#!/usr/bin/env node
// agent-fsm HTTP server with dark-theme web dashboard (port 3124)

import { createServer } from 'http';
import { FSM, FSMRegistry, presets } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3124');
const registry = new FSMRegistry();

// Pre-create a demo FSM
const demo = registry.create({ ...presets.conversation, name: 'Conversation Demo' });
demo.start();

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // API routes
  if (path === '/api/registry/stats') return json(res, registry.stats());
  if (path === '/api/registry/list') return json(res, registry.list());

  if (path === '/api/create' && req.method === 'POST') {
    const body = await parseBody(req);
    const fsm = registry.create(body);
    fsm.start(body.initialState);
    return json(res, { id: fsm.id, state: fsm.state });
  }

  if (path.startsWith('/api/fsm/')) {
    const parts = path.split('/');
    const id = parts[3];
    const action = parts[4];
    const fsm = registry.get(id);
    if (!fsm) return json(res, { error: 'not found' }, 404);

    if (!action) return json(res, fsm.toJSON());
    if (action === 'send' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = fsm.send(body.event, body.payload);
      return json(res, result);
    }
    if (action === 'can') return json(res, { can: fsm.can(url.searchParams.get('event')) });
    if (action === 'events') return json(res, { events: fsm.availableEvents() });
    if (action === 'transitions') return json(res, fsm.possibleTransitions());
    if (action === 'history') return json(res, fsm.history);
    if (action === 'reset' && req.method === 'POST') { fsm.reset(); return json(res, fsm.toJSON()); }
    if (action === 'mermaid') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(fsm.toMermaid()); }
    if (action === 'dot') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(fsm.toDot()); }
  }

  if (path === '/api/presets') {
    const result = {};
    for (const [k, v] of Object.entries(presets)) {
      result[k] = { name: v.name, initial: v.initial, final: v.finalStates, transitions: v.transitions.length };
    }
    return json(res, result);
  }

  if (path === '/api/presets/create' && req.method === 'POST') {
    const body = await parseBody(req);
    const preset = presets[body.preset];
    if (!preset) return json(res, { error: 'preset not found' }, 404);
    const fsm = registry.create({ ...preset, name: body.name || preset.name });
    fsm.start();
    return json(res, { id: fsm.id, state: fsm.state, name: fsm.name });
  }

  // Dashboard HTML
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(buildDashboard());
});

function buildDashboard() {
  const presetList = JSON.stringify(Object.keys(presets));
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>agent-fsm</title>',
    '<style>',
    '*{margin:0;padding:0;box-sizing:border-box}',
    'body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:20px}',
    'h1{color:#58a6ff;margin-bottom:8px}',
    '.sub{color:#8b949e;margin-bottom:20px}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}',
    '.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}',
    '.card h3{color:#8b949e;font-size:12px;text-transform:uppercase;margin-bottom:8px}',
    '.card .v{color:#58a6ff;font-size:28px;font-weight:bold}',
    '.card .v.green{color:#3fb950}.card .v.red{color:#f85149}.card .v.yellow{color:#d29922}',
    'table{width:100%;border-collapse:collapse;margin-top:12px}',
    'th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #30363d}',
    'th{color:#8b949e;font-size:12px;text-transform:uppercase}',
    '.st{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:bold}',
    '.st.a{background:#1f6feb33;color:#58a6ff}.st.d{background:#23883533;color:#3fb950}.st.i{background:#d2992233;color:#d29922}',
    '.btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;margin:2px}',
    '.btn:hover{background:#30363d;border-color:#58a6ff}.btn.p{background:#1f6feb;border-color:#1f6feb;color:#fff}',
    'select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:6px;font-size:13px}',
    '.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}',
    '.logs{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:13px}',
    '.le{padding:4px 0;border-bottom:1px solid #21262d}',
    '.le:last-child{border:none}',
    '.tg{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;margin-right:4px}',
    '.tg.f{background:#1f6feb33;color:#58a6ff}.tg.t{background:#23883533;color:#3fb950}.tg.e{background:#d2992233;color:#d29922}',
    '.md{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;font-family:monospace;font-size:13px;white-space:pre-wrap;margin-top:12px;overflow-x:auto}',
    '.sec{margin-top:24px}.sec h2{color:#c9d1d9;font-size:16px;margin-bottom:12px}',
    '</style></head><body>',
    '<h1>🐋 agent-fsm</h1>',
    '<p class="sub">Finite State Machine Engine — zero-dependency</p>',
    '<div class="grid" id="stats"></div>',
    '<div class="card"><h3>Active Machines</h3>',
    '<div class="row" style="margin-bottom:12px">',
    '<select id="ps"><option value="">— New from Preset —</option></select>',
    '<button class="btn p" onclick="mkPreset()">Create</button></div>',
    '<div id="machines"></div></div>',
    '<div class="sec" id="ds" style="display:none">',
    '<h2 id="dt">Machine Detail</h2>',
    '<div class="grid">',
    '<div class="card"><h3>State</h3><div class="v" id="dS">—</div></div>',
    '<div class="card"><h3>Transitions</h3><div class="v" id="dC">0</div></div>',
    '<div class="card"><h3>State Time</h3><div class="v" id="dT">0ms</div></div>',
    '<div class="card"><h3>Status</h3><div class="v" id="dSt">—</div></div></div>',
    '<div class="card" style="margin-top:12px"><h3>Send Event</h3>',
    '<div class="row"><select id="es"></select>',
    '<button class="btn p" onclick="sendEv()">Send</button>',
    '<button class="btn" onclick="rst()">Reset</button></div></div>',
    '<div class="card" style="margin-top:12px"><h3>Transition History</h3><div class="logs" id="hl"></div></div>',
    '<div class="card" style="margin-top:12px"><h3>State Diagram</h3><div class="md" id="diag"></div></div></div>',
    '<script>',
    'let aid=null;const presets=' + presetList + ';',
    'async function api(p,o={}){return(await fetch(p,o)).json()}',
    'async function refresh(){',
    'const s=await api("/api/registry/stats");',
    'document.getElementById("stats").innerHTML=',
    '"<div class=\\"card\\"><h3>Total</h3><div class=\\"v\\">"+s.total+"</div></div>"+',
    '"<div class=\\"card\\"><h3>Active</h3><div class=\\"v green\\">"+s.active+"</div></div>"+',
    '"<div class=\\"card\\"><h3>Done</h3><div class=\\"v yellow\\">"+s.done+"</div></div>"+',
    '"<div class=\\"card\\"><h3>Transitions</h3><div class=\\"v\\">"+s.totalTransitions+"</div></div>";',
    'const l=await api("/api/registry/list");',
    'document.getElementById("machines").innerHTML="<table><tr><th>Name</th><th>State</th><th>Status</th><th>Trans</th><th></th></tr>"+',
    'l.map(m=>"<tr><td>"+m.name+"</td><td><span class=\\"st "+(m.done?"d":m.active?"a":"i")+"\\">"+(m.state||"—")+"</span></td>"+',
    '"<td>"+(m.done?"✅ Done":m.active?"🟢 Active":"⚪ Idle")+"</td><td>"+m.transitions+"</td>"+',
    '"<td><button class=\\"btn\\" onclick=\\"sel(this.dataset.id)\\" data-id=\\""+m.id+"\\">Inspect</button></td></tr>").join("")+"</table>";',
    'if(aid)await showD(aid)}',
    'async function sel(id){aid=id;document.getElementById("ds").style.display="";await showD(id)}',
    'async function showD(id){',
    'const d=await api("/api/fsm/"+id);',
    'document.getElementById("dt").textContent=d.name+" ("+d.id+")";',
    'document.getElementById("dS").textContent=d.currentState||"—";',
    'document.getElementById("dC").textContent=d.transitionCount;',
    'document.getElementById("dT").textContent=d.stateTime+"ms";',
    'document.getElementById("dSt").textContent=d.done?"✅ Done":d.started?"🟢 Active":"⚪ Idle";',
    'const ev=await api("/api/fsm/"+id+"/events");',
    'document.getElementById("es").innerHTML=ev.events.map(e=>"<option>"+e+"</option>").join("")||"<option disabled>—</option>";',
    'const h=await api("/api/fsm/"+id+"/history");',
    'document.getElementById("hl").innerHTML=h.map(x=>',
    '"<div class=\\"le\\"><span class=\\"tg f\\">"+x.from+"</span> → <span class=\\"tg t\\">"+x.to+"</span> <span class=\\"tg e\\">"+x.event+"</span></div>"',
    ').join("")||"<div style=\\"color:#8b949e\\">No transitions</div>";',
    'const r=await fetch("/api/fsm/"+id+"/mermaid");document.getElementById("diag").textContent=await r.text()}',
    'async function sendEv(){if(!aid)return;const ev=document.getElementById("es").value;',
    'await api("/api/fsm/"+aid+"/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event:ev})});await refresh()}',
    'async function rst(){if(!aid)return;await api("/api/fsm/"+aid+"/reset",{method:"POST"});await refresh()}',
    'async function mkPreset(){const p=document.getElementById("ps").value;if(!p)return;',
    'await api("/api/presets/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({preset:p})});await refresh()}',
    'document.getElementById("ps").innerHTML="<option value=\\"\\">— New from Preset —</option>"+presets.map(p=>"<option value=\\""+p+"\\">"+p+"</option>").join("");',
    'refresh();setInterval(refresh,5000);',
    '</script></body></html>'
  ].join('\n');
}

server.listen(PORT, () => {
  console.log('🐋 agent-fsm dashboard → http://localhost:' + PORT);
});
