#!/usr/bin/env node
// agent-cache HTTP Server — REST API + Dashboard
import { AgentCache } from './index.mjs';
import { createServer } from 'http';

const port = +(process.env.PORT ?? process.argv[2]?.replace('--port=', '') ?? 3102);
const cache = new AgentCache({
  defaultTTL: +(process.env.CACHE_DEFAULT_TTL ?? 300000),
  maxSize: +(process.env.CACHE_MAX_SIZE ?? 10000),
  namespace: process.env.CACHE_NAMESPACE ?? 'default',
  persistPath: process.env.CACHE_PERSIST ?? null,
});

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;

  try {
    // Dashboard
    if (path === '/' && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html');
      res.end(renderDashboard());
      return;
    }

    // Stats
    if (path === '/api/stats' && req.method === 'GET') {
      res.end(JSON.stringify(cache.stats()));
      return;
    }

    // Keys
    if (path === '/api/keys' && req.method === 'GET') {
      const pattern = url.searchParams.get('pattern');
      res.end(JSON.stringify({ keys: cache.keys(pattern) }));
      return;
    }

    // Tags
    if (path === '/api/tags' && req.method === 'GET') {
      res.end(JSON.stringify({ tags: cache.tags() }));
      return;
    }

    // Get
    if (path.match(/^\/api\/get\//) && req.method === 'GET') {
      const key = decodeURIComponent(path.slice(9));
      const val = await cache.get(key);
      res.end(JSON.stringify({ found: val !== null, value: val }));
      return;
    }

    // Has
    if (path.match(/^\/api\/has\//) && req.method === 'GET') {
      const key = decodeURIComponent(path.slice(9));
      res.end(JSON.stringify({ exists: cache.has(key) }));
      return;
    }

    // Set
    if (path === '/api/set' && req.method === 'POST') {
      const body = await readBody(req);
      const { key, value, ttl, tags } = JSON.parse(body);
      await cache.set(key, value, { ttl, tags });
      res.end(JSON.stringify({ success: true, key }));
      return;
    }

    // Delete
    if (path.match(/^\/api\/delete\//) && req.method === 'DELETE') {
      const key = decodeURIComponent(path.slice(13));
      const deleted = await cache.delete(key);
      res.end(JSON.stringify({ deleted }));
      return;
    }

    // Invalidate tag
    if (path === '/api/invalidate-tag' && req.method === 'POST') {
      const body = await readBody(req);
      const { tag } = JSON.parse(body);
      const count = await cache.invalidateTag(tag);
      res.end(JSON.stringify({ invalidated: count }));
      return;
    }

    // Invalidate pattern
    if (path === '/api/invalidate-pattern' && req.method === 'POST') {
      const body = await readBody(req);
      const { pattern } = JSON.parse(body);
      const count = await cache.invalidatePattern(pattern);
      res.end(JSON.stringify({ invalidated: count }));
      return;
    }

    // Clear
    if (path === '/api/clear' && req.method === 'POST') {
      const count = await cache.clear();
      res.end(JSON.stringify({ cleared: count }));
      return;
    }

    // Export
    if (path === '/api/export' && req.method === 'GET') {
      res.end(JSON.stringify(cache.export()));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function renderDashboard() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-cache dashboard</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'SF Mono','Fira Code',monospace;background:#0d1117;color:#c9d1d9;padding:24px}
  h1{color:#58a6ff;margin-bottom:16px;font-size:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center}
  .card .value{font-size:28px;font-weight:bold;color:#58a6ff}
  .card .label{font-size:11px;color:#8b949e;margin-top:4px;text-transform:uppercase}
  .card.green .value{color:#3fb950}
  .card.red .value{color:#f85149}
  .card.yellow .value{color:#d29922}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
  th,td{padding:8px 12px;border:1px solid #30363d;text-align:left}
  th{background:#161b22;color:#58a6ff;font-size:11px;text-transform:uppercase}
  tr:hover{background:rgba(88,166,255,0.05)}
  .tag{display:inline-block;background:#1f6feb;color:white;padding:1px 8px;border-radius:12px;font-size:10px;margin:1px}
  .toolbar{margin:16px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  input[type=text]{background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:8px 12px;border-radius:6px;font-family:inherit;font-size:13px}
  input[type=text]:focus{border-color:#58a6ff;outline:none}
  button{background:#238636;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px}
  button:hover{background:#2ea043}
  button.danger{background:#da3633}
  button.danger:hover{background:#b62324}
  button.secondary{background:#30363d}
  button.secondary:hover{background:#484f58}
  code{color:#79c0ff;background:#161b22;padding:2px 6px;border-radius:4px;font-size:12px}
  .ns{color:#8b949e;font-size:14px}
</style></head>
<body>
<h1>🐋 agent-cache <span class="ns">— dashboard</span></h1>
<div class="grid" id="cards"></div>
<div class="toolbar">
  <input type="text" id="search" placeholder="Filter keys (glob: user:*)">
  <button onclick="search()">🔍 Search</button>
  <button class="secondary" onclick="load()">↻ Refresh</button>
  <button class="danger" onclick="clearAll()">🗑 Clear All</button>
</div>
<table><thead><tr><th>Key</th><th>Value</th><th>Tags</th><th>Hits</th><th>Expires</th><th>Actions</th></tr></thead><tbody id="tbody"></tbody></table>
<script>
const fmt = v => v==null?'N/A':typeof v==='number'?v.toFixed?((v*100).toFixed(1)+'%'):v:v;
async function load(pattern){
  const s=await fetch('/api/stats').then(r=>r.json());
  document.getElementById('cards').innerHTML=
    '<div class="card"><div class="value">'+s.size+'</div><div class="label">Entries / '+s.maxSize+' max</div></div>'+
    '<div class="card green"><div class="value">'+(s.hitRate!=null?(s.hitRate*100).toFixed(1)+'%':'N/A')+'</div><div class="label">Hit Rate</div></div>'+
    '<div class="card green"><div class="value">'+s.hits+'</div><div class="label">Hits</div></div>'+
    '<div class="card red"><div class="value">'+s.misses+'</div><div class="label">Misses</div></div>'+
    '<div class="card yellow"><div class="value">'+s.evictions+'</div><div class="label">Evictions</div></div>'+
    '<div class="card"><div class="value">'+s.tagCount+'</div><div class="label">Tags</div></div>';
  const q=pattern?'?pattern='+encodeURIComponent(pattern):'';
  const keys=await fetch('/api/keys'+q).then(r=>r.json());
  const tbody=document.getElementById('tbody');
  tbody.innerHTML='';
  for(const k of keys.keys){
    const e=await fetch('/api/get/'+encodeURIComponent(k)).then(r=>r.json());
    const v=JSON.stringify(e.value);
    const prev=v.length>80?v.slice(0,80)+'…':v;
    tbody.innerHTML+='<tr><td><code>'+k+'</code></td><td><code>'+prev+'</code></td><td>-</td><td>-</td><td>-</td><td><button class="danger" style="padding:4px 8px;font-size:11px" onclick="del(\\''+k+'\\')">✕</button></td></tr>';
  }
}
function search(){load(document.getElementById('search').value)}
async function del(k){await fetch('/api/delete/'+encodeURIComponent(k),{method:'DELETE'});load()}
async function clearAll(){if(confirm('Clear entire cache?')){await fetch('/api/clear',{method:'POST'});load()}}
load();
setInterval(()=>load(),5000);
</script></body></html>`;
}

server.listen(port, () => {
  console.log(`[agent-cache] HTTP server running on http://localhost:${port}`);
  console.log(`[agent-cache] Dashboard: http://localhost:${port}/`);
  console.log(`[agent-cache] API: http://localhost:${port}/api/stats`);
});
