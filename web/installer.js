import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createDownloadPanel } from "./progress.js?v=20261105-folder-import";

function installStyles() {
    if (document.getElementById("workflow-model-installer-style")) return;
    const style = document.createElement("style");
    style.id = "workflow-model-installer-style";
    style.textContent = `
        #workflow-model-installer-dialog h2 { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
        #workflow-model-installer-dialog p { margin: 12px 0; line-height: 1.5; }
        #workflow-model-installer-dialog button {
            min-height: 42px; padding: 10px 16px; border: 2px solid #8b9bb3;
            border-radius: 8px; background: #39475b; color: #fff;
            font-size: 14px; font-weight: 700; line-height: 1.3; cursor: pointer;
            box-shadow: 0 2px 4px #0005; opacity: 1;
        }
        #workflow-model-installer-dialog button.wm-primary { background: #1261c9; border-color: #82b9ff; }
        #workflow-model-installer-dialog button.wm-cancel { background: #a52a35; border-color: #ff9ba6; }
        #workflow-model-installer-dialog button:disabled {
            background: #303845; color: #b8c3d3; border-color: #626f82;
            border-style: dashed; cursor: not-allowed; box-shadow: none; opacity: 1;
        }
        #workflow-model-installer-dialog button:not(:disabled):hover,
        #workflow-model-installer-button:hover { filter: brightness(1.2); }
        #workflow-model-installer-dialog button:focus-visible,
        #workflow-model-installer-button:focus-visible { outline: 3px solid #ffe58a; outline-offset: 3px; }
        #workflow-model-installer-button {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 7px; width: calc(var(--sidebar-width, 56px) - 8px); min-height: 48px;
            flex-shrink: 0; margin: 4px; padding: 5px 2px;
            background: transparent; color: var(--descrip-text, #999); border: 1px solid transparent;
            border-radius: 8px; cursor: pointer; font: 400 12px/1.2 sans-serif;
        }
        #workflow-model-installer-button .wm-icon { display: block; width: 23px; height: 23px; line-height: 1; }
        #workflow-model-installer-button:hover { background: #ffffff0a; color: #d4d4d4; }
        #workflow-model-installer-button[aria-expanded=true] { background: #ffffff10; color: #e5e5e5; }
        #workflow-model-installer-button .wm-mini { background: #41474d; }
        #workflow-model-installer-button .wm-mini-fill { background: #9aaab9; }
    `;
    document.head.append(style);
}

function workflowModels(workflow) {
    const models = new Map();
    const visited = new WeakSet();
    function visit(value) {
        if (!value || typeof value !== "object" || visited.has(value)) return;
        visited.add(value);
        if (typeof value.type === "string" && value.widgets_values) {
            const values = [];
            function collect(input) {
                if (typeof input === "string" && /\.(safetensors|gguf)$/i.test(input)) values.push(input);
                else if (Array.isArray(input)) input.forEach(collect);
                else if (input && typeof input === "object") Object.values(input).forEach(collect);
            }
            collect(value.widgets_values);
            const folders = { CheckpointLoaderSimple: "checkpoints", CheckpointLoader: "checkpoints", UNETLoader: "diffusion_models", CLIPLoader: "text_encoders", DualCLIPLoader: "text_encoders", TripleCLIPLoader: "text_encoders", QuadrupleCLIPLoader: "text_encoders", VAELoader: "vae", LoraLoader: "loras", LoraLoaderModelOnly: "loras", ControlNetLoader: "controlnet", CLIPVisionLoader: "clip_vision", UpscaleModelLoader: "upscale_models" };
            const linkedWidgets = new Set((value.inputs || [])
                .filter(input => input.link != null)
                .map(input => input.widget?.name || input.name));
            const namedWidgets = Object.entries(value.widgets_values_named ||
                (Array.isArray(value.widgets_values) ? {} : value.widgets_values));
            for (const filename of values) {
                const matchingWidgets = namedWidgets.filter(([, current]) => current === filename);
                const name = filename.replaceAll("\\", "/").split("/").pop();
                const metadata = value.properties?.models?.find(model => model.name === name);
                if (!metadata && !folders[value.type] && matchingWidgets.length && matchingWidgets.every(([name]) => linkedWidgets.has(name))) continue;
                const model = metadata || { name, directory: folders[value.type] || "", url: "" };
                models.set(`${model.directory}/${name}`, model);
            }
        }
        for (const child of Object.values(value)) visit(child);
    }
    visit(workflow);
    const entries = [...models.values()];
    return entries.filter(model => model.directory || !entries.some(other => other.name === model.name && other.directory));
}

async function request(path, body) {
    const response = await api.fetchApi(`/workflow-model-installer/${path}`, body === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (response.status === 404) throw new Error("Restart ComfyUI once to activate the model installer, then refresh this page.");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The model installer request failed.");
    return data;
}

function element(tag, text, parent) {
    const result = document.createElement(tag);
    if (text) result.textContent = text;
    parent?.append(result);
    return result;
}

function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "size unknown";
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(2)} MB`;
}

let downloadPanel;
function openInstaller() { return downloadPanel?.toggle(); }

app.registerExtension({
    name: "local.WorkflowModelInstaller",
    commands: [{ id: "local.WorkflowModelInstaller.Open", label: "Install missing workflow models", function: openInstaller }],
    menuCommands: [{ path: ["Workflow"], commands: ["local.WorkflowModelInstaller.Open"] }],
    setup() {
        installStyles();
        const button = element("button");
        button.id = "workflow-model-installer-button";
        button.type = "button";
        button.title = "Missing Models — review and install workflow models";
        button.setAttribute("aria-label", "Missing Models");
        const icon = element("span", "", button);
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "23"); svg.setAttribute("height", "23");
        svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.5"); svg.setAttribute("stroke-linejoin", "round");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "m12 2 10 5-10 5L2 7Zm-10 10 10 5 10-5M2 17l10 5 10-5");
        svg.append(path); icon.append(svg);
        icon.className = "wm-icon";
        icon.setAttribute("aria-hidden", "true");
        element("span", "Workflow Models", button);
        downloadPanel = createDownloadPanel({ app, request, workflowModels, element, formatSize, button });
        button.onclick = openInstaller;
        const placeButton = () => {
            const toolbar = document.querySelector('[data-testid="sidebar-top-group"]');
            if (toolbar && button.parentElement !== toolbar) toolbar.append(button);
        };
        placeButton();
        new MutationObserver(placeButton).observe(document.body, { childList: true, subtree: true });
    }
});

