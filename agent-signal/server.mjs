#!/usr/bin/env node
/**
 * agent-signal HTTP Server with dark-theme dashboard
 */

import { createServer } from 'http';
import { SignalEngine, signalMetrics, sma, ema, findPeaks, findValleys, detectAnomaliesZScore, detectChangePointsCUSUM, pearsonCorrelation, dominantFrequency } from './index.mjs';

const PORT = parseInt(process.env.PORT) || 3145;
const engine = new SignalEngine();

// ── API handlers ──

const apiRoutes = {
  'POST /api/signals': async (req) => {
    const { name, values } = await readBody(req);
    if (!name || !values) throw new Error('name and values required');
    return { added: engine.add(name, values), total: engine.get(name).length };
  },
  'GET /api/signals': () => ({ signals: engine.list().map(n => ({ name: n, length: engine.get(n).length })) }),
  'GET /api/metrics': (req) => {
    const name = new URL(req.url, 'http://x').searchParams.get('name');
    if (!name) throw new Error('name required');
    return signalMetrics(engine.get(name));
  },
  'GET /api/sma': (req) => {
    const u = new URL(req.url, 'http://x');
    const name = u.searchParams.get('name');
    const period = Number(u.searchParams.get('period')) || 20;
    return sma(engine.get(name), period).filter(v => v !== null);
  },
  'GET /api/ema': (req) => {
    const u = new URL(req.url, 'http://x');
    const name = u.searchParams.get('name');
    const period = Number(u.searchParams.get('period')) || 20;
    return ema(engine.get(name), period).filter(v => v !== null);
  },
  'GET /api/peaks': (req) => {
    const u = new URL(req.url, 'http://x');
    return findPeaks(engine.get(u.searchParams.get('name')), {
      minProminence: Number(u.searchParams.get('prominence')) || 0,
    });
  },
  'GET /api/anomalies': (req) => {
    const u = new URL(req.url, 'http://x');
    return detectAnomaliesZScore(engine.get(u.searchParams.get('name')),
      Number(u.searchParams.get('threshold')) || 3,
      Number(u.searchParams.get('window')) || 20);
  },
  'GET /api/changepoints': (req) => {
    const u = new URL(req.url, 'http://x');
    return detectChangePointsCUSUM(engine.get(u.searchParams.get('name')), {
      threshold: Number(u.searchParams.get('threshold')) || 4,
    });
  },
  'GET /api/spectrum': (req) => {
    const u = new URL(req.url, 'http://x');
    const name = u.searchParams.get('name');
    return { dominant: dominantFrequency(engine.get(name)), stats: engine.stats };
  },
  'GET /api/stats': () => engine.stats,
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Dashboard HTML ──

function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-signal Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.header{background:#161b22;padding:16px 24px;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:12px}
.header h1{font-size:20px;color:#58a6ff}
.header .stats{margin-left:auto;display:flex;gap:20px;font-size:13px;color:#8b949e}
.header .stats b{color:#c9d1d9}
.container{max-width:1200px;margin:0 auto;padding:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{font-size:12px;color:#8b949e;text-transform:uppercase;margin-bottom:8px}
.card .value{font-size:28px;font-weight:700;color:#58a6ff}
.card .sub{font-size:12px;color:#8b949e;margin-top:4px}
.section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;margin-bottom:24px}
.section h2{font-size:16px;color:#58a6ff;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d;font-size:13px}
th{color:#8b949e;font-weight:600}
.signal-row td:first-child{color:#58a6ff;font-weight:600}
input,select,button{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:8px 12px;border-radius:6px;font-size:13px}
button{background:#238636;border-color:#238636;cursor:pointer;font-weight:600}
button:hover{background:#2ea043}
.form-row{display:flex;gap:8px;margin-bottom:16px;flex-wrap:align-items}
.form-row input[type=text]{flex:1;min-width:200px}
.form-row input[type=number]{width:80px}
textarea{width:100%;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:12px;border-radius:6px;font-family:monospace;font-size:13px;resize:vertical;min-height:80px}
#result{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:16px;font-family:monospace;font-size:13px;white-space:pre-wrap;max-height:400px;overflow-y:auto;margin-top:12px;display:none}
.chart-container{position:relative;height:200px;margin:16px 0}
canvas{width:100%!important;height:100%!important}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head><body>
<div class="header">
  <h1>🐋 agent-signal</h1>
  <div class="stats">
    <span>Processed: <b id="s-processed">0</b></span>
    <span>Anomalies: <b id="s-anomalies">0</b></span>
    <span>Change Points: <b id="s-changes">0</b></span>
  </div>
</div>
<div class="container">
  <div class="grid">
    <div class="card"><h3>Signals</h3><div class="value" id="c-signals">0</div></div>
    <div class="card"><h3>Data Points</h3><div class="value" id="c-points">0</div></div>
    <div class="card"><h3>Anomalies Found</h3><div class="value" id="c-anomalies">0</div></div>
    <div class="card"><h3>Change Points</h3><div class="value" id="c-changes">0</div></div>
  </div>

  <div class="section">
    <h2>📡 Add Signal Data</h2>
    <div class="form-row">
      <input type="text" id="sig-name" placeholder="signal name (e.g. temperature)">
      <textarea id="sig-values" placeholder="comma-separated values: 1.2, 3.4, 5.6, ..." rows="2"></textarea>
    </div>
    <button onclick="addSignal()">Add Data</button>
  </div>

  <div class="section">
    <h2>📊 Analyze</h2>
    <div class="form-row">
      <select id="a-signal"></select>
      <select id="a-action">
        <option value="metrics">Metrics</option>
        <option value="sma">SMA</option>
        <option value="ema">EMA</option>
        <option value="peaks">Peaks</option>
        <option value="anomalies">Anomalies</option>
        <option value="changepoints">Change Points</option>
        <option value="spectrum">Spectrum</option>
      </select>
      <input type="number" id="a-param" placeholder="period/threshold" value="20">
      <button onclick="analyze()">Run</button>
    </div>
    <div id="result"></div>
    <div class="chart-container"><canvas id="chart"></canvas></div>
  </div>

  <div class="section">
    <h2>📋 Signals</h2>
    <table><thead><tr><th>Name</th><th>Points</th></tr></thead><tbody id="signals-table"></tbody></table>
  </div>
</div>

<script>
let chart = null;
async function refresh() {
  const [signals, stats] = await Promise.all([fetch('/api/signals').then(r=>r.json()), fetch('/api/stats').then(r=>r.json())]);
  document.getElementById('c-signals').textContent = signals.signals.length;
  document.getElementById('c-points').textContent = signals.signals.reduce((s,x)=>s+x.length,0);
  document.getElementById('c-anomalies').textContent = stats.anomaliesDetected;
  document.getElementById('c-changes').textContent = stats.changePoints;
  document.getElementById('s-processed').textContent = stats.processed;
  document.getElementById('s-anomalies').textContent = stats.anomaliesDetected;
  document.getElementById('s-changes').textContent = stats.changePoints;
  const sel = document.getElementById('a-signal');
  sel.innerHTML = signals.signals.map(s=>'<option value="'+s.name+'">'+s.name+' ('+s.length+')</option>').join('');
  document.getElementById('signals-table').innerHTML = signals.signals.map(s=>'<tr class="signal-row"><td>'+s.name+'</td><td>'+s.length+'</td></tr>').join('');
}
async function addSignal() {
  const name = document.getElementById('sig-name').value.trim();
  const values = document.getElementById('sig-values').value.split(',').map(Number).filter(v=>!isNaN(v));
  if (!name || !values.length) return alert('Need name and values');
  await fetch('/api/signals', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,values}) });
  document.getElementById('sig-name').value = '';
  document.getElementById('sig-values').value = '';
  refresh();
}
async function analyze() {
  const name = document.getElementById('a-signal').value;
  const action = document.getElementById('a-action').value;
  const param = document.getElementById('a-param').value;
  if (!name) return;
  let url = '/api/'+action+'?name='+encodeURIComponent(name);
  if (['sma','ema'].includes(action)) url += '&period='+param;
  if (action === 'anomalies') url += '&threshold='+param;
  if (action === 'changepoints') url += '&threshold='+param;
  if (action === 'peaks') url += '&prominence='+param;
  const res = await fetch(url).then(r=>r.json());
  const el = document.getElementById('result');
  el.style.display = 'block';
  el.textContent = JSON.stringify(res, null, 2);
  // Chart
  if (chart) chart.destroy();
  const signals = await fetch('/api/signals').then(r=>r.json());
  const sig = signals.signals.find(s=>s.name===name);
  if (sig) {
    const data = await fetch('/api/metrics?name='+encodeURIComponent(name)).then(r=>r.json());
    // Just show the raw data as a simple line chart via the metrics
    chart = new Chart(document.getElementById('chart'), {
      type: 'line',
      data: { labels: Array.from({length:1}, (_,i)=>''), datasets: [{
        label: name + ' (' + action + ')',
        data: Array.isArray(res) ? res.slice(0,200).map((v,i)=>typeof v==='number'?v:v?.value||v?.correlation||0) : [],
        borderColor: '#58a6ff', borderWidth: 1, pointRadius: 0, tension: 0.3,
      }]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{labels:{color:'#c9d1d9'}}}, scales:{x:{ticks:{color:'#8b949e'},grid:{color:'#21262d'}},y:{ticks:{color:'#8b949e'},grid:{color:'#21262d'}}} }
    });
  }
}
refresh(); setInterval(refresh, 5000);
</script></body></html>`;
}

// ── HTTP Server ──

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const routeKey = req.method + ' ' + url.pathname;

  try {
    if (routeKey === 'GET /' || routeKey === 'GET /dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(dashboardHTML());
    }
    const handler = apiRoutes[routeKey];
    if (handler) {
      const result = await handler(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`🐋 agent-signal dashboard: http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/signals`);
});
