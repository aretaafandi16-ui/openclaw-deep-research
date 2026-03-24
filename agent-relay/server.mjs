/**
 * agent-relay HTTP server — dark-theme web dashboard + REST API
 */

import http from 'http';
import { AgentRelay from './index.mjs';

const PORT = process.env.PORT || 3125;

const relay = new AgentRelay({
  persistenceDir: process.env.DATA_DIR || './data',
  maxHistory: parseInt(process.env.MAX_HISTORY || '10000'),
  defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '30000')
});

// SSE clients
const sseClients = new Set();

function sseBroadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) { sseClients.delete(res); }
  }
}

relay.on('msg', msg => sseBroadcast('message', msg));
relay.on('deliver', ({ agentId, msg }) => sseBroadcast('deliver', { agentId, msgId: msg.id, topic: msg.topic }));
relay.on('agent:register', id => sseBroadcast('agent', { event: 'register', id }));
relay.on('agent:unregister', id => sseBroadcast('agent', { event: 'unregister', id }));
relay.on('broadcast', msg => sseBroadcast('broadcast', { msgId: msg.id, delivered: msg.delivered }));
relay.on('dlq', ({ queueName, entry }) => sseBroadcast('dlq', { queueName, entryId: entry.id }));

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const routes = {
  'GET /api/stats': () => json(res, relay.stats()),
  'POST /api/agents/register': async (req, res) => {
    const { agentId, metadata } = await parseBody(req);
    if (!agentId) return json(res, { error: 'agentId required' }, 400);
    const agent = relay.registerAgent(agentId, metadata || {});
    json(res, { ok: true, agent: { id: agentId, connected: agent.connected, subscriptions: [...agent.subscriptions] } });
  },
  'POST /api/agents/unregister': async (req, res) => {
    const { agentId } = await parseBody(req);
    json(res, { ok: relay.unregisterAgent(agentId) });
  },
  'GET /api/agents': (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const connectedOnly = url.searchParams.get('connected') === 'true';
    json(res, relay.listAgents(connectedOnly));
  },
  'POST /api/subscribe': async (req, res) => {
    const { agentId, topic } = await parseBody(req);
    if (!agentId || !topic) return json(res, { error: 'agentId and topic required' }, 400);
    try { json(res, { ok: relay.subscribe(agentId, topic) }); }
    catch (e) { json(res, { error: e.message }, 400); }
  },
  'POST /api/unsubscribe': async (req, res) => {
    const { agentId, topic } = await parseBody(req);
    json(res, { ok: relay.unsubscribe(agentId, topic) });
  },
  'POST /api/publish': async (req, res) => {
    const { topic, payload, from, opts } = await parseBody(req);
    if (!topic) return json(res, { error: 'topic required' }, 400);
    json(res, relay.publish(topic, payload, from, opts || {}));
  },
  'POST /api/send': async (req, res) => {
    const { to, payload, from, opts } = await parseBody(req);
    if (!to) return json(res, { error: 'to required' }, 400);
    json(res, relay.send(to, payload, from, opts || {}));
  },
  'POST /api/broadcast': async (req, res) => {
    const { payload, from, opts } = await parseBody(req);
    json(res, relay.broadcast(payload, from, opts || {}));
  },
  'POST /api/request': async (req, res) => {
    const { to, payload, from, opts } = await parseBody(req);
    if (!to) return json(res, { error: 'to required' }, 400);
    try {
      const result = await relay.request(to, payload, from, opts || {});
      json(res, result);
    } catch (e) {
      json(res, { error: e.message }, 408);
    }
  },
  'POST /api/reply': async (req, res) => {
    const { correlationId, payload, from } = await parseBody(req);
    json(res, { ok: relay.reply(correlationId, payload, from) });
  },
  'POST /api/queue/enqueue': async (req, res) => {
    const { queue, payload, opts } = await parseBody(req);
    if (!queue) return json(res, { error: 'queue required' }, 400);
    json(res, { id: relay.enqueue(queue, payload, opts || {}) });
  },
  'GET /api/queue/dequeue': async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const queue = url.searchParams.get('queue');
    if (!queue) return json(res, { error: 'queue param required' }, 400);
    json(res, relay.dequeue(queue) || { empty: true });
  },
  'GET /api/history': (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const opts = {};
    if (url.searchParams.get('topic')) opts.topic = url.searchParams.get('topic');
    if (url.searchParams.get('from')) opts.from = url.searchParams.get('from');
    if (url.searchParams.get('type')) opts.type = url.searchParams.get('type');
    if (url.searchParams.get('limit')) opts.limit = parseInt(url.searchParams.get('limit'));
    if (url.searchParams.get('since')) opts.since = parseInt(url.searchParams.get('since'));
    json(res, relay.getHistory(opts));
  },
  'GET /api/dlq': () => json(res, relay.dlq.slice(-100)),
  'GET /api/queues': () => {
    const result = {};
    for (const [name] of relay.queues) result[name] = relay.queueStats(name);
    json(res, result);
  },
  'GET /api/subscriptions': () => {
    const result = {};
    for (const [topic, subs] of relay.topics) result[topic] = [...subs];
    for (const [pattern, subs] of relay.wildcards) result[pattern] = [...subs];
    json(res, result);
  }
};

function handleRoute(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // SSE
  if (path === '/api/_watch' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('event: connected\ndata: {"ok":true}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return true;
  }

  // CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return true;
  }

  const key = `${method} ${path}`;
  if (routes[key]) {
    routes[key](req, res);
    return true;
  }
  return false;
}

const DASHBOARD = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-relay</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:20px;font-size:24px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;text-align:center}
.stat .val{font-size:28px;font-weight:700;color:#58a6ff}
.stat .lbl{font-size:11px;color:#8b949e;margin-top:4px;text-transform:uppercase}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px}
.card h2{color:#58a6ff;font-size:16px;margin-bottom:12px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d;font-size:13px}
th{color:#8b949e;font-size:11px;text-transform:uppercase}
.tag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.tag-pub{background:#1f6feb33;color:#58a6ff}
.tag-direct{background:#23883333;color:#3fb950}
.tag-broadcast{background:#da363333;color:#f85149}
.tag-request{background:#d2992233;color:#d29922}
.flex{display:flex;gap:12px;flex-wrap:wrap}
input,textarea,select,button{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:13px}
button{background:#238636;border-color:#238636;cursor:pointer;font-weight:600}
button:hover{background:#2ea043}
textarea{width:100%;min-height:60px;resize:vertical;font-family:monospace}
input,select{min-width:120px}
form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}
form>*{flex:1;min-width:100px}
.live{color:#3fb950;font-size:11px}
.auto{opacity:.6;font-size:11px}
#log{max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px;background:#0d1117;padding:8px;border-radius:4px}
.log-line{padding:2px 0;border-bottom:1px solid #161b22}
</style></head><body>
<h1>🐋 agent-relay</h1>
<div class="stats" id="stats"></div>

<div class="card">
<h2>Publish Message <span class="live" id="sse-status">● SSE</span></h2>
<form id="pub-form">
<input id="pub-topic" placeholder="topic/path" required>
<textarea id="pub-payload" placeholder='{"key":"value"}' rows="2"></textarea>
<input id="pub-from" placeholder="from (agentId)">
<button type="submit">Publish</button>
</form>
</div>

<div class="card">
<h2>Register Agent</h2>
<form id="reg-form">
<input id="reg-id" placeholder="agent-id" required>
<input id="reg-meta" placeholder='metadata (JSON)'>
<button type="submit">Register</button>
</form>
</div>

<div class="card">
<h2>Subscribe</h2>
<form id="sub-form">
<input id="sub-agent" placeholder="agent-id" required>
<input id="sub-topic" placeholder="topic or pattern (e.g. events/*)" required>
<button type="submit">Subscribe</button>
</form>
</div>

<div class="flex">
<div class="card" style="flex:1">
<h2>Agents</h2>
<table id="agents-table"><tr><th>ID</th><th>Status</th><th>Subs</th><th>Queue</th></tr></table>
</div>
<div class="card" style="flex:1">
<h2>Subscriptions</h2>
<table id="subs-table"><tr><th>Topic/Pattern</th><th>Subscribers</th></tr></table>
</div>
</div>

<div class="card">
<h2>Live Messages <span class="auto">auto-refresh 3s</span></h2>
<div id="log"></div>
</div>

<script>
const api = (p, m='GET', b=null) => fetch('/api'+p, m!=='GET'?{method:m,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}).then(r=>r.json());

async function refresh(){
  const s = await api('/stats');
  document.getElementById('stats').innerHTML=[
    ['Agents',s.agents],['Connected',s.connected],['Topics',s.topics],
    ['Messages',s.messages],['Subscriptions',s.subscriptions],['Pending',s.pendingRequests],
    ['Queued',s.queuedMessages],['DLQ',s.dlqSize],['Routes',s.routes]
  ].map(([l,v])=>'<div class="stat"><div class="val">'+v+'</div><div class="lbl">'+l+'</div></div>').join('');

  const agents = await api('/agents');
  document.getElementById('agents-table').innerHTML='<tr><th>ID</th><th>Status</th><th>Subs</th><th>Queue</th></tr>'+
    agents.map(a=>'<tr><td>'+a.id+'</td><td>'+(a.connected?'🟢':'🔴')+'</td><td>'+a.subscriptions.length+'</td><td>'+a.queueLength+'</td></tr>').join('');

  const subs = await api('/subscriptions');
  document.getElementById('subs-table').innerHTML='<tr><th>Topic/Pattern</th><th>Subscribers</th></tr>'+
    Object.entries(subs).map(([t,s])=>'<tr><td>'+t+'</td><td>'+s.join(', ')+'</td></tr>').join('');
}

// SSE
const es = new EventSource('/api/_watch');
es.addEventListener('message', e=>{
  const d = JSON.parse(e.data);
  const log = document.getElementById('log');
  const cls = 'tag-'+(d.type||'pub');
  log.innerHTML = '<div class="log-line"><span class="tag '+cls+'">'+(d.type||'pub')+'</span> <b>'+d.topic+'</b> from '+(d.from||'anon')+' <span style="color:#8b949e">'+new Date(d.ts).toLocaleTimeString()+'</span></div>' + log.innerHTML;
  if(log.children.length > 100) log.removeChild(log.lastChild);
});
es.addEventListener('deliver', ()=>refresh());
es.addEventListener('agent', ()=>refresh());

document.getElementById('pub-form').onsubmit = async e=>{
  e.preventDefault();
  let payload;
  try{ payload = JSON.parse(document.getElementById('pub-payload').value); } catch{ payload = document.getElementById('pub-payload').value; }
  await api('/publish','POST',{
    topic: document.getElementById('pub-topic').value,
    payload,
    from: document.getElementById('pub-from').value||null
  });
  document.getElementById('pub-payload').value='';
  refresh();
};

document.getElementById('reg-form').onsubmit = async e=>{
  e.preventDefault();
  let meta={}; try{ meta=JSON.parse(document.getElementById('reg-meta').value); }catch{}
  await api('/agents/register','POST',{agentId:document.getElementById('reg-id').value,metadata:meta});
  document.getElementById('reg-id').value='';
  refresh();
};

document.getElementById('sub-form').onsubmit = async e=>{
  e.preventDefault();
  await api('/subscribe','POST',{agentId:document.getElementById('sub-agent').value,topic:document.getElementById('sub-topic').value});
  document.getElementById('sub-topic').value='';
  refresh();
};

refresh();
setInterval(refresh, 3000);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/' || url.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(DASHBOARD);
  }
  if (handleRoute(req, res)) return;
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => console.log(`agent-relay server on :${PORT}`));
