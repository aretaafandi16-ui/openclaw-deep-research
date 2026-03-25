#!/usr/bin/env node
// agent-contract HTTP server — REST API + web dashboard

import { createServer } from 'node:http';
import { ContractEngine } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3144');
const engine = new ContractEngine({ dataDir: process.env.CONTRACT_DATA_DIR });

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, content, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html' });
  res.end(content);
}

const DASHBOARD = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-contract</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center}
.card .val{font-size:2em;font-weight:bold;color:#58a6ff}.card .lbl{color:#8b949e;font-size:.85em}
table{width:100%;border-collapse:collapse;background:#161b22;border-radius:8px;overflow:hidden;margin-top:16px}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #30363d}
th{background:#21262d;color:#58a6ff;font-weight:600}
tr:hover{background:#1c2128}
.tag{display:inline-block;background:#1f6feb22;color:#58a6ff;padding:2px 8px;border-radius:12px;font-size:.75em;margin:1px}
.method{font-weight:bold;padding:2px 8px;border-radius:4px;font-size:.8em}
.method-GET{background:#23863622;color:#3fb950}.method-POST{background:#1f6feb22;color:#58a6ff}
.method-PUT{background:#d2992222;color:#d29922}.method-DELETE{background:#f8514922;color:#f85149}
.method-PATCH{background:#a371f722;color:#a371f7}
.btn{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.85em}
.btn:hover{background:#30363d}.btn-primary{background:#238636;border-color:#238636;color:#fff}
.empty{text-align:center;padding:40px;color:#8b949e}pre{background:#161b22;padding:12px;border-radius:6px;overflow-x:auto;font-size:.85em}
h2{color:#c9d1d9;margin:24px 0 12px}
</style></head><body>
<h1>📋 agent-contract</h1>
<div class="cards" id="cards"></div>
<h2>Contracts</h2>
<div id="contracts"><div class="empty">Loading...</div></div>
<script>
async function load(){
  const stats=await (await fetch('/api/stats')).json();
  document.getElementById('cards').innerHTML=
    [{v:stats.contracts,l:'Contracts'},{v:stats.validations,l:'Validations'},{v:stats.passed,l:'Passed'},{v:stats.failed,l:'Failed'},{v:stats.mocks,l:'Mock Servers'},{v:stats.requests,l:'Mock Requests'}]
    .map(c=>'<div class="card"><div class="val">'+c.v+'</div><div class="lbl">'+c.l+'</div></div>').join('');
  const cs=await (await fetch('/api/contracts')).json();
  if(!cs.length){document.getElementById('contracts').innerHTML='<div class="empty">No contracts yet. Create one via the API.</div>';return;}
  let h='<table><tr><th>Name</th><th>Version</th><th>Endpoints</th><th>Base URL</th><th>Tags</th></tr>';
  for(const c of cs){
    h+='<tr><td><strong>'+c.name+'</strong><br><small style="color:#8b949e">'+c.id+'</small></td><td>'+c.version+'</td><td>';
    for(const e of c.endpoints) h+='<span class="method method-'+e.method+'">'+e.method+'</span> '+e.path+'<br>';
    h+='</td><td><small>'+(c.base_url||'—')+'</small></td><td>'+(c.tags||[]).map(t=>'<span class="tag">'+t+'</span>').join(' ')+'</td></tr>';
  }
  h+='</table>';
  document.getElementById('contracts').innerHTML=h;
}
load();setInterval(load,5000);
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  let body = '';
  req.on('data', c => body += c);
  await new Promise(r => req.on('end', r));
  let parsed; try { parsed = JSON.parse(body); } catch { parsed = {}; }

  try {
    if (path === '/' || path === '/dashboard') return html(res, DASHBOARD);
    if (path === '/api/stats') return json(res, engine.getStats());
    if (path === '/api/contracts' && req.method === 'GET') return json(res, engine.listContracts());
    if (path === '/api/contracts' && req.method === 'POST') return json(res, engine.createContract(parsed), 201);
    if (path.match(/^\/api\/contracts\/([^/]+)$/) && req.method === 'GET') return json(res, engine.getContract(decodeURIComponent(path.split('/')[3])));
    if (path.match(/^\/api\/contracts\/([^/]+)$/) && req.method === 'DELETE') { engine.deleteContract(decodeURIComponent(path.split('/')[3])); return json(res, { ok: true }); }
    if (path.match(/^\/api\/contracts\/([^/]+)\/export$/)) return json(res, engine.exportContract(decodeURIComponent(path.split('/')[3])));
    if (path.match(/^\/api\/contracts\/([^/]+)\/report$/)) { res.writeHead(200, { 'Content-Type': 'text/markdown' }); return res.end(engine.generateReport(decodeURIComponent(path.split('/')[3]))); }
    if (path.match(/^\/api\/contracts\/([^/]+)\/endpoints$/) && req.method === 'POST') return json(res, engine.addEndpoint(decodeURIComponent(path.split('/')[3]), parsed), 201);
    if (path.match(/^\/api\/contracts\/([^/]+)\/validate-request$/) && req.method === 'POST') return json(res, engine.validateRequest(decodeURIComponent(path.split('/')[3]), parsed.endpoint_id, parsed.request));
    if (path.match(/^\/api\/contracts\/([^/]+)\/validate-response$/) && req.method === 'POST') return json(res, engine.validateResponse(decodeURIComponent(path.split('/')[3]), parsed.endpoint_id, parsed.status_code, parsed.body));
    if (path.match(/^\/api\/contracts\/([^/]+)\/mock$/) && req.method === 'POST') { engine.setMockResponse(decodeURIComponent(path.split('/')[3]), parsed.endpoint_id, parsed.status_code || 200, parsed.body, parsed.headers || {}); return json(res, { ok: true }); }
    if (path === '/api/openapi/import' && req.method === 'POST') return json(res, engine.importOpenAPI(parsed), 201);
    if (path === '/api/validation-log') return json(res, engine.store.getValidationLog(parseInt(url.searchParams.get('limit') || '50')));
    json(res, { error: 'Not found', endpoints: ['GET /api/stats', 'GET /api/contracts', 'POST /api/contracts', 'POST /api/openapi/import'] }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => console.log(`📋 agent-contract server on :${PORT}`));
