"""User-approved installation of models referenced by the current workflow."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import ipaddress
import json
import os
import re
import secrets
from pathlib import Path
import shutil
import struct
import threading
import time
import urllib.parse
import urllib.request

from aiohttp import web
import folder_paths
from server import PromptServer

WEB_DIRECTORY = "./web"
NODE_CLASS_MAPPINGS = {}
_lock = threading.Lock()
_cancel = threading.Event()
_state = {"running": False, "items": []}
_catalogue = None
_size_cache = {}
_size_lock = threading.Lock()
_recycle_plans = {}
_cleanup_running = False


def source_json(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ("huggingface.co", "civitai.com"):
        raise ValueError("Unsupported model catalogue.")
    request = urllib.request.Request(url, headers={"User-Agent": "ComfyUI-Workflow-Model-Installer/1.0", "Accept": "application/json"})
    with urllib.request.build_opener(ModelRedirects()).open(request, timeout=15) as response:
        payload = response.read(10_000_001)
    if len(payload) > 10_000_000:
        raise ValueError("Model catalogue response is too large; provide a specific model page.")
    return json.loads(payload)


def find_sources(model, provider="huggingface", page=""):
    model_target(model)
    if provider == "auto" and not page:
        errors = []
        for fallback in ("huggingface", "civitai"):
            try:
                matches = find_sources(model, fallback)
                if matches:
                    return matches
            except (ValueError, OSError) as exc:
                errors.append(str(exc))
        if len(errors) == 2:
            raise ValueError("Both model catalogues could not be reached. Try again or provide a specific model page.")
        return []
    name = model["name"]
    query = re.split(r"[_\-\s.]", Path(name).stem)[0]
    candidates = []
    if page:
        parsed = urllib.parse.urlsplit(page)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError("Enter an HTTPS Hugging Face or Civitai page.")
        provider = {"huggingface.co": "huggingface", "civitai.com": "civitai"}.get(parsed.hostname)
        if not provider:
            raise ValueError("Custom links currently support Hugging Face and Civitai only.")
    if provider == "huggingface":
        if page:
            parts = parsed.path.strip("/").split("/")
            if len(parts) < 2:
                raise ValueError("Provide a Hugging Face model repository or file page.")
            repos = [{"id": "/".join(parts[:2])}]
        else:
            repos = source_json("https://huggingface.co/api/models?" + urllib.parse.urlencode({"search": query, "limit": 20, "full": "true"}))
        for repo in repos[:20]:
            if not page and not any(Path(file.get("rfilename", "")).name == name for file in repo.get("siblings", [])):
                continue
            repo_id = repo.get("id", "")
            revision_path = ""
            if page and len(parts) >= 4 and parts[2] in ("blob", "resolve", "tree"):
                revision_path = "/revision/" + urllib.parse.quote(parts[3], safe="")
                if parts[2] in ("blob", "resolve") and len(parts) >= 5 and urllib.parse.unquote(parts[-1]) != name:
                    raise ValueError("This link's filename does not match the workflow model.")
            info = source_json("https://huggingface.co/api/models/" + urllib.parse.quote(repo_id, safe="/") + revision_path + "?blobs=true")
            revision = info.get("sha") or "main"
            for file in info.get("siblings", []):
                filename = file.get("rfilename", "")
                if Path(filename).name != name:
                    continue
                url = f"https://huggingface.co/{repo_id}/resolve/{revision}/" + urllib.parse.quote(filename, safe="/")
                candidates.append({**model, "url": url, "sha256": (file.get("lfs") or {}).get("sha256", ""), "size": file.get("size") or (file.get("lfs") or {}).get("size"), "repository": repo_id, "version": revision, "source": "Hugging Face search (selected)"})
    elif provider == "civitai":
        if page:
            version = urllib.parse.parse_qs(parsed.query).get("modelVersionId", [None])[0]
            match = re.search(r"/(?:model-versions|api/download/models)/(\d+)", parsed.path)
            if version or match:
                version = version or match.group(1)
                if not str(version).isdigit():
                    raise ValueError("Invalid Civitai model version.")
                versions = [source_json(f"https://civitai.com/api/v1/model-versions/{version}")]
            else:
                match = re.search(r"/models/(\d+)", parsed.path)
                if not match:
                    raise ValueError("Provide a Civitai model or model-version page.")
                versions = source_json(f"https://civitai.com/api/v1/models/{match.group(1)}").get("modelVersions", [])
        else:
            models = source_json("https://civitai.com/api/v1/models?" + urllib.parse.urlencode({"query": query, "limit": 20})).get("items", [])
            versions = [version for entry in models for version in entry.get("modelVersions", [])]
        for version in versions:
            for file in version.get("files", []):
                if file.get("name") != name or file.get("virusScanResult") == "Danger" or file.get("pickleScanResult") == "Danger":
                    continue
                url = file.get("downloadUrl") or version.get("downloadUrl")
                if not url:
                    continue
                checked_url(url)
                candidates.append({**model, "url": url, "sha256": file.get("hashes", {}).get("SHA256", ""), "size": int(file.get("sizeKB", file.get("sizeKb", 0)) * 1024), "repository": "Civitai", "version": str(version.get("name", version.get("id", ""))), "source": "Civitai search (selected)"})
    else:
        raise ValueError("Choose Hugging Face or Civitai.")
    return candidates[:30]


def lookup_model_size(item):
    result = {"name": item["name"], "directory": item["directory"], "size": None}
    if item["status"] == "installed":
        try:
            result["size"] = Path(item["destination"]).stat().st_size
        except OSError:
            pass
        return result
    if item["status"] != "missing":
        return result
    url = checked_url(item["url"])
    with _size_lock:
        cached = _size_cache.get(url)
        if cached and time.monotonic() - cached[0] < (3600 if cached[1] else 30):
            result["size"] = cached[1]
            return result
    try:
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "ComfyUI-Workflow-Model-Installer/1.0"})
        # Inspect response headers only. Never read or save the model body here.
        with urllib.request.build_opener(ModelRedirects()).open(request, timeout=15) as response:
            size = int(response.headers.get("Content-Length") or response.headers.get("X-Linked-Size") or 0)
            content_type = response.headers.get("Content-Type", "").lower()
            if size > 0 and "text/html" not in content_type and "application/json" not in content_type:
                result["size"] = size
    except (OSError, ValueError):
        pass
    with _size_lock:
        if len(_size_cache) > 500:
            _size_cache.clear()
        _size_cache[url] = (time.monotonic(), result["size"])
    return result


def model_sizes(models):
    items = plan_models(models)
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(lookup_model_size, items))


def installed_model_path(model):
    # Validate the name/category; never accept a client-supplied filesystem path.
    model_target(model)
    directory, name = model["directory"], model["name"]
    existing = folder_paths.get_full_path(directory, name)
    if not existing:
        relative = next((value for value in folder_paths.get_filename_list(directory) if Path(value).name == name), None)
        if relative:
            existing = folder_paths.get_full_path(directory, relative)
    if not existing:
        raise ValueError("This model is not installed yet.")
    path = Path(existing).resolve()
    roots = [Path(root).resolve() for root in folder_paths.get_folder_paths(directory)]
    if not path.is_file() or path.stat().st_size == 0 or not any(path.is_relative_to(root) for root in roots):
        raise ValueError("Installed model must be inside a configured ComfyUI model folder.")
    return path


def installed_model_folder(model):
    return installed_model_path(model).parent


def ensure_idle():
    if _state["running"] or _cleanup_running:
        raise ValueError("Finish or cancel model downloads before recycling files.")
    running, queued = PromptServer.instance.prompt_queue.get_current_queue_volatile()
    if running or queued:
        raise ValueError("Wait until the generation queue is empty before recycling models.")


def prepare_recycle(models):
    ensure_idle()
    if not isinstance(models, list) or not 1 <= len(models) <= 100:
        raise ValueError("Select between 1 and 100 installed models.")
    items, seen = [], set()
    for model in models:
        path = installed_model_path(model)
        if str(path).casefold() in seen:
            continue
        seen.add(str(path).casefold())
        stat = path.stat()
        items.append({"name": model["name"], "directory": model["directory"], "path": str(path), "size": stat.st_size, "fingerprint": (stat.st_size, stat.st_mtime_ns, stat.st_dev, stat.st_ino)})
    token = secrets.token_urlsafe(24)
    with _lock:
        for key in list(_recycle_plans):
            if time.monotonic() - _recycle_plans[key][0] > 600:
                del _recycle_plans[key]
        if len(_recycle_plans) >= 20:
            raise ValueError("Too many open confirmations; try again later.")
        _recycle_plans[token] = (time.monotonic(), items)
    return {"token": token, "items": [{k: v for k, v in item.items() if k != "fingerprint"} for item in items]}


def recycle_one(path):
    if os.name != "nt":
        raise ValueError("Recycle Bin is currently supported on Windows only.")
    # Use the existing Windows runtime. No permanent-delete fallback is permitted.
    import pythoncom
    from win32com.shell import shell
    pythoncom.CoInitialize()
    operation = item = None
    try:
        operation = pythoncom.CoCreateInstance(shell.CLSID_FileOperation, None, pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IFileOperation)
        # RECYCLEONDELETE, ADDUNDORECORD, EARLYFAILURE, NOERRORUI, NOCONFIRMATION,
        # SILENT, NO_CONNECTED_ELEMENTS. Windows must recycle or return an error.
        operation.SetOperationFlags(0x00080000 | 0x20000000 | 0x00100000 | 0x0400 | 0x0010 | 0x0004 | 0x2000)
        item = shell.SHCreateItemFromParsingName(str(path), None, shell.IID_IShellItem)
        operation.DeleteItem(item, None)
        operation.PerformOperations()
        if operation.GetAnyOperationsAborted() or path.exists():
            raise OSError("Windows could not move this file to Recycle Bin; it was not permanently deleted.")
    finally:
        operation = item = None
        pythoncom.CoUninitialize()


def confirm_recycle(token):
    global _cleanup_running
    with _lock:
        ensure_idle()
        saved = _recycle_plans.pop(token, None)
        if not saved or time.monotonic() - saved[0] > 600:
            raise ValueError("Confirmation expired. Review the installed files again.")
        items = saved[1]
        for item in items:
            path = installed_model_path(item)
            stat = path.stat()
            if str(path) != item["path"] or (stat.st_size, stat.st_mtime_ns, stat.st_dev, stat.st_ino) != item["fingerprint"]:
                raise ValueError("A selected file changed. Review the files again before recycling.")
        _cleanup_running = True
    results = []
    try:
        for item in items:
            try:
                path = installed_model_path(item)
                stat = path.stat()
                if str(path) != item["path"] or (stat.st_size, stat.st_mtime_ns, stat.st_dev, stat.st_ino) != item["fingerprint"]:
                    raise ValueError("File changed after confirmation. It was not recycled.")
                recycle_one(path)
                with _lock:
                    _state["items"] = [entry for entry in _state["items"] if entry.get("destination") != item["path"]]
                results.append({"name": item["name"], "status": "recycled"})
            except Exception as exc:
                results.append({"name": item["name"], "status": "failed", "error": str(exc)})
        folder_paths.filename_list_cache.clear()
        return {"items": results}
    finally:
        with _lock:
            _cleanup_running = False


def template_catalogue():
    """Resolve filenames from installed templates only; never guess a remote model."""
    global _catalogue
    if _catalogue is not None:
        return _catalogue
    from comfyui_workflow_templates import iter_templates, get_asset_path
    catalogue = {}

    def visit(value):
        if isinstance(value, dict):
            for model in value.get("models", []) if isinstance(value.get("models"), list) else []:
                if isinstance(model, dict) and model.get("name") and model.get("directory") and model.get("url"):
                    key = (model["directory"], model["name"])
                    if key not in catalogue:
                        catalogue[key] = model
                    elif catalogue[key] and catalogue[key]["url"] != model["url"]:
                        catalogue[key] = None
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    for entry in iter_templates():
        for asset in entry.assets:
            if asset.filename.endswith(".json"):
                path = get_asset_path(entry.template_id, asset.filename)
                try:
                    visit(json.loads(Path(path).read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    continue
    _catalogue = catalogue
    return catalogue


def resolve_model(raw):
    item = dict(raw)
    if item.get("url"):
        return item
    catalogue = template_catalogue()
    name, directory = item.get("name"), item.get("directory")
    match = catalogue.get((directory, name))
    if match:
        return {**match, **item, "url": match["url"]}
    if not directory:
        matches = [model for (folder, filename), model in catalogue.items() if filename == name and model]
        if len(matches) == 1:
            return {**item, **matches[0]}
    return item


def checked_url(url, redirect=False):
    parsed = urllib.parse.urlsplit(url)
    host = (parsed.hostname or "").lower()
    allowed = host in ("huggingface.co", "civitai.com")
    if redirect:
        allowed = allowed or host.endswith((".huggingface.co", ".hf.co", ".cloudfront.net", ".civitai.com", ".civitai.green", ".r2.cloudflarestorage.com"))
    if not allowed or parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Only HTTPS Hugging Face and Civitai model links are supported.")
    if not redirect and not ((host == "huggingface.co" and "/resolve/" in parsed.path) or (host == "civitai.com" and re.fullmatch(r"/api/download/models/\d+", parsed.path))):
        raise ValueError("A direct Hugging Face or Civitai model file link is required.")
    return url


class ModelRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        checked_url(newurl, redirect=True)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def model_target(model):
    name = model.get("name", "")
    directory = model.get("directory", "")
    if not isinstance(name, str) or not name or name in (".", "..") or any(c in name for c in '/\\:\x00'):
        raise ValueError("Model filename must be a plain filename.")
    if Path(name).suffix.lower() not in (".safetensors", ".gguf"):
        raise ValueError("This installer supports safetensors and GGUF model files.")
    if not isinstance(directory, str) or directory not in folder_paths.folder_names_and_paths:
        raise ValueError("Model folder is not registered with ComfyUI.")
    roots = folder_paths.get_folder_paths(directory)
    if not roots:
        raise ValueError("Model folder has no configured location.")
    root = Path(roots[0]).resolve()
    target = (root / name).resolve()
    if target.parent != root:
        raise ValueError("Model destination must stay inside its configured folder.")
    return target


def plan_models(models):
    if not isinstance(models, list) or len(models) > 100:
        raise ValueError("Review at most 100 models at a time.")
    result = []
    seen = set()
    for raw in models:
        if not isinstance(raw, dict):
            raise ValueError("Invalid workflow model entry.")
        resolved = resolve_model(raw)
        item = {k: resolved.get(k, "") for k in ("name", "directory", "url", "sha256")}
        item["source"] = raw.get("source") or ("Workflow metadata" if raw.get("url") else "Installed official template catalogue" if item["url"] else "No source supplied")
        try:
            target = model_target(item)
            key = str(target).casefold()
            if key in seen:
                continue
            seen.add(key)
            item["destination"] = str(target)
            existing = folder_paths.get_full_path(item["directory"], item["name"])
            if not existing:
                # Existing installations may keep models in subfolders or extra model paths.
                relative = next((name for name in folder_paths.get_filename_list(item["directory"]) if Path(name).name == item["name"]), None)
                if relative:
                    existing = folder_paths.get_full_path(item["directory"], relative)
            if existing and Path(existing).is_file() and Path(existing).stat().st_size > 0:
                item.update(status="installed", destination=existing)
            else:
                checked_url(item["url"])
                checksum = item["sha256"]
                if checksum and (not isinstance(checksum, str) or len(checksum) != 64 or any(c not in "0123456789abcdefABCDEF" for c in checksum)):
                    raise ValueError("Invalid model SHA-256 checksum.")
                item["status"] = "missing"
        except (ValueError, TypeError, OSError) as exc:
            item.update(status="unsupported", error=str(exc))
        result.append(item)
    return result


def check_model_file(path, name):
    size = path.stat().st_size
    with path.open("rb") as handle:
        if name.lower().endswith(".gguf"):
            if handle.read(4) != b"GGUF":
                raise ValueError("Downloaded file is not a GGUF model.")
        else:
            prefix = handle.read(8)
            if len(prefix) != 8:
                raise ValueError("Downloaded model is incomplete.")
            header_size = struct.unpack("<Q", prefix)[0]
            if not 2 <= header_size <= min(size - 8, 100_000_000):
                raise ValueError("Downloaded file is not a safetensors model.")
            if not isinstance(json.loads(handle.read(header_size)), dict):
                raise ValueError("Invalid safetensors header.")


def install_models(items):
    opener = urllib.request.build_opener(ModelRedirects())
    try:
        for item in items:
            if _cancel.is_set():
                item["status"] = "cancelled"
                continue
            partial = None
            try:
                target = model_target(item)
                if target.is_file() and target.stat().st_size:
                    item["status"] = "installed"
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                partial = target.with_name(target.name + ".workflow-download.part")
                if partial.is_symlink():
                    raise ValueError("Temporary download path must not be a symbolic link.")
                item.update(status="downloading", downloaded=0, total=0)
                request = urllib.request.Request(checked_url(item["url"]), headers={"User-Agent": "ComfyUI-Workflow-Model-Installer/1.0"})
                digest = hashlib.sha256()
                with opener.open(request, timeout=30) as response:
                    total = int(response.headers.get("Content-Length", 0))
                    item["total"] = total
                    if total and total + 256 * 1024**2 > shutil.disk_usage(target.parent).free:
                        raise ValueError("Not enough free disk space for this model.")
                    with partial.open("wb") as output:
                        while True:
                            if _cancel.is_set():
                                raise InterruptedError("Download cancelled.")
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            output.write(chunk)
                            digest.update(chunk)
                            item["downloaded"] += len(chunk)
                if total and item["downloaded"] != total:
                    raise ValueError("Incomplete download; retry this model.")
                if item.get("sha256") and digest.hexdigest() != item["sha256"].lower():
                    raise ValueError("Model checksum did not match.")
                check_model_file(partial, item["name"])
                # Never replace an existing model, including one installed during this download.
                try:
                    if os.name == "nt":
                        os.rename(partial, target)
                    else:
                        os.link(partial, target)
                except FileExistsError:
                    pass
                partial.unlink(missing_ok=True)
                item["status"] = "installed"
            except InterruptedError:
                item["status"] = "cancelled"
            except Exception as exc:
                item.update(status="failed", error=str(exc))
            finally:
                if partial is not None and partial.exists():
                    partial.unlink()
    finally:
        with _lock:
            _state["running"] = False


@PromptServer.instance.routes.post("/workflow-model-installer/plan")
async def plan(request):
    try:
        return web.json_response({"items": plan_models((await request.json()).get("models"))})
    except (ValueError, TypeError) as exc:
        return web.json_response({"error": str(exc)}, status=400)


@PromptServer.instance.routes.post("/workflow-model-installer/start")
async def start(request):
    body = await request.json()
    if body.get("approved") is not True:
        return web.json_response({"error": "Approve the model list before downloading."}, status=400)
    try:
        items = plan_models(body.get("models"))
    except (ValueError, TypeError) as exc:
        return web.json_response({"error": str(exc)}, status=400)
    if any(item["status"] == "unsupported" for item in items):
        return web.json_response({"error": "Some model links or folders are unsupported; review the list."}, status=400)
    with _lock:
        if _state["running"] or _cleanup_running:
            return web.json_response({"error": "A model installation is already running."}, status=409)
        items = [item for item in items if item["status"] == "missing"]
        for item in items:
            item["status"] = "queued"
        _cancel.clear()
        _state.update(running=bool(items), items=items)
        if items:
            threading.Thread(target=install_models, args=(items,), daemon=True).start()
    return web.json_response({"started": len(items)})


@PromptServer.instance.routes.post("/workflow-model-installer/sizes")
async def sizes(request):
    try:
        models = (await request.json()).get("models")
        return web.json_response({"items": await asyncio.to_thread(model_sizes, models)})
    except (ValueError, TypeError) as exc:
        return web.json_response({"error": str(exc)}, status=400)


@PromptServer.instance.routes.get("/workflow-model-installer/status")
async def status(request):
    with _lock:
        return web.json_response(_state)


@PromptServer.instance.routes.post("/workflow-model-installer/cancel")
async def cancel(request):
    _cancel.set()
    return web.json_response({"cancel_requested": True})


@PromptServer.instance.routes.post("/workflow-model-installer/open-folder")
async def open_model_folder(request):
    try:
        if not request.remote or not ipaddress.ip_address(request.remote).is_loopback:
            return web.json_response({"error": "Open folder is available only on this computer."}, status=403)
        folder = installed_model_folder(await request.json())
        if os.name != "nt":
            return web.json_response({"error": "Open folder is currently available on Windows only."}, status=400)
        os.startfile(str(folder))
        return web.json_response({"opened": True, "folder": str(folder)})
    except (ValueError, TypeError, OSError) as exc:
        return web.json_response({"error": str(exc)}, status=400)


@PromptServer.instance.routes.post("/workflow-model-installer/sources")
async def sources(request):
    try:
        body = await request.json()
        candidates = await asyncio.to_thread(find_sources, body.get("model", {}), body.get("provider", "huggingface"), body.get("url", ""))
        return web.json_response({"items": candidates})
    except (ValueError, TypeError, OSError) as exc:
        return web.json_response({"error": str(exc)}, status=400)


@PromptServer.instance.routes.post("/workflow-model-installer/recycle-plan")
async def recycle_plan(request):
    try:
        if not request.remote or not ipaddress.ip_address(request.remote).is_loopback:
            return web.json_response({"error": "Model cleanup is available only on this computer."}, status=403)
        return web.json_response(prepare_recycle((await request.json()).get("models")))
    except (ValueError, TypeError, OSError) as exc:
        return web.json_response({"error": str(exc)}, status=400)


@PromptServer.instance.routes.post("/workflow-model-installer/recycle-confirm")
async def recycle_confirm(request):
    try:
        if not request.remote or not ipaddress.ip_address(request.remote).is_loopback:
            return web.json_response({"error": "Model cleanup is available only on this computer."}, status=403)
        body = await request.json()
        if body.get("approved") is not True:
            raise ValueError("Confirm the selected files before moving them to Recycle Bin.")
        return web.json_response(await asyncio.to_thread(confirm_recycle, body.get("token")))
    except (ValueError, TypeError, OSError) as exc:
        return web.json_response({"error": str(exc)}, status=400)

