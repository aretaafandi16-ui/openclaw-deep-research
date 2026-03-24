#!/usr/bin/env node
// agent-diff HTTP Server — port 3124
import { createServer } from 'node:http';
import { AgentDiff } from './index.mjs';

const diff = new AgentDiff();
const PORT = parseInt(process.env.PORT || '3124');
let stats = { requests: 0, diffs: 0, patches: 0, merges: 0 };

const dashboard = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-diff</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:20px;font-size:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{font-size:12px;color:#8b949e;text-transform:uppercase}.card .value{font-size:28px;font-weight:bold;color:#58a6ff;margin-top:4px}
.panel{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px}
.panel h2{color:#58a6ff;font-size:16px;margin-bottom:12px}
textarea{width:100%;height:150px;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:10px;font-family:monospace;font-size:13px;resize:vertical}
button{background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:14px;margin:8px 4px}
button:hover{background:#2ea043}select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 10px}
.output{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;margin-top:12px;font-family:monospace;font-size:13px;white-space:pre-wrap;min-height:60px;max-height:400px;overflow:auto}
label{display:block;margin:8px 0 4px;color:#8b949e;font-size:13px}
.flex{display:flex;gap:12px;flex-wrap:wrap}.flex>div{flex:1;min-width:300px}
</style></head><body>
<h1>🐋 agent-diff</h1>
<div class="cards">
<div class="card"><div class="label">Requests</div><div class="value" id="reqs">0</div></div>
<div class="card"><div class="label">Diffs</div><div class="value" id="diffs">0</div></div>
<div class="card"><div class="label">Patches</div><div class="value" id="patches">0</div></div>
<div class="card"><div class="label">Merges</div><div class="value" id="merges">0</div></div>
</div>
<div class="flex">
<div class="panel"><h2>Deep Diff</h2>
<label>Old JSON</label><textarea id="diffOld">{"name":"Alice","age":30}</textarea>
<label>New JSON</label><textarea id="diffNew">{"name":"Alice","age":31}</textarea>
<button onclick="runDiff()">Diff</button><div class="output" id="diffOut"></div></div>
<div class="panel"><h2>JSON Patch</h2>
<label>Old JSON</label><textarea id="patchOld">{"a":1,"b":2}</textarea>
<label>New JSON</label><textarea id="patchNew">{"a":1,"b":3,"c":4}</textarea>
<button onclick="runPatch()">Generate Patch</button><div class="output" id="patchOut"></div></div>
</div>
<div class="panel"><h2>Merge</h2>
<label>Base</label><textarea id="mergeBase">{"x":1,"y":{"z":2}}</textarea>
<label>Override</label><textarea id="mergeOver">{"y":{"z":99},"w":5}</textarea>
<label>Strategy</label><select id="mergeStrategy"><option value="override">override</option><option value="shallow">shallow</option><option value="concat">concat</option><option value="deep">deep</option><option value="array_union">array_union</option></select>
<button onclick="runMerge()">Merge</button><div class="output" id="mergeOut"></div></div>
<div class="panel"><h2>Text Diff</h2>
<div class="flex"><div><label>Old Text</label><textarea id="txtOld" style="height:100px">hello world
foo bar
baz</textarea></div>
<div><label>New Text</label><textarea id="txtNew" style="height:100px">hello world
foo baz
qux
baz</textarea></div></div>
<button onclick="runTextDiff()">Diff Text</button><div class="output" id="txtOut"></div></div>
<script>
async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json()}
async function refresh(){try{const r=await fetch('/api/stats');const s=await r.json();document.getElementById('reqs').textContent=s.requests;document.getElementById('diffs').textContent=s.diffs;document.getElementById('patches').textContent=s.patches;document.getElementById('merges').textContent=s.merges}catch{}}
async function runDiff(){try{const r=await api('/api/diff',{old:JSON.parse(document.getElementById('diffOld').value),new:JSON.parse(document.getElementById('diffNew').value)});document.getElementById('diffOut').textContent=JSON.stringify(r,null,2);refresh()}catch(e){document.getElementById('diffOut').textContent='Error: '+e.message}}
async function runPatch(){try{const r=await api('/api/patch',{old:JSON.parse(document.getElementById('patchOld').value),new:JSON.parse(document.getElementById('patchNew').value)});document.getElementById('patchOut').textContent=JSON.stringify(r,null,2);refresh()}catch(e){document.getElementById('patchOut').textContent='Error: '+e.message}}
async function runMerge(){try{const r=await api('/api/merge',{base:JSON.parse(document.getElementById('mergeBase').value),override:JSON.parse(document.getElementById('mergeOver').value),strategy:document.getElementById('mergeStrategy').value});document.getElementById('mergeOut').textContent=JSON.stringify(r,null,2);refresh()}catch(e){document.getElementById('mergeOut').textContent='Error: '+e.message}}
async function runTextDiff(){try{const r=await api('/api/text-diff',{old:document.getElementById('txtOld').value,new:document.getElementById('txtNew').value});let out='';for(const c of r.changes){const p=c.type==='add'?'+':c.type==='remove'?'-':' ';out+=p+' '+c.content+'\\n'}out+='\\n+'+r.stats.added+' -'+r.stats.removed+' ='+r.stats.equal;document.getElementById('txtOut').textContent=out;refresh()}catch(e){document.getElementById('txtOut').textContent='Error: '+e.message}}
setInterval(refresh,5000);refresh();
</script></body></html>`;

async function handler(req, res) {
  stats.requests++;
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
    res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(dashboard);
  }
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(stats));
  }

  let body = '';
  req.on('data', c => body += c);
  await new Promise(r => req.on('end', r));
  let data; try { data = JSON.parse(body || '{}'); } catch { data = {}; }

  res.writeHead(200, { 'Content-Type': 'application/json' });

  switch (url.pathname) {
    case '/api/diff': stats.diffs++; res.end(JSON.stringify(diff.diff(data.old, data.new))); break;
    case '/api/patch': stats.patches++; res.end(JSON.stringify(diff.patch(data.old, data.new))); break;
    case '/api/apply': res.end(JSON.stringify(diff.applyPatch(data.doc, data.patches))); break;
    case '/api/merge': stats.merges++; res.end(JSON.stringify(diff.merge(data.base, data.override, data.strategy))); break;
    case '/api/three-way': res.end(JSON.stringify(diff.threeWay(data.base, data.ours, data.theirs, data.strategy))); break;
    case '/api/text-diff': stats.diffs++; res.end(JSON.stringify(diff.textDiff(data.old, data.new))); break;
    case '/api/unified': res.end(JSON.stringify(diff.unifiedDiff(data.filename || 'file', data.old, data.new))); break;
    case '/api/stats': res.end(JSON.stringify(stats)); break;
    case '/api/equal': res.end(JSON.stringify({ equal: diff.isEqual(data.a, data.b) })); break;
    case '/api/changed-keys': res.end(JSON.stringify({ keys: diff.changedKeys(data.old, data.new) })); break;
    default: res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
  }
}

createServer(handler).listen(PORT, () => console.log(`agent-diff dashboard: http://localhost:${PORT}`));
