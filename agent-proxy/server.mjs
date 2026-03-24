#!/usr/bin/env node

/**
 * agent-proxy HTTP Server — Dashboard + REST API
 */

import { createServer } from 'http';
import { AgentProxy } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3110');
const proxy = new AgentProxy({ port: PORT });

const dashboardHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-proxy</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e1e4e8;padding:20px}
h1{color:#58a6ff;margin-bottom:8px;font-size:1.8em}
.subtitle{color:#8b949e;margin-bottom:24px;font-size:.9em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:.75em;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.card .value{color:#58a6ff;font-size:2em;font-weight:700}
.card .sub{color:#8b949e;font-size:.8em;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:24px}
th{background:#21262d;color:#8b949e;font-size:.75em;text-transform:uppercase;letter-spacing:1px;padding:12px 16px;text-align:left}
td{padding:12px 16px;border-top:1px solid #30363d;font-size:.9em}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;font-weight:600}
.badge-green{background:#1b4332;color:#3fb950}
.badge-red{background:#3d1518;color:#f85149}
.badge-yellow{background:#3d2e00;color:#d29922}
.badge-blue{background:#0c2d6b;color:#58a6ff}
.auto-refresh{color:#8b949e;font-size:.8em;margin-top:16px;text-align:center}
pre{background:#0d1117;padding:12px;border-radius:6px;overflow-x:auto;font-size:.85em;color:#c9d1d9;margin-top:8px}
.section{margin-bottom:32px}
.section h2{color:#c9d1d9;margin-bottom:12px;font-size:1.2em;border-bottom:1px solid #30363d;padding-bottom:8px}
</style></head><body>
<h1>🐋 agent-proxy</h1>
<p class="subtitle">API Gateway & Request Proxy — Real-time Dashboard</p>
<div class="grid" id="stats"></div>
<div class="section"><h2>Routes</h2><table id="routes"><thead><tr><th>Route</th><th>Requests</th><th>Success</th><th>Errors</th><th>Avg Latency</th><th>Circuit</th><th>Rate Limit</th></tr></thead><tbody></tbody></table></div>
<div class="section"><h2>Global Stats</h2><pre id="raw"></pre></div>
<p class="auto-refresh">Auto-refreshes every 3s</p>
<script>
async function load(){
  try{
    const [stats,routes]=await Promise.all([fetch('/_proxy/stats').then(r=>r.json()),fetch('/_proxy/routes').then(r=>r.json())]);
    document.getElementById('stats').innerHTML=\`
      <div class="card"><h3>Total Requests</h3><div class="value">\${stats.requests}</div></div>
      <div class="card"><h3>Errors</h3><div class="value" style="color:\${stats.errors?'#f85149':'#3fb950'}">\${stats.errors}</div></div>
      <div class="card"><h3>Avg Latency</h3><div class="value">\${Math.round(stats.avgLatency)}ms</div></div>
      <div class="card"><h3>Routes</h3><div class="value">\${stats.routes}</div></div>
      <div class="card"><h3>Cache Size</h3><div class="value">\${stats.cache.size}</div><div class="sub">Hits: \${stats.cache.totalHits}</div></div>
      <div class="card"><h3>Uptime</h3><div class="value">\${Math.round(stats.uptime/1000)}s</div></div>\`;
    const tbody=document.querySelector('#routes tbody');
    tbody.innerHTML=Object.entries(routes).map(([name,r])=>\`<tr>
      <td><strong>\${name}</strong></td><td>\${r.requests}</td><td>\${r.success}</td>
      <td style="color:\${r.errors?'#f85149':'inherit'}">\${r.errors}</td>
      <td>\${Math.round(r.avgLatency)}ms</td>
      <td><span class="badge badge-\${r.circuitBreaker.state==='closed'?'green':r.circuitBreaker.state==='open'?'red':'yellow'}">\${r.circuitBreaker.state}</span></td>
      <td>\${r.rateLimit?\`\${r.rateLimit.current}/\${r.rateLimit.max}\`:'—'}</td>
    </tr>\`).join('')||'<tr><td colspan="7" style="text-align:center;color:#8b949e">No routes configured</td></tr>';
    document.getElementById('raw').textContent=JSON.stringify(stats,null,2);
  }catch(e){console.error(e)}
}
load();setInterval(load,3000);
</script></body></html>`;

const adminServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.url === '/' || req.url === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(dashboardHtml);
  }

  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - proxy.globalStats.startMs }));
  }

  if (req.url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(proxy.stats()));
  }

  if (req.url === '/api/routes') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(proxy.routeStats()));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const cfg = JSON.parse(body);
      proxy.addRoute(cfg.name, cfg);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, route: cfg.name }));
    }
  }

  if (req.url?.startsWith('/api/routes/') && req.method === 'DELETE') {
    const name = req.url.split('/api/routes/')[1];
    proxy.removeRoute(name);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.url === '/api/circuit-breakers') {
    const cbs = {};
    for (const [name, route] of proxy.routes) cbs[name] = route.circuitBreaker.status();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(cbs));
  }

  if (req.url === '/api/circuit-breakers/reset' && req.method === 'POST') {
    for (const [, route] of proxy.routes) route.circuitBreaker.reset();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.url === '/api/cache' && req.method === 'DELETE') {
    proxy.cache.invalidate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '3111');

proxy.on('request', (e) => console.log(`→ ${e.method} ${e.url} → ${e.target} [${e.status}] ${e.latency}ms`));
proxy.on('request:error', (e) => console.error(`✗ ${e.method} ${e.url} → ${e.target}: ${e.error}`));
proxy.on('rate-limited', (e) => console.warn(`⚠ Rate limited: ${e.route}`));
proxy.on('circuit-open', (e) => console.warn(`⚠ Circuit open: ${e.route}`));

await proxy.start();
adminServer.listen(ADMIN_PORT, () => {
  console.log(`🐋 agent-proxy dashboard: http://localhost:${ADMIN_PORT}/dashboard`);
  console.log(`🐋 agent-proxy gateway:  http://localhost:${PORT}`);
});

process.on('SIGINT', async () => { await proxy.stop(); adminServer.close(); process.exit(0); });
process.on('SIGTERM', async () => { await proxy.stop(); adminServer.close(); process.exit(0); });
