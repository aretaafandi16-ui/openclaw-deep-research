/**
 * agent-lock HTTP server with dark-theme web dashboard
 * Port: 3124
 */

import http from 'http';
import { AgentLock } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3124');
const lock = new AgentLock({ persistDir: process.env.PERSIST_DIR || './data' });

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-lock</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:20px;font-size:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase}
.card .value{color:#58a6ff;font-size:28px;font-weight:700;margin-top:4px}
.card.green .value{color:#3fb950}
.card.red .value{color:#f85149}
.card.orange .value{color:#d29922}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase;background:#161b22}
td{font-size:14px}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.badge.locked{background:#f8514920;color:#f85149}
.badge.free{background:#3fb95020;color:#3fb950}
.badge.reading{background:#58a6ff20;color:#58a6ff}
.badge.writing{background:#d2992220;color:#d29922}
.section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px}
.section h2{color:#c9d1d9;font-size:16px;margin-bottom:12px}
button{background:#238636;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px}
button:hover{background:#2ea043}
button.danger{background:#da3633}
button.danger:hover{background:#f85149}
input,select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:6px;font-size:13px}
.form-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.auto{opacity:.6;font-size:12px}
</style></head><body>
<h1>🔒 agent-lock Dashboard</h1>
<div class="cards" id="stats-cards"></div>
<div class="section"><h2>🔒 Mutex Locks</h2>
<div class="form-row">
<input id="mutex-name" placeholder="Lock name">
<input id="mutex-holder" placeholder="Holder" value="default">
<button onclick="doLock()">Acquire</button>
<button onclick="doUnlock()">Release</button>
<button class="danger" onclick="doForce()">Force Release</button>
</div>
<table><thead><tr><th>Name</th><th>Status</th><th>Owner</th><th>Reentrant</th><th>Queue</th></tr></thead><tbody id="mutex-table"></tbody></table>
</div>
<div class="section"><h2>📖 Read-Write Locks</h2>
<div class="form-row">
<input id="rw-name" placeholder="Lock name">
<input id="rw-holder" placeholder="Holder" value="default">
<button onclick="doReadLock()">Read Lock</button>
<button onclick="doWriteLock()">Write Lock</button>
<button onclick="doReadUnlock()">Read Unlock</button>
<button onclick="doWriteUnlock()">Write Unlock</button>
</div>
<table><thead><tr><th>Name</th><th>Writer</th><th>Readers</th><th>R Queue</th><th>W Queue</th></tr></thead><tbody id="rw-table"></tbody></table>
</div>
<div class="section"><h2>🚦 Semaphores</h2>
<div class="form-row">
<input id="sem-name" placeholder="Semaphore name">
<input id="sem-max" type="number" value="3" style="width:60px" placeholder="Max">
<button onclick="createSem()">Create</button>
<button onclick="doAcquirePermit()">Acquire</button>
<button onclick="doReleasePermit()">Release</button>
</div>
<table><thead><tr><th>Name</th><th>Available</th><th>Max</th><th>Holders</th><th>Queue</th></tr></thead><tbody id="sem-table"></tbody></table>
</div>
<div class="section"><h2>🚧 Barriers</h2>
<div class="form-row">
<input id="barrier-name" placeholder="Barrier name">
<input id="barrier-parties" type="number" value="3" style="width:60px" placeholder="Parties">
<button onclick="createBarrier()">Create</button>
<button onclick="doBarrierWait()">Wait</button>
<button onclick="doBarrierReset()">Reset</button>
</div>
<table><thead><tr><th>Name</th><th>Parties</th><th>Waiting</th><th>Generation</th></tr></thead><tbody id="barrier-table"></tbody></table>
</div>
<div class="section"><h2>👑 Leader Elections</h2>
<table><thead><tr><th>Name</th><th>Leader</th><th>Candidates</th></tr></thead><tbody id="election-table"></tbody></table>
</div>
<div class="section"><h2>🔍 Deadlock Detection</h2>
<pre id="deadlock-info" style="color:#f85149;font-size:13px">No deadlocks detected</pre>
</div>
<span class="auto">Auto-refresh: 3s</span>
<script>
async function api(path,method='GET',body=null){const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):null});return r.json()}
async function refresh(){
  const d=await api('/status');
  document.getElementById('stats-cards').innerHTML=[
    card('Acquires',d.stats.acquires),card('Releases',d.stats.releases,'green'),
    card('Timeouts',d.stats.timeouts,'orange'),card('Deadlocks',d.stats.deadlocks,'red'),
    card('Force Releases',d.stats.forceReleases,'red'),
  ].join('');
  let mt='';for(const[n,l]of Object.entries(d.locks.mutexes||{})){mt+=\`<tr><td>\${n}</td><td><span class="badge \${l.locked?'locked':'free'}">\${l.locked?'LOCKED':'FREE'}</span></td><td>\${l.owner||'-'}</td><td>\${l.reentrantCount}</td><td>\${l.queueLength}</td></tr>\`}document.getElementById('mutex-table').innerHTML=mt||'<tr><td colspan="5" style="color:#8b949e">No locks</td></tr>';
  let rt='';for(const[n,l]of Object.entries(d.locks.rwlocks||{})){rt+=\`<tr><td>\${n}</td><td>\${l.writer||'-'}</td><td>\${Object.keys(l.readers||{}).join(', ')||'-'}</td><td>\${l.readQueueLength}</td><td>\${l.writeQueueLength}</td></tr>\`}document.getElementById('rw-table').innerHTML=rt||'<tr><td colspan="5" style="color:#8b949e">No RW locks</td></tr>';
  let st='';for(const[n,l]of Object.entries(d.locks.semaphores||{})){st+=\`<tr><td>\${n}</td><td>\${l.available}</td><td>\${l.maxPermits}</td><td>\${JSON.stringify(l.holders)}</td><td>\${l.queueLength}</td></tr>\`}document.getElementById('sem-table').innerHTML=st||'<tr><td colspan="5" style="color:#8b949e">No semaphores</td></tr>';
  let bt='';for(const[n,b]of Object.entries(d.barriers||{})){bt+=\`<tr><td>\${n}</td><td>\${b.parties}</td><td>\${b.waiting}</td><td>\${b.generation}</td></tr>\`}document.getElementById('barrier-table').innerHTML=bt||'<tr><td colspan="4" style="color:#8b949e">No barriers</td></tr>';
  let et='';for(const[n,e]of Object.entries(d.elections||{})){et+=\`<tr><td>\${n}</td><td>\${e.leader||'-'}</td><td>\${e.candidateCount}</td></tr>\`}document.getElementById('election-table').innerHTML=et||'<tr><td colspan="3" style="color:#8b949e">No elections</td></tr>';
  document.getElementById('deadlock-info').textContent=d.deadlocks.length?JSON.stringify(d.deadlocks):'No deadlocks detected';
}
function card(label,value,cls=''){return\`<div class="card \${cls}"><div class="label">\${label}</div><div class="value">\${value}</div></div>\`}
async function doLock(){await api('/mutex/lock','POST',{name:$id('mutex-name'),holder:$id('mutex-holder')});refresh()}
async function doUnlock(){await api('/mutex/unlock','POST',{name:$id('mutex-name'),holder:$id('mutex-holder')});refresh()}
async function doForce(){await api('/mutex/force','POST',{name:$id('mutex-name')});refresh()}
async function doReadLock(){await api('/rw/read-lock','POST',{name:$id('rw-name'),holder:$id('rw-holder')});refresh()}
async function doWriteLock(){await api('/rw/write-lock','POST',{name:$id('rw-name'),holder:$id('rw-holder')});refresh()}
async function doReadUnlock(){await api('/rw/read-unlock','POST',{name:$id('rw-name'),holder:$id('rw-holder')});refresh()}
async function doWriteUnlock(){await api('/rw/write-unlock','POST',{name:$id('rw-name'),holder:$id('rw-holder')});refresh()}
async function createSem(){await api('/semaphore/create','POST',{name:$id('sem-name'),maxPermits:+$id('sem-max')});refresh()}
async function doAcquirePermit(){await api('/semaphore/acquire','POST',{name:$id('sem-name')});refresh()}
async function doReleasePermit(){await api('/semaphore/release','POST',{name:$id('sem-name')});refresh()}
async function createBarrier(){await api('/barrier/create','POST',{name:$id('barrier-name'),parties:+$id('barrier-parties')});refresh()}
async function doBarrierWait(){api('/barrier/wait','POST',{name:$id('barrier-name')}).then(refresh)}
async function doBarrierReset(){await api('/barrier/reset','POST',{name:$id('barrier-name')});refresh()}
function $id(v){return document.getElementById(v).value}
refresh();setInterval(refresh,3000);
</script></body></html>`;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Dashboard
  if (p === '/' || p === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
    return;
  }

  // Parse body
  let body = '';
  if (req.method === 'POST') {
    for await (const chunk of req) body += chunk;
    body = body ? JSON.parse(body) : {};
  }

  try {
    // Status
    if (p === '/api/status' && req.method === 'GET') {
      return json(res, {
        stats: lock.stats,
        locks: { mutexes: Object.fromEntries([...(lock.listLocks())].filter(([,v]) => v.type === 'mutex').map(([k,v]) => [k, v])),
                  rwlocks: Object.fromEntries([...(lock.listLocks())].filter(([,v]) => v.type === 'rwlock').map(([k,v]) => [k, v])),
                  semaphores: Object.fromEntries([...(lock.listLocks())].filter(([,v]) => v.type === 'semaphore').map(([k,v]) => [k, v])) },
        barriers: lock.listBarriers(),
        elections: lock.listElections(),
        deadlocks: lock.detectDeadlocks(),
      });
    }

    // Mutex
    if (p === '/api/mutex/lock' && req.method === 'POST') {
      await lock.lock(body.name, body.holder || 'default', body.timeout || 0);
      return json(res, { ok: true });
    }
    if (p === '/api/mutex/unlock' && req.method === 'POST') {
      const ok = lock.unlock(body.name, body.holder || 'default');
      return json(res, { ok });
    }
    if (p === '/api/mutex/force' && req.method === 'POST') {
      const prev = lock.forceUnlock(body.name);
      return json(res, { ok: true, previousOwner: prev });
    }

    // RW Lock
    if (p === '/api/rw/read-lock' && req.method === 'POST') {
      await lock.readLock(body.name, body.holder || 'default', body.timeout || 0);
      return json(res, { ok: true });
    }
    if (p === '/api/rw/write-lock' && req.method === 'POST') {
      await lock.writeLock(body.name, body.holder || 'default', body.timeout || 0);
      return json(res, { ok: true });
    }
    if (p === '/api/rw/read-unlock' && req.method === 'POST') {
      return json(res, { ok: lock.readUnlock(body.name, body.holder || 'default') });
    }
    if (p === '/api/rw/write-unlock' && req.method === 'POST') {
      return json(res, { ok: lock.writeUnlock(body.name, body.holder || 'default') });
    }

    // Semaphore
    if (p === '/api/semaphore/create' && req.method === 'POST') {
      lock.semaphore(body.name, body.maxPermits || 1);
      return json(res, { ok: true });
    }
    if (p === '/api/semaphore/acquire' && req.method === 'POST') {
      await lock.acquirePermit(body.name, body.holder || 'default', body.count || 1, body.timeout || 0);
      return json(res, { ok: true });
    }
    if (p === '/api/semaphore/release' && req.method === 'POST') {
      return json(res, { ok: lock.releasePermit(body.name, body.holder || 'default', body.count || 1) });
    }

    // Barrier
    if (p === '/api/barrier/create' && req.method === 'POST') {
      lock.barrier(body.name, body.parties || 2);
      return json(res, { ok: true });
    }
    if (p === '/api/barrier/wait' && req.method === 'POST') {
      const gen = await lock.barrierWait(body.name, body.label || '');
      return json(res, { ok: true, generation: gen });
    }
    if (p === '/api/barrier/reset' && req.method === 'POST') {
      lock.barrierReset(body.name);
      return json(res, { ok: true });
    }

    // With-lock convenience
    if (p === '/api/with-lock' && req.method === 'POST') {
      const result = await lock.withLock(body.name, body.holder || 'default', () => body.result || 'ok', body.timeout || 0);
      return json(res, { ok: true, result });
    }

    // Stats
    if (p === '/api/stats' && req.method === 'GET') {
      return json(res, lock.stats);
    }

    // List
    if (p === '/api/locks' && req.method === 'GET') {
      return json(res, lock.listLocks());
    }
    if (p === '/api/barriers' && req.method === 'GET') {
      return json(res, lock.listBarriers());
    }
    if (p === '/api/elections' && req.method === 'GET') {
      return json(res, lock.listElections());
    }
    if (p === '/api/deadlocks' && req.method === 'GET') {
      return json(res, { cycles: lock.detectDeadlocks() });
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    json(res, { error: err.message }, 400);
  }
});

server.listen(PORT, () => console.log(`agent-lock dashboard: http://localhost:${PORT}`));

export { server, lock };
