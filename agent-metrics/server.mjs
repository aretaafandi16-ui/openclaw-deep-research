#!/usr/bin/env node
// agent-metrics HTTP server + dark-theme web dashboard
import { createServer } from 'node:http';
import { MetricsStore } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3114');
const store = new MetricsStore({ persistDir: process.env.PERSIST_DIR || './data' });

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

const dashboardHTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-metrics dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh}
.header{background:#161b22;padding:16px 24px;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:12px}
.header h1{font-size:20px;color:#58a6ff}
.header .tag{background:#238636;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px}
.container{max-width:1400px;margin:0 auto;padding:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{font-size:12px;color:#8b949e;text-transform:uppercase;margin-bottom:8px}
.card .val{font-size:28px;font-weight:700;color:#58a6ff}
.card .sub{font-size:12px;color:#8b949e;margin-top:4px}
.section{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:24px;overflow:hidden}
.section h2{padding:12px 16px;background:#21262d;border-bottom:1px solid #30363d;font-size:14px;color:#c9d1d9}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 16px;text-align:left;border-bottom:1px solid #21262d;font-size:13px}
th{color:#8b949e;font-weight:600;font-size:11px;text-transform:uppercase}
td.mono{font-family:monospace}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge-counter{background:#1f6feb33;color:#58a6ff}
.badge-gauge{background:#23863633;color:#3fb950}
.badge-histogram{background:#9e6a0333;color:#d29922}
.badge-timer{background:#8957e533;color:#bc8cff}
.refresh{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px}
.auto{color:#3fb950;font-size:12px;margin-left:8px}
.histogram-bars{display:flex;align-items:flex-end;gap:2px;height:60px;margin-top:8px}
.bar{flex:1;background:#1f6feb;border-radius:2px 2px 0 0;min-width:4px;transition:height .3s}
.bar-label{font-size:9px;color:#8b949e;text-align:center;margin-top:2px}
</style></head><body>
<div class="header"><h1>📊 agent-metrics</h1><span class="tag">LIVE</span>
<button class="refresh" onclick="load()">↻ Refresh</button><span class="auto" id="auto">auto: 5s</span></div>
<div class="container">
<div class="cards" id="cards"></div>
<div class="section"><h2>All Metrics</h2>
<table><thead><tr><th>Name</th><th>Type</th><th>Value / Stats</th><th>Tags</th></tr></thead><tbody id="tbody"></tbody></table>
</div>
</div>
<script>
async function load(){
  const d=await(await fetch('/api/snapshot')).json();
  const entries=Object.entries(d);
  let counters=0,gauges=0,histograms=0,timers=0;
  entries.forEach(([,m])=>{if(m.type==='counter')counters++;if(m.type==='gauge')gauges++;if(m.type==='histogram')histograms++;if(m.type==='timer')timers++;});
  document.getElementById('cards').innerHTML=
    '<div class="card"><h3>Total Metrics</h3><div class="val">'+entries.length+'</div></div>'+
    '<div class="card"><h3>Counters</h3><div class="val">'+counters+'</div></div>'+
    '<div class="card"><h3>Gauges</h3><div class="val">'+gauges+'</div></div>'+
    '<div class="card"><h3>Histograms</h3><div class="val">'+histograms+'</div></div>'+
    '<div class="card"><h3>Timers</h3><div class="val">'+timers+'</div></div>';
  const tbody=document.getElementById('tbody');
  tbody.innerHTML=entries.map(([key,m])=>{
    const cls='badge badge-'+m.type;
    let val='';
    if(m.type==='counter'||m.type==='gauge') val='Value: <b>'+m.value+'</b>';
    else if(m.type==='histogram'||m.type==='timer'){
      val='Count: '+m.count+' | Mean: '+(m.mean||0).toFixed(2)+' | P50: '+(m.p50||0).toFixed(2)+' | P95: '+(m.p95||0).toFixed(2)+' | P99: '+(m.p99||0).toFixed(2);
    } else if(m.type==='rate') val='Value: '+m.value+' | Rate: '+(m.rate_per_sec||0).toFixed(2)+'/s';
    const tags=m.tags?Object.entries(m.tags).map(([k,v])=>k+'='+v).join(', '):'';
    return '<tr><td class="mono">'+(m.name||key)+'</td><td><span class="'+cls+'">'+m.type+'</span></td><td class="mono">'+val+'</td><td class="mono">'+tags+'</td></tr>';
  }).join('');
}
load();setInterval(load,5000);
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(dashboardHTML); return;
  }
  if (url.pathname === '/api/snapshot') { json(res, store.snapshot()); return; }
  if (url.pathname === '/api/list') { json(res, store.list()); return; }
  if (url.pathname === '/api/prometheus') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(store.prometheus()); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/record') {
    const body = await parseBody(req);
    const { type, name, value, tags } = body;
    if (!type || !name) return json(res, { error: 'type and name required' }, 400);
    if (type === 'counter') store.counter(name, tags || {}).inc(value || 1);
    else if (type === 'gauge') store.gauge(name, tags || {}).set(value ?? 0);
    else if (type === 'histogram') store.histogram(name, tags || {}).observe(value ?? 0);
    else if (type === 'timer') store.timer(name, tags || {}).record(value ?? 0);
    else return json(res, { error: 'unknown type' }, 400);
    json(res, { ok: true }); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/reset') { store.clear(); json(res, { ok: true }); return; }
  json(res, { error: 'not found' }, 404);
});

server.listen(PORT, () => console.log(`📊 agent-metrics dashboard → http://localhost:${PORT}/dashboard`));
process.on('SIGINT', () => { store.close(); process.exit(0); });
process.on('SIGTERM', () => { store.close(); process.exit(0); });
