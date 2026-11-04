export function downloadProgress(items) {
    const installed = items.filter(item => item.status === "installed").length;
    const active = items.find(item => item.status === "downloading");
    const failed = items.filter(item => item.status === "failed").length;
    const cancelled = items.filter(item => item.status === "cancelled").length;
    const percent = active?.total > 0 ? Math.min(100, Math.floor(100 * (active.downloaded || 0) / active.total)) : null;
    return { installed, active, failed, cancelled, percent, total: items.length,
        remaining: items.length - installed, queuePercent: items.length ? 100 * installed / items.length : 0 };
}

export function createDownloadPanel({ app, request, workflowModels, element, formatSize, button }) {
    const style = element("style");
    style.textContent = `
        #workflow-model-installer-dialog.wm-drawer {
            position: fixed; inset: 64px auto auto calc(var(--sidebar-width, 64px) + 10px); height: var(--wm-height, auto); box-sizing: border-box; margin: 0; width: min(460px, calc(100vw - 80px));
            max-height: calc(100vh - 80px); overflow: hidden; padding: 0; display: flex; flex-direction: column;
            background: #171717; color: #eeeeee; border: 1px solid #404040; border-radius: 8px;
            box-shadow: 0 14px 50px #0008; z-index: 1100; font: 13px/1.45 system-ui, sans-serif;
            transition: transform .22s ease, opacity .22s ease, visibility .22s;
        }
        #workflow-model-installer-dialog.wm-hidden { transform: translateX(calc(-100% - 90px)); opacity: 0; visibility: hidden; pointer-events: none; }
        #workflow-model-installer-dialog .wm-head { padding: 16px 18px 12px; display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #353535; }
        #workflow-model-installer-dialog h2 { margin: 0 0 5px; font-size: 19px; }
        #workflow-model-installer-dialog .wm-subtitle { color: #aaaaaa; font-size: 12px; }
        #workflow-model-installer-dialog .wm-close { min-height: 34px; height: 34px; width: 34px; padding: 0; font-size: 23px; flex-shrink: 0; }
        #workflow-model-installer-dialog .wm-summary { padding: 16px 22px; background: #252525; }
        #workflow-model-installer-dialog .wm-line { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
        #workflow-model-installer-dialog .wm-muted { color: #aaaaaa; font-size: 12px; }
        #workflow-model-installer-dialog .wm-row { margin: 8px 14px; padding: 12px; border: 1px solid #454545; border-radius: 7px; background: #252525; overflow-wrap: anywhere; }
        #workflow-model-installer-dialog .wm-row.wm-active { background: #303030; border-left: 3px solid #aaaaaa; padding-left: 10px; }
        #workflow-model-installer-dialog .wm-name { font-weight: 650; font-size: 13px; }
        #workflow-model-installer-dialog .wm-folder { font-size: 12px; color: #aaaaaa; margin-top: 4px; }
        #workflow-model-installer-dialog .wm-status { color: #cccccc; font-size: 12px; }
        #workflow-model-installer-dialog .wm-installed { color: #7be1af; }
        #workflow-model-installer-dialog .wm-failed { color: #ffb7be; }
        #workflow-model-installer-dialog .wm-percent { font-size: 19px; font-weight: 650; color: #eeeeee; white-space: nowrap; }
        #workflow-model-installer-dialog .wm-bar { width: 100%; height: 8px; background: #404040; border-radius: 8px; overflow: hidden; margin: 10px 0 6px; }
        #workflow-model-installer-dialog .wm-fill { height: 100%; background: #b8b8b8; border-radius: 8px; transition: width .5s ease; }
        #workflow-model-installer-dialog .wm-indeterminate .wm-fill { width: 35% !important; animation: wm-download 1.3s ease-in-out infinite alternate; }
        #workflow-model-installer-dialog .wm-foot { padding: 16px 22px 20px; border-top: 1px solid #3d3d3d; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        #workflow-model-installer-dialog .wm-footnote { flex: 1 1 190px; color: #aaaaaa; font-size: 12px; }
        #workflow-model-installer-dialog .wm-selection { padding: 12px 22px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #252525; border-top: 1px solid #3d3d3d; }
        #workflow-model-installer-dialog .wm-selection[hidden] { display: none; }
        #workflow-model-installer-dialog .wm-size { color: #dddddd; font-weight: 650; font-size: 13px; margin-top: 5px; }
        #workflow-model-installer-dialog button.wm-open-folder { min-height: 30px; padding: 5px 9px; font-size: 12px; border-width: 1px; white-space: nowrap; }
        #workflow-model-installer-dialog button.wm-open-folder[hidden] { display: none; }
        #workflow-model-installer-dialog .wm-installed-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        #workflow-model-installer-dialog .wm-tabs { display: flex; gap: 8px; padding: 12px 22px; border-bottom: 1px solid #3d3d3d; }
        #workflow-model-installer-dialog .wm-tabs button { min-height: 34px; padding: 6px 12px; }
        #workflow-model-installer-dialog .wm-tabs button[aria-selected=true] { background: #424242; border-color: #aaaaaa; }
        #workflow-model-installer-dialog .wm-source-controls { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        #workflow-model-installer-dialog .wm-source-controls input, #workflow-model-installer-dialog select { background: #202020; color: #fff; padding: 8px; border: 1px solid #505050; border-radius: 6px; min-width: 0; }
        #workflow-model-installer-dialog .wm-source-controls input { flex: 1 1 100%; }
        #workflow-model-installer-dialog .wm-candidate { margin-top: 10px; padding: 10px; border: 1px solid #505050; border-radius: 8px; }
        #workflow-model-installer-dialog input[type=checkbox] { accent-color: #bbbbbb; width: 17px; height: 17px; vertical-align: middle; margin-right: 7px; }
        #workflow-model-installer-button .wm-mini { width: 100%; height: 4px; background: #133d70; border-radius: 4px; overflow: hidden; margin-top: 3px; }
        #workflow-model-installer-button .wm-mini-fill { height: 100%; background: #c4e7ff; transition: width .5s ease; }
        #workflow-model-installer-button .wm-mini-label { font-size: 10px; line-height: 1.2; margin-top: 2px; }
        #workflow-model-installer-button .wm-mini[hidden], #workflow-model-installer-button .wm-mini-label[hidden] { display: none; }
        #workflow-model-installer-dialog button { min-height: 30px; padding: 5px 10px; border: 1px solid #484848; border-radius: 5px; background: #2b2b2b; color: #eeeeee; font: 500 12px/1.4 system-ui; cursor: pointer; }
        #workflow-model-installer-dialog button:hover { background: #383838; }
        #workflow-model-installer-dialog button.wm-primary { background: #444444; border-color: #777777; color: white; }
        #workflow-model-installer-dialog button.wm-cancel { background: #573039; border-color: #92515f; }
        #workflow-model-installer-dialog button:disabled { opacity: .5; cursor: not-allowed; }
        #workflow-model-installer-dialog .wm-section { padding: 14px 18px 4px; color: #bbbbbb; font-size: 11px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
        #workflow-model-installer-dialog .wm-search { box-sizing: border-box; margin: 10px 18px; width: calc(100% - 36px); padding: 8px 10px; color: #eeeeee; background: #252525; border: 1px solid #484848; border-radius: 5px; font: inherit; }
        #workflow-model-installer-dialog .wm-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 7px 0; }
        #workflow-model-installer-dialog .wm-role { background: #3a3a3a; color: #dddddd; border-radius: 12px; padding: 2px 8px; font-size: 11px; }
        #workflow-model-installer-dialog .wm-source { display: inline-flex; align-items: center; gap: 5px; color: #dddddd; font-size: 12px; }
        #workflow-model-installer-dialog .wm-source-icon { display: inline-grid; place-items: center; width: 20px; height: 20px; font-size: 17px; }
        #workflow-model-installer-dialog .wm-civitai { background: #1678ce; color: white; clip-path: polygon(25% 0,75% 0,100% 25%,100% 75%,75% 100%,25% 100%,0 75%,0 25%); font: 750 14px system-ui; }
        #workflow-model-installer-dialog .wm-size { display: inline-block; padding: 2px 7px; background: #353535; color: #eeeeee; border-radius: 4px; font-size: 12px; }
        #workflow-model-installer-dialog .wm-row:has(input:checked) { border-color: #888888; background: #303030; }
        #workflow-model-installer-dialog .wm-row > label { display: flex; gap: 5px; align-items: flex-start; }
        #workflow-model-installer-dialog .wm-row > label input { flex-shrink: 0; margin-top: 2px; }
        #workflow-model-installer-dialog .wm-row .wm-status { margin-top: 5px; }
        #workflow-model-installer-dialog .wm-summary { padding: 10px 18px; font-size: 12px; }
        #workflow-model-installer-dialog button.wm-close { background: transparent; border: 0; box-shadow: none; font-size: 25px; font-weight: 400; min-height: 28px; height: 28px; width: 28px; }
        #workflow-model-installer-dialog button.wm-close:hover { background: #ffffff0d; }
        #workflow-model-installer-dialog .wm-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
        #workflow-model-installer-dialog .wm-card-top > label { display: flex; align-items: flex-start; min-width: 0; gap: 6px; }
        #workflow-model-installer-dialog .wm-card-top input { flex-shrink: 0; }
        #workflow-model-installer-dialog .wm-card-top .wm-size { flex-shrink: 0; margin: 0; padding: 0; background: transparent; font-weight: 500; white-space: nowrap; }
        #workflow-model-installer-dialog .wm-card-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 7px; }
        #workflow-model-installer-dialog .wm-card-bottom .wm-status { margin: 0; }
        #workflow-model-installer-dialog .wm-trash { width: 30px; padding: 4px; }
        #workflow-model-installer-dialog .wm-trash svg { display: block; width: 17px; height: 17px; margin: auto; }
        #workflow-model-installer-dialog .wm-title { display: flex; align-items: center; gap: 10px; }
        #workflow-model-installer-dialog .wm-title-icon { width: 25px; height: 27px; flex-shrink: 0; background: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 30' fill='none' stroke='%23cccccc' stroke-width='1.8' stroke-linejoin='round'%3E%3Cpath d='m14 2 12 6-12 6L2 8Z'/%3E%3Cpath d='m3 13-1 1 12 6 12-6-1-1M3 19l-1 1 12 6 12-6-1-1'/%3E%3C/svg%3E"); }
        #workflow-model-installer-dialog .wm-tabs { margin: 0 18px 10px; padding: 0; gap: 0; border: 1px solid #404040; border-radius: 6px; overflow: hidden; background: #252525; }
        #workflow-model-installer-dialog .wm-tabs button { flex: 1; border: 0; border-radius: 0; background: transparent; min-height: 34px; color: #cccccc; }
        #workflow-model-installer-dialog .wm-tabs button[aria-selected=true] { background: #444444; color: white; }
        #workflow-model-installer-dialog .wm-tab-count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; margin-left: 6px; border-radius: 10px; background: #555555; color: #eeeeee; font-size: 11px; }
        #workflow-model-installer-dialog .wm-tabs button[aria-selected=true] .wm-tab-count { background: #dddddd; color: #333333; }
        #workflow-model-installer-dialog .wm-content { overflow: auto; min-height: 0; flex: 1 1 auto; }
        #workflow-model-installer-dialog .wm-resize { position: relative; flex: 0 0 26px; margin-top: auto; display: block; width: 100%; min-height: 26px; height: 26px; padding: 0; border: 0; border-top: 1px solid #3d3d3d; border-radius: 0; background: #303030; color: #cccccc; font-size: 11px; cursor: ns-resize; touch-action: none; z-index: 2; }
        #workflow-model-installer-dialog .wm-resize::after { content: ""; display: block; width: 36px; height: 2px; margin: 1px auto; border-radius: 3px; background: #9cacc0; }
        #workflow-model-installer-dialog .wm-row[hidden] { display: none; }
        #workflow-model-installer-dialog .wm-foot { position: sticky; bottom: 0; background: #202020; padding: 12px 18px; gap: 8px; }
        @keyframes wm-download { from { transform: translateX(-100%); } to { transform: translateX(280%); } }
        @media (prefers-reduced-motion: reduce) { #workflow-model-installer-dialog, #workflow-model-installer-dialog .wm-fill { transition: none; } #workflow-model-installer-dialog .wm-indeterminate .wm-fill { animation: none; } }
    `;
    document.head.append(style);
    const panel = element("aside");
    panel.id = "workflow-model-installer-dialog";
    panel.className = "wm-drawer wm-hidden";
    panel.setAttribute("aria-label", "Workflow model downloads");
    panel.setAttribute("aria-hidden", "true");
    panel.inert = true;
    document.body.append(panel);
    const content = element("div");
    content.className = "wm-content";
    panel.append(content);
    const mini = element("div", "", button);
    mini.className = "wm-mini";
    const miniFill = element("div", "", mini);
    miniFill.className = "wm-mini-fill";
    const miniLabel = element("span", "", button);
    miniLabel.className = "wm-mini-label";
    mini.hidden = miniLabel.hidden = true;
    let state = { running: false, items: [] };
    let visible = false;
    let view = "review";
    let pollTimer;
    let autoHideTimer;
    let idleTimer;
    let polling = false;
    let wasRunning = false;
    let progressRows = new Map();
    let progressKey = "";
    const sourceOverrides = new Map();
    let summaryTitle, summaryDetail, summaryFill, subtitle, cancelButton, progressFootnote;

    function hide() {
        clearTimeout(idleTimer);
        clearTimeout(autoHideTimer);
        visible = false;
        panel.classList.add("wm-hidden");
        panel.inert = true;
        panel.setAttribute("aria-hidden", "true");
        button.setAttribute("aria-expanded", "false");
        button.focus();
    }

    function resetIdleTimer() {
        clearTimeout(idleTimer);
        if (!visible) return;
        idleTimer = setTimeout(() => {
            const focused = document.activeElement;
            if (view === "confirm" || (panel.contains(focused) && focused.matches("input, select, textarea"))) {
                resetIdleTimer();
                return;
            }
            hide();
        }, 12000);
    }
    for (const event of ["pointermove", "pointerdown", "keydown", "input", "focusin", "scroll"]) {
        panel.addEventListener(event, resetIdleTimer, { passive: true, capture: true });
    }

    function show() {
        clearTimeout(autoHideTimer);
        visible = true;
        resetIdleTimer();
        panel.inert = false;
        panel.classList.remove("wm-hidden");
        panel.setAttribute("aria-hidden", "false");
        button.setAttribute("aria-expanded", "true");
    }

    function addResizeHandle() {
        const handle = element("button", "↕ Drag to resize", panel);
        handle.className = "wm-resize";
        handle.title = "Drag to resize panel height; use arrow keys for small adjustments";
        handle.setAttribute("aria-label", "Resize model panel height");
        function resize(height) {
            const maximum = Math.max(120, window.innerHeight - 80);
            panel.style.setProperty("--wm-height", `${Math.min(maximum, Math.max(Math.min(240, maximum), height))}px`);
        }
        handle.onpointerdown = event => {
            if (event.button !== 0) return;
            event.preventDefault();
            const startY = event.clientY;
            const startHeight = panel.getBoundingClientRect().height;
            handle.setPointerCapture(event.pointerId);
            handle.onpointermove = move => resize(startHeight + move.clientY - startY);
            handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; };
            handle.onlostpointercapture = () => { handle.onpointermove = null; };
        };
        handle.onkeydown = event => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                resize(panel.getBoundingClientRect().height + (event.key === "ArrowUp" ? -24 : 24));
            }
        };
    }

    function header(title, description) {
        panel.style.removeProperty("--wm-height");
        content.replaceChildren();
        panel.replaceChildren(content);
        const head = element("div", "", content);
        head.className = "wm-head";
        const labels = element("div", "", head);
        const heading = element("h2", "", labels);
        heading.className = "wm-title";
        const mark = element("span", "", heading);
        mark.className = "wm-title-icon";
        mark.setAttribute("aria-hidden", "true");
        element("span", title, heading);
        subtitle = element("div", description, labels);
        subtitle.className = "wm-subtitle";
        const close = element("button", "×", head);
        close.className = "wm-close";
        close.title = "Hide panel — downloads continue";
        close.setAttribute("aria-label", "Hide model downloads panel");
        close.onclick = hide;
    }

    function openFolderButton(item, parent, feedback) {
        const open = element("button", "▱ Open folder", parent);
        open.className = "wm-open-folder";
        open.title = item.destination || `Open ${item.directory} folder`;
        open.setAttribute("aria-label", `Open folder for ${item.name}`);
        open.onclick = async () => {
            open.disabled = true;
            try {
                await request("open-folder", { name: item.name, directory: item.directory });
                feedback.textContent = "Folder opened in File Explorer.";
            } catch (error) { feedback.textContent = `Could not open folder: ${error.message}`; }
            finally { open.disabled = false; }
        };
        return open;
    }

    function recycleButton(item, parent, feedback) {
        const remove = element("button", "", parent);
        remove.className = "wm-trash";
        remove.title = "Move to Recycle Bin";
        remove.setAttribute("aria-label", `Move ${item.name} to Recycle Bin`);
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.6");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7");
        svg.append(path); remove.append(svg);
        remove.disabled = state.running;
        remove.onclick = async () => {
            remove.disabled = true;
            try { showRecycleConfirmation(await request("recycle-plan", { models: [item] })); }
            catch (error) { feedback.textContent = error.message; remove.disabled = state.running; }
        };
    }

    function progressBar(parent, label) {
        const bar = element("div", "", parent);
        bar.className = "wm-bar";
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", label);
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        const fill = element("div", "", bar);
        fill.className = "wm-fill";
        fill.style.width = "0%";
        return { bar, fill };
    }

    function setBar({ bar, fill }, percent) {
        bar.classList.toggle("wm-indeterminate", percent === null);
        if (percent === null) bar.removeAttribute("aria-valuenow");
        else bar.setAttribute("aria-valuenow", String(Math.floor(percent)));
        fill.style.width = `${percent ?? 35}%`;
    }

    function modelBadges(item, row) {
    const badges = element("div", "", row);
    badges.className = "wm-badges";
    const roles = { diffusion_models: "Diffusion", text_encoders: "Text encoder", vae: "VAE", loras: "LoRA", checkpoints: "Checkpoint" };
    element("span", roles[item.directory] || item.directory || "Choose folder", badges).className = "wm-role";
    const provider = item.url?.includes("huggingface.co/") ? "Hugging Face" : item.url?.includes("civitai.com/") ? "Civitai" : "Source needed";
    const source = element("span", "", badges);
    source.className = "wm-source";
    const icon = element("span", provider === "Hugging Face" ? "🤗" : provider === "Civitai" ? "C" : "↗", source);
    icon.className = `wm-source-icon${provider === "Civitai" ? " wm-civitai" : ""}`;
    icon.setAttribute("aria-hidden", "true");
    element("span", provider, source);
    }

    function buildProgress() {
        header("Model downloads", "Downloads continue while ComfyUI is running.");
        const summary = element("div", "", content);
        summary.className = "wm-summary";
        const line = element("div", "", summary);
        line.className = "wm-line";
        summaryTitle = element("strong", "", line);
        summaryDetail = element("span", "", line);
        summaryDetail.className = "wm-muted";
        summaryFill = progressBar(summary, "Models installed");
        element("div", "Queue progress · models installed", summary).className = "wm-muted";
        progressRows = new Map();
        for (const item of state.items) {
            const row = element("div", "", content);
            row.className = "wm-row";
            const line = element("div", "", row);
            line.className = "wm-line";
            element("div", item.name, line).className = "wm-name";
            const actions = element("div", "", line);
            actions.className = "wm-installed-actions";
            const status = element("span", "", actions);
            status.className = "wm-status";
            modelBadges(item, row);
            const size = element("div", "Size: checking…", row);
            size.className = "wm-size";
            const folder = element("div", `Folder: ${item.directory}`, row);
            folder.className = "wm-folder";
            folder.title = item.destination || item.directory;
            const meter = progressBar(row, `${item.name} downloaded`);
            const details = element("div", "", row);
            details.className = "wm-muted";
            const open = openFolderButton(item, actions, details);
            open.hidden = item.status !== "installed";
            progressRows.set(`${item.directory}/${item.name}`, { row, status, meter, details, open, size });
        }
        const footer = element("div", "", content);
        footer.className = "wm-foot";
        progressFootnote = element("div", "", footer);
        progressFootnote.className = "wm-footnote";
        cancelButton = element("button", "Cancel downloads", footer);
        cancelButton.className = "wm-cancel";
        cancelButton.onclick = async () => {
            cancelButton.disabled = true;
            try { await request("cancel", {}); subtitle.textContent = "Cancelling…"; }
            catch (error) { subtitle.textContent = error.message; cancelButton.disabled = false; }
        };
        const review = element("button", "Check current workflow", footer);
        review.onclick = () => reviewWorkflow();
        addResizeHandle();
        progressKey = state.items.map(item => `${item.directory}/${item.name}`).join("|");
    }

    function renderProgress() {
        const key = state.items.map(item => `${item.directory}/${item.name}`).join("|");
        if (key !== progressKey || !summaryTitle || !panel.contains(summaryTitle)) buildProgress();
        const progress = downloadProgress(state.items);
        summaryTitle.textContent = `${progress.installed} of ${progress.total} installed`;
        summaryDetail.textContent = state.running ? `${progress.remaining} remaining` : progress.failed ? `${progress.failed} failed` : progress.cancelled ? `${progress.cancelled} cancelled` : "Complete";
        setBar(summaryFill, progress.queuePercent);
        subtitle.textContent = state.running ? "Downloading in background" : progress.failed ? "Some downloads failed — see details below" : progress.cancelled ? "Downloads stopped" : "Downloads complete";
        progressFootnote.textContent = state.running ? "Hide this panel anytime. Click Models to reopen it; downloads keep running in the background." : progress.failed || progress.cancelled ? "Use Check current workflow to review and retry models that were not installed." : "Models installed. You can hide this panel and continue working.";
        cancelButton.disabled = !state.running;
        for (const item of state.items) {
            const refs = progressRows.get(`${item.directory}/${item.name}`);
            if (!refs) continue;
            const active = item.status === "downloading";
            const percent = item.total > 0 ? Math.min(100, Math.floor(100 * (item.downloaded || 0) / item.total)) : null;
            refs.row.classList.toggle("wm-active", active);
            refs.status.className = active ? "wm-percent" : `wm-status wm-${item.status}`;
            refs.status.textContent = active ? percent === null ? "Starting…" : `${percent}%` : ({ installed: "✓ Installed", queued: "Queued", failed: "Failed", cancelled: "Cancelled" }[item.status] || item.status);
            refs.size.textContent = item.total > 0 ? `Size: ${formatSize(item.total)}` : "Size unavailable";
            refs.open.hidden = item.status !== "installed";
            refs.meter.bar.hidden = !active;
            if (active) setBar(refs.meter, percent);
            refs.details.textContent = item.error || (active ? `${formatSize(item.downloaded || 0)} / ${item.total ? formatSize(item.total) : "total size unknown"} · Downloading…` : "");
        }
    }

    function renderButton() {
        const progress = downloadProgress(state.items);
        mini.hidden = miniLabel.hidden = !progress.total;
        miniFill.style.width = `${state.running ? progress.percent ?? progress.queuePercent : progress.queuePercent}%`;
        miniLabel.textContent = state.running ? progress.active ? progress.percent === null ? "…" : `${progress.percent}%` : "Queued" : progress.failed ? "Failed" : progress.cancelled ? "Stopped" : "Done";
        button.title = state.running ? `${progress.active?.name || "Models queued"} · ${progress.installed}/${progress.total} installed` : progress.total ? `${progress.installed}/${progress.total} models installed — click for details` : "Missing Models — review and install workflow models";
        button.setAttribute("aria-label", state.running ? `Missing Models — ${miniLabel.textContent}, ${progress.installed} of ${progress.total} installed` : "Missing Models");
    }

    async function poll() {
        if (polling) return;
        clearTimeout(pollTimer);
        polling = true;
        try {
            state = await request("status");
            renderButton();
            if (visible && view === "progress") renderProgress();
            if (wasRunning && !state.running && state.items.some(item => item.status === "installed")) {
                try { await app.refreshComboInNodes(); } catch { /* Refresh can still be retried from the review panel. */ }
            }
            wasRunning = state.running;
        } catch (error) {
            if (visible && subtitle) subtitle.textContent = `Cannot read download status: ${error.message}`;
            if (state.running) { miniLabel.textContent = "Offline"; button.title = "Download status unavailable. Check that ComfyUI is running."; }
        } finally {
            polling = false;
            pollTimer = setTimeout(poll, state.running ? 1000 : 8000);
        }
    }

    async function reviewWorkflow(mode = "missing") {
        view = "review";
        const cleanup = mode === "installed";
        header("Workflow Models", cleanup ? "Select only models you no longer need. Other workflows may use these same files." : "Review sources and folders. Downloads begin only after you approve.");
        const tabs = element("div", "", content);
        tabs.className = "wm-tabs";
        tabs.setAttribute("role", "tablist");
        for (const [tabMode, label] of [["missing", "Missing models"], ["installed", "Installed models"]]) {
            const tab = element("button", label, tabs);
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-selected", String(mode === tabMode));
            tab.onclick = () => reviewWorkflow(tabMode);
        }
        const search = element("input", "", content);
        search.type = "search";
        search.className = "wm-search";
        search.style.paddingLeft = "34px";
        search.style.backgroundImage = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23bbbbbb' stroke-width='1.8' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='m16 16 4.5 4.5'/%3E%3C/svg%3E\")";
        search.style.backgroundRepeat = "no-repeat";
        search.style.backgroundPosition = "10px center";
        search.placeholder = "Search filename, type, or source";
        search.setAttribute("aria-label", "Search workflow models");
        const message = element("div", "Checking this workflow…", content);
        message.className = "wm-summary";
        message.setAttribute("role", "status");
        const selection = element("div", "", content);
        selection.className = "wm-selection";
        selection.hidden = true;
        const allLabel = element("label", "", selection);
        const selectAll = element("input", "", allLabel);
        selectAll.type = "checkbox";
        element("strong", "Select all", allLabel);
        const selectionCount = element("span", "", selection);
        selectionCount.className = "wm-muted";
        const list = element("div", "", content);
        const footer = element("div", "", content);
        footer.className = "wm-foot";
        const approve = element("button", cleanup ? "Move selected to Recycle Bin" : "Approve & install selected", footer);
        approve.className = cleanup ? "wm-cancel" : "wm-primary";
        approve.disabled = true;
        const refresh = element("button", "Refresh model lists", footer);
        refresh.onclick = async () => {
            try { await app.refreshComboInNodes(); message.textContent = "Model lists refreshed."; }
            catch (error) { message.textContent = error.message; }
        };
        if (state.items.length) {
            const downloads = element("button", "View downloads", footer);
            downloads.onclick = () => { view = "progress"; buildProgress(); renderProgress(); };
        }
        addResizeHandle();
        try {
            const models = workflowModels((app.rootGraph || app.graph).serialize()).map(model => sourceOverrides.get(`${model.directory}/${model.name}`) || model);
            if (!models.length) { message.textContent = "No supported model filenames found in this workflow. Reliable download sources cannot be guessed."; return; }
            const plan = await request("plan", { models });
            if (view !== "review" || !panel.contains(list)) return;
            const choices = [];
            const sizeLabels = new Map();
            const knownSizes = new Map();
            let submitting = false;
            function updateSelection() {
                const count = choices.filter(choice => choice.check.checked).length;
                selectAll.checked = choices.length > 0 && count === choices.length;
                selectAll.indeterminate = count > 0 && count < choices.length;
                selectAll.disabled = !choices.length || submitting;
                selectionCount.textContent = `${count} of ${choices.length} selected`;
                const selected = choices.filter(choice => choice.check.checked);
                if (count && selected.every(choice => knownSizes.has(`${choice.item.directory}/${choice.item.name}`))) {
                    const total = selected.reduce((sum, choice) => sum + knownSizes.get(`${choice.item.directory}/${choice.item.name}`), 0);
                    selectionCount.textContent += ` · ${formatSize(total)}`;
                }
                approve.disabled = !count || state.running || submitting;
            }
            selectAll.onchange = () => {
                choices.forEach(choice => { choice.check.checked = selectAll.checked; });
                updateSelection();
            };
            for (const tab of tabs.children) {
                const installed = tab.textContent.startsWith("Installed");
                tab.replaceChildren();
                element("span", installed ? "Installed" : "Missing", tab);
                element("span", String(plan.items.filter(item => installed ? item.status === "installed" : item.status !== "installed").length), tab).className = "wm-tab-count";
            }
            element("div", cleanup ? "Installed models" : "Missing models", list).className = "wm-section";
            search.oninput = () => {
                const query = search.value.trim().toLowerCase();
                list.querySelectorAll(".wm-row").forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query); });
            };
            const entries = plan.items.filter(item => cleanup ? item.status === "installed" : item.status !== "installed");
            for (const item of entries) {
                const row = element("div", "", list);
                row.className = "wm-row";
                const top = element("div", "", row); top.className = "wm-card-top";
                const label = element("label", "", top);
                const check = element("input", "", label);
                check.type = "checkbox";
                check.checked = !cleanup && item.status === "missing";
                check.disabled = cleanup ? false : item.status !== "missing";
                element("strong", item.name, label).className = "wm-name";
                const sizeLabel = element("div", item.status === "unsupported" ? "Size unavailable" : "Size: checking…", top);
                sizeLabel.className = "wm-size";
                sizeLabels.set(`${item.directory}/${item.name}`, sizeLabel);
                modelBadges(item, row);
                const details = element("details", "", row);
                element("summary", "Source & destination", details).className = "wm-folder";
                element("div", `Folder: ${item.destination || item.directory}`, details).className = "wm-folder";
                element("div", `Source: ${item.url || "not supplied"}`, details).className = "wm-folder";
                if (item.source) element("div", `Source information: ${item.source}`, details).className = "wm-folder";
                const bottom = element("div", "", row); bottom.className = "wm-card-bottom";
                const status = element("div", `${item.status}${item.error ? `: ${item.error}` : ""}`, bottom);
                status.className = `wm-status wm-${item.status}`;
                if (item.status === "installed") {
                    const actions = element("div", "", bottom);
                    actions.className = "wm-installed-actions";
                    openFolderButton(item, actions, status);
                    recycleButton(item, actions, status);
                }
                if (cleanup || item.status === "missing") { choices.push({ item, check }); check.onchange = updateSelection; }
                if (!cleanup && item.status === "unsupported") addSourceControls(item, row, status);
            }
            selection.hidden = !choices.length;
            updateSelection();
            message.textContent = cleanup ? `${choices.length} installed model(s) used by this workflow. Nothing is selected for removal by default. Files go to Windows Recycle Bin only after confirmation.` : `${choices.length} ready to download · Review sizes and sources before approving.`;
            if (!entries.length) message.textContent = cleanup ? "No installed models found for this workflow." : "No missing models found. Use Installed models to review existing files.";
            if (state.running) message.textContent += " Another installation is already running; use View downloads.";
            // HEAD metadata only: selecting/reviewing a model never downloads its weights.
            request("sizes", { models: plan.items.filter(item => item.status !== "unsupported") }).then(data => {
                for (const item of data.items) {
                    const label = sizeLabels.get(`${item.directory}/${item.name}`);
                    if (label) label.textContent = item.size > 0 ? `Size: ${formatSize(item.size)}` : "Size unavailable";
                    if (item.size > 0) knownSizes.set(`${item.directory}/${item.name}`, item.size);
                }
                updateSelection();
            }).catch(() => {
                sizeLabels.forEach(label => { label.textContent = "Size unavailable — try reopening the list"; });
            });
            approve.onclick = async () => {
                const selected = choices.filter(choice => choice.check.checked).map(choice => choice.item);
                if (!selected.length) { message.textContent = "Select at least one model."; return; }
                submitting = true;
                choices.forEach(choice => { choice.check.disabled = true; });
                updateSelection();
                try {
                    if (cleanup) {
                        const recyclePlan = await request("recycle-plan", { models: selected });
                        return showRecycleConfirmation(recyclePlan);
                    }
                    await request("start", { approved: true, models: selected });
                    state = await request("status");
                    wasRunning = state.running;
                    view = "progress";
                    buildProgress();
                    renderProgress();
                    renderButton();
                    clearTimeout(pollTimer);
                    pollTimer = setTimeout(poll, 1000);
                    autoHideTimer = setTimeout(() => { if (state.running) hide(); }, 2200);
                } catch (error) { message.textContent = error.message; submitting = false; choices.forEach(choice => { choice.check.disabled = false; }); updateSelection(); }
            };
        } catch (error) { message.textContent = error.message; }
    }

    function addSourceControls(item, row, feedback) {
        const controls = element("div", "", row);
        controls.className = "wm-source-controls";
        const provider = element("select", "", controls);
        provider.setAttribute("aria-label", `Search provider for ${item.name}`);
        for (const [value, label] of [["auto", "Auto: Hugging Face → Civitai"], ["huggingface", "Hugging Face"], ["civitai", "Civitai"]]) {
            const option = element("option", label, provider); option.value = value;
        }
        const category = element("select", "", controls);
        category.setAttribute("aria-label", `Model folder for ${item.name}`);
        const categories = [...new Set([item.directory, "", "checkpoints", "diffusion_models", "text_encoders", "vae", "loras", "controlnet", "clip_vision", "upscale_models"])];
        for (const value of categories) { const option = element("option", value || "Choose model folder", category); option.value = value; }
        category.value = item.directory || "";
        const page = element("input", "", controls);
        page.type = "url";
        page.placeholder = "Optional: Hugging Face or Civitai model page / file link";
        page.setAttribute("aria-label", `Custom source link for ${item.name}`);
        const search = element("button", "Find matching sources", controls);
        const results = element("div", "", row);
        search.onclick = async () => {
            if (!category.value) { feedback.textContent = "Choose the model's correct folder first."; return; }
            search.disabled = true;
            results.replaceChildren();
            feedback.textContent = "Searching file records only; no model is being downloaded…";
            try {
                const data = await request("sources", { model: { name: item.name, directory: category.value }, provider: provider.value, url: page.value.trim() });
                feedback.textContent = data.items.length ? `${data.items.length} exact-filename match(es). Check the repository and version before choosing. No source is selected automatically.` : "No exact filename match found. Try a specific model page link. Similar filenames are not substituted.";
                for (const candidate of data.items) {
                    const card = element("div", "", results); card.className = "wm-candidate";
                    element("div", candidate.repository, card).className = "wm-name";
                    element("div", `Version: ${candidate.version}`, card).className = "wm-folder";
                    element("div", `File: ${candidate.name}`, card).className = "wm-folder";
                    element("div", candidate.size ? `Size: ${formatSize(candidate.size)}` : "Size unavailable", card).className = "wm-size";
                    element("div", candidate.url, card).className = "wm-folder";
                    const use = element("button", "Use this source", card);
                    use.onclick = () => { sourceOverrides.set(`${item.directory}/${item.name}`, candidate); reviewWorkflow(); };
                }
            } catch (error) { feedback.textContent = error.message; }
            finally { search.disabled = false; }
        };
        if (!item.url && category.value) search.click();
    }

    function showRecycleConfirmation(plan) {
        view = "confirm";
        header("Confirm move to Recycle Bin", "These files may also be used by other workflows. Restore them from Windows Recycle Bin if needed.");
        const message = element("div", `${plan.items.length} file(s) · ${formatSize(plan.items.reduce((sum, item) => sum + item.size, 0))}`, content);
        message.className = "wm-summary";
        for (const item of plan.items) {
            const row = element("div", "", content); row.className = "wm-row";
            element("strong", item.name, row);
            element("div", `Size: ${formatSize(item.size)}`, row).className = "wm-size";
            element("div", item.path, row).className = "wm-folder";
        }
        const footer = element("div", "", content); footer.className = "wm-foot";
        const confirm = element("button", "Confirm move to Recycle Bin", footer); confirm.className = "wm-cancel";
        const cancel = element("button", "Keep files", footer);
        cancel.onclick = () => reviewWorkflow("installed");
        addResizeHandle();
        confirm.onclick = async () => {
            confirm.disabled = cancel.disabled = true;
            try {
                const result = await request("recycle-confirm", { approved: true, token: plan.token });
                message.textContent = result.items.map(item => `${item.name}: ${item.status}${item.error ? ` — ${item.error}` : ""}`).join("\n");
                message.style.whiteSpace = "pre-wrap";
                await app.refreshComboInNodes();
                confirm.hidden = true;
                cancel.textContent = "Back to installed models";
            } catch (error) { message.textContent = error.message; }
            finally { cancel.disabled = false; }
        };
    }

    panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); hide(); } });
    button.setAttribute("aria-controls", panel.id);
    button.setAttribute("aria-expanded", "false");
    poll();
    return {
        async toggle() {
            if (visible) { hide(); return; }
            show();
            await poll();
            if (state.items.length) { view = "progress"; buildProgress(); renderProgress(); }
            else await reviewWorkflow();
        }
    };
}

