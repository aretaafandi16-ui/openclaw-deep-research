#!/usr/bin/env node
/**
 * agent-session HTTP server — REST API + dark-theme web dashboard
 * Port: 3118 (configurable via PORT env)
 */

import { createServer } from 'http';
import { SessionManager } from './index.mjs';

const PORT = parseInt(process.env.PORT ?? '3118');
const sm = new SessionManager({
  persistDir: process.env.PERSIST_DIR ?? './data',
  defaultTTL: parseInt(process.env.DEFAULT_TTL ?? '1800000'),
  maxSessions: parseInt(process.env.MAX_SESSIONS ?? '10000'),
  maxMessages: parseInt(process.env.MAX_MESSAGES ?? '500')
});

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}

const dashboard = () => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-session</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:20px;font-size:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase}.card .value{color:#58a6ff;font-size:28px;font-weight:700;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#161b22;border-radius:8px;overflow:hidden}
th{background:#21262d;color:#8b949e;text-align:left;padding:10px 12px;font-size:12px;text-transform:uppercase}
td{padding:10px 12px;border-top:1px solid #30363d;font-size:13px}
tr:hover{background:#1c2128}.status-active{color:#3fb950}.status-expired{color:#f85149}
.tag{background:#1f6feb22;color:#58a6ff;padding:2px 8px;border-radius:12px;font-size:11px;margin-right:4px}
.section{margin-bottom:32px}h2{color:#c9d1d9;margin-bottom:12px;font-size:18px}
button{background:#238636;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px}
button:hover{background:#2ea043}button.danger{background:#da3633}button.danger:hover{background:#f85149}
input,select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:6px;font-size:13px}
.form{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.msg{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:12px}
.msg .role{font-weight:600;color:#58a6ff;margin-right:8px}.msg .ts{color:#484f58;font-size:11px}
</style></head><body>
<h1>🐋 agent-session</h1>
<div class="cards" id="cards"></div>
<div class="section"><h2>Create Session</h2>
<div class="form">
<input id="c-owner" placeholder="Owner (optional)">
<input id="c-ns" placeholder="Namespace" value="default">
<input id="c-ttl" placeholder="TTL ms" value="1800000">
<input id="c-tags" placeholder="Tags (comma-sep)">
<button onclick="createSession()">Create</button>
</div></div>
<div class="section"><h2>Sessions</h2>
<div id="sessions"></div></div>
<div class="section"><h2>Messages</h2>
<input id="msg-sid" placeholder="Session ID" style="width:300px;margin-bottom:8px">
<button onclick="loadMessages()" style="margin-bottom:8px">Load Messages</button>
<div class="form">
<select id="msg-role"><option>user</option><option>assistant</option><option>system</option><option>tool</option></select>
<input id="msg-content" placeholder="Message content" style="flex:1">
<button onclick="addMessage()">Send</button>
</div>
<div id="messages"></div></div>
<script>
async function api(path,method='GET',body){const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return r.json()}
async function loadStats(){const s=await api('/stats');
document.getElementById('cards').innerHTML=
[['Active',s.active],['Created',s.created],['Expired',s.expired],['Destroyed',s.destroyed],
['Messages',s.totalMessages],['Owners',s.owners],['Namespaces',s.namespaces],['Avg Msgs',s.avgMessagesPerSession]]
.map(([l,v])=>'<div class="card"><div class="label">'+l+'</div><div class="value">'+v+'</div></div>').join('')}
async function loadSessions(){const ss=await api('/sessions');
document.getElementById('sessions').innerHTML='<table><tr><th>ID</th><th>Owner</th><th>Namespace</th><th>Tags</th><th>Messages</th><th>Status</th><th>Last Active</th><th>Actions</th></tr>'+
ss.map(s=>'<tr><td style="font-family:monospace;font-size:11px">'+s.id.slice(0,12)+'…</td><td>'+(s.owner||'—')+'</td><td>'+s.namespace+'</td><td>'+
(s.tags.map(t=>'<span class="tag">'+t+'</span>').join('')||'—')+'</td><td>'+s.messageCount+'</td><td><span class="status-'+s.status+'">'+s.status+'</span></td><td>'+
new Date(s.lastAccessedAt).toLocaleTimeString()+'</td><td><button class="danger" onclick="destroySession(\\''+s.id+'\\')">Destroy</button></td></tr>').join('')+'</table>'}
async function createSession(){const tags=document.getElementById('c-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
await api('/sessions','POST',{owner:document.getElementById('c-owner').value||undefined,namespace:document.getElementById('c-ns').value||'default',
ttl:parseInt(document.getElementById('c-ttl').value)||1800000,tags:tags.length?tags:undefined});
loadStats();loadSessions()}
async function destroySession(id){await api('/sessions/'+id,'DELETE');loadStats();loadSessions()}
async function loadMessages(){const sid=document.getElementById('msg-sid').value;if(!sid)return;
const ms=await api('/sessions/'+sid+'/messages');
document.getElementById('messages').innerHTML=ms.map(m=>'<div class="msg"><span class="role">'+m.role+'</span><span class="ts">'+new Date(m.timestamp).toLocaleTimeString()+'</span><br>'+m.content+'</div>').join('')}
async function addMessage(){const sid=document.getElementById('msg-sid').value;if(!sid)return;
await api('/sessions/'+sid+'/messages','POST',{role:document.getElementById('msg-role').value,content:document.getElementById('msg-content').value});
document.getElementById('msg-content').value='';loadMessages();loadStats()}
loadStats();loadSessions();setInterval(()=>{loadStats();loadSessions()},5000);
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/') return html(res, dashboard());
  if (p === '/api/stats') return json(res, sm.stats());

  if (p === '/api/sessions' && req.method === 'GET') {
    const opts = {};
    if (url.searchParams.get('owner')) opts.owner = url.searchParams.get('owner');
    if (url.searchParams.get('namespace')) opts.namespace = url.searchParams.get('namespace');
    if (url.searchParams.get('tag')) opts.tag = url.searchParams.get('tag');
    if (url.searchParams.get('limit')) opts.limit = parseInt(url.searchParams.get('limit'));
    return json(res, sm.list(opts));
  }

  if (p === '/api/sessions' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const s = sm.create(body);
      return json(res, s, 201);
    } catch (e) { return json(res, { error: e.message }, 400); }
  }

  const sessMatch = p.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessMatch) {
    const id = sessMatch[1];
    if (req.method === 'GET') {
      const s = sm.get(id);
      return s ? json(res, s) : json(res, { error: 'Not found' }, 404);
    }
    if (req.method === 'DELETE') {
      sm.destroy(id);
      return json(res, { ok: true });
    }
    if (req.method === 'PATCH') {
      try {
        const body = await parseBody(req);
        return json(res, sm.update(id, body));
      } catch (e) { return json(res, { error: e.message }, 400); }
    }
  }

  const msgMatch = p.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (msgMatch) {
    const id = msgMatch[1];
    if (req.method === 'GET') {
      const opts = {};
      if (url.searchParams.get('role')) opts.role = url.searchParams.get('role');
      if (url.searchParams.get('limit')) opts.limit = parseInt(url.searchParams.get('limit'));
      return json(res, sm.getMessages(id, opts));
    }
    if (req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const msg = sm.addMessage(id, body.role ?? 'user', body.content ?? '', body);
        return json(res, msg, 201);
      } catch (e) { return json(res, { error: e.message }, 400); }
    }
    if (req.method === 'DELETE') {
      return json(res, { cleared: sm.clearMessages(id) });
    }
  }

  const stateMatch = p.match(/^\/api\/sessions\/([^/]+)\/state(?:\/([^/]+))?$/);
  if (stateMatch) {
    const [, id, key] = stateMatch;
    if (req.method === 'GET') {
      return json(res, sm.getState(id, key));
    }
    if (req.method === 'PUT' && !key) {
      const body = await parseBody(req);
      for (const [k, v] of Object.entries(body)) sm.setState(id, k, v);
      return json(res, sm.getState(id));
    }
    if (req.method === 'DELETE' && key) {
      sm.deleteState(id, key);
      return json(res, { ok: true });
    }
  }

  const touchMatch = p.match(/^\/api\/sessions\/([^/]+)\/touch$/);
  if (touchMatch && req.method === 'POST') {
    try { return json(res, sm.touch(touchMatch[1])); }
    catch (e) { return json(res, { error: e.message }, 404); }
  }

  const extendMatch = p.match(/^\/api\/sessions\/([^/]+)\/extend$/);
  if (extendMatch && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      return json(res, sm.extend(extendMatch[1], body.ttl));
    } catch (e) { return json(res, { error: e.message }, 400); }
  }

  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, () => console.log(`agent-session dashboard → http://localhost:${PORT}`));
