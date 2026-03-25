#!/usr/bin/env node
/**
 * agent-replay HTTP Server — dark-theme web dashboard + REST API
 */

import { createServer } from 'node:http';
import { ReplayEngine } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3145');
const engine = new ReplayEngine();

// SSE clients
const sseClients = new Set();
engine.on('step:recorded', ({ session, step }) => {
  const data = JSON.stringify({ event: 'step', session, step });
  for (const res of sseClients) res.write(`data: ${data}\n\n`);
});

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, content) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

const dashboardHTML = () => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-replay</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:system-ui;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:12px;text-transform:uppercase}
.card .val{color:#58a6ff;font-size:28px;font-weight:bold}
table{width:100%;border-collapse:collapse;margin:16px 0}
th,td{padding:8px 12px;border:1px solid #30363d;text-align:left}
th{background:#161b22;color:#8b949e}
.tag{background:#1f6feb22;color:#58a6ff;padding:2px 8px;border-radius:4px;font-size:12px}
.err{color:#f85149}
.ok{color:#3fb950}
button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:6px 12px;border-radius:6px;cursor:pointer}
button:hover{background:#30363d}
input,textarea{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:8px;border-radius:6px;width:100%}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
</style></head><body>
<h1>🐋 agent-replay</h1>
<div class="cards" id="stats"></div>
<div class="grid">
  <div><h2>Sessions</h2><div id="sessions"></div></div>
  <div><h2>Create Session</h2>
    <input id="sid" placeholder="Session ID (auto)" style="margin:8px 0">
    <button onclick="createSession()">Create</button>
    <h2 style="margin-top:16px">Record Step</h2>
    <select id="stepSession" style="margin:8px 0"></select>
    <input id="stepType" placeholder="Type (input/think/compute/output)">
    <textarea id="stepData" placeholder='{"input":{...},"output":{...}}' rows="4" style="margin:8px 0"></textarea>
    <button onclick="recordStep()">Record</button>
  </div>
</div>
<div id="log" style="margin-top:16px;background:#161b22;padding:12px;border-radius:8px;max-height:200px;overflow-y:auto;font-family:monospace;font-size:13px"></div>
<script>
async function api(path,opts){return fetch('/api'+path,opts).then(r=>r.json())}
async function refresh(){
  const [st,sess]=await Promise.all([api('/stats'),api('/sessions')]);
  document.getElementById('stats').innerHTML=
    '<div class="card"><h3>Sessions</h3><div class="val">'+st.totalSessions+'</div></div>'+
    '<div class="card"><h3>Total Steps</h3><div class="val">'+st.totalSteps+'</div></div>'+
    '<div class="card"><h3>Snapshots</h3><div class="val">'+st.totalSnapshots+'</div></div>'+
    '<div class="card"><h3>Recording</h3><div class="val">'+st.recording+'</div></div>';
  const sel=document.getElementById('stepSession');
  sel.innerHTML=sess.map(s=>'<option value="'+s.id+'">'+s.id+' ('+s.steps+' steps)</option>').join('');
  document.getElementById('sessions').innerHTML='<table><tr><th>ID</th><th>Steps</th><th>Recording</th><th>Created</th></tr>'+
    sess.map(s=>'<tr><td><a href="/api/sessions/'+s.id+'">'+s.id.slice(0,8)+'</a></td><td>'+s.steps+'</td><td>'+(s.recording?'<span class="ok">●</span>':'<span class="err">○</span>')+'</td><td>'+new Date(s.createdAt).toLocaleTimeString()+'</td></tr>').join('')+'</table>';
}
async function createSession(){
  const sid=document.getElementById('sid').value||undefined;
  await api('/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:sid})});
  refresh();
}
async function recordStep(){
  const sid=document.getElementById('stepSession').value;
  const type=document.getElementById('stepType').value;
  const data=JSON.parse(document.getElementById('stepData').value||'{}');
  await api('/sessions/'+sid+'/steps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,...data})});
  refresh();
}
refresh();setInterval(refresh,3000);
const es=new EventSource('/events');
es.onmessage=e=>{const d=JSON.parse(e.data);document.getElementById('log').innerHTML+='<div>['+d.session?.slice(0,8)+'] '+d.event+'</div>';document.getElementById('log').scrollTop=9e9};
</script></body></html>`;

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  // CORS
  if (m === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }

  // SSE
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('data: connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Dashboard
  if (p === '/' || p === '/dashboard') return html(res, dashboardHTML());

  // API routes
  const body = m !== 'GET' && m !== 'DELETE' ? await new Promise(ok => { let d = ''; req.on('data', c => d += c); req.on('end', () => ok(d ? JSON.parse(d) : {})); }) : {};

  try {
    // GET /api/stats
    if (p === '/api/stats' && m === 'GET') return json(res, engine.stats());

    // GET/POST /api/sessions
    if (p === '/api/sessions' && m === 'GET') return json(res, engine.listSessions());
    if (p === '/api/sessions' && m === 'POST') { const s = engine.createSession(body.id, body); return json(res, { id: s.id }); }

    // Session routes
    const sm = p.match(/^\/api\/sessions\/([^/]+)(?:\/(.*))?$/);
    if (sm) {
      const [, sid, rest] = sm;
      const session = engine.getSession(sid);
      if (!session) return json(res, { error: 'Session not found' }, 404);

      // GET /api/sessions/:id
      if (!rest && m === 'GET') return json(res, session.toJSON());
      // DELETE /api/sessions/:id
      if (!rest && m === 'DELETE') { engine.deleteSession(sid); return json(res, { ok: true }); }
      // POST /api/sessions/:id/stop
      if (rest === 'stop' && m === 'POST') { session.stop(); return json(res, { ok: true }); }
      // GET /api/sessions/:id/timeline
      if (rest === 'timeline') return json(res, session.timeline());
      // GET /api/sessions/:id/stats
      if (rest === 'stats') return json(res, session.stats());
      // GET /api/sessions/:id/export
      if (rest === 'export') return json(res, session.toJSON());
      // GET /api/sessions/:id/markdown
      if (rest === 'markdown') return json(res, { markdown: session.toMarkdown() });
      // GET /api/sessions/:id/annotations
      if (rest === 'annotations') return json(res, session.getAnnotations());
      // GET /api/sessions/:id/errors
      if (rest === 'errors') return json(res, session.filterErrors());

      // POST /api/sessions/:id/steps
      if (rest === 'steps' && m === 'POST') { const step = session.record(body.type, body); return json(res, step); }

      // POST /api/sessions/:id/annotate
      if (rest === 'annotate' && m === 'POST') { const a = session.annotate(body.stepIndex, body.text, body.tags); return json(res, a); }

      // POST /api/sessions/:id/assert
      if (rest === 'assert' && m === 'POST') {
        let result;
        if (body.type === 'state') result = session.assertState(body.index, body.expected, body.message);
        else if (body.type === 'output') result = session.assertOutput(body.index, body.expected, body.message);
        else if (body.type === 'sequence') result = session.assertTypeSequence(body.expected);
        else if (body.type === 'noErrors') result = session.assertNoErrors();
        else if (body.type === 'duration') result = session.assertDuration(body.index, body.maxMs);
        else return json(res, { error: 'Unknown assertion type' }, 400);
        return json(res, result);
      }

      // POST /api/sessions/:id/branch
      if (rest === 'branch' && m === 'POST') { const b = session.branch(body.name, body.fromStep); return json(res, { name: b.name, fromStep: b.fromStep }); }

      // POST /api/sessions/:id/step/:index
      const stm = rest?.match(/^step\/(\d+)$/);
      if (stm && m === 'GET') return json(res, session.getStep(parseInt(stm[1])));
    }

    // POST /api/diff
    if (p === '/api/diff' && m === 'POST') return json(res, engine.diff(body.sessionA, body.sessionB));
    // POST /api/merge
    if (p === '/api/merge' && m === 'POST') { const m = engine.merge(body.sessionA, body.sessionB, body.strategy); return json(res, { id: m.id, steps: m.steps.length }); }

    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
}

createServer(handler).listen(PORT, () => console.log(`🐋 agent-replay dashboard: http://localhost:${PORT}`));
