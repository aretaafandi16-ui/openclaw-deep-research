// agent-diag HTTP server — dark-theme web dashboard + REST API
import { createServer } from 'node:http';
import { AgentDiag, Status, Severity, presets } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3137');
const diag = new AgentDiag();
const alertEngine = new (await import('./index.mjs')).AlertEngine();

// Register default system checks
diag.register(presets.memoryUsage(95));
diag.register(presets.diskUsage('/'));

const json = (res, data, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
};
const parse = async req => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
};

const routes = {
  'GET /api/status': () => diag.getStatus(),
  'GET /api/checks': () => diag.listChecks(),
  'POST /api/checks/run': async () => ({ results: await diag.runAll() }),
  'GET /api/system': () => diag.collectSystem(),
  'GET /api/history': (req) => {
    const u = new URL(req.url, 'http://localhost');
    const limit = parseInt(u.searchParams.get('limit') || '100');
    const name = u.searchParams.get('name');
    const category = u.searchParams.get('category');
    return diag.getHistory({ name, category, limit });
  },
  'GET /api/alerts': () => alertEngine.toJSON(),
};

const handler = async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const path = `${req.method} ${u.pathname}`;
  if (req.method === 'OPTIONS') return json(res, { ok: true });

  if (routes[path]) {
    try { return json(res, await routes[path](req)); } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // Dashboard HTML
  if (path === 'GET /' || path === 'GET /dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
    return;
  }
  json(res, { error: 'Not found' }, 404);
};

createServer(handler).listen(PORT, () => console.log(`agent-diag dashboard: http://localhost:${PORT}`));

const DASHBOARD_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>agent-diag</title><style>
*{box-sizing:border-box;margin:0}body{background:#0d1117;color:#c9d1d9;font-family:system-ui;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}h2{color:#8b949e;margin:20px 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:1px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
.card .label{font-size:11px;color:#8b949e;text-transform:uppercase}.card .value{font-size:24px;font-weight:700;margin-top:4px}
.healthy{color:#3fb950}.degraded{color:#d29922}.unhealthy{color:#f85149}.unknown{color:#8b949e}
table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}tr:hover{background:#161b22}
.btn{background:#238636;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px}
.btn:hover{background:#2ea043}
.sys{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.sys-item{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px}
.sys-item .key{font-size:11px;color:#8b949e;text-transform:uppercase}.sys-item .val{font-size:16px;font-weight:600;margin-top:2px}
</style></head><body>
<h1>🐋 agent-diag</h1>
<div id="app">Loading...</div>
<script>
async function load(){
  const [status,checks,system]=await Promise.all([
    fetch('/api/status').then(r=>r.json()),
    fetch('/api/checks').then(r=>r.json()),
    fetch('/api/system').then(r=>r.json()),
  ]);
  const s=status;
  document.getElementById('app').innerHTML=\`
  <div class="cards">
    <div class="card"><div class="label">Overall</div><div class="value \${s.overall}">\${s.overall}</div></div>
    <div class="card"><div class="label">Checks</div><div class="value">\${s.totalChecks}</div></div>
    <div class="card"><div class="label">Running</div><div class="value">\${s.running?'🟢 Yes':'🔴 No'}</div></div>
    <div class="card"><div class="label">Memory</div><div class="value">\${system.memory.percent}%</div></div>
  </div>
  <button class="btn" onclick="runAll()">▶ Run All Checks</button>
  <h2>Checks</h2>
  <table><tr><th>Name</th><th>Category</th><th>Status</th><th>Interval</th><th>Tags</th></tr>
  \${checks.map(c=>\`<tr><td>\${c.name}</td><td>\${c.category}</td><td class="\${c.status}">\${c.status}</td><td>\${c.intervalMs/1000}s</td><td>\${(c.tags||[]).join(', ')}</td></tr>\`).join('')}
  </table>
  <h2>System</h2>
  <div class="sys">
    <div class="sys-item"><div class="key">Platform</div><div class="val">\${system.platform} \${system.arch}</div></div>
    <div class="sys-item"><div class="key">CPUs</div><div class="val">\${system.cpus.count} × \${(system.cpus.model||'').slice(0,30)}</div></div>
    <div class="sys-item"><div class="key">Load Avg</div><div class="val">\${system.cpus.load1.toFixed(2)} / \${system.cpus.load5.toFixed(2)} / \${system.cpus.load15.toFixed(2)}</div></div>
    <div class="sys-item"><div class="key">Memory</div><div class="val">\${(system.memory.used/1e9).toFixed(1)}G / \${(system.memory.total/1e9).toFixed(1)}G (\${system.memory.percent}%)</div></div>
    <div class="sys-item"><div class="key">Node</div><div class="val">\${system.process.version}</div></div>
    <div class="sys-item"><div class="key">Uptime</div><div class="val">\${Math.floor(system.uptime/3600)}h \${Math.floor((system.uptime%3600)/60)}m</div></div>
    <div class="sys-item"><div class="key">Heap Used</div><div class="val">\${(system.process.memoryUsage.heapUsed/1e6).toFixed(1)} MB</div></div>
    <div class="sys-item"><div class="key">RSS</div><div class="val">\${(system.process.memoryUsage.rss/1e6).toFixed(1)} MB</div></div>
  </div>\`;
}
async function runAll(){await fetch('/api/checks/run',{method:'POST'});load();}
load();setInterval(load,5000);
</script></body></html>`;
