#!/usr/bin/env node
// agent-dial — HTTP Server with web dashboard
import { createServer } from 'node:http';
import { DialogEngine } from './index.mjs';

const PORT = parseInt(process.argv[2] || process.env.PORT || '3128');
const engine = new DialogEngine();

// Demo flow
engine.defineFlow('demo', {
  name: 'Demo Flow',
  startNode: 'greet',
  nodes: {
    greet: { type: 'intent_router', content: "Didn't catch that. Try: register, help, info.", intents: [
      { intent: 'register', keywords: ['register', 'signup'], goto: 'reg_name' },
      { intent: 'support', keywords: ['help', 'support'], goto: 'support' },
      { intent: 'info', keywords: ['info', 'about'], goto: 'info' },
    ]},
    reg_name: { type: 'slot_fill', slots: [{ name: 'name', prompt: 'Your name?' }], transitions: [{ when: { slotFilled: 'name' }, goto: 'reg_email' }] },
    reg_email: { type: 'slot_fill', slots: [{ name: 'email', prompt: 'Email?', validate: [['pattern', '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$']] }], transitions: [{ when: { slotFilled: 'email' }, goto: 'reg_done' }] },
    reg_done: { type: 'action', action: (ctx) => ({ response: `✅ Registered: ${ctx.slots.name} <${ctx.slots.email}>` }), transitions: [{ goto: 'end' }] },
    support: { type: 'slot_fill', slots: [{ name: 'issue', prompt: 'Describe your issue:' }], transitions: [{ when: { slotFilled: 'issue' }, goto: 'support_done' }] },
    support_done: { type: 'action', action: (ctx) => ({ response: `🎫 Ticket #${Math.floor(Math.random()*9000+1000)} created.` }), transitions: [{ goto: 'end' }] },
    info: { type: 'message', content: 'ℹ️ agent-dial v1.0 — dialog state machine for AI agents.', transitions: [{ goto: 'end' }] },
    end: { type: 'end', content: '👋 Goodbye!' },
  },
});

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }

  // API routes
  if (url.pathname.startsWith('/api/')) {
    const body = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d)); } catch { r({}); } }); });

    if (url.pathname === '/api/flows' && req.method === 'GET') {
      return json(res, [...engine.flows.values()].map(f => ({ id: f.id, name: f.name, nodes: f.nodes.size })));
    }
    if (url.pathname === '/api/flows' && req.method === 'POST') {
      try { engine.defineFlow(body.flowId, body.definition); return json(res, { ok: true }); }
      catch (e) { return json(res, { error: e.message }, 400); }
    }
    if (url.pathname === '/api/sessions' && req.method === 'GET') {
      const activeOnly = url.searchParams.get('active') === 'true';
      const sessions = [...engine.sessions.values()];
      return json(res, (activeOnly ? sessions.filter(s => s.active) : sessions).map(s => s.toJSON()));
    }
    if (url.pathname === '/api/sessions' && req.method === 'POST') {
      try { const s = engine.createSession(body.flowId, body.sessionId, body.state || {}); return json(res, { sessionId: s.id, currentNode: s.currentNode }); }
      catch (e) { return json(res, { error: e.message }, 400); }
    }
    if (url.pathname === '/api/send' && req.method === 'POST') {
      try { const result = await engine.processMessage(body.sessionId, body.message); return json(res, result); }
      catch (e) { return json(res, { error: e.message }, 400); }
    }
    if (url.pathname.startsWith('/api/session/') && req.method === 'GET') {
      const sid = url.pathname.split('/')[3];
      try { return json(res, engine.getSessionContext(sid)); }
      catch (e) { return json(res, { error: e.message }, 404); }
    }
    if (url.pathname.startsWith('/api/history/') && req.method === 'GET') {
      const sid = url.pathname.split('/')[3];
      try { return json(res, engine.getConversationHistory(sid, parseInt(url.searchParams.get('limit') || '50'))); }
      catch (e) { return json(res, { error: e.message }, 404); }
    }
    if (url.pathname === '/api/slot' && req.method === 'POST') {
      try { return json(res, engine.setSlotValue(body.sessionId, body.slotName, body.value)); }
      catch (e) { return json(res, { error: e.message }, 400); }
    }
    if (url.pathname.startsWith('/api/session/') && req.method === 'DELETE') {
      const sid = url.pathname.split('/')[3];
      return json(res, { ended: engine.endSession(sid) });
    }
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      return json(res, engine.stats());
    }
    if (url.pathname === '/api/intent' && req.method === 'POST') {
      engine.addGlobalIntent(body.pattern);
      return json(res, { ok: true });
    }
    return json(res, { error: 'Not found' }, 404);
  }

  // Dashboard
  if (url.pathname === '/' || url.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(DASHBOARD_HTML);
  }

  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, () => {
  console.log(`[agent-dial] HTTP server on :${PORT} — Dashboard: http://localhost:${PORT}/`);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-dial — Dialog Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:20px;font-size:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:12px;text-transform:uppercase;margin-bottom:4px}
.card .val{font-size:28px;font-weight:bold;color:#58a6ff}
.section{margin-bottom:24px}.section h2{color:#c9d1d9;font-size:18px;margin-bottom:12px;border-bottom:1px solid #30363d;padding-bottom:8px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}tr:hover{background:#161b22}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge-active{background:#238636;color:#fff}.badge-ended{background:#da3633;color:#fff}
.msg{padding:8px 12px;margin:4px 0;border-radius:8px;max-width:80%}.msg-user{background:#1f6feb;color:#fff;margin-left:auto;text-align:right}
.msg-agent{background:#21262d;color:#c9d1d9}.msg-system{background:#1a1f2e;color:#8b949e;font-style:italic;text-align:center}
.chat{max-height:400px;overflow-y:auto;padding:12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;margin-bottom:12px}
input,select,button,textarea{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:14px}
button{background:#238636;color:#fff;cursor:pointer;border:none;font-weight:600}button:hover{background:#2ea043}
.flex{display:flex;gap:8px}.grow{flex:1}pre{background:#161b22;padding:12px;border-radius:8px;overflow-x:auto;font-size:13px;margin:8px 0}
.auto{animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
</style></head><body>
<h1>🐋 agent-dial — Dialog Dashboard</h1>
<div class="grid" id="stats"></div>
<div class="grid">
  <div class="card">
    <h3>New Session</h3>
    <div class="flex" style="margin-top:8px">
      <select id="flowSelect" class="grow"><option value="demo">Demo Flow</option></select>
      <button onclick="createSession()">Start</button>
    </div>
  </div>
  <div class="card">
    <h3>Active Session</h3>
    <select id="sessionSelect" class="grow" style="margin-top:8px;width:100%" onchange="selectSession()">
      <option value="">— select —</option>
    </select>
  </div>
</div>
<div class="section">
  <h2>💬 Conversation</h2>
  <div class="chat" id="chat"></div>
  <div class="flex">
    <input id="msgInput" class="grow" placeholder="Type a message..." onkeydown="if(event.key==='Enter')sendMsg()">
    <button onclick="sendMsg()">Send</button>
  </div>
</div>
<div class="section">
  <h2>📋 Sessions</h2>
  <table><thead><tr><th>ID</th><th>Flow</th><th>Node</th><th>Turns</th><th>Status</th><th>Actions</th></tr></thead><tbody id="sessionsBody"></tbody></table>
</div>
<div class="section">
  <h2>🔍 Session Context</h2>
  <pre id="contextView">Select a session to view context</pre>
</div>
<script>
let currentSession=null,sessions=[];
async function api(p,o={}){const r=await fetch('/api'+p,{headers:{'Content-Type':'application/json'},...o,body:o.body?JSON.stringify(o.body):undefined});return r.json()}
async function refresh(){
  const[s,sess]=await Promise.all([api('/stats'),api('/sessions')]);
  sessions=sess;
  document.getElementById('stats').innerHTML=\`
    <div class="card"><h3>Flows</h3><div class="val">\${s.flows}</div></div>
    <div class="card"><h3>Sessions</h3><div class="val">\${s.totalSessions}</div></div>
    <div class="card"><h3>Active</h3><div class="val" style="color:#238636">\${s.activeSessions}</div></div>
    <div class="card"><h3>Completed</h3><div class="val" style="color:#da3633">\${s.completedSessions}</div></div>
    <div class="card"><h3>Total Turns</h3><div class="val">\${s.totalTurns}</div></div>
    <div class="card"><h3>Avg Turns</h3><div class="val">\${s.avgTurnsPerSession}</div></div>\`;
  const sel=document.getElementById('sessionSelect');
  const opts=sess.map(s=>\`<option value="\${s.id}" \${s.id===currentSession?'selected':''}>\${s.id.slice(0,8)}… (\${s.flowId})</option>\`).join('');
  sel.innerHTML='<option value="">— select —</option>'+opts;
  document.getElementById('sessionsBody').innerHTML=sess.map(s=>\`<tr>
    <td style="font-family:monospace">\${s.id.slice(0,12)}…</td><td>\${s.flowId}</td><td>\${s.currentNode}</td>
    <td>\${s.turns.length}</td><td><span class="badge \${s.active?'badge-active':'badge-ended'}">\${s.active?'Active':'Ended'}</span></td>
    <td><button onclick="viewCtx('\${s.id}')" style="padding:2px 8px;font-size:12px">Context</button></td></tr>\`).join('');
}
async function createSession(){const flowId=document.getElementById('flowSelect').value;const r=await api('/sessions',{method:'POST',body:{flowId}});currentSession=r.sessionId;await refresh();selectSession()}
function selectSession(){currentSession=document.getElementById('sessionSelect').value;if(currentSession)loadChat(currentSession)}
async function loadChat(sid){const h=await api('/history/'+sid);document.getElementById('chat').innerHTML=h.map(t=>\`<div class="msg msg-\${t.role}"><small style="opacity:.6">\${new Date(t.timestamp).toLocaleTimeString()}</small><br>\${t.content}</div>\`).join('');const c=document.getElementById('chat');c.scrollTop=c.scrollHeight;viewCtx(sid)}
async function sendMsg(){const input=document.getElementById('msgInput');if(!currentSession||!input.value.trim())return;const r=await api('/send',{method:'POST',body:{sessionId:currentSession,message:input.value}});input.value='';await loadChat(currentSession);if(r.ended)refresh()}
async function viewCtx(sid){const c=await api('/session/'+sid);document.getElementById('contextView').textContent=JSON.stringify(c,null,2)}
refresh();setInterval(refresh,5000);
</script></body></html>`;

export { engine, server };
