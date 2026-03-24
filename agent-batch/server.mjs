#!/usr/bin/env node
/**
 * agent-batch HTTP server with dark-theme web dashboard
 * Port: 3113 (default)
 */

import { createServer } from 'node:http';
import { BatchProcessor } from './index.mjs';

const PORT = parseInt(process.env.PORT ?? '3113');
const bp = new BatchProcessor();

// Forward all events to SSE clients
const sseClients = new Set();
bp.on('*', ({ event, data }) => {
  for (const res of sseClients) {
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
  }
});

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function notFound(res) { json(res, 404, { error: 'Not found' }); }

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

const routes = {
  'GET /health': (res) => json(res, 200, { status: 'ok', uptime: process.uptime() }),
  'GET /api/stats': (res) => json(res, 200, bp.getStats()),
  'GET /api/runs': (res) => json(res, 200, bp.getRuns()),
  'GET /api/history': (res) => json(res, 200, bp.getHistory()),
  'POST /api/execute': async (res, req) => {
    const body = await readBody(req);
    const items = body.items ?? [];
    const fn = body.fn ?? 'return item * 2';
    const processor = new Function('item', 'index', fn);
    const opts = body.options ?? {};
    const result = await bp.execute(items, processor, opts);
    json(res, 200, result);
  },
  'POST /api/retry': async (res, req) => {
    const body = await readBody(req);
    const fn = body.fn ?? 'return "ok"';
    const opts = body.options ?? {};
    try {
      const result = await bp.retry((attempt) => {
        const fnBody = new Function('attempt', fn);
        return fnBody(attempt);
      }, opts);
      json(res, 200, { result });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  }
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // SSE
  if (path === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Dashboard
  if (path === '/' || path === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
    return;
  }

  const key = `${req.method} ${path}`;
  const handler = routes[key];
  if (handler) {
    return handler(res, req);
  }
  notFound(res);
});

server.listen(PORT, () => console.log(`agent-batch dashboard: http://localhost:${PORT}`));

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-batch</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px;font-size:1.5em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:.8em;text-transform:uppercase;margin-bottom:4px}
.card .value{font-size:1.8em;font-weight:700;color:#58a6ff}
table{width:100%;border-collapse:collapse;background:#161b22;border-radius:8px;overflow:hidden}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #30363d;font-size:.85em}
th{background:#1c2128;color:#8b949e;text-transform:uppercase;font-size:.75em}
.success{color:#3fb950}.failed{color:#f85149}.running{color:#d29922}
.btn{background:#238636;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.85em}
.btn:hover{background:#2ea043}
.btn-danger{background:#da3633}
select,input{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:6px;font-size:.85em}
textarea{width:100%;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:8px;border-radius:6px;font-family:monospace;font-size:.85em;min-height:60px}
.form-row{margin-bottom:10px}.form-row label{display:block;color:#8b949e;font-size:.8em;margin-bottom:2px}
pre{background:#0d1117;padding:12px;border-radius:8px;font-size:.8em;overflow-x:auto;max-height:300px}
.log{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;max-height:200px;overflow-y:auto;font-size:.8em;font-family:monospace}
</style></head><body>
<h1>🐋 agent-batch Dashboard</h1>
<div class="grid" id="stats"></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
  <div class="card"><h3>Quick Execute</h3>
    <div class="form-row"><label>Items (JSON array)</label><textarea id="items">[1,2,3,4,5,6,7,8,9,10]</textarea></div>
    <div class="form-row"><label>Processor (JS function body, receives item & index)</label><textarea id="fn">await new Promise(r => setTimeout(r, 100));
return item * 2;</textarea></div>
    <div class="form-row" style="display:flex;gap:8px">
      <label>Concurrency <input id="concurrency" type="number" value="3" min="1" max="50" style="width:60px"></label>
      <label>Retries <input id="retries" type="number" value="2" min="0" max="10" style="width:60px"></label>
      <label>Timeout(ms) <input id="timeout" type="number" value="5000" min="0" style="width:80px"></label>
    </div>
    <button class="btn" onclick="execute()">Execute Batch</button>
  </div>
  <div class="card"><h3>Live Events</h3><div class="log" id="log"></div></div>
</div>
<h2 style="margin-bottom:12px;font-size:1.1em">Batch Runs</h2>
<table><thead><tr><th>ID</th><th>State</th><th>Total</th><th>OK</th><th>Fail</th><th>Skip</th><th>Duration</th></tr></thead>
<tbody id="runs"></tbody></table>
<script>
const $=s=>document.querySelector(s);
function renderStats(s){$('#stats').innerHTML=
'<div class="card"><h3>Total Batches</h3><div class="value">'+s.totalBatches+'</div></div>'+
'<div class="card"><h3>Total Items</h3><div class="value">'+s.totalItems+'</div></div>'+
'<div class="card"><h3>Success Rate</h3><div class="value">'+s.successRate+'%</div></div>'+
'<div class="card"><h3>Avg Duration</h3><div class="value">'+s.avgDurationMs+'ms</div></div>';}
function renderRuns(runs){$('#runs').innerHTML=runs.map(r=>'<tr><td>'+r.id+'</td><td class="'+r.state+'">'+r.state+'</td><td>'+r.stats.total+'</td><td class="success">'+r.stats.succeeded+'</td><td class="failed">'+r.stats.failed+'</td><td>'+r.stats.skipped+'</td><td>'+(r.duration||'-')+'ms</td></tr>').reverse().join('');}
function addLog(msg){const d=$('#log');d.innerHTML+='<div>'+new Date().toLocaleTimeString()+' '+msg+'</div>';d.scrollTop=d.scrollHeight;}
async function load(){const s=await(await fetch('/api/stats')).json();renderStats(s);const r=await(await fetch('/api/runs')).json();renderRuns(r);}
async function execute(){const items=JSON.parse($('#items').value);const fn=$('#fn').value;
const res=await(await fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({items,fn,options:{concurrency:+$('#concurrency').value,retries:+$('#retries').value,itemTimeout:+$('#timeout').value}})})).json();
addLog('Batch '+res.batchId+': '+res.state+' ('+res.stats.succeeded+'/'+res.stats.total+' OK)');load();}
const es=new EventSource('/api/events');
es.onmessage=e=>{const d=JSON.parse(e.data);addLog(d.event+': '+(d.index!==undefined?'#'+d.index:'batch '+d.batchId));
if(d.event==='complete')load();};
load();setInterval(load,3000);
</script></body></html>`;
