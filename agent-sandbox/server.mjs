#!/usr/bin/env node
/**
 * agent-sandbox HTTP Server
 * REST API + dark-theme web dashboard for isolated code execution
 */

import { createServer } from 'http';
import { AgentSandbox } from './index.mjs';

const PORT = parseInt(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '3121');
const sandbox = new AgentSandbox({ persistFile: '.agent-sandbox/sandbox.jsonl' });

const DASHBOARD = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-sandbox</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Mono',Consolas,monospace;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase}
.card .value{font-size:24px;font-weight:700;margin-top:4px}
.card .value.green{color:#3fb950}.card .value.red{color:#f85149}.card .value.blue{color:#58a6ff}
.card .value.yellow{color:#d29922}
.box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:16px 0}
textarea{width:100%;height:120px;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:12px;font-family:inherit;font-size:13px;resize:vertical}
button{background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-family:inherit;margin-top:8px}
button:hover{background:#2ea043}
pre{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;margin-top:8px;overflow-x:auto;max-height:300px;font-size:13px}
.success{color:#3fb950}.error{color:#f85149}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{padding:8px;text-align:left;border-bottom:1px solid #30363d;font-size:13px}
th{color:#8b949e;text-transform:uppercase;font-size:11px}
.tag{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.tag.ok{background:#23863633;color:#3fb950}.tag.err{background:#f8514933;color:#f85149}
</style></head><body>
<h1>🧪 agent-sandbox</h1>
<div class="cards" id="cards"></div>
<div class="box">
<h3 style="margin-bottom:8px;color:#8b949e">Execute Code</h3>
<textarea id="code" placeholder="Enter JavaScript code...">const sum = [1,2,3,4,5].reduce((a,b) => a+b, 0);\nsum * 2</textarea>
<button onclick="runCode()">▶ Execute</button>
<pre id="result" style="display:none"></pre>
</div>
<div class="box">
<h3 style="margin-bottom:8px;color:#8b949e">Execution History</h3>
<table><thead><tr><th>ID</th><th>Status</th><th>Duration</th><th>Output</th></tr></thead><tbody id="history"></tbody></table>
</div>
<script>
async function load(){
  const s=await(await fetch('/stats')).json();
  document.getElementById('cards').innerHTML=\`
    <div class="card"><div class="label">Total</div><div class="value blue">\${s.total}</div></div>
    <div class="card"><div class="label">Success</div><div class="value green">\${s.success}</div></div>
    <div class="card"><div class="label">Failed</div><div class="value red">\${s.failed}</div></div>
    <div class="card"><div class="label">Timeout</div><div class="value yellow">\${s.timeout}</div></div>
    <div class="card"><div class="label">Avg Duration</div><div class="value">\${s.avgDurationMs}ms</div></div>
    <div class="card"><div class="label">Snapshots</div><div class="value">\${s.snapshots}</div></div>\`;
  const h=await(await fetch('/history?limit=20')).json();
  document.getElementById('history').innerHTML=h.map(r=>\`<tr>
    <td>\${r.id.slice(0,8)}</td>
    <td><span class="tag \${r.success?'ok':'err'}">\${r.success?'✓ OK':'✗ FAIL'}</span></td>
    <td>\${r.durationMs}ms</td>
    <td>\${r.success ? (r.stdout||JSON.stringify(r.value)?.slice(0,60)||'—') : r.error?.message?.slice(0,60)||'—'}</td>
  </tr>\`).reverse().join('');
}
async function runCode(){
  const code=document.getElementById('code').value;
  const res=await(await fetch('/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})})).json();
  const el=document.getElementById('result');
  el.style.display='block';
  el.className=res.success?'success':'error';
  el.textContent=res.success ? (res.stdout ? res.stdout+'\\n→ '+JSON.stringify(res.value) : '→ '+JSON.stringify(res.value)) : 'Error: '+res.error?.message;
  load();
}
load();setInterval(load,5000);
</script></body></html>`;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(DASHBOARD);
  }

  if (url.pathname === '/stats') return json(res, sandbox.getStats());
  if (url.pathname === '/history') return json(res, sandbox.getHistory({ limit: parseInt(url.searchParams.get('limit') || '50'), success: url.searchParams.has('success') ? url.searchParams.get('success') === 'true' : undefined }));
  if (url.pathname === '/snapshots') return json(res, sandbox.listSnapshots());

  if (url.pathname === '/run' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { code, timeout, globals } = JSON.parse(body);
        const result = sandbox.run(code, { timeout, globals });
        if (result && typeof result.then === 'function') {
          result.then(r => json(res, r)).catch(e => json(res, { error: e.message }, 500));
        } else {
          json(res, result);
        }
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  if (url.pathname === '/snapshot' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, code, globals } = JSON.parse(body);
        json(res, sandbox.snapshot(name, code, { globals }));
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  if (url.pathname.startsWith('/snapshot/') && req.method === 'DELETE') {
    const name = url.pathname.slice('/snapshot/'.length);
    sandbox.deleteSnapshot(decodeURIComponent(name));
    return json(res, { deleted: true });
  }

  if (url.pathname.startsWith('/snapshot/') && req.method === 'POST') {
    const name = url.pathname.slice('/snapshot/'.length);
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body);
        json(res, sandbox.runInSnapshot(decodeURIComponent(name), code));
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, () => console.log(`agent-sandbox dashboard → http://localhost:${PORT}`));
