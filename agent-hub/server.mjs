/**
 * agent-hub HTTP server with dark-theme web dashboard
 */

import { createServer } from 'http';
import { AgentHub } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3136');

const hub = new AgentHub({
  dataDir: process.env.DATA_DIR || '.hub-data',
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000'),
  heartbeatTimeout: parseInt(process.env.HEARTBEAT_TIMEOUT || '90000'),
  autoDeregister: process.env.AUTO_DEREGISTER !== 'false',
  namespace: process.env.NAMESPACE || 'default',
});

// SSE clients
const sseClients = new Set();

hub.on('*', (event, data) => {
  const msg = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const res of sseClients) {
    res.write(`data: ${msg}\n\n`);
  }
});

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Hub</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:12px;text-transform:uppercase;margin-bottom:8px}
.card .val{color:#58a6ff;font-size:28px;font-weight:700}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
td{font-size:13px}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.badge-online{background:#238636;color:#fff}
.badge-offline{background:#da3633;color:#fff}
.badge-open{background:#da3633;color:#fff}
.badge-closed{background:#238636;color:#fff}
.badge-half{background:#d29922;color:#fff}
.cap-tag{display:inline-block;padding:2px 6px;background:#1f6feb22;color:#58a6ff;border-radius:4px;font-size:11px;margin:1px}
.section{margin-bottom:24px}
.section h2{color:#c9d1d9;font-size:18px;margin-bottom:12px;border-bottom:1px solid #30363d;padding-bottom:8px}
input,select,textarea,button{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:13px}
button{background:#238636;color:#fff;cursor:pointer;border:none;padding:8px 16px;font-weight:600}
button:hover{background:#2ea043}
button.danger{background:#da3633}
button.danger:hover{background:#f85149}
.form-row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.form-row label{min-width:80px;font-size:12px;color:#8b949e}
.form-row input,.form-row select,.form-row textarea{flex:1;min-width:120px}
.log{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px}
.log-entry{padding:4px 0;border-bottom:1px solid #161b22}
.log-entry .ts{color:#8b949e;margin-right:8px}
.log-entry .ev{color:#58a6ff;margin-right:8px}
.cap-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
</style></head><body>
<h1>🐋 Agent Hub</h1>
<div class="grid" id="stats"></div>

<div class="section">
  <h2>Register Agent</h2>
  <div class="card">
    <div class="form-row"><label>Name</label><input id="reg-name" placeholder="my-agent"></div>
    <div class="form-row"><label>Capabilities</label><input id="reg-caps" placeholder="translate,summarize,code"></div>
    <div class="form-row"><label>Tags</label><input id="reg-tags" placeholder="fast,premium"></div>
    <div class="form-row"><label>Version</label><input id="reg-ver" value="1.0.0"></div>
    <div class="form-row"><label>Endpoint</label><input id="reg-endpoint" placeholder="http://localhost:4000"></div>
    <div class="form-row"><label>Group</label><input id="reg-group" value="default"></div>
    <div class="form-row"><label>Weight</label><input id="reg-weight" type="number" value="1" style="width:80px"></div>
    <button onclick="registerAgent()">Register</button>
  </div>
</div>

<div class="section">
  <h2>Route Task</h2>
  <div class="card">
    <div class="form-row"><label>Capability</label><input id="route-cap" placeholder="translate"></div>
    <div class="form-row"><label>Strategy</label>
      <select id="route-strategy"><option>round_robin</option><option>random</option><option>least_loaded</option><option>weighted</option><option>best_match</option></select>
    </div>
    <div class="form-row"><label>Tags</label><input id="route-tags" placeholder="fast"></div>
    <button onclick="routeTask()">Route</button>
    <span id="route-result" style="margin-left:12px;font-size:13px"></span>
  </div>
</div>

<div class="section">
  <h2>Agents</h2>
  <div class="card"><table><thead><tr><th>Name</th><th>Capabilities</th><th>Status</th><th>Load</th><th>Tasks</th><th>Success%</th><th>Avg Latency</th><th>Circuit</th><th></th></tr></thead><tbody id="agents"></tbody></table></div>
</div>

<div class="section">
  <h2>Capabilities</h2>
  <div class="card" id="caps-list"></div>
</div>

<div class="section">
  <h2>Named Routes</h2>
  <div class="card">
    <div class="form-row"><label>Name</label><input id="nr-name" placeholder="my-route"></div>
    <div class="form-row"><label>Capability</label><input id="nr-cap" placeholder="translate"></div>
    <div class="form-row"><label>Strategy</label>
      <select id="nr-strategy"><option>round_robin</option><option>random</option><option>least_loaded</option><option>weighted</option><option>best_match</option></select>
    </div>
    <div class="form-row"><label>Fallback</label><input id="nr-fallback" placeholder="fallback capability"></div>
    <button onclick="addRoute()">Add Route</button>
  </div>
  <div class="card" style="margin-top:12px"><table><thead><tr><th>Name</th><th>Capability</th><th>Strategy</th><th>Fallback</th><th></th></tr></thead><tbody id="routes-table"></tbody></table></div>
</div>

<div class="section">
  <h2>Event Log</h2>
  <div class="log" id="event-log"></div>
</div>

<script>
async function api(path,method='GET',body){const r=await fetch(path,{method,body:body?JSON.stringify(body):undefined,headers:{'Content-Type':'application/json'}});return r.json()}

async function refresh(){
  const[s,agents,caps,routes]=await Promise.all([api('/api/stats'),api('/api/agents'),api('/api/capabilities'),api('/api/routes')]);
  document.getElementById('stats').innerHTML=\`
    <div class="card"><h3>Agents</h3><div class="val">\${s.agents}</div></div>
    <div class="card"><h3>Capabilities</h3><div class="val">\${s.capabilities}</div></div>
    <div class="card"><h3>Total Routed</h3><div class="val">\${s.routed}</div></div>
    <div class="card"><h3>Success Rate</h3><div class="val">\${s.routed?Math.round((s.routed-s.failed)/s.routed*100):0}%</div></div>
    <div class="card"><h3>Groups</h3><div class="val">\${s.groups}</div></div>
    <div class="card"><h3>Open Circuits</h3><div class="val" style="color:\${s.openCircuits?'#f85149':'#58a6ff'}">\${s.openCircuits}</div></div>\`;
  document.getElementById('agents').innerHTML=agents.map(a=>{
    const sr=a.totalTasks?Math.round(a.successTasks/a.totalTasks*100):'-';
    return \`<tr><td>\${a.name}</td><td>\${a.capabilities.map(c=>'<span class="cap-tag">'+c+'</span>').join('')}</td><td><span class="badge badge-\${a.status}">\${a.status}</span></td><td>\${a.load}</td><td>\${a.totalTasks}</td><td>\${sr}%</td><td>\${a.avgLatencyMs}ms</td><td><span class="badge badge-\${a.circuitState}">\${a.circuitState}</span></td><td><button class="danger" onclick="unreg('\${a.id}')">✕</button></td></tr>\`;
  }).join('')||'<tr><td colspan="9" style="color:#8b949e">No agents registered</td></tr>';
  document.getElementById('caps-list').innerHTML=caps.map(c=>\`<div style="margin-bottom:8px"><span class="cap-tag">\${c.capability}</span> <span style="color:#8b949e;font-size:12px">\${c.agentCount} agent(s): \${c.agents.join(', ')}</span></div>\`).join('')||'<span style="color:#8b949e">No capabilities registered</span>';
  document.getElementById('routes-table').innerHTML=routes.map(r=>\`<tr><td>\${r.name}</td><td><span class="cap-tag">\${r.capability}</span></td><td>\${r.strategy}</td><td>\${r.fallback||'-'}</td><td><button class="danger" onclick="delRoute('\${r.name}')">✕</button></td></tr>\`).join('')||'<tr><td colspan="5" style="color:#8b949e">No named routes</td></tr>';
}

async function registerAgent(){
  const caps=document.getElementById('reg-caps').value.split(',').map(s=>s.trim()).filter(Boolean);
  const tags=document.getElementById('reg-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
  const weight=parseInt(document.getElementById('reg-weight').value)||1;
  await api('/api/agents','POST',{name:document.getElementById('reg-name').value,capabilities:cap,tags,version:document.getElementById('reg-ver').value,endpoint:document.getElementById('reg-endpoint').value||null,group:document.getElementById('reg-group').value,metadata:{weight}});
  refresh();
}

async function unreg(id){await api('/api/agents/'+id,'DELETE');refresh()}

async function routeTask(){
  const tags=document.getElementById('route-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
  const r=await api('/api/route','POST',{capability:document.getElementById('route-cap').value,strategy:document.getElementById('route-strategy').value,tags});
  document.getElementById('route-result').innerHTML=r?'→ <b>'+r.name+'</b> ('+r.id+')':'<span style="color:#f85149">No candidate found</span>';
  refresh();
}

async function addRoute(){
  await api('/api/routes','POST',{name:document.getElementById('nr-name').value,capability:document.getElementById('nr-cap').value,strategy:document.getElementById('nr-strategy').value,fallback:document.getElementById('nr-fallback').value||null});
  refresh();
}
async function delRoute(n){await api('/api/routes/'+n,'DELETE');refresh()}

// SSE
const es=new EventSource('/events');
es.onmessage=e=>{
  const d=JSON.parse(e.data);
  const log=document.getElementById('event-log');
  const div=document.createElement('div');
  div.className='log-entry';
  const t=new Date(d.timestamp).toISOString().slice(11,19);
  div.innerHTML='<span class="ts">'+t+'</span><span class="ev">'+d.event+'</span>'+JSON.stringify(d.data||{}).slice(0,100);
  log.prepend(div);
  if(log.children.length>100)log.removeChild(log.lastChild);
  refresh();
};

refresh();
setInterval(refresh,5000);
</script></body></html>`;

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const body = () => new Promise(resolve => {
    let d = ''; req.on('data', c => d += c); req.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({}) } });
  });

  // SSE
  if (path === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('data: {"event":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Dashboard
  if (path === '/' || path === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  // API
  if (path === '/api/stats') return json(res, 200, hub.getStats());
  if (path === '/api/capabilities') return json(res, 200, hub.listCapabilities());
  if (path === '/api/groups') return json(res, 200, hub.listGroups());
  if (path === '/api/routes' && method === 'GET') return json(res, 200, [...hub.routes.values()]);
  if (path === '/api/routes' && method === 'POST') return body().then(b => json(res, 201, hub.addRoute(b.name, b)));
  if (path.startsWith('/api/routes/') && method === 'DELETE') { hub.removeRoute(path.split('/').pop()); return json(res, 200, { ok: true }); }

  if (path === '/api/agents' && method === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    if (q.tags) q.tags = q.tags.split(',');
    return json(res, 200, hub.discover(q));
  }
  if (path === '/api/agents' && method === 'POST') return body().then(b => json(res, 201, hub.register(b)));
  if (path.startsWith('/api/agents/') && method === 'DELETE') { hub.unregister(path.split('/')[3]); return json(res, 200, { ok: true }); }
  if (path.startsWith('/api/agents/') && method === 'GET') { const a = hub.getAgent(path.split('/')[3]); return a ? json(res, 200, a) : json(res, 404, { error: 'not found' }); }

  if (path === '/api/route' && method === 'POST') return body().then(b => { const r = hub.route(b.capability, b); return json(res, r ? 200 : 404, r || { error: 'no candidate' }); });
  if (path === '/api/route/complete' && method === 'POST') return body().then(b => json(res, 200, { ok: hub.routeComplete(b.routeId, b) }));
  if (path === '/api/heartbeat' && method === 'POST') return body().then(b => json(res, 200, { ok: hub.heartbeat(b.agentId, b) }));
  if (path === '/api/history') return json(res, 200, hub.taskHistory.slice(-50));
  if (path === '/api/circuit') return json(res, 200, [...hub.circuitBreakers.entries()].map(([id, cb]) => ({ agentId: id, ...cb })));

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`Agent Hub running on http://localhost:${PORT}`));

export { hub, server };
