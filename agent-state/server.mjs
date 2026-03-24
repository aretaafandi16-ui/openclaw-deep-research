#!/usr/bin/env node
/**
 * agent-state HTTP Server — REST API + dark-theme web dashboard
 */

import { createServer } from 'http';
import { StateMachine, Guards, createWorkflow, createGameLoop } from './index.mjs';

const PORT = parseInt(process.argv[2] || process.env.PORT || '3112', 10);
const machines = new Map();

function parseActions(states) {
  for (const [name, def] of Object.entries(states)) {
    if (typeof def.onEntry === 'string') def.onEntry = new Function('ctx', def.onEntry);
    if (typeof def.onExit === 'string') def.onExit = new Function('ctx', def.onExit);
    if (def.on) {
      for (const [evt, trans] of Object.entries(def.on)) {
        const arr = Array.isArray(trans) ? trans : [trans];
        for (const t of arr) {
          if (typeof t.action === 'string') t.action = new Function('ctx', 'data', t.action);
          if (typeof t.guard === 'string') t.guard = new Function('ctx', 'data', `return (${t.guard})`);
        }
        def.on[evt] = arr.length === 1 ? arr[0] : arr;
      }
    }
  }
  return states;
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // API routes
  if (path === '/api/machines' && req.method === 'GET') {
    const list = [];
    for (const [id, sm] of machines) {
      list.push({ id, state: sm.state, running: sm.isRunning, isDone: sm.isDone, transitions: sm.history.length, events: sm.events });
    }
    return json(res, { machines: list, total: list.length });
  }

  if (path === '/api/machines' && req.method === 'POST') {
    const body = await readBody(req);
    const config = JSON.parse(body);
    if (config.states) parseActions(config.states);
    const sm = new StateMachine(config);
    machines.set(sm.id, sm);
    if (config.autoStart) await sm.start();
    return json(res, { id: sm.id, state: sm.state, created: true });
  }

  if (path.match(/^\/api\/machines\/[^/]+$/) && req.method === 'GET') {
    const id = path.split('/')[3];
    const sm = machines.get(id);
    if (!sm) return json(res, { error: 'not found' }, 404);
    return json(res, {
      id: sm.id, state: sm.state, running: sm.isRunning, isDone: sm.isDone,
      context: sm.context, events: sm.events, transitions: sm.history.length,
      states: Array.from(sm.states.keys()),
    });
  }

  if (path.match(/^\/api\/machines\/[^/]+\/send$/) && req.method === 'POST') {
    const id = path.split('/')[3];
    const sm = machines.get(id);
    if (!sm) return json(res, { error: 'not found' }, 404);
    const body = JSON.parse(await readBody(req));
    const result = await sm.send(body.event, body.data || {});
    return json(res, { ...result, state: sm.state, context: sm.context });
  }

  if (path.match(/^\/api\/machines\/[^/]+\/start$/) && req.method === 'POST') {
    const id = path.split('/')[3];
    const sm = machines.get(id);
    if (!sm) return json(res, { error: 'not found' }, 404);
    const body = await readBody(req);
    const opts = body ? JSON.parse(body) : {};
    await sm.start(opts.initialState);
    return json(res, { id: sm.id, state: sm.state, running: sm.isRunning });
  }

  if (path.match(/^\/api\/machines\/[^/]+\/stop$/) && req.method === 'POST') {
    const id = path.split('/')[3];
    const sm = machines.get(id);
    if (!sm) return json(res, { error: 'not found' }, 404);
    sm.stop();
    return json(res, { id: sm.id, stopped: true });
  }

  if (path.match(/^\/api\/machines\/[^/]+\/history$/) && req.method === 'GET') {
    const id = path.split('/')[3];
    const sm = machines.get(id);
    if (!sm) return json(res, { error: 'not found' }, 404);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    return json(res, { history: sm.history.slice(-limit), total: sm.history.length });
  }

  if (path.match(/^\/api\/machines\/[^/]+\/snapshot$/) && req.method === 'GET') {
    const id = path.split('/')[3];
    const sm = machines.get(id);
    if (!sm) return json(res, { error: 'not found' }, 404);
    return json(res, sm.snapshot());
  }

  if (path === '/api/stats' && req.method === 'GET') {
    let totalTransitions = 0, running = 0, done = 0;
    for (const [, sm] of machines) {
      totalTransitions += sm.history.length;
      if (sm.isRunning) running++;
      if (sm.isDone) done++;
    }
    return json(res, { totalMachines: machines.size, running, done, totalTransitions });
  }

  // Dashboard
  if (path === '/' || path === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(DASHBOARD_HTML);
  }

  json(res, { error: 'not found' }, 404);
});

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => resolve(body));
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-state dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:8px;font-size:1.5rem}
.subtitle{color:#8b949e;margin-bottom:20px;font-size:.85rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:.75rem;text-transform:uppercase}
.card .value{font-size:1.8rem;font-weight:700;color:#58a6ff;margin-top:4px}
.card .value.green{color:#3fb950}.card .value.yellow{color:#d29922}.card .value.red{color:#f85149}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d;font-size:.85rem}
th{color:#8b949e;font-weight:600}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.7rem;font-weight:600}
.badge.running{background:#238636;color:#fff}.badge.done{background:#8957e5;color:#fff}.badge.stopped{background:#da3633;color:#fff}
button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;margin:2px}
button:hover{background:#30363d}.btn-primary{background:#238636;border-color:#238636;color:#fff}
.btn-danger{background:#da3633;border-color:#da3633;color:#fff}
.panel{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px}
.panel h2{color:#c9d1d9;font-size:1rem;margin-bottom:12px}
textarea{width:100%;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px;font-family:monospace;font-size:.8rem;min-height:100px;resize:vertical}
select,input[type=text]{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 8px;font-size:.85rem}
.flex{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
pre{background:#0d1117;padding:12px;border-radius:6px;font-size:.8rem;overflow-x:auto;max-height:300px}
#log{font-family:monospace;font-size:.75rem;color:#8b949e;max-height:200px;overflow-y:auto;background:#0d1117;padding:8px;border-radius:6px;margin-top:8px}
</style>
</head>
<body>
<h1>🐋 agent-state</h1>
<p class="subtitle">State Machine Engine Dashboard &bull; Auto-refresh 3s</p>
<div class="cards" id="stats"></div>
<div class="flex" style="margin-bottom:16px">
  <button class="btn-primary" onclick="showCreate()">+ New Machine</button>
  <button onclick="showWorkflow()">+ Workflow</button>
</div>
<div id="create-form" style="display:none" class="panel">
  <h2>Create State Machine</h2>
  <textarea id="machine-json" rows="8">{
  "id": "demo",
  "initial": "idle",
  "context": {"count": 0},
  "states": {
    "idle": {
      "onEntry": "ctx.count++",
      "on": {"START": {"target": "running"}}
    },
    "running": {
      "on": {"PAUSE": {"target": "paused"}, "STOP": {"target": "idle"}},
      "after": {"10000": "idle"}
    },
    "paused": {
      "on": {"RESUME": {"target": "running"}, "STOP": {"target": "idle"}}
    }
  }
}</textarea>
  <div class="flex" style="margin-top:8px">
    <button class="btn-primary" onclick="createMachine()">Create</button>
    <button onclick="document.getElementById('create-form').style.display='none'">Cancel</button>
  </div>
</div>
<table>
  <thead><tr><th>ID</th><th>State</th><th>Status</th><th>Events</th><th>Transitions</th><th>Actions</th></tr></thead>
  <tbody id="machines"></tbody>
</table>
<div id="detail" class="panel" style="display:none">
  <h2 id="detail-title">Machine Detail</h2>
  <div class="flex" style="margin-bottom:12px">
    <input type="text" id="event-input" placeholder="Event name">
    <button class="btn-primary" onclick="sendEvent()">Send Event</button>
  </div>
  <pre id="detail-body"></pre>
  <h3 style="margin:12px 0 8px;color:#8b949e;font-size:.85rem">Transition History</h3>
  <div id="log"></div>
</div>
<script>
let selectedId=null;
async function api(p,o={}){const r=await fetch(p,{headers:{'Content-Type':'application/json'},...o});return r.json()}
async function refresh(){
  const[s,m]=await Promise.all([api('/api/stats'),api('/api/machines')]);
  document.getElementById('stats').innerHTML=\`
    <div class="card"><div class="label">Total Machines</div><div class="value">\${s.totalMachines}</div></div>
    <div class="card"><div class="label">Running</div><div class="value green">\${s.running}</div></div>
    <div class="card"><div class="label">Done</div><div class="value yellow">\${s.done}</div></div>
    <div class="card"><div class="label">Transitions</div><div class="value">\${s.totalTransitions}</div></div>\`;
  document.getElementById('machines').innerHTML=m.machines.map(x=>\`<tr>
    <td><a href="#" onclick="select('\${x.id}');return false">\${x.id}</a></td>
    <td><strong>\${x.state||'—'}</strong></td>
    <td><span class="badge \${x.running?'running':x.isDone?'done':'stopped'}">\${x.running?'running':x.isDone?'done':'stopped'}</span></td>
    <td>\${(x.events||[]).map(e=>'<code>'+e+'</code>').join(' ')||'—'}</td>
    <td>\${x.transitions}</td>
    <td>
      <button onclick="startMachine('\${x.id}')">Start</button>
      <button class="btn-danger" onclick="stopMachine('\${x.id}')">Stop</button>
    </td>
  </tr>\`).join('')||'<tr><td colspan="6" style="text-align:center;color:#8b949e">No machines yet. Create one above.</td></tr>';
  if(selectedId)select(selectedId);
}
async function select(id){selectedId=id;const d=await api('/api/machines/'+id);document.getElementById('detail').style.display='block';
  document.getElementById('detail-title').textContent='Machine: '+id;
  document.getElementById('detail-body').textContent=JSON.stringify(d,null,2);
  const h=await api('/api/machines/'+id+'/history');
  document.getElementById('log').innerHTML=h.history.map(x=>\`<div>\${new Date(x.ts).toLocaleTimeString()} <strong>\${x.from}</strong> → <strong>\${x.to}</strong> [\${x.event}]</div>\`).join('')||'No transitions yet.';}
async function sendEvent(){if(!selectedId)return;const e=document.getElementById('event-input').value.trim();if(!e)return;
  await api('/api/machines/'+selectedId+'/send',{method:'POST',body:JSON.stringify({event:e})});
  document.getElementById('event-input').value='';refresh();}
async function startMachine(id){await api('/api/machines/'+id+'/start',{method:'POST'});refresh();}
async function stopMachine(id){await api('/api/machines/'+id+'/stop',{method:'POST'});refresh();}
function showCreate(){document.getElementById('create-form').style.display='block'}
function showWorkflow(){const steps=prompt('Enter step names (comma-separated):','fetch,process,save');if(!steps)return;
  const w={id:'wf-'+Date.now(),initial:steps.split(',')[0].trim(),states:{}};
  const names=steps.split(',').map(s=>s.trim());
  names.forEach((n,i)=>{w.states[n]={on:i<names.length-1?{NEXT:{target:names[i+1]}}:{}};});
  api('/api/machines',{method:'POST',body:JSON.stringify(w)}).then(refresh);}
async function createMachine(){try{const c=JSON.parse(document.getElementById('machine-json').value);
  await api('/api/machines',{method:'POST',body:JSON.stringify(c)});
  document.getElementById('create-form').style.display='none';refresh();}catch(e){alert('Invalid JSON: '+e.message)}}
refresh();setInterval(refresh,3000);
</script>
</body>
</html>`;

server.listen(PORT, () => {
  console.log(\`agent-state dashboard: http://localhost:\${PORT}\`);
});

export default server;
