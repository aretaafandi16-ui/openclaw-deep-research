/**
 * agent-secrets HTTP Server
 * Dark-theme web dashboard + REST API
 */

import { createServer } from 'node:http';
import AgentSecrets from './index.mjs';

const PORT = parseInt(process.env.PORT || '3130');
const secrets = new AgentSecrets({
  password: process.env.SECRETS_MASTER_PASSWORD || 'agent-secrets-default',
  persistPath: process.env.SECRETS_PERSIST_PATH || './secrets.enc',
  autoSaveMs: 30000,
});

await secrets.load();

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-secrets</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:20px;font-size:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase}
.card .value{color:#58a6ff;font-size:28px;font-weight:bold;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
td{font-size:14px}
.tag{background:#1f6feb33;color:#58a6ff;padding:2px 8px;border-radius:10px;font-size:11px;margin-right:4px}
.expired{color:#f85149}
.ok{color:#3fb950}
.rotation{color:#d29922}
button{background:#238636;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px}
button:hover{background:#2ea043}
button.danger{background:#da3633}button.danger:hover{background:#f85149}
input,select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:6px;font-size:13px}
.form{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
.form label{font-size:11px;color:#8b949e;display:block;margin-bottom:2px}
.audit{margin-top:20px}
.audit-entry{font-size:12px;padding:4px 8px;border-bottom:1px solid #21262d;font-family:monospace}
.audit-entry .ts{color:#8b949e}
.audit-entry .action{color:#58a6ff;font-weight:bold}
.ns-tabs{display:flex;gap:4px;margin-bottom:16px}
.ns-tab{padding:4px 12px;border-radius:6px;cursor:pointer;background:#21262d;color:#8b949e;font-size:13px}
.ns-tab.active{background:#1f6feb;color:#fff}
</style></head>
<body>
<h1>🔐 agent-secrets</h1>
<div class="cards" id="cards"></div>
<div class="ns-tabs" id="ns-tabs"></div>
<div class="form">
  <div><label>Key</label><input id="f-key" placeholder="API_KEY"></div>
  <div><label>Value</label><input id="f-val" type="password" placeholder="secret value"></div>
  <div><label>Namespace</label><input id="f-ns" value="default"></div>
  <div><label>TTL (sec)</label><input id="f-ttl" type="number" placeholder="0=forever" style="width:80px"></div>
  <div><label>Tags</label><input id="f-tags" placeholder="comma,separated"></div>
  <button onclick="addSecret()">💾 Store</button>
</div>
<table><thead><tr><th>Key</th><th>Namespace</th><th>Status</th><th>Tags</th><th>Created</th><th>Actions</th></tr></thead>
<tbody id="list"></tbody></table>
<div class="audit"><h3 style="color:#8b949e;margin-bottom:8px">Audit Log</h3><div id="audit"></div></div>
<script>
let currentNs='';
async function api(p,m='GET',b){const o={method:m,headers:{'Content-Type':'application/json'}};if(b)o.body=JSON.stringify(b);const r=await fetch('/api'+p,o);return r.json()}
async function load(){
  const s=await api('/stats');
  document.getElementById('cards').innerHTML=
    '<div class="card"><div class="label">Total Secrets</div><div class="value">'+s.total+'</div></div>'+
    '<div class="card"><div class="label">Namespaces</div><div class="value">'+s.namespaces+'</div></div>'+
    '<div class="card"><div class="label">Expired</div><div class="value" style="color:'+(s.expired?'#f85149':'#3fb950')+'">'+s.expired+'</div></div>'+
    '<div class="card"><div class="label">Need Rotation</div><div class="value" style="color:'+(s.needsRotation?'#d29922':'#3fb950')+'">'+s.needsRotation+'</div></div>';
  const list=await api('/secrets?namespace='+(currentNs||''));
  document.getElementById('list').innerHTML=list.map(e=>
    '<tr><td><b>'+e.key+'</b></td><td>'+e.namespace+'</td><td>'+(e.expired?'<span class="expired">Expired</span>':e.needsRotation?'<span class="rotation">Rotate</span>':'<span class="ok">✓ Active</span>')+'</td><td>'+(e.tags||[]).map(t=>'<span class="tag">'+t+'</span>').join('')+'</td><td>'+new Date(e.createdAt).toLocaleString()+'</td><td><button class="danger" onclick="del(\\''+e.id+'\\',\\''+e.namespace+'\\')">🗑</button></td></tr>'
  ).join('');
  const ns=await api('/namespaces');
  document.getElementById('ns-tabs').innerHTML='<div class="ns-tab'+(currentNs===''?' active':'')+'" onclick="filterNs(\\'\\')">All</div>'+ns.map(n=>'<div class="ns-tab'+(currentNs===n?' active':'')+'" onclick="filterNs(\\''+n+'\\')">'+n+'</div>').join('');
  const audit=await api('/audit?limit=20');
  document.getElementById('audit').innerHTML=audit.reverse().map(a=>'<div class="audit-entry"><span class="ts">'+new Date(a.timestamp).toLocaleTimeString()+'</span> <span class="action">'+a.action+'</span> '+a.namespace+'/'+a.key+'</div>').join('');
}
async function addSecret(){await api('/secrets','POST',{key:document.getElementById('f-key').value,value:document.getElementById('f-val').value,namespace:document.getElementById('f-ns').value,ttl:parseInt(document.getElementById('f-ttl').value)||undefined,tags:document.getElementById('f-tags').value?document.getElementById('f-tags').value.split(',').map(t=>t.trim()):[]});document.getElementById('f-key').value='';document.getElementById('f-val').value='';load()}
async function del(id,ns){await api('/secrets/'+encodeURIComponent(id)+'?namespace='+ns,'DELETE');load()}
function filterNs(ns){currentNs=ns;load()}
load();setInterval(load,5000);
</script></body></html>`;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') { json(res, ''); return; }
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(DASHBOARD_HTML); return; }
  if (url.pathname === '/api/stats') { json(res, secrets.stats()); return; }
  if (url.pathname === '/api/namespaces') { json(res, secrets.namespaces()); return; }
  if (url.pathname === '/api/secrets' && req.method === 'GET') {
    json(res, secrets.list({ namespace: url.searchParams.get('namespace') || undefined, tag: url.searchParams.get('tag') || undefined }));
    return;
  }
  if (url.pathname === '/api/secrets' && req.method === 'POST') {
    const b = await body(req);
    const result = secrets.set(b.key, b.value, { namespace: b.namespace, ttl: b.ttl, tags: b.tags, rotationInterval: b.rotationInterval, metadata: b.metadata });
    json(res, result);
    return;
  }
  if (url.pathname.startsWith('/api/secrets/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.split('/')[3]);
    json(res, { deleted: secrets.delete(id, { namespace: url.searchParams.get('namespace') || 'default' }) });
    return;
  }
  if (url.pathname === '/api/search') {
    json(res, secrets.search(url.searchParams.get('q') || '', { namespace: url.searchParams.get('namespace') || undefined }));
    return;
  }
  if (url.pathname === '/api/audit') {
    json(res, secrets.getAuditLog({ limit: parseInt(url.searchParams.get('limit') || '50'), namespace: url.searchParams.get('namespace') || undefined, action: url.searchParams.get('action') || undefined }));
    return;
  }
  if (url.pathname === '/api/rotate' && req.method === 'POST') {
    const b = await body(req);
    json(res, secrets.rotate(b.keyOrId, b.newValue, { namespace: b.namespace }));
    return;
  }
  if (url.pathname === '/api/needs-rotation') {
    json(res, secrets.needsRotation({ namespace: url.searchParams.get('namespace') || undefined }));
    return;
  }
  if (url.pathname === '/api/export') {
    json(res, { encrypted: secrets.exportEncrypted(url.searchParams.get('namespace') || undefined) });
    return;
  }

  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, () => {
  console.log(`agent-secrets dashboard: http://localhost:${PORT}`);
});
