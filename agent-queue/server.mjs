#!/usr/bin/env node
/**
 * agent-queue HTTP Server
 *
 * Endpoints:
 *   GET  /                  — Dashboard UI
 *   POST /publish           — Publish message
 *   POST /subscribe         — Subscribe to pattern
 *   POST /ack               — Acknowledge message
 *   POST /nack              — Negative-acknowledge
 *   POST /request           — Request-reply
 *   GET  /messages/:topic   — Query messages
 *   GET  /topics            — List topics
 *   GET  /subscribers       — List subscribers
 *   GET  /dead-letter       — Dead letter queue
 *   POST /purge             — Purge messages
 *   GET  /stats             — Queue statistics
 *   GET  /sse               — Server-Sent Events stream
 */

import { createServer } from 'http';
import { AgentQueue } from './index.mjs';
import { join } from 'path';

const PORT = parseInt(process.env.QUEUE_PORT || '3116');
const dataDir = process.env.QUEUE_DATA_DIR || join(process.env.HOME || '/tmp', '.agent-queue');
const queue = new AgentQueue({ dataDir, enablePersistence: true });

// SSE clients
const sseClients = new Set();

// Forward queue events to SSE
['published', 'acked', 'nacked', 'dead_lettered', 'expired'].forEach(event => {
  queue.on(event, (data) => {
    const msg = `data: ${JSON.stringify({ event, data, timestamp: Date.now() })}\n\n`;
    for (const res of sseClients) res.write(msg);
  });
});

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
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
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    // Dashboard
    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(DASHBOARD_HTML);
    }

    // SSE
    if (path === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(`data: ${JSON.stringify({ event: 'connected', timestamp: Date.now() })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // API routes
    if (path === '/publish' && req.method === 'POST') {
      const body = await readBody(req);
      const msg = queue.publish(body.topic, body.payload, body);
      return json(res, msg);
    }

    if (path === '/subscribe' && req.method === 'POST') {
      const body = await readBody(req);
      const subId = queue.subscribe(body.pattern, (msg) => {
        console.error(`[${subId}] ${msg.topic}:`, msg.payload);
      }, body);
      return json(res, { subscriptionId: subId, pattern: body.pattern });
    }

    if (path === '/ack' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, { acked: queue.ack(body.subscriptionId, body.messageId) });
    }

    if (path === '/nack' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, { nacked: queue.nack(body.subscriptionId, body.messageId, body) });
    }

    if (path === '/request' && req.method === 'POST') {
      const body = await readBody(req);
      const reply = await queue.request(body.topic, body.payload, { timeout: body.timeout });
      return json(res, reply);
    }

    if (path.startsWith('/messages/') && req.method === 'GET') {
      const topic = decodeURIComponent(path.slice('/messages/'.length));
      const since = parseInt(url.searchParams.get('since') || '0');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      return json(res, queue.getMessages(topic, { since, limit }));
    }

    if (path === '/topics' && req.method === 'GET') {
      return json(res, queue.getTopics());
    }

    if (path === '/subscribers' && req.method === 'GET') {
      return json(res, queue.getSubscribers());
    }

    if (path === '/dead-letter' && req.method === 'GET') {
      return json(res, queue.getDeadLetter());
    }

    if (path === '/purge' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, { purged: queue.purge(body.topic) });
    }

    if (path === '/stats' && req.method === 'GET') {
      return json(res, {
        stats: queue.stats,
        messages: queue.messages.size,
        topics: queue.topics.size,
        subscribers: queue.subscribers.size,
        deadLetter: queue.deadLetter.length
      });
    }

    json(res, { error: 'Not found' }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`[agent-queue] HTTP server on http://localhost:${PORT}`);
});

// ─── Dashboard HTML ──────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-queue</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:8px;font-size:1.5em}
.subtitle{color:#8b949e;margin-bottom:20px;font-size:.85em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:.75em;text-transform:uppercase;letter-spacing:.5em}
.card .val{font-size:1.8em;font-weight:700;color:#58a6ff;margin:8px 0}
.card .val.green{color:#3fb950}.card .val.red{color:#f85149}.card .val.yellow{color:#d29922}
table{width:100%;border-collapse:collapse;margin:16px 0}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:.75em;text-transform:uppercase;background:#161b22}
tr:hover{background:#161b22}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;font-weight:600}
.badge.low{background:#1f2937;color:#8b949e}.badge.normal{background:#0d419d;color:#58a6ff}
.badge.high{background:#5c1d1d;color:#f85149}.badge.critical{background:#6e1b1b;color:#ff7b72}
.btn{padding:6px 14px;border:1px solid #30363d;border-radius:6px;background:#21262d;color:#c9d1d9;cursor:pointer;font-size:.85em}
.btn:hover{background:#30363d}.btn.primary{background:#238636;border-color:#2ea043;color:#fff}
input,textarea{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;color:#c9d1d9;font-size:.9em;width:100%}
input:focus,textarea:focus{border-color:#58a6ff;outline:none}
.form-row{margin:8px 0;display:flex;gap:8px}.form-row input{flex:1}
#pub-form{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:16px 0}
#pub-form h3{margin-bottom:12px;color:#58a6ff}
#live-feed{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:.8em}
.feed-msg{padding:4px 0;border-bottom:1px solid #161b22}.feed-msg:last-child{border:none}
.feed-time{color:#8b949e;margin-right:8px}.feed-topic{color:#58a6ff;margin-right:8px}
</style></head><body>
<h1>🐋 agent-queue</h1>
<p class="subtitle">Zero-dep message queue for AI agents — auto-refresh 5s</p>
<div class="grid" id="stats-grid"></div>
<div id="pub-form">
<h3>Publish Message</h3>
<div class="form-row"><input id="pub-topic" placeholder="topic (e.g. orders.new)"><select id="pub-priority"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High</option><option value="critical">Critical</option></select></div>
<div class="form-row"><textarea id="pub-payload" rows="2" placeholder='{"key": "value"}'></textarea></div>
<div class="form-row"><button class="btn primary" onclick="publish()">Publish</button></div>
</div>
<h3 style="margin:20px 0 10px;color:#58a6ff">📋 Topics</h3>
<table><thead><tr><th>Topic</th><th>Pending</th><th>Total</th><th>Last Published</th></tr></thead><tbody id="topics-body"></tbody></table>
<h3 style="margin:20px 0 10px;color:#58a6ff">👥 Subscribers</h3>
<table><thead><tr><th>ID</th><th>Pattern</th><th>Group</th><th>Inflight</th><th>Acked</th><th>Nacked</th></tr></thead><tbody id="subs-body"></tbody></table>
<h3 style="margin:20px 0 10px;color:#58a6ff">💀 Dead Letter Queue</h3>
<table><thead><tr><th>Topic</th><th>Reason</th><th>Attempts</th><th>Payload</th></tr></thead><tbody id="dl-body"></tbody></table>
<h3 style="margin:20px 0 10px;color:#58a6ff">📡 Live Feed</h3>
<div id="live-feed"></div>
<script>
const feed=document.getElementById('live-feed');
function html(s){const d=document.createElement('div');d.innerHTML=s;return d.firstChild}
async function fetchJSON(u){return(await fetch(u)).json()}
async function refresh(){
  const s=await fetchJSON('/stats');
  document.getElementById('stats-grid').innerHTML=[
    ['Published',s.stats.published,'blue'],['Delivered',s.stats.delivered,'blue'],['Active',s.messages,'green'],
    ['Acked',s.stats.acked,'green'],['Nacked',s.stats.nacked,'yellow'],['Dead Lett.',s.stats.deadLettered,'red'],
    ['Expired',s.stats.expired,'yellow'],['Topics',s.topics,'blue'],['Subscribers',s.subscribers,'blue']
  ].map(([l,v,c])=>'<div class="card"><h3>'+l+'</h3><div class="val '+c+'">'+v+'</div></div>').join('');
  const topics=await fetchJSON('/topics');
  document.getElementById('topics-body').innerHTML=topics.map(t=>'<tr><td>'+t.topic+'</td><td>'+t.pending+'</td><td>'+t.total+'</td><td>'+(t.lastPublished?new Date(t.lastPublished).toLocaleTimeString():'-')+'</td></tr>').join('');
  const subs=await fetchJSON('/subscribers');
  document.getElementById('subs-body').innerHTML=subs.map(s=>'<tr><td style="font-family:monospace;font-size:.8em">'+s.id.slice(0,16)+'…</td><td>'+s.pattern+'</td><td>'+(s.group||'-')+'</td><td>'+s.inflight+'</td><td>'+s.acked+'</td><td>'+s.nacked+'</td></tr>').join('');
  const dl=await fetchJSON('/dead-letter');
  document.getElementById('dl-body').innerHTML=dl.map(d=>'<tr><td>'+d.topic+'</td><td>'+(d.reason||'-')+'</td><td>'+d.attempts+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">'+JSON.stringify(d.payload||d.message?.payload||'').slice(0,60)+'</td></tr>').join('');
}
async function publish(){
  const topic=document.getElementById('pub-topic').value;if(!topic)return;
  let payload;try{payload=JSON.parse(document.getElementById('pub-payload').value||'""')}catch{payload=document.getElementById('pub-payload').value}
  await fetch('/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,payload,priority:document.getElementById('pub-priority').value})});
  document.getElementById('pub-topic').value='';document.getElementById('pub-payload').value='';
  refresh();
}
const es=new EventSource('/sse');
es.onmessage=e=>{const d=JSON.parse(e.data);if(d.event==='connected')return;
  const el=document.createElement('div');el.className='feed-msg';
  el.innerHTML='<span class="feed-time">'+new Date(d.timestamp).toLocaleTimeString()+'</span><span class="feed-topic">['+d.event+']</span>'+JSON.stringify(d.data).slice(0,120);
  feed.prepend(el);while(feed.children.length>100)feed.lastChild.remove();
};
refresh();setInterval(refresh,5000);
</script></body></html>`;

export default server;
