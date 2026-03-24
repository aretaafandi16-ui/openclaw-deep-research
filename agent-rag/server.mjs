/**
 * agent-rag HTTP server with dark-theme web dashboard
 */

import { createServer } from 'http';
import { AgentRAG } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3123');
const PERSIST = process.env.PERSIST_PATH || './data/agent-rag.json';

const rag = new AgentRAG({ persistPath: PERSIST, chunkStrategy: process.env.CHUNK_STRATEGY || 'recursive' });
await rag.load().catch(() => {});

// ─── Dashboard HTML ──────────────────────────────────────────────────────────

function dashboard() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-rag</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase}
.card .value{font-size:28px;font-weight:bold;color:#58a6ff;margin-top:4px}
.search-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:16px 0}
.search-box input{width:100%;padding:10px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;font-size:14px}
.search-box button{margin-top:8px;padding:8px 16px;background:#238636;color:#fff;border:none;border-radius:6px;cursor:pointer}
.results{margin:16px 0}
.result{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;margin:8px 0}
.result .score{color:#3fb950;font-weight:bold}
.result .text{margin-top:6px;color:#c9d1d9;white-space:pre-wrap;font-size:13px}
.result .meta{color:#8b949e;font-size:11px;margin-top:4px}
.add-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:16px 0}
.add-box textarea{width:100%;height:100px;padding:10px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;font-size:13px;resize:vertical}
.add-box input,.add-box select{padding:8px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;font-size:13px}
.row{display:flex;gap:8px;margin:8px 0;align-items:center}
table{width:100%;border-collapse:collapse;margin:16px 0}
th,td{text-align:left;padding:8px;border-bottom:1px solid #30363d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
.ns-select{padding:8px;background:#161b22;border:1px solid #30363d;color:#c9d1d9;border-radius:6px}
</style></head><body>
<h1>🐋 agent-rag</h1>
<div class="cards" id="stats"></div>
<div class="add-box">
  <h3 style="color:#58a6ff;margin-bottom:8px">Add Document</h3>
  <div class="row">
    <input id="docNs" placeholder="namespace (optional)" style="flex:1">
    <input id="docMeta" placeholder='metadata JSON (e.g. {"source":"file.txt"})' style="flex:2">
  </div>
  <textarea id="docText" placeholder="Paste document text here..."></textarea>
  <button onclick="addDoc()" style="margin-top:8px;padding:8px 16px;background:#238636;color:#fff;border:none;border-radius:6px;cursor:pointer">Add Document</button>
</div>
<div class="search-box">
  <h3 style="color:#58a6ff;margin-bottom:8px">Search</h3>
  <div class="row">
    <input id="q" placeholder="Search query..." style="flex:1" onkeydown="if(event.key==='Enter')doSearch()">
    <select id="searchNs" class="ns-select"><option value="">all namespaces</option></select>
    <input id="topK" type="number" value="5" min="1" max="50" style="width:60px" title="top K">
  </div>
  <button onclick="doSearch()">Search</button>
  <div id="results" class="results"></div>
</div>
<h3 style="color:#58a6ff;margin:16px 0 8px">Documents</h3>
<table><thead><tr><th>ID</th><th>Namespace</th><th>Chunks</th><th>Metadata</th><th>Created</th><th></th></tr></thead><tbody id="docs"></tbody></table>
<script>
async function api(p,o={}){const r=await fetch(p,{headers:{'Content-Type':'application/json'},...o,body:o.body?JSON.stringify(o.body):undefined});return r.json()}
async function loadStats(){
  const s=await api('/api/stats');
  document.getElementById('stats').innerHTML=
    '<div class="card"><div class="label">Namespaces</div><div class="value">'+s.namespaces+'</div></div>'+
    '<div class="card"><div class="label">Documents</div><div class="value">'+s.totalDocuments+'</div></div>'+
    '<div class="card"><div class="label">Chunks</div><div class="value">'+s.totalChunks+'</div></div>';
  const ns=await api('/api/namespaces');
  const sel=document.getElementById('searchNs');
  sel.innerHTML='<option value="">all namespaces</option>'+ns.map(n=>'<option value="'+n+'">'+n+'</option>').join('');
}
async function loadDocs(){
  const d=await api('/api/documents');
  document.getElementById('docs').innerHTML=d.map(d=>'<tr><td>'+d.id.slice(0,10)+'…</td><td>'+d.namespace+'</td><td>'+(d.chunks?d.chunks.length:0)+'</td><td><small>'+JSON.stringify(d.metadata||{})+'</small></td><td><small>'+new Date(d.createdAt).toLocaleString()+'</small></td><td><button onclick="delDoc(\\''+d.id+'\\',\\''+d.namespace+'\\')" style="background:#da3633;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer">Del</button></td></tr>').join('');
}
async function doSearch(){
  const q=document.getElementById('q').value;
  const ns=document.getElementById('searchNs').value;
  const topK=parseInt(document.getElementById('topK').value);
  if(!q)return;
  const r=await api('/api/search',{method:'POST',body:{query:q,namespace:ns||undefined,topK}});
  document.getElementById('results').innerHTML=r.map((r,i)=>'<div class="result"><div class="score">#'+(i+1)+' — Score: '+r.score.toFixed(4)+'</div><div class="text">'+r.text.replace(/</g,'&lt;')+'</div><div class="meta">doc: '+r.docId.slice(0,10)+'… | chunk: '+(r.metadata?.chunkIndex??'?')+'</div></div>').join('')||'<p style="color:#8b949e">No results</p>';
}
async function addDoc(){
  const text=document.getElementById('docText').value;
  const ns=document.getElementById('docNs').value||undefined;
  let meta={};try{meta=JSON.parse(document.getElementById('docMeta').value||'{}')}catch{}
  if(!text)return;
  await api('/api/documents',{method:'POST',body:{text,metadata:meta,namespace:ns}});
  document.getElementById('docText').value='';
  loadStats();loadDocs();
}
async function delDoc(id,ns){
  await api('/api/documents/'+id+'?namespace='+encodeURIComponent(ns),{method:'DELETE'});
  loadStats();loadDocs();
}
loadStats();loadDocs();
setInterval(()=>{loadStats()},10000);
</script></body></html>`;
}

// ─── Request helpers ─────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
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

// ─── Server ──────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;

  // CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    // Dashboard
    if (path === '/' || path === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(dashboard());
    }

    // API: Stats
    if (path === '/api/stats' && method === 'GET') {
      return json(res, rag.stats());
    }

    // API: Namespaces
    if (path === '/api/namespaces' && method === 'GET') {
      return json(res, rag.namespaces());
    }

    // API: Documents
    if (path === '/api/documents' && method === 'GET') {
      const ns = url.searchParams.get('namespace');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      return json(res, rag.listDocuments(ns, { limit }));
    }

    if (path === '/api/documents' && method === 'POST') {
      const body = await readBody(req);
      if (!body.text) return json(res, { error: 'text required' }, 400);
      const docId = rag.addDocument(body.text, body.metadata || {}, body.namespace);
      return json(res, { docId });
    }

    // API: Document by ID
    const docMatch = path.match(/^\/api\/documents\/([^/]+)$/);
    if (docMatch && method === 'GET') {
      const doc = rag.getDocument(docMatch[1], url.searchParams.get('namespace'));
      if (!doc) return json(res, { error: 'not found' }, 404);
      return json(res, doc);
    }
    if (docMatch && method === 'DELETE') {
      const ok = rag.deleteDocument(docMatch[1], url.searchParams.get('namespace'));
      return json(res, { deleted: ok });
    }

    // API: Search
    if (path === '/api/search' && method === 'POST') {
      const body = await readBody(req);
      if (!body.query) return json(res, { error: 'query required' }, 400);
      const results = rag.search(body.query, {
        namespace: body.namespace,
        topK: body.topK || 5,
        minScore: body.minScore || 0,
        rerank: body.rerank !== false,
        filters: body.filters
      });
      return json(res, results);
    }

    // API: Context (formatted)
    if (path === '/api/context' && method === 'POST') {
      const body = await readBody(req);
      if (!body.query) return json(res, { error: 'query required' }, 400);
      const ctx = rag.contextString(body.query, body.topK || 5, { namespace: body.namespace });
      return json(res, { context: ctx });
    }

    // API: Export
    if (path === '/api/export' && method === 'GET') {
      return json(res, rag.export(url.searchParams.get('namespace')));
    }

    // API: Clear
    if (path === '/api/clear' && method === 'POST') {
      const body = await readBody(req);
      rag.clear(body.namespace);
      return json(res, { cleared: true });
    }

    json(res, { error: 'not found' }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`agent-rag server on http://localhost:${PORT}`);
});

process.on('SIGTERM', async () => { await rag.save(); process.exit(0); });
process.on('SIGINT', async () => { await rag.save(); process.exit(0); });
