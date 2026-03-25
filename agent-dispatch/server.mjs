#!/usr/bin/env node
/**
 * agent-dispatch HTTP Server + Dashboard
 * Port: 3142 (configurable via PORT env)
 */

import { createServer } from 'http';
import { Dispatcher, Classifier } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3142');
const dispatcher = new Dispatcher({ id: 'http-dispatcher' });
const classifier = new Classifier();

// ── JSON helpers ──────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, content, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

// ── SSE clients ──────────────────────────────────────────────────

const sseClients = new Set();

function sseBroadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) { try { c.write(msg); } catch { sseClients.delete(c); } }
}

dispatcher.on('message:received', (msg) => sseBroadcast('received', { id: msg._id, type: msg.type, at: Date.now() }));
dispatcher.on('message:delivered', (route, msg) => sseBroadcast('delivered', { routeId: route.id, msgId: msg._id, at: Date.now() }));
dispatcher.on('message:failed', (route, msg, e) => sseBroadcast('failed', { routeId: route.id, msgId: msg._id, error: e.message, at: Date.now() }));
dispatcher.on('dlq:add', (entry) => sseBroadcast('dlq', { id: entry.messageId, reason: entry.reason, at: Date.now() }));

// ── Server ───────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    // ── Dashboard ──
    if (path === '/' || path === '/dashboard') return html(res, DASHBOARD_HTML);

    // ── SSE ──
    if (path === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write('event: connected\ndata: {}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ── API Routes ──
    if (path === '/api/submit' && method === 'POST') {
      const body = await readBody(req);
      const result = await dispatcher.submit(body.message || body, { priority: body.priority, tags: body.tags, enqueue: body.enqueue });
      return json(res, result);
    }

    if (path === '/api/routes' && method === 'GET') {
      return json(res, dispatcher.listRoutes().map(r => ({
        id: r.id, name: r.name, enabled: r.enabled, priority: r.priority,
        weight: r.weight, tags: r.tags, pattern: r.pattern, stats: r.stats,
      })));
    }

    if (path === '/api/routes' && method === 'POST') {
      const body = await readBody(req);
      const route = dispatcher.addRoute(body);
      return json(res, { id: route.id, name: route.name, enabled: route.enabled });
    }

    if (path.startsWith('/api/routes/') && method === 'DELETE') {
      const id = path.split('/')[3];
      return json(res, { removed: dispatcher.removeRoute(id) });
    }

    if (path.startsWith('/api/routes/') && path.endsWith('/enable') && method === 'POST') {
      const id = path.split('/')[3];
      return json(res, { enabled: dispatcher.enableRoute(id) });
    }

    if (path.startsWith('/api/routes/') && path.endsWith('/disable') && method === 'POST') {
      const id = path.split('/')[3];
      return json(res, { disabled: dispatcher.disableRoute(id) });
    }

    if (path === '/api/fan-out' && method === 'POST') {
      const body = await readBody(req);
      const result = await dispatcher.fanOut(body.message || {}, body.routeIds || [], { parallel: body.parallel });
      return json(res, result);
    }

    if (path === '/api/queue/process' && method === 'POST') {
      const body = await readBody(req);
      const processed = await dispatcher.processQueue(body.batchSize || 10);
      return json(res, { processed, remaining: dispatcher.queue.size });
    }

    if (path === '/api/dlq' && method === 'GET') {
      return json(res, dispatcher.getDLQ().map(e => ({ messageId: e.messageId, reason: e.reason, error: e.error, timestamp: e.timestamp, retries: e.retries })));
    }

    if (path === '/api/dlq/retry' && method === 'POST') {
      const body = await readBody(req);
      return json(res, await dispatcher.retryDLQ(body.maxItems || 10));
    }

    if (path === '/api/dlq/clear' && method === 'POST') {
      return json(res, { cleared: dispatcher.clearDLQ() });
    }

    if (path === '/api/history') {
      const routeId = url.searchParams.get('routeId');
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return json(res, dispatcher.getHistory({ routeId, limit }));
    }

    if (path === '/api/stats') {
      return json(res, dispatcher.getInfo());
    }

    if (path === '/api/classify' && method === 'POST') {
      const body = await readBody(req);
      const result = classifier.classify(body.message || body);
      return json(result.message, result);
    }

    json(res, { error: 'Not found' }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`🐋 agent-dispatch dashboard: http://localhost:${PORT}`);
  console.log(`📡 SSE endpoint: http://localhost:${PORT}/sse`);
});

// ── Dashboard HTML ────────────────────────────────────────────────

const DASHBOARD_HTML = /*html*/ `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🐋 agent-dispatch</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#c9d1d9;--dim:#8b949e;--accent:#58a6ff;--green:#3fb950;--red:#f85149;--yellow:#d29922;--purple:#bc8cff}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{font-size:1.6em;margin-bottom:16px}h1 span{color:var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}
.card .val{font-size:1.8em;font-weight:700;color:var(--accent)}.card .label{font-size:.78em;color:var(--dim);margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px}
.panel h2{font-size:1.1em;margin-bottom:12px;color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:.85em}
th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--dim);font-weight:600}
td{padding:6px 8px;border-bottom:1px solid var(--border)}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.75em;font-weight:600}
.badge-on{background:#238636;color:#fff}.badge-off{background:#6e7681;color:#fff}
.badge-critical{background:#da3633;color:#fff}.badge-high{background:#d29922;color:#fff}
.badge-normal{background:#1f6feb;color:#fff}.badge-low{background:#6e7681;color:#fff}
.btn{padding:6px 12px;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:6px;cursor:pointer;font-size:.82em}
.btn:hover{border-color:var(--accent);color:var(--accent)}
.btn-red{border-color:var(--red);color:var(--red)}.btn-green{border-color:var(--green);color:var(--green)}
.form-row{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.form-row input,.form-row select{padding:6px 10px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:.85em}
.form-row input{flex:1;min-width:120px}
.log{max-height:300px;overflow-y:auto;font-family:monospace;font-size:.8em}
.log-entry{padding:3px 6px;border-bottom:1px solid var(--border)}.log-entry:nth-child(odd){background:rgba(255,255,255,.02)}
.log-time{color:var(--dim);margin-right:8px}
.log-ok{color:var(--green)}.log-err{color:var(--red)}.log-info{color:var(--accent)}
</style></head><body>
<h1>🐋 <span>agent-dispatch</span> — Event Router</h1>

<div class="cards" id="stats-cards"></div>

<div class="grid">
  <div class="panel">
    <h2>📨 Send Message</h2>
    <div class="form-row">
      <input id="msg-type" placeholder="type (e.g. order.created)" style="flex:0.4">
      <input id="msg-payload" placeholder='{"key":"value"}'>
    </div>
    <div class="form-row">
      <select id="msg-priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select>
      <input id="msg-tags" placeholder="tags (comma-sep)" style="flex:0.5">
      <label style="display:flex;align-items:center;gap:4px;font-size:.82em"><input type="checkbox" id="msg-enqueue"> Enqueue</label>
      <button class="btn btn-green" onclick="sendMsg()">Send</button>
    </div>
  </div>
  <div class="panel">
    <h2>🛤️ Add Route</h2>
    <div class="form-row">
      <input id="route-name" placeholder="name">
      <select id="route-pattern-type"><option value="exact">Exact</option><option value="contains">Contains</option><option value="prefix">Prefix</option><option value="regex">Regex</option><option value="glob">Glob</option></select>
      <input id="route-pattern-field" placeholder="field (type)" style="flex:0.4">
      <input id="route-pattern-value" placeholder="pattern value">
    </div>
    <div class="form-row">
      <select id="route-priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select>
      <input id="route-weight" placeholder="weight" type="number" value="1" style="width:60px">
      <input id="route-tags" placeholder="tags" style="flex:0.5">
      <button class="btn btn-green" onclick="addRoute()">Add</button>
    </div>
  </div>
</div>

<div class="grid">
  <div class="panel">
    <h2>🛤️ Routes</h2>
    <table><thead><tr><th>Name</th><th>Pattern</th><th>Priority</th><th>Status</th><th>Matched</th><th>Delivered</th><th>Actions</th></tr></thead>
    <tbody id="routes-table"></tbody></table>
  </div>
  <div class="panel">
    <h2>📋 Dispatch Log</h2>
    <div class="log" id="dispatch-log"></div>
  </div>
</div>

<div class="grid">
  <div class="panel">
    <h2>💀 Dead Letter Queue (<span id="dlq-count">0</span>)</h2>
    <div style="margin-bottom:8px">
      <button class="btn" onclick="retryDLQ()">Retry All</button>
      <button class="btn btn-red" onclick="clearDLQ()">Clear</button>
    </div>
    <table><thead><tr><th>Message</th><th>Reason</th><th>Retries</th><th>Time</th></tr></thead>
    <tbody id="dlq-table"></tbody></table>
  </div>
  <div class="panel">
    <h2>📊 Queue</h2>
    <div class="cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:8px" id="queue-cards"></div>
    <button class="btn" onclick="processQueue()">Process Queue</button>
    <h2 style="margin-top:16px">📜 History (last 50)</h2>
    <table><thead><tr><th>Route</th><th>Status</th><th>Time</th></tr></thead>
    <tbody id="history-table"></tbody></table>
  </div>
</div>

<script>
const $ = s => document.querySelector(s);
let lastMsgId = null;

async function api(path, method='GET', body=null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  return (await fetch('/api' + path, opts)).json();
}

function fmtTime(ts) { return new Date(ts).toLocaleTimeString(); }

function patternStr(p) {
  if (!p) return '*';
  if (typeof p === 'function') return 'custom()';
  if (p.type) return \`\${p.field||'type'} \${p.type} "\${p.value||''}"\`;
  return JSON.stringify(p).slice(0,40);
}

async function refresh() {
  const stats = await api('/stats');
  $('#stats-cards').innerHTML = \`
    <div class="card"><div class="val">\${stats.stats.received}</div><div class="label">Received</div></div>
    <div class="card"><div class="val">\${stats.stats.dispatched}</div><div class="label">Dispatched</div></div>
    <div class="card"><div class="val">\${stats.stats.matched}</div><div class="label">Matched</div></div>
    <div class="card"><div class="val" style="color:var(--red)">\${stats.stats.failed}</div><div class="label">Failed</div></div>
    <div class="card"><div class="val" style="color:var(--yellow)">\${stats.dlqSize}</div><div class="label">DLQ</div></div>
    <div class="card"><div class="val">\${stats.routes}</div><div class="label">Routes</div></div>
    <div class="card"><div class="val">\${stats.strategy}</div><div class="label">Strategy</div></div>
    <div class="card"><div class="val">\${Math.round((Date.now()-stats.stats.startedAt)/1000)}s</div><div class="label">Uptime</div></div>\`;

  const routes = await api('/routes');
  $('#routes-table').innerHTML = routes.map(r => \`<tr>
    <td>\${r.name}</td><td><code>\${patternStr(r.pattern)}</code></td>
    <td><span class="badge badge-\${r.priority}">\${r.priority}</span></td>
    <td><span class="badge badge-\${r.enabled?'on':'off'}">\${r.enabled?'on':'off'}</span></td>
    <td>\${r.stats.matched}</td><td>\${r.stats.delivered}</td>
    <td><button class="btn" onclick="toggleRoute('\${r.id}',\${!r.enabled})">\${r.enabled?'Disable':'Enable'}</button>
    <button class="btn btn-red" onclick="removeRoute('\${r.id}')">×</button></td></tr>\`).join('');

  const dlq = await api('/dlq');
  $('#dlq-count').textContent = dlq.length;
  $('#dlq-table').innerHTML = dlq.slice(-20).reverse().map(e => \`<tr>
    <td><code>\${e.messageId?.slice(0,16)}…</code></td><td>\${e.reason}</td><td>\${e.retries}</td><td>\${fmtTime(e.timestamp)}</td></tr>\`).join('');

  const qs = stats.queueSizes || {};
  $('#queue-cards').innerHTML = \`
    <div class="card"><div class="val" style="color:var(--red)">\${qs.critical||0}</div><div class="label">Critical</div></div>
    <div class="card"><div class="val" style="color:var(--yellow)">\${qs.high||0}</div><div class="label">High</div></div>
    <div class="card"><div class="val">\${qs.normal||0}</div><div class="label">Normal</div></div>
    <div class="card"><div class="val" style="color:var(--dim)">\${qs.low||0}</div><div class="label">Low</div></div>\`;

  const hist = await api('/history?limit=50');
  $('#history-table').innerHTML = hist.reverse().slice(0,30).map(h => \`<tr>
    <td>\${h.routeName||h.routeId||'-'}</td>
    <td><span style="color:\${h.success?'var(--green)':'var(--red)'}">\${h.success?'✓':'✗'}</span> \${h.error||''}</td>
    <td>\${fmtTime(h.timestamp)}</td></tr>\`).join('');
}

async function sendMsg() {
  const type = $('#msg-type').value || 'test';
  let payload = {};
  try { payload = JSON.parse($('#msg-payload').value); } catch {}
  const msg = { type, ...payload };
  const tags = $('#msg-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
  const result = await api('/submit', 'POST', {
    message: msg, priority: $('#msg-priority').value, tags, enqueue: $('#msg-enqueue').checked
  });
  addLog('info', JSON.stringify(result));
  refresh();
}

async function addRoute() {
  const name = $('#route-name').value || 'unnamed';
  const pt = $('#route-pattern-type').value;
  const pf = $('#route-pattern-field').value || 'type';
  const pv = $('#route-pattern-value').value || '*';
  const tags = $('#route-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
  const weight = parseInt($('#route-weight').value) || 1;
  await api('/routes', 'POST', {
    name, pattern: { type: pt, field: pf, value: pv },
    priority: $('#route-priority').value, weight, tags
  });
  addLog('ok', \`Route "\${name}" added\`);
  refresh();
}

async function toggleRoute(id, enable) {
  await api(\`/routes/\${id}/\${enable?'enable':'disable'}\`, 'POST');
  refresh();
}

async function removeRoute(id) {
  await api(\`/routes/\${id}\`, 'DELETE');
  refresh();
}

async function retryDLQ() { await api('/dlq/retry', 'POST'); refresh(); }
async function clearDLQ() { await api('/dlq/clear', 'POST'); refresh(); }
async function processQueue() { const r = await api('/queue/process', 'POST'); addLog('info', \`Processed \${r.processed} messages\`); refresh(); }

function addLog(type, msg) {
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = \`<span class="log-time">\${new Date().toLocaleTimeString()}</span><span class="log-\${type}">\${msg}</span>\`;
  const log = $('#dispatch-log');
  log.prepend(el);
  while (log.children.length > 100) log.removeChild(log.lastChild);
}

// SSE
const es = new EventSource('/sse');
es.addEventListener('received', e => { const d = JSON.parse(e.data); addLog('info', \`← received \${d.type || d.id}\`); refresh(); });
es.addEventListener('delivered', e => { const d = JSON.parse(e.data); addLog('ok', \`✓ delivered to \${d.routeId}\`); refresh(); });
es.addEventListener('failed', e => { const d = JSON.parse(e.data); addLog('err', \`✗ failed \${d.routeId}: \${d.error}\`); refresh(); });
es.addEventListener('dlq', e => { const d = JSON.parse(e.data); addLog('err', \`💀 DLQ: \${d.reason}\`); refresh(); });

refresh();
setInterval(refresh, 5000);
</script></body></html>`;
