import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from aiohttp import web

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
sys.modules["server"] = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=web.RouteTableDef())))
spec = importlib.util.spec_from_file_location("installer_under_test", Path(__file__).resolve().parents[1] / "__init__.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class Response(io.BytesIO):
    def __init__(self, content):
        super().__init__(content)
        self.headers = {"Content-Length": str(len(content))}


class Request:
    remote = "127.0.0.1"
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        installer.folder_paths.folder_names_and_paths.pop("installer_test", None)
        installer.folder_paths.filename_list_cache.pop("installer_test", None)
        installer.folder_paths.add_model_folder_path("installer_test", str(self.folder))
        installer._cancel.clear()
        installer._state.update(running=False, items=[])
        installer._cleanup_running = False
        installer._recycle_plans.clear()
        installer.PromptServer.instance.prompt_queue = types.SimpleNamespace(get_current_queue_volatile=lambda: ([], []))
        self.model = {"name": "test.safetensors", "directory": "installer_test", "url": "https://huggingface.co/Comfy-Org/test/resolve/main/test.safetensors"}

    def test_paths_and_sources(self):
        for changes in ({"name": "../escape.safetensors"}, {"name": "C:escape.safetensors"}, {"directory": "../vae"}, {"url": "http://huggingface.co/x/resolve/main/a"}, {"url": "https://127.0.0.1/resolve/main/a"}, {"url": "https://huggingface.co.evil.example/resolve/main/a"}):
            self.assertEqual(installer.plan_models([{**self.model, **changes}])[0]["status"], "unsupported")
        with self.assertRaises(ValueError):
            installer.checked_url("https://127.0.0.1/model", redirect=True)

    def test_skip_existing_and_deduplicate(self):
        (self.folder / self.model["name"]).write_bytes(b"existing")
        items = installer.plan_models([self.model, self.model])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["status"], "installed")

    def test_approval_is_required(self):
        coroutine = installer.start(Request({"models": [self.model]}))
        with self.assertRaises(StopIteration) as completed:
            coroutine.send(None)
        response = completed.exception.value
        self.assertEqual(response.status, 400)
        self.assertFalse(installer._state["running"])

    def test_pre_download_size_uses_head_only(self):
        item = installer.plan_models([self.model])[0]
        response = Response(b"")
        response.headers = {"Content-Length": "123456789", "Content-Type": "application/octet-stream"}
        opener = types.SimpleNamespace(open=lambda request, **kwargs: response)
        requests = []

        def open_head(request, **kwargs):
            requests.append(request)
            return response

        opener.open = open_head
        installer._size_cache.clear()
        with patch.object(installer.urllib.request, "build_opener", return_value=opener):
            result = installer.lookup_model_size(item)
        self.assertEqual(requests[0].method, "HEAD")
        self.assertEqual(result["size"], 123456789)
        self.assertFalse((self.folder / self.model["name"]).exists())
        with patch.object(installer.urllib.request, "build_opener", side_effect=AssertionError("Cache should prevent another request")):
            self.assertEqual(installer.lookup_model_size(item)["size"], 123456789)

    def test_open_folder_only_for_installed_models(self):
        with self.assertRaises(ValueError):
            installer.installed_model_folder(self.model)
        (self.folder / self.model["name"]).write_bytes(b"existing")
        self.assertEqual(installer.installed_model_folder(self.model), self.folder.resolve())
        with self.assertRaises(ValueError):
            installer.installed_model_folder({**self.model, "name": "../outside.safetensors"})
        with patch.object(installer.os, "startfile") as launch:
            coroutine = installer.open_model_folder(Request(self.model))
            with self.assertRaises(StopIteration) as completed:
                coroutine.send(None)
            self.assertEqual(completed.exception.value.status, 200)
            launch.assert_called_once_with(str(self.folder.resolve()))
        remote = Request(self.model)
        remote.remote = "192.0.2.1"
        with patch.object(installer.os, "startfile") as launch:
            coroutine = installer.open_model_folder(remote)
            with self.assertRaises(StopIteration) as completed:
                coroutine.send(None)
            self.assertEqual(completed.exception.value.status, 403)
            launch.assert_not_called()

    def test_local_import_preview_and_copy(self):
        download_temp = tempfile.TemporaryDirectory(dir=ROOT.parent)
        self.addCleanup(download_temp.cleanup)
        downloads = Path(download_temp.name)
        source = downloads / self.model["name"]
        header = b'{"__metadata__":{}}'
        data = struct.pack("<Q", len(header)) + header
        source.write_bytes(data)
        target = self.folder / self.model["name"]
        model = {**self.model, "url": ""}
        preview = installer.prepare_import(str(downloads), [model])
        self.assertEqual(preview["items"][0]["destination"], str(target.resolve()))
        self.assertFalse(target.exists())
        result = installer.confirm_import(preview["token"])
        self.assertEqual(result["items"][0]["status"], "installed")
        self.assertEqual(target.read_bytes(), data)
        self.assertEqual(source.read_bytes(), data)
        self.assertEqual(installer.prepare_import(str(downloads), [model])["items"], [])
        with self.assertRaises(ValueError):
            installer.confirm_import(preview["token"])

    def test_import_preserves_existing_and_rejects_changed_source(self):
        download_temp = tempfile.TemporaryDirectory(dir=ROOT.parent)
        self.addCleanup(download_temp.cleanup)
        downloads = Path(download_temp.name)
        source = downloads / self.model["name"]
        source.write_bytes(b"first")
        target = self.folder / self.model["name"]
        preview = installer.prepare_import(str(downloads), [self.model])
        source.write_bytes(b"different")
        self.assertEqual(installer.confirm_import(preview["token"])["items"][0]["status"], "failed")
        self.assertFalse(target.exists())
        preview = installer.prepare_import(str(downloads), [self.model])
        target.write_bytes(b"existing")
        self.assertEqual(installer.confirm_import(preview["token"])["items"][0]["status"], "skipped")
        self.assertEqual(target.read_bytes(), b"existing")

    def test_download_atomic_and_invalid_file(self):
        header = json.dumps({"__metadata__": {}}).encode()
        valid = struct.pack("<Q", len(header)) + header
        opener = types.SimpleNamespace(open=lambda *args, **kwargs: Response(valid))
        item = installer.plan_models([self.model])[0]
        with patch.object(installer.urllib.request, "build_opener", return_value=opener):
            installer.install_models([item])
        self.assertEqual(item["status"], "installed", item.get("error"))
        self.assertEqual((self.folder / self.model["name"]).read_bytes(), valid)
        # A concurrent/existing installation must never be overwritten.
        with patch.object(installer.urllib.request, "build_opener", return_value=object()):
            installer.install_models([item])
        self.assertEqual((self.folder / self.model["name"]).read_bytes(), valid)
        other = installer.plan_models([{**self.model, "name": "bad.safetensors"}])[0]
        opener = types.SimpleNamespace(open=lambda *args, **kwargs: Response(b"<html>not a model</html>"))
        with patch.object(installer.urllib.request, "build_opener", return_value=opener):
            installer.install_models([other])
        self.assertEqual(other["status"], "failed")
        self.assertFalse((self.folder / "bad.safetensors").exists())
        self.assertFalse(list(self.folder.glob("*.part")))

    def test_exact_source_matches_and_auto_fallback(self):
        hf_info = {"id": "author/test", "sha": "pinned-commit", "siblings": [{"rfilename": "test.safetensors", "size": 123, "lfs": {"sha256": "a" * 64}}, {"rfilename": "test-fp16.safetensors"}]}
        with patch.object(installer, "source_json", return_value=hf_info):
            result = installer.find_sources(self.model, page="https://huggingface.co/author/test")
        self.assertEqual(len(result), 1)
        self.assertIn('/resolve/pinned-commit/', result[0]['url'])
        self.assertEqual(result[0]['sha256'], 'a' * 64)
        with self.assertRaises(ValueError):
            installer.find_sources(self.model, page="https://127.0.0.1/private")
        with patch.object(installer, "source_json", side_effect=[[], {"items": [{"modelVersions": [{"name": "v1", "files": [{"name": "test.safetensors", "downloadUrl": "https://civitai.com/api/download/models/123", "sizeKB": 20, "hashes": {"SHA256": "b" * 64}}]}]}]}]):
            result = installer.find_sources(self.model, "auto")
        self.assertEqual(result[0]['source'], 'Civitai search (selected)')
        self.assertEqual(result[0]['size'], 20 * 1024)

    def test_recycle_confirmation_and_busy_guards(self):
        path = self.folder / self.model['name']
        path.write_bytes(b'test-only fixture')
        plan = installer.prepare_recycle([self.model])
        with patch.object(installer, 'recycle_one') as recycle:
            result = installer.confirm_recycle(plan['token'])
            recycle.assert_called_once_with(path.resolve())
            self.assertEqual(result['items'][0]['status'], 'recycled')
        with self.assertRaises(ValueError):
            installer.confirm_recycle(plan['token'])
        plan = installer.prepare_recycle([self.model])
        path.write_bytes(b'changed test-only fixture')
        with patch.object(installer, 'recycle_one') as recycle:
            with self.assertRaises(ValueError):
                installer.confirm_recycle(plan['token'])
            recycle.assert_not_called()
        installer._state['running'] = True
        with self.assertRaises(ValueError):
            installer.prepare_recycle([self.model])

    def test_actual_minimax_template_destinations(self):
        from comfyui_workflow_templates import get_asset_path
        workflow = json.loads(Path(get_asset_path("video_minimax_h3_t2v", "video_minimax_h3_t2v.json")).read_text(encoding="utf-8"))
        models = []

        def visit(value):
            if isinstance(value, dict):
                if isinstance(value.get("models"), list):
                    models.extend(value["models"])
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(workflow)
        items = installer.plan_models(models)
        self.assertEqual(len(items), 5)
        self.assertEqual(sorted(item["directory"] for item in items), ["diffusion_models", "loras", "text_encoders", "vae", "vae"])
        self.assertFalse(any(item["status"] == "unsupported" for item in items))
        # Older workflows without URL metadata resolve from installed templates.
        item = installer.resolve_model({"name": models[0]["name"], "directory": models[0]["directory"]})
        self.assertEqual(item["url"], models[0]["url"])


if __name__ == "__main__":
    unittest.main()

