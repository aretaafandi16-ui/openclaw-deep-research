/**
 * agent-config HTTP Server — Dark-theme web dashboard + REST API
 */

import { createServer } from 'http';
import { AgentConfig } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3122');

const config = new AgentConfig({ dataDir: process.env.DATA_DIR || './data' });
config.loadEnv();

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-config</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:12px;text-transform:uppercase;margin-bottom:8px}
.card .val{font-size:24px;font-weight:700;color:#58a6ff}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
tr:hover{background:#161b22}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge-secret{background:#da3633;color:#fff}
.badge-env{background:#238636;color:#fff}
.badge-file{background:#1f6feb;color:#fff}
.badge-runtime{background:#6e40c9;color:#fff}
input,textarea,select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:8px;border-radius:6px;width:100%;margin:4px 0}
button{background:#238636;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600}
button:hover{background:#2ea043}
.btn-danger{background:#da3633}
.btn-danger:hover{background:#b62324}
.flex{display:flex;gap:8px;align-items:center}
.section{margin:24px 0}
.section h2{color:#c9d1d9;margin-bottom:12px;font-size:18px}
.auto{color:#8b949e;font-size:12px}
</style></head><body>
<h1>🐋 agent-config</h1>
<p class="auto">Auto-refresh 5s</p>
<div class="grid" id="stats"></div>

<div class="section">
<h2>Configuration</h2>
<div class="flex" style="margin-bottom:12px">
  <input id="setKey" placeholder="dotted.path.key" style="flex:1">
  <input id="setVal" placeholder="value" style="flex:2">
  <button onclick="setKey()">Set</button>
</div>
<table><thead><tr><th>Key</th><th>Value</th><th>Source</th><th>Actions</th></tr></thead><tbody id="cfgBody"></tbody></table>
</div>

<div class="section">
<h2>Change History</h2>
<table><thead><tr><th>Time</th><th>Key</th><th>Old</th><th>New</th><th>Source</th></tr></thead><tbody id="histBody"></tbody></table>
</div>

<div class="section">
<h2>Snapshots</h2>
<div class="flex">
  <input id="snapName" placeholder="snapshot name" style="flex:1">
  <button onclick="createSnap()">Create</button>
</div>
<table><thead><tr><th>Name</th><th>Actions</th></tr></thead><tbody id="snapBody"></tbody></table>
</div>

<div class="section">
<h2>Schema</h2>
<table><thead><tr><th>Key</th><th>Type</th><th>Required</th><th>Default</th><th>Enum</th></tr></thead><tbody id="schemaBody"></tbody></table>
</div>

<script>
function $(id){return document.getElementById(id)}
function esc(s){if(s===undefined||s===null)return'<i>undefined</i>';const t=String(s);return t.length>80?t.slice(0,80)+'…':t}
function sourceBadge(s){const c=s?.startsWith('env')?'env':s?.startsWith('file')?'file':s==='runtime'?'runtime':'';return c?'<span class="badge badge-'+c+'">'+s+'</span>':s||'—'}

async function api(p,method,body){const r=await fetch('/api'+p,{method:method||'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return r.json()}

async function load(){
  const [stats,cfg,hist,snap,schema]=await Promise.all([api('/stats'),api('/config'),api('/history?limit=50'),api('/snapshots'),api('/schema')]);
  $('stats').innerHTML=[
    ['Keys',stats.totalKeys],['Schema Fields',stats.schemaFields],['Secrets',stats.secrets],
    ['Snapshots',stats.snapshots],['Watchers',stats.watchers],['Changes',stats.changes]
  ].map(([l,v])=>'<div class="card"><h3>'+l+'</h3><div class="val">'+v+'</div></div>').join('');

  function flatten(obj,prefix=''){let r=[];for(const[k,v]of Object.entries(obj)){const f=prefix?prefix+'.'+k:k;if(v&&typeof v==='object'&&!Array.isArray(v))r=r.concat(flatten(v,f));else r.push([f,v])}return r}
  const rows=flatten(cfg);
  $('cfgBody').innerHTML=rows.map(([k,v])=>'<tr><td><code>'+k+'</code></td><td>'+esc(v)+'</td><td>—</td><td><button class="btn-danger" onclick="delKey(\\''+k+'\\')">Del</button></td></tr>').join('');

  $('histBody').innerHTML=(hist.items||hist||[]).reverse().map(h=>'<tr><td>'+(h.timestamp||'').slice(11,19)+'</td><td><code>'+h.path+'</code></td><td>'+esc(h.oldValue)+'</td><td>'+esc(h.newValue)+'</td><td>'+sourceBadge(h.source)+'</td></tr>').join('');

  $('snapBody').innerHTML=(snap.items||snap||[]).map(s=>'<tr><td><code>'+s+'</code></td><td><button onclick="rollbackSnap(\\''+s+'\\')">Rollback</button> <button class="btn-danger" onclick="delSnap(\\''+s+'\\')">Delete</button></td></tr>').join('');

  const sRows=typeof schema==='object'&&!schema.items?Object.entries(schema):Object.entries(schema.items||{});
  $('schemaBody').innerHTML=sRows.map(([k,s])=>'<tr><td><code>'+k+'</code></td><td>'+(s.type||'—')+'</td><td>'+(s.required?'✅':'—')+'</td><td>'+(s.default!==undefined?esc(s.default):'—')+'</td><td>'+(s.enum?'['+s.enum.join(', ')+']':'—')+'</td></tr>').join('');
}

async function setKey(){const k=$('setKey').value.trim(),v=$('setVal').value;if(!k)return;await api('/config/'+encodeURIComponent(k),'PUT',{value:v});$('setKey').value='';$('setVal').value='';load()}
async function delKey(k){await api('/config/'+encodeURIComponent(k),'DELETE');load()}
async function createSnap(){const n=$('snapName').value.trim();if(!n)return;await api('/snapshots/'+encodeURIComponent(n),'POST');$('snapName').value='';load()}
async function rollbackSnap(n){await api('/snapshots/'+encodeURIComponent(n)+'/rollback','POST');load()}
async function delSnap(n){await api('/snapshots/'+encodeURIComponent(n),'DELETE');load()}

load();setInterval(load,5000);
</script></body></html>`;

function flattenConfig(obj, prefix = '') {
  let result = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result = result.concat(flattenConfig(value, full));
    } else {
      result.push([full, value]);
    }
  }
  return result;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const json = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };

  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  let body = '';
  if (['POST', 'PUT'].includes(req.method)) {
    body = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
  }
  const parsed = body ? JSON.parse(body) : {};

  try {
    // Dashboard
    if (path === '/' || path === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(HTML);
    }

    // API
    if (path === '/api/stats') return json(config.stats());
    if (path === '/api/history') return json({ items: config.history(parseInt(url.searchParams.get('limit') || '50')) });
    if (path === '/api/snapshots') return json({ items: config.listSnapshots() });
    if (path === '/api/schema') return json(config._schema);
    if (path === '/api/config' && req.method === 'GET') return json(config.getAllMasked());

    // Config CRUD
    const configMatch = path.match(/^\/api\/config\/(.+)$/);
    if (configMatch) {
      const key = decodeURIComponent(configMatch[1]);
      if (req.method === 'GET') return json({ key, value: config.getMasked(key) });
      if (req.method === 'PUT') { config.set(key, parsed.value); return json({ ok: true, key, value: config.getMasked(key) }); }
      if (req.method === 'DELETE') { config.delete(key); return json({ ok: true, key }); }
    }

    // Snapshots
    const snapMatch = path.match(/^\/api\/snapshots\/([^/]+)$/);
    if (snapMatch) {
      const name = decodeURIComponent(snapMatch[1]);
      if (req.method === 'POST' && !path.endsWith('/rollback')) { config.snapshot(name); return json({ ok: true, name }); }
      if (req.method === 'DELETE') { config.deleteSnapshot(name); return json({ ok: true, name }); }
    }
    const rollbackMatch = path.match(/^\/api\/snapshots\/([^/]+)\/rollback$/);
    if (rollbackMatch && req.method === 'POST') {
      config.rollback(decodeURIComponent(rollbackMatch[1]));
      return json({ ok: true });
    }

    // Validate
    if (path === '/api/validate' && req.method === 'POST') return json(config.validate());

    // Env load
    if (path === '/api/env/load' && req.method === 'POST') { config.loadEnv(); return json({ ok: true }); }

    json({ error: 'Not found' }, 404);
  } catch (e) {
    json({ error: e.message }, 500);
  }
});

server.listen(PORT, () => console.log(`agent-config dashboard: http://localhost:${PORT}`));

// Graceful shutdown
process.on('SIGTERM', () => { config.unwatchAll(); server.close(); process.exit(0); });
process.on('SIGINT', () => { config.unwatchAll(); server.close(); process.exit(0); });
