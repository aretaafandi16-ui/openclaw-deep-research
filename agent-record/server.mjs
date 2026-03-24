/**
 * agent-record HTTP server — REST API + dark-theme web dashboard
 */

import { createServer } from 'http';
import { SessionRecorder } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3133');
const DATA_DIR = process.env.DATA_DIR || '.agent-record';

const recorder = new SessionRecorder({ dataDir: DATA_DIR });
await recorder.loadAll();

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const json = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const err = (msg, code = 400) => json({ error: msg }, code);

  try {
    // ── Dashboard ────────────────────────────────────────────────────────
    if (path === '/' || path === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(DASHBOARD_HTML);
    }

    // ── API Routes ───────────────────────────────────────────────────────

    // Start session
    if (path === '/api/sessions' && method === 'POST') {
      const body = await readBody(req);
      const session = recorder.startSession(body.id, body.meta || {});
      return json(session, 201);
    }

    // List sessions
    if (path === '/api/sessions' && method === 'GET') {
      const state = url.searchParams.get('state');
      const tag = url.searchParams.get('tag');
      return json(recorder.listSessions({ state, tag }));
    }

    // Get session
    const sessMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessMatch && method === 'GET') {
      return json(recorder.getSession(sessMatch[1]));
    }

    // Stop session
    if (sessMatch && method === 'DELETE') {
      const s = recorder.stopSession(sessMatch[1]);
      return json(s);
    }

    // Record entry
    const recMatch = path.match(/^\/api\/sessions\/([^/]+)\/record$/);
    if (recMatch && method === 'POST') {
      const body = await readBody(req);
      const entry = recorder.record(recMatch[1], body.type, body.data, body.meta || {});
      return json(entry, 201);
    }

    // Get records
    const recordsMatch = path.match(/^\/api\/sessions\/([^/]+)\/records$/);
    if (recordsMatch && method === 'GET') {
      const opts = {};
      if (url.searchParams.get('type')) opts.type = url.searchParams.get('type');
      if (url.searchParams.get('search')) opts.search = url.searchParams.get('search');
      if (url.searchParams.get('fromSeq')) opts.fromSeq = parseInt(url.searchParams.get('fromSeq'));
      if (url.searchParams.get('limit')) opts.limit = parseInt(url.searchParams.get('limit'));
      return json(recorder.getRecords(recordsMatch[1], opts));
    }

    // Get single record
    const recGetMatch = path.match(/^\/api\/sessions\/([^/]+)\/records\/(\d+)$/);
    if (recGetMatch && method === 'GET') {
      return json(recorder.getRecord(recGetMatch[1], parseInt(recGetMatch[2])));
    }

    // Bookmark
    const bmMatch = path.match(/^\/api\/sessions\/([^/]+)\/bookmark$/);
    if (bmMatch && method === 'POST') {
      const body = await readBody(req);
      return json(recorder.bookmark(bmMatch[1], body.label, body.seq), 201);
    }

    // Annotate
    const annMatch = path.match(/^\/api\/sessions\/([^/]+)\/annotate$/);
    if (annMatch && method === 'POST') {
      const body = await readBody(req);
      return json(recorder.annotate(annMatch[1], body.seq, body.note, body.tags || []), 201);
    }

    // Session stats
    const statsMatch = path.match(/^\/api\/sessions\/([^/]+)\/stats$/);
    if (statsMatch && method === 'GET') {
      return json(recorder.getStats(statsMatch[1]));
    }

    // Export
    const exportMatch = path.match(/^\/api\/sessions\/([^/]+)\/export$/);
    if (exportMatch && method === 'GET') {
      const format = url.searchParams.get('format') || 'json';
      if (format === 'markdown') {
        res.writeHead(200, { 'Content-Type': 'text/markdown' });
        return res.end(recorder.toMarkdown(exportMatch[1]));
      }
      if (format === 'replay') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        return res.end(recorder.toReplayScript(exportMatch[1]));
      }
      return json(recorder.toJSON(exportMatch[1]));
    }

    // Diff
    if (path === '/api/diff' && method === 'POST') {
      const body = await readBody(req);
      return json(recorder.diff(body.sessionA, body.sessionB, body.opts || {}));
    }

    // Merge
    if (path === '/api/merge' && method === 'POST') {
      const body = await readBody(req);
      return json(recorder.merge(body.target, body.source, body.opts || {}));
    }

    // Search
    if (path === '/api/search' && method === 'GET') {
      const q = url.searchParams.get('q');
      if (!q) return err('Missing q parameter');
      return json(recorder.search(q, { limit: parseInt(url.searchParams.get('limit') || '50') }));
    }

    // Global stats
    if (path === '/api/stats' && method === 'GET') {
      return json(recorder.getGlobalStats());
    }

    // Pause/Resume
    const pauseMatch = path.match(/^\/api\/sessions\/([^/]+)\/pause$/);
    if (pauseMatch && method === 'POST') return json(recorder.pauseSession(pauseMatch[1]));
    const resumeMatch = path.match(/^\/api\/sessions\/([^/]+)\/resume$/);
    if (resumeMatch && method === 'POST') return json(recorder.resumeSession(resumeMatch[1]));

    return err('Not found', 404);
  } catch (e) {
    return err(e.message, 500);
  }
});

server.listen(PORT, () => console.log(`🐋 agent-record dashboard: http://localhost:${PORT}`));

// ── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Dashboard HTML ───────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🐋 agent-record</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh}
.container{max-width:1400px;margin:0 auto;padding:20px}
header{display:flex;align-items:center;gap:16px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #21262d}
header h1{font-size:24px;color:#58a6ff}
header p{color:#8b949e;font-size:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.stat{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px;text-align:center}
.stat .val{font-size:28px;font-weight:700;color:#58a6ff}
.stat .label{font-size:12px;color:#8b949e;margin-top:4px}
.section{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:20px;margin-bottom:16px}
.section h2{font-size:16px;color:#58a6ff;margin-bottom:12px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d;font-size:13px}
th{color:#8b949e;font-weight:600}
tr:hover{background:#1c2128}
.tag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;margin:2px}
.tag-input{background:#1f6feb22;color:#58a6ff}
.tag-output{background:#23863622;color:#3fb950}
.tag-tool_call{background:#d2992222;color:#d29922}
.tag-tool_result{background:#d2992222;color:#e3b341}
.tag-decision{background:#a371f722;color:#a371f7}
.tag-error{background:#f8514922;color:#f85149}
.tag-recording{background:#23863622;color:#3fb950}
.tag-paused{background:#d2992222;color:#d29922}
.tag-stopped{background:#8b949e22;color:#8b949e}
.btn{padding:6px 14px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;border-radius:6px;cursor:pointer;font-size:13px}
.btn:hover{background:#30363d}
.btn-primary{background:#238636;border-color:#238636;color:#fff}
.btn-danger{background:#da3633;border-color:#da3633;color:#fff}
input,select{padding:6px 10px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;font-size:13px}
.flex{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mono{font-family:monospace;font-size:12px}
.record-detail{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px;margin:8px 0;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto}
.search-box{margin-bottom:16px}
</style></head><body>
<div class="container">
<header><h1>🐋 agent-record</h1><p>Session Recording & Playback Engine</p></header>
<div class="stats" id="stats"></div>
<div class="section"><h2>Sessions</h2><div class="flex" style="margin-bottom:12px">
<button class="btn btn-primary" onclick="createSession()">+ New Session</button>
<input id="sessionId" placeholder="Session ID (optional)" style="width:200px">
<input id="sessionMeta" placeholder='Meta JSON: {"agent":"gpt-4"}' style="flex:1">
</div>
<table><thead><tr><th>ID</th><th>State</th><th>Records</th><th>Started</th><th>Agent</th><th>Actions</th></tr></thead><tbody id="sessions"></tbody></table>
</div>
<div class="section search-box"><h2>Search</h2><div class="flex">
<input id="searchQ" placeholder="Search across all sessions..." style="flex:1" onkeyup="e=>e.key==='Enter'&&doSearch()">
<button class="btn" onclick="doSearch()">Search</button>
</div><div id="searchResults" style="margin-top:12px"></div></div>
<div class="section" id="recordsSection" style="display:none"><h2 id="recordsTitle">Records</h2>
<div class="flex" style="margin-bottom:12px">
<select id="typeFilter" onchange="loadRecords()"><option value="">All types</option><option>input</option><option>output</option><option>tool_call</option><option>tool_result</option><option>decision</option><option>error</option><option>metric</option><option>custom</option></select>
<button class="btn" onclick="exportSession('json')">Export JSON</button>
<button class="btn" onclick="exportSession('markdown')">Export MD</button>
</div>
<table><thead><tr><th>#</th><th>Type</th><th>Data</th><th>Time</th></tr></thead><tbody id="records"></tbody></table>
</div>
<div class="section" id="diffSection"><h2>Diff Sessions</h2><div class="flex">
<input id="diffA" placeholder="Session A ID">
<input id="diffB" placeholder="Session B ID">
<button class="btn" onclick="doDiff()">Compare</button>
</div><pre id="diffResult" class="record-detail" style="display:none"></pre></div>
</div>
<script>
const API='';
let currentSession=null;
async function api(p,m='GET',b=null){const o={method:m,headers:{'Content-Type':'application/json'}};if(b)o.body=JSON.stringify(b);return(await fetch(API+p,o)).json()}
async function refresh(){const s=await api('/api/stats');document.getElementById('stats').innerHTML=[
['Total Sessions',s.totalSessions],['Active',s.activeSessions],['Total Records',s.totalRecords],
['Errors',s.totalErrors],['Tool Calls',s.totalToolCalls]
].map(([l,v])=>'<div class="stat"><div class="val">'+v+'</div><div class="label">'+l+'</div></div>').join('');
const ss=await api('/api/sessions');
document.getElementById('sessions').innerHTML=ss.map(s=>'<tr><td class="mono">'+s.id+'</td><td><span class="tag tag-'+s.state+'">'+s.state+'</span></td><td>'+s.stats.total+'</td><td>'+new Date(s.startedAt).toLocaleString()+'</td><td>'+(s.meta.agent||'-')+'</td><td><button class="btn" onclick="viewSession(\\''+s.id+'\\')">View</button> '+(s.state==='recording'?'<button class="btn btn-danger" onclick="stopSession(\\''+s.id+'\\')">Stop</button>':'')+'</td></tr>').join('')||'<tr><td colspan="6" style="text-align:center;color:#8b949e">No sessions yet</td></tr>';}
async function createSession(){const id=document.getElementById('sessionId').value||undefined;let meta={};try{meta=JSON.parse(document.getElementById('sessionMeta').value||'{}')}catch{}
await api('/api/sessions','POST',{id,meta});document.getElementById('sessionId').value='';document.getElementById('sessionMeta').value='';refresh();}
async function stopSession(id){await api('/api/sessions/'+id,'DELETE');refresh();}
async function viewSession(id){currentSession=id;document.getElementById('recordsSection').style.display='';document.getElementById('recordsTitle').textContent='Records — '+id;loadRecords();}
async function loadRecords(){if(!currentSession)return;const type=document.getElementById('typeFilter').value;const qs=type?'?type='+type:'';const records=await api('/api/sessions/'+currentSession+'/records'+qs);
document.getElementById('records').innerHTML=records.map(r=>'<tr><td class="mono">'+r.seq+'</td><td><span class="tag tag-'+r.type+'">'+r.type+'</span></td><td><div class="record-detail">'+escapeHtml(JSON.stringify(r.data,null,2))+'</div></td><td class="mono">'+new Date(r.timestamp).toLocaleTimeString()+'</td></tr>').join('')||'<tr><td colspan="4" style="text-align:center">No records</td></tr>';}
function exportSession(fmt){window.open(API+'/api/sessions/'+currentSession+'/export?format='+fmt);}
async function doSearch(){const q=document.getElementById('searchQ').value;if(!q)return;const results=await api('/api/search?q='+encodeURIComponent(q));
document.getElementById('searchResults').innerHTML='<p style="color:#8b949e;margin-bottom:8px">'+results.length+' results</p>'+results.map(r=>'<div class="record-detail"><strong>Session:</strong> '+r.sessionId+' | <strong>Record #'+r.record.seq+'</strong> | <span class="tag tag-'+r.record.type+'">'+r.record.type+'</span><br>'+escapeHtml(JSON.stringify(r.record.data,null,2))+'</div>').join('');}
async function doDiff(){const a=document.getElementById('diffA').value,b=document.getElementById('diffB').value;if(!a||!b)return;const d=await api('/api/diff','POST',{sessionA:a,sessionB:b});document.getElementById('diffResult').style.display='';document.getElementById('diffResult').textContent=JSON.stringify(d,null,2);}
function escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
refresh();setInterval(refresh,5000);
</script></body></html>`;
