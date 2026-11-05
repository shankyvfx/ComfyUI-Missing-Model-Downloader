const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../web/installer.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
const context = { app: { registerExtension() {} }, api: {} };
vm.createContext(context);
vm.runInContext(source, context);
const templatePath = path.resolve(__dirname, '../../../..', 'Lib/site-packages/comfyui_workflow_templates_json/templates/video_minimax_h3_t2v.json');
const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
const models = context.workflowModels(template);
assert.equal(models.length, 5, 'Collect models inside subgraphs');
assert.deepEqual(Array.from(models, model => model.directory).sort(), ['diffusion_models', 'loras', 'text_encoders', 'vae', 'vae']);
const changed = { nodes: [{ type: 'VAELoader', widgets_values: ['chosen.safetensors'], properties: { models: [{ name: 'old.safetensors', directory: 'vae', url: 'old-url' }] } }] };
const selected = context.workflowModels(changed);
assert.equal(selected.length, 1);
assert.equal(selected[0].name, 'chosen.safetensors', 'Never download stale template selection');
assert.equal(selected[0].url, '');
const connected = {
    type: 'GemmaAPITextEncode',
    inputs: [{ name: 'ckpt_name', widget: { name: 'ckpt_name' }, link: 5 }],
    widgets_values: ['stale.safetensors'],
    widgets_values_named: { ckpt_name: 'stale.safetensors' }
};
const loader = { type: 'UNETLoader', widgets_values: ['active.safetensors'] };
assert.deepEqual(Array.from(context.workflowModels({ nodes: [connected, loader] }), item => item.name), ['active.safetensors']);
connected.inputs[0].link = null;
assert.equal(context.workflowModels({ nodes: [connected] })[0].name, 'stale.safetensors');
console.log('Frontend checks passed: five MiniMax models, nested subgraphs, correct folders, changed selections.');

