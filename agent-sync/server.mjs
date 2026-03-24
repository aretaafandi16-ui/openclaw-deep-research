#!/usr/bin/env node
/**
 * agent-sync HTTP Server — REST API + Web Dashboard
 */

import http from 'http';
import { AgentSync } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3119');
const sync = new AgentSync({
  peerId: process.env.SYNC_PEER_ID || 'server-peer',
  namespace: process.env.SYNC_NAMESPACE || 'default',
  persistPath: process.env.SYNC_PERSIST || null
});

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-sync</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:system-ui,sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:12px;text-transform:uppercase;margin-bottom:4px}
.card .val{font-size:28px;font-weight:700;color:#58a6ff}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.tag-lww{background:#1f6feb33;color:#58a6ff}
.tag-counter{background:#23863633;color:#3fb950}
.tag-set{background:#da363333;color:#f85149}
.tag-map{background:#d2992233;color:#e3b341}
.btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px}
.btn:hover{background:#30363d}
input,select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:6px;font-size:13px}
.flex{display:flex;gap:8px;align-items:center;margin:12px 0;flex-wrap:wrap}
#data{max-height:400px;overflow-y:auto}
</style></head><body>
<h1>🐋 agent-sync</h1>
<p style="color:#8b949e">Distributed data sync with CRDTs</p>
<div class="grid" id="stats"></div>
<div class="flex">
  <input id="k" placeholder="key">
  <input id="v" placeholder="value">
  <select id="t"><option value="lww">LWW</option><option value="g-counter">G-Counter</option><option value="pn-counter">PN-Counter</option><option value="or-set">OR-Set</option><option value="lww-map">LWW-Map</option></select>
  <button class="btn" onclick="doSet()">Set</button>
  <button class="btn" onclick="doDelete()">Delete</button>
  <button class="btn" onclick="load()">Refresh</button>
</div>
<div id="data"></div>
<h2 style="margin-top:20px">Sync Log</h2>
<div id="log" style="max-height:300px;overflow-y:auto"></div>
<h2 style="margin-top:20px">Peers</h2>
<div id="peers"></div>
<script>
const $=s=>document.querySelector(s);
async function api(path,body){const r=await fetch('/api'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return r.json()}
async function load(){
  const[s,e,l,p]=await Promise.all([api('/stats'),api('/entries'),api('/log?limit=50'),api('/peers')]);
  $('#stats').innerHTML=[['Keys',s.keys],['Sets',s.sets],['Deletes',s.deletes],['Syncs',s.syncs],['Peers',s.peers],['Conflicts',s.conflicts||0]].map(([k,v])=>\`<div class="card"><h3>\${k}</h3><div class="val">\${v}</div></div>\`).join('');
  $('#data').innerHTML='<table><tr><th>Key</th><th>Value</th><th>Type</th></tr>'+Object.entries(e.entries||{}).map(([k,v])=>\`<tr><td>\${k}</td><td>\${JSON.stringify(v)}</td><td><span class="tag tag-lww">lww</span></td></tr>\`).join('')+'</table>';
  $('#log').innerHTML='<table><tr><th>Time</th><th>Op</th><th>Key</th><th>Peer</th></tr>'+(l.log||[]).reverse().map(e=>\`<tr><td>\${new Date(e.timestamp).toLocaleTimeString()}</td><td>\${e.op}</td><td>\${e.key}</td><td>\${e.peer}</td></tr>\`).join('')+'</table>';
  $('#peers').innerHTML='<table><tr><th>Peer ID</th><th>Last Sync</th></tr>'+(p.peers||[]).map(p=>\`<tr><td>\${p.peerId}</td><td>\${p.lastSync?new Date(p.lastSync).toLocaleString():'never'}</td></tr>\`).join('')+'</table>';
}
async function doSet(){await api('/set',{key:$('#k').value,value:tryParse($('#v').value),type:$('#t').value});load()}
async function doDelete(){await api('/delete',{key:$('#k').value});load()}
function tryParse(v){try{return JSON.parse(v)}catch{return v}}
setInterval(load,5000);load();
</script></body></html>`;

function tryParse(v) { try { return JSON.parse(v); } catch { return v; } }

const server = http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  const json = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify(data));
  };

  let body = '';
  req.on('data', c => body += c);
  await new Promise(r => req.on('end', r));
  const params = body ? tryParse(body) : {};

  const url = new URL(req.url, 'http://localhost');

  try {
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return;
    }
    if (url.pathname === '/api/stats') return json(200, sync.stats());
    if (url.pathname === '/api/entries') return json(200, { entries: sync.entries(params.namespace) });
    if (url.pathname === '/api/keys') return json(200, { keys: sync.keys(params.namespace) });
    if (url.pathname === '/api/peers') return json(200, { peers: sync.listPeers() });
    if (url.pathname === '/api/conflicts') return json(200, { conflicts: sync.getConflicts() });
    if (url.pathname === '/api/log') {
      return json(200, { log: sync.getLog(params.since ? parseInt(url.searchParams.get('since')) : null, params.limit || parseInt(url.searchParams.get('limit') || '100')) });
    }
    if (url.pathname === '/api/get' && req.method === 'POST') {
      return json(200, { key: params.key, value: sync.get(params.key), exists: sync.has(params.key) });
    }
    if (url.pathname === '/api/set' && req.method === 'POST') {
      sync.set(params.key, params.value, { type: params.type || 'lww', timestamp: params.timestamp, namespace: params.namespace, increment: params.increment, decrement: params.decrement, mapKey: params.mapKey });
      return json(200, { ok: true, key: params.key });
    }
    if (url.pathname === '/api/delete' && req.method === 'POST') {
      return json(200, { ok: sync.delete(params.key) });
    }
    if (url.pathname === '/api/increment' && req.method === 'POST') {
      sync.increment(params.key, params.amount || 1);
      return json(200, { key: params.key, value: sync.get(params.key) });
    }
    if (url.pathname === '/api/decrement' && req.method === 'POST') {
      sync.decrement(params.key, params.amount || 1);
      return json(200, { key: params.key, value: sync.get(params.key) });
    }
    if (url.pathname === '/api/add-to-set' && req.method === 'POST') {
      sync.addToSet(params.key, params.value);
      return json(200, { ok: true });
    }
    if (url.pathname === '/api/snapshot') return json(200, sync.createSnapshot());
    if (url.pathname === '/api/load-snapshot' && req.method === 'POST') {
      sync.loadSnapshot(params.snapshot);
      return json(200, { ok: true });
    }
    if (url.pathname === '/api/delta') return json(200, sync.getDelta(params.peerId));
    if (url.pathname === '/api/apply-delta' && req.method === 'POST') {
      return json(200, sync.applyDelta(params.delta));
    }
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      return json(200, sync.sync(params.snapshot));
    }
    if (url.pathname === '/api/register-peer' && req.method === 'POST') {
      sync.registerPeer(params.peerId, params.clock);
      return json(200, { ok: true });
    }
    if (url.pathname === '/api/clear' && req.method === 'POST') {
      sync.clear();
      return json(200, { ok: true });
    }
    if (url.pathname === '/api/save' && req.method === 'POST') {
      sync.save();
      return json(200, { ok: true });
    }
    json(404, { error: 'not found' });
  } catch (e) {
    json(500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`agent-sync server on :${PORT} (dashboard: http://localhost:${PORT}/)`));
