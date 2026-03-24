/**
 * agent-embed HTTP server — REST API + dark-theme web dashboard
 */

import { createServer } from 'node:http';
import { EmbedStore } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3113');
const persistPath = process.env.PERSIST_PATH || './data/embed.jsonl';
const dimension = parseInt(process.env.DIMENSION || '0');
const distance = process.env.DISTANCE || 'cosine';

const store = new EmbedStore({ dimension, distance, persistPath });

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, content) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const dashboard = (info) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-embed</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase}
.card .value{font-size:24px;font-weight:700;color:#58a6ff;margin-top:4px}
input,button,select,textarea{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:14px}
button{background:#238636;cursor:pointer;border:none;color:#fff}
button:hover{background:#2ea043}
.search-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:24px}
.search-box textarea{width:100%;height:60px;resize:vertical;font-family:monospace}
.search-row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
.score{color:#3fb950;font-weight:600}
.meta{color:#8b949e;font-size:13px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head><body>
<h1>🐋 agent-embed</h1>
<div class="cards">
<div class="card"><div class="label">Vectors</div><div class="value">${info.count}</div></div>
<div class="card"><div class="label">Dimension</div><div class="value">${info.dimension || 'auto'}</div></div>
<div class="card"><div class="label">Distance</div><div class="value">${info.distance}</div></div>
<div class="card"><div class="label">Memory</div><div class="value">${info.memoryEstimateMB} MB</div></div>
<div class="card"><div class="label">IVF</div><div class="value">${info.ivfEnabled ? '✓ ON' : 'OFF'}</div></div>
<div class="card"><div class="label">Searches</div><div class="value">${info.stats.searches}</div></div>
</div>
<div class="search-box">
<strong>Search Vectors</strong>
<div class="search-row">
<input id="q" placeholder='Vector e.g. [1,0,0] or text' style="flex:1;min-width:200px">
<input id="k" type="number" value="5" min="1" max="100" style="width:60px" placeholder="k">
<input id="filter" placeholder='Filter e.g. {"type":"img"}' style="flex:1;min-width:150px">
<button onclick="doSearch()">Search</button>
</div>
</div>
<div id="results"></div>
<script>
async function doSearch(){
  const q=document.getElementById('q').value.trim();
  const k=parseInt(document.getElementById('k').value)||5;
  const fStr=document.getElementById('filter').value.trim();
  let filter=null;
  if(fStr){try{filter=JSON.parse(fStr)}catch(e){alert('Invalid filter JSON');return}}
  let vector;
  try{vector=JSON.parse(q)}catch(e){alert('Enter a JSON array vector');return}
  const res=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vector,k,filter})});
  const data=await res.json();
  let html='<table><tr><th>ID</th><th>Score</th><th>Metadata</th></tr>';
  for(const r of data.results||[]){html+=\`<tr><td>\${r.id}</td><td class="score">\${r.score.toFixed(4)}</td><td class="meta">\${JSON.stringify(r.metadata)}</td></tr>\`}
  html+='</table>';
  document.getElementById('results').innerHTML=html;
}
document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch()});
</script></body></html>`;

const routes = {
  'GET /': (req, res) => html(res, dashboard(store.getInfo())),
  'GET /api/info': (req, res) => json(res, store.getInfo()),
  'POST /api/upsert': async (req, res) => {
    const { id, vector, metadata } = await readBody(req);
    if (!vector) return json(res, { error: 'vector required' }, 400);
    const result = store.upsert(id || Date.now().toString(36), vector, metadata || {});
    json(res, result);
  },
  'POST /api/upsert-batch': async (req, res) => {
    const { items } = await readBody(req);
    if (!Array.isArray(items)) return json(res, { error: 'items array required' }, 400);
    json(res, store.upsertBatch(items));
  },
  'GET /api/get': (req, res, params) => {
    const id = params.get('id');
    if (!id) return json(res, { error: 'id required' }, 400);
    const entry = store.get(id);
    json(res, entry || { error: 'not found' }, entry ? 200 : 404);
  },
  'POST /api/search': async (req, res) => {
    const { vector, k, filter, threshold, includeVectors } = await readBody(req);
    if (!vector) return json(res, { error: 'vector required' }, 400);
    try {
      json(res, { results: store.search(vector, k || 10, { filter, threshold, includeVectors }) });
    } catch (e) {
      json(res, { error: e.message }, 400);
    }
  },
  'DELETE /api/delete': async (req, res) => {
    const { id } = await readBody(req);
    json(res, { deleted: store.delete(id) });
  },
  'POST /api/update-metadata': async (req, res) => {
    const { id, metadata } = await readBody(req);
    json(res, { updated: store.updateMetadata(id, metadata) });
  },
  'GET /api/export': (req, res) => json(res, store.export()),
  'POST /api/import': async (req, res) => {
    const { items } = await readBody(req);
    json(res, store.upsertBatch(items));
  },
  'POST /api/build-index': async (req, res) => {
    const { partitions } = await readBody(req);
    store.buildIndex(partitions || 0);
    json(res, { built: true, trained: store.ivf?.trained || false });
  },
  'GET /api/ids': (req, res) => json(res, store.ids()),
  'POST /api/clear': (req, res) => json(res, { cleared: store.clear() })
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const key = `${req.method} ${path}`;
  const handler = routes[key];
  if (handler) {
    try { await handler(req, res, url.searchParams); }
    catch (e) { json(res, { error: e.message }, 500); }
  } else {
    json(res, { error: 'not found' }, 404);
  }
});

server.listen(PORT, () => {
  console.log(`agent-embed server listening on :${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
});

export { server, store };
