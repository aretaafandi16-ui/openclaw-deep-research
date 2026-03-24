/**
 * agent-rate HTTP Server — REST API + dark-theme web dashboard
 */
import { createServer } from 'http';
import { AgentRate } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3126');

const rate = new AgentRate({ persistenceFile: process.env.PERSISTENCE || './data/rate.jsonl' });
rate.addLimiter('default', { strategy: 'fixed_window', limit: 100, windowMs: 60000 });
rate.addLimiter('strict', { strategy: 'sliding_window_log', limit: 20, windowMs: 60000 });
rate.addLimiter('api', { strategy: 'token_bucket', limit: 50, windowMs: 60000, burst: 10 });

// Track recent checks for dashboard
const recentChecks = [];
const MAX_RECENT = 200;
rate.on('check', (info) => {
  recentChecks.unshift(info);
  if (recentChecks.length > MAX_RECENT) recentChecks.length = MAX_RECENT;
});

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/') return json(res, { service: 'agent-rate', limiters: rate.listLimiters() });
  if (p === '/api/stats') return json(res, rate.getStats());
  if (p === '/api/check') {
    const key = url.searchParams.get('key') || 'test';
    const limiter = url.searchParams.get('limiter') || 'default';
    return json(res, rate.check(key, limiter));
  }
  if (p === '/api/reset') {
    const key = url.searchParams.get('key');
    const limiter = url.searchParams.get('limiter') || 'default';
    if (key) rate.reset(key, limiter);
    else rate.resetAll(limiter);
    return json(res, { ok: true });
  }
  if (p === '/api/limiters') return json(res, rate.listLimiters());
  if (p === '/api/recent') return json(res, recentChecks.slice(0, parseInt(url.searchParams.get('limit') || '50')));
  if (p === '/api/state') {
    const limiter = url.searchParams.get('limiter') || 'default';
    return json(res, rate.getState(limiter));
  }
  if (p === '/api/limiter/add' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const opts = JSON.parse(body);
        const name = opts.name || `limiter_${Date.now()}`;
        delete opts.name;
        rate.addLimiter(name, opts);
        json(res, { ok: true, name });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }
  if (p === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
    return;
  }
  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, () => console.log(`agent-rate dashboard: http://localhost:${PORT}/dashboard`));

const DASHBOARD_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>agent-rate</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0d1117;color:#c9d1d9;font-family:system-ui;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}h2{color:#8b949e;margin:16px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:1px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase;letter-spacing:1px}
.card .value{color:#58a6ff;font-size:28px;font-weight:700;margin-top:4px}
.card .sub{color:#8b949e;font-size:12px;margin-top:2px}
.pass{color:#3fb950}.fail{color:#f85149}table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}td{font-size:13px}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.badge.ok{background:#238636;color:#fff}.badge.blocked{background:#da3633;color:#fff}
.badge.strat{background:#1f6feb;color:#fff}
form{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
input,select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:13px}
button{background:#238636;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px}
button:hover{background:#2ea043}
</style></head><body>
<h1>🐋 agent-rate</h1>
<div class="grid" id="stats"></div>
<h2>Limiters</h2>
<div class="card"><table><thead><tr><th>Name</th><th>Strategy</th><th>Limit</th><th>Window</th><th>Active Keys</th></tr></thead><tbody id="limiters"></tbody></table></div>
<h2>Test Rate Limit</h2>
<div class="card"><form id="testForm">
<input id="tKey" placeholder="Key" value="test-user">
<select id="tLimiter"></select>
<button type="submit">Check</button>
<span id="testResult"></span>
</form></div>
<h2>Recent Checks</h2>
<div class="card"><table><thead><tr><th>Time</th><th>Key</th><th>Limiter</th><th>Strategy</th><th>Result</th><th>Remaining</th></tr></thead><tbody id="recent"></tbody></table></div>
<h2>Add Limiter</h2>
<div class="card"><form id="addForm">
<input id="aName" placeholder="Name" required>
<select id="aStrategy"><option value="fixed_window">Fixed Window</option><option value="sliding_window_log">Sliding Window Log</option><option value="sliding_window_counter">Sliding Window Counter</option><option value="token_bucket">Token Bucket</option><option value="leaky_bucket">Leaky Bucket</option></select>
<input id="aLimit" type="number" placeholder="Limit" value="100" style="width:80px">
<input id="aWindow" type="number" placeholder="Window ms" value="60000" style="width:100px">
<button type="submit">Add</button>
</form></div>
<script>
async function load(){
  const s=await(await fetch('/api/stats')).json();
  document.getElementById('stats').innerHTML=\`
    <div class="card"><div class="label">Total Checks</div><div class="value">\${s.global.totalChecks}</div></div>
    <div class="card"><div class="label">Allowed</div><div class="value pass">\${s.global.allowed}</div></div>
    <div class="card"><div class="label">Rejected</div><div class="value fail">\${s.global.rejected}</div></div>
    <div class="card"><div class="label">Accept Rate</div><div class="value">\${s.global.totalChecks?((s.global.allowed/s.global.totalChecks)*100).toFixed(1):'100.0'}%</div></div>\`;
  const ls=await(await fetch('/api/limiters')).json();
  document.getElementById('limiters').innerHTML=ls.map(l=>\`<tr><td><strong>\${l.name}</strong></td><td><span class="badge strat">\${l.type}</span></td><td>\${l.limit}</td><td>\${(l.windowMs/1000).toFixed(0)}s</td><td>\${l.activeKeys}</td></tr>\`).join('');
  const sel=document.getElementById('tLimiter');sel.innerHTML=ls.map(l=>\`<option>\${l.name}\</option>\`).join('');
  const r=await(await fetch('/api/recent?limit=30')).json();
  document.getElementById('recent').innerHTML=r.map(c=>\`<tr><td>\${new Date(c.ts||Date.now()).toLocaleTimeString()}</td><td>\${c.key}</td><td>\${c.limiter}</td><td><span class="badge strat">\${c.strategy}</span></td><td><span class="badge \${c.allowed?'ok':'blocked'}">\${c.allowed?'OK':'BLOCKED'}</span></td><td>\${c.remaining}</td></tr>\`).join('');
}
document.getElementById('testForm').onsubmit=async e=>{e.preventDefault();
  const r=await(await fetch('/api/check?key='+tKey.value+'&limiter='+tLimiter.value)).json();
  testResult.innerHTML=\`<span class="badge \${r.allowed?'ok':'blocked'}">\${r.allowed?'Allowed':'Blocked'} — \${r.remaining}/\${r.limit} remaining\</span>\`;load();};
document.getElementById('addForm').onsubmit=async e=>{e.preventDefault();
  await fetch('/api/limiter/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:aName.value,strategy:aStrategy.value,limit:+aLimit.value,windowMs:+aWindow.value})});load();};
load();setInterval(load,3000);
</script></body></html>`;
