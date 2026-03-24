#!/usr/bin/env node
// agent-notify HTTP Server — REST API + dark-theme web dashboard

import http from 'node:http';
import { AgentNotify, Priority, PriorityName } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3108');

export function startServer(notify, port = PORT) {
  if (!notify) {
    notify = new AgentNotify();
    notify.addChannel('console', 'console');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // API routes
    if (url.pathname === '/api/send' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const notif = JSON.parse(body);
        const result = await notify.send(notif);
        json(res, result);
      } catch (e) { json(res, { error: e.message }, 400); }
      return;
    }

    if (url.pathname === '/api/channels') {
      if (req.method === 'GET') {
        json(res, notify.listChannels());
      } else if (req.method === 'POST') {
        const body = await readBody(req);
        try {
          const { name, type, config } = JSON.parse(body);
          notify.addChannel(name, type, config || {});
          json(res, { added: name });
        } catch (e) { json(res, { error: e.message }, 400); }
      }
      return;
    }

    if (url.pathname.startsWith('/api/channels/') && req.method === 'DELETE') {
      const name = url.pathname.split('/')[3];
      notify.removeChannel(name);
      json(res, { removed: name });
      return;
    }

    if (url.pathname === '/api/stats') {
      json(res, notify.stats());
      return;
    }

    if (url.pathname === '/api/templates' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { name, template } = JSON.parse(body);
        notify.addTemplate(name, template);
        json(res, { added: name });
      } catch (e) { json(res, { error: e.message }, 400); }
      return;
    }

    if (url.pathname === '/api/rules' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { matchTag, matchMinPriority, channels } = JSON.parse(body);
        const priMap = { low: 0, normal: 1, high: 2, critical: 3 };
        notify.addRule({
          match: (n) => {
            if (matchTag && n.tag !== matchTag) return false;
            if (matchMinPriority && n.priority < (priMap[matchMinPriority] ?? 0)) return false;
            return true;
          },
          channels,
        });
        json(res, { ruleAdded: true });
      } catch (e) { json(res, { error: e.message }, 400); }
      return;
    }

    if (url.pathname === '/api/quiet-hours' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { start, end } = JSON.parse(body);
        notify.setQuietHours(start, end);
        json(res, { quietStart: start, quietEnd: end });
      } catch (e) { json(res, { error: e.message }, 400); }
      return;
    }

    // Health
    if (url.pathname === '/health' || url.pathname === '/') {
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(DASHBOARD_HTML);
        return;
      }
      json(res, { status: 'ok', ...notify.stats(), channels: notify.listChannels().length });
      return;
    }

    json(res, { error: 'Not found' }, 404);
  });

  server.listen(port, () => {
    console.log(`🔔 agent-notify dashboard: http://localhost:${port}`);
  });

  return server;
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-notify</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center}
.card .num{font-size:2em;font-weight:bold;color:#58a6ff}
.card .label{color:#8b949e;font-size:0.85em}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #30363d}
th{color:#58a6ff;font-weight:600}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:600}
.badge-ok{background:#238636;color:#fff}
.badge-off{background:#484f58;color:#fff}
.btn{background:#238636;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:0.9em}
.btn:hover{background:#2ea043}
input,select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:4px;margin:4px}
input,select{width:200px}
.form{margin:16px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#result{margin-top:12px;padding:12px;background:#161b22;border:1px solid #30363d;border-radius:6px;white-space:pre-wrap;font-family:monospace;display:none}
</style></head><body>
<h1>🔔 agent-notify Dashboard</h1>
<div class="cards" id="cards"></div>

<h2 style="margin-top:24px">📤 Send Notification</h2>
<div class="form">
<input id="nf-title" placeholder="Title">
<input id="nf-body" placeholder="Body (required)" style="width:300px">
<select id="nf-priority"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High</option><option value="critical">Critical</option></select>
<button class="btn" onclick="sendNotif()">Send</button>
</div>
<div id="result"></div>

<h2 style="margin-top:24px">📡 Channels</h2>
<table><thead><tr><th>Name</th><th>Type</th><th>Status</th></tr></thead><tbody id="ch-body"></tbody></table>

<script>
async function load(){
  const stats=await(await fetch('/api/stats')).json();
  document.getElementById('cards').innerHTML=[
    ['📤','Sent',stats.sent],['❌','Failed',stats.failed],
    ['🔄','Deduped',stats.deduped],['⏳','Rate Limited',stats.rateLimited],
    ['🌙','Quiet Blocked',stats.quietBlocked],['📦','Batched',stats.batched],
  ].map(([e,l,n])=>'<div class="card"><div class="num">'+e+' '+n+'</div><div class="label">'+l+'</div></div>').join('');
  const ch=await(await fetch('/api/channels')).json();
  document.getElementById('ch-body').innerHTML=ch.map(c=>'<tr><td>'+c.name+'</td><td>'+c.type+'</td><td><span class="badge '+(c.enabled?'badge-ok':'badge-off')+'">'+(c.enabled?'ON':'OFF')+'</span></td></tr>').join('');
}
async function sendNotif(){
  const r=document.getElementById('result');
  const res=await(await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:document.getElementById('nf-title').value,body:document.getElementById('nf-body').value,priority:document.getElementById('nf-priority').value})})).json();
  r.style.display='block';r.textContent=JSON.stringify(res,null,2);load();
}
load();setInterval(load,5000);
</script></body></html>`;

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
