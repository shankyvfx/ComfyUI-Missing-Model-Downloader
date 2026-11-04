const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../web/progress.js'), 'utf8').replaceAll('export function ', 'function ');
const context = {};
vm.createContext(context);
vm.runInContext(source, context);
let progress = context.downloadProgress([
    {status:'installed'}, {status:'installed'},
    {status:'downloading', downloaded:60, total:100}, {status:'queued'}, {status:'queued'}
]);
assert.equal(progress.installed, 2);
assert.equal(progress.total, 5);
assert.equal(progress.remaining, 3);
assert.equal(progress.queuePercent, 40);
assert.equal(progress.percent, 60);
assert.equal(context.downloadProgress([{status:'downloading',downloaded:1024,total:0}]).percent, null, 'Unknown size must not invent a percentage');
assert.equal(context.downloadProgress([{status:'downloading',downloaded:110,total:100}]).percent,100);
assert.equal(context.downloadProgress([{status:'failed'},{status:'cancelled'}]).failed,1);
assert.equal(context.downloadProgress([{status:'failed'},{status:'cancelled'}]).cancelled,1);
assert.equal(context.downloadProgress([]).queuePercent,0);
console.log('Progress checks passed: per-model bytes, queue counts, unknown size, completed, failed and cancelled states.');

