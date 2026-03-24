#!/usr/bin/env node
// agent-retry/server.mjs — HTTP health dashboard + REST API
import { createServer } from 'http';
import { CircuitBreaker, Bulkhead, RetryOrchestrator, HealthChecker, ExponentialBackoff } from './index.mjs';

const PORT = parseInt(process.env.PORT ?? '3103');
const breakers = new Map();
const bulkheads = new Map();
const healthChecker = new HealthChecker();

// ─── JSON Helpers ─────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
function dashboard() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-retry Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#c9d1d9;padding:16px}
h1{color:#58a6ff;margin-bottom:16px;font-size:1.5em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h2{color:#8b949e;font-size:.85em;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
.stat{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #21262d}
.stat:last-child{border:none}
.label{color:#8b949e}.value{color:#c9d1d9;font-weight:600}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;font-weight:600}
.closed{background:#238636;color:#fff}.open{background:#da3633;color:#fff}.half_open{background:#d29922;color:#fff}
button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:6px 12px;border-radius:6px;cursor:pointer;margin:4px}
button:hover{background:#30363d}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #21262d;font-size:.85em}
th{color:#8b949e;font-weight:500}
</style></head><body>
<h1>🛡️ agent-retry Dashboard</h1>
<div class="grid">
  <div class="card"><h2>Circuit Breakers</h2><div id="breakers">Loading...</div></div>
  <div class="card"><h2>Bulkheads</h2><div id="bulkheads">Loading...</div></div>
  <div class="card"><h2>Health Checks</h2><div id="health">Loading...</div></div>
  <div class="card"><h2>Quick Actions</h2>
    <button onclick="createCB()">+ Circuit Breaker</button>
    <button onclick="createBH()">+ Bulkhead</button>
    <div id="actions" style="margin-top:12px"></div>
  </div>
</div>
<script>
async function refresh(){
  try{
    const r=await fetch('/api/status');const d=await r.json();
    // Breakers
    let bh='<table><tr><th>Name</th><th>State</th><th>Calls</th><th>Fail Rate</th><th>Rejected</th></tr>';
    (d.circuitBreakers||[]).forEach(b=>{
      bh+='<tr><td>'+b.name+'</td><td><span class="badge '+b.state+'">'+b.state+'</span></td><td>'+b.totalCalls+'</td><td>'+b.failureRate+'</td><td>'+b.rejectedCalls+'</td></tr>';
    });
    bh+='</table>';
    document.getElementById('breakers').innerHTML=d.circuitBreakers?.length?bh:'<p style="color:#8b949e">No circuit breakers registered</p>';
    // Bulkheads
    let bk='<table><tr><th>Name</th><th>Active</th><th>Queued</th><th>Available</th><th>Executed</th><th>Rejected</th></tr>';
    (d.bulkheads||[]).forEach(b=>{
      bk+='<tr><td>'+b.name+'</td><td>'+b.active+'</td><td>'+b.queued+'</td><td>'+b.available+'</td><td>'+b.totalExecuted+'</td><td>'+b.totalRejected+'</td></tr>';
    });
    bk+='</table>';
    document.getElementById('bulkheads').innerHTML=d.bulkheads?.length?bk:'<p style="color:#8b949e">No bulkheads registered</p>';
    // Health
    const hc=d.health;
    if(hc){
      let hh='<div class="stat"><span class="label">Overall</span><span class="value">'+(hc.healthy?'✅ Healthy':'❌ Unhealthy')+'</span></div>';
      Object.entries(hc.checks||{}).forEach(([name,c])=>{
        hh+='<div class="stat"><span class="label">'+name+'</span><span class="value">'+(c.ok?'✅':'❌')+' ('+c.consecutiveFailures+' fails)</span></div>';
      });
      document.getElementById('health').innerHTML=hh;
    }
  }catch(e){console.error(e)}
}
setInterval(refresh,2000);refresh();
</script></body></html>`;
}

// ─── Router ───────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // Dashboard
    if (path === '/' || path === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(dashboard());
    }

    // API: Status
    if (path === '/api/status' && req.method === 'GET') {
      return json(res, {
        circuitBreakers: [...breakers.values()].map(b => b.stats),
        bulkheads: [...bulkheads.values()].map(b => b.stats),
        health: healthChecker.status,
        uptime: process.uptime(),
      });
    }

    // API: Create circuit breaker
    if (path === '/api/breaker' && req.method === 'POST') {
      const body = await readBody(req);
      const cb = new CircuitBreaker(body);
      breakers.set(body.name ?? cb.name, cb);
      return json(res, cb.stats, 201);
    }

    // API: Get breaker stats
    if (path.startsWith('/api/breaker/') && req.method === 'GET') {
      const name = path.split('/')[3];
      const cb = breakers.get(name);
      if (!cb) return json(res, { error: 'Not found' }, 404);
      return json(res, cb.stats);
    }

    // API: Reset breaker
    if (path.startsWith('/api/breaker/') && path.endsWith('/reset') && req.method === 'POST') {
      const name = path.split('/')[3];
      const cb = breakers.get(name);
      if (!cb) return json(res, { error: 'Not found' }, 404);
      cb.reset();
      return json(res, { ok: true });
    }

    // API: Force breaker state
    if (path.startsWith('/api/breaker/') && (path.endsWith('/open') || path.endsWith('/close')) && req.method === 'POST') {
      const name = path.split('/')[3];
      const cb = breakers.get(name);
      if (!cb) return json(res, { error: 'Not found' }, 404);
      if (path.endsWith('/open')) cb.forceOpen();
      else cb.forceClose();
      return json(res, { ok: true, state: cb.state });
    }

    // API: Create bulkhead
    if (path === '/api/bulkhead' && req.method === 'POST') {
      const body = await readBody(req);
      const bh = new Bulkhead(body);
      bulkheads.set(body.name ?? bh.name, bh);
      return json(res, bh.stats, 201);
    }

    // API: Get bulkhead stats
    if (path.startsWith('/api/bulkhead/') && req.method === 'GET') {
      const name = path.split('/')[3];
      const bh = bulkheads.get(name);
      if (!bh) return json(res, { error: 'Not found' }, 404);
      return json(res, bh.stats);
    }

    // API: Health check
    if (path === '/api/health' && req.method === 'GET') {
      const results = await healthChecker.runAll();
      return json(res, { ...healthChecker.status, results });
    }

    return json(res, { error: 'Not found' }, 404);
  } catch (err) {
    return json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`🛡️  agent-retry dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`📡 API: http://localhost:${PORT}/api/status`);
});

export { server, breakers, bulkheads, healthChecker };
