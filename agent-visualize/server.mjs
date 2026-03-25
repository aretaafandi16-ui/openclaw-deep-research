#!/usr/bin/env node
/**
 * agent-visualize HTTP Server — REST API + web dashboard (port 3140)
 */

import { createServer } from 'node:http';
import { VisualizeEngine, PALETTES } from './index.mjs';

const PORT = +process.env.PORT || 3140;
const engine = new VisualizeEngine({ palette: 'vivid' });

// ─── REST API ──────────────────────────────────────────────────────────────

function chartHandler(type, req, body) {
  return new Promise((resolve, reject) => {
    try {
      const args = JSON.parse(body || '{}');
      const eng = new VisualizeEngine({
        width: args.width || 800,
        height: args.height || 500,
        palette: args.palette || 'vivid',
        bg: args.bg || '#ffffff',
      });
      let svg;
      switch (type) {
        case 'bar':
          svg = eng.bar(args.data || [], { title: args.title, horizontal: args.horizontal, showValues: args.showValues });
          break;
        case 'line':
          svg = eng.line(args.datasets || [], { title: args.title, labels: args.labels, area: args.area, dots: args.dots });
          break;
        case 'pie':
          svg = eng.pie(args.data || [], { title: args.title });
          break;
        case 'donut':
          svg = eng.donut(args.data || [], { title: args.title, centerLabel: args.centerLabel, centerValue: args.centerValue });
          break;
        case 'scatter':
          svg = eng.scatter(args.datasets || [], { title: args.title });
          break;
        case 'sparkline':
          svg = eng.sparkline(args.data || [], { width: args.width || 300, height: args.height || 60, color: args.color, dots: args.dots, showLast: args.showLast });
          break;
        case 'heatmap':
          svg = eng.heatmap(args.matrix || [], { title: args.title, rowLabels: args.rowLabels, colLabels: args.colLabels });
          break;
        case 'gauge':
          svg = eng.gauge(args.value ?? 0, { title: args.title, min: args.min, max: args.max, unit: args.unit, label: args.label });
          break;
        case 'radar':
          svg = eng.radar(args.datasets || [], { title: args.title, labels: args.labels, dots: args.dots });
          break;
        case 'kpi':
          svg = eng.kpi(args.items || [], { title: args.title });
          break;
        case 'table':
          svg = eng.table(args.columns || [], args.rows || [], { title: args.title });
          break;
        case 'area':
          svg = eng.areaStacked(args.datasets || [], { title: args.title, labels: args.labels });
          break;
        default:
          return reject(new Error(`Unknown chart type: ${type}`));
      }
      resolve(svg);
    } catch (e) { reject(e); }
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function svg(res, svgStr) {
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*' });
  res.end(svgStr);
}

function html(res, htmlStr) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(htmlStr);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  try {
    // API endpoints: POST /api/:type
    if (req.method === 'POST' && path.startsWith('/api/')) {
      const type = path.slice(5);
      const body = await readBody(req);
      const svgStr = await chartHandler(type, req, body);
      if ((JSON.parse(body || '{}')).format === 'svg') return svg(res, svgStr);
      return json(res, { svg: svgStr, chartType: type });
    }

    // GET /api/palettes
    if (path === '/api/palettes') return json(res, Object.keys(PALETTES));

    // GET /api/types
    if (path === '/api/types') return json(res, ['bar', 'line', 'pie', 'donut', 'scatter', 'sparkline', 'heatmap', 'gauge', 'radar', 'kpi', 'table', 'area']);

    // GET /api/stats
    if (path === '/api/stats') return json(res, { charts: engine.list(), palettes: Object.keys(PALETTES) });

    // Dashboard
    if (path === '/' || path === '/dashboard') return html(res, DASHBOARD_HTML);

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.error(`agent-visualize server running at http://localhost:${PORT}`);
});

// ─── Dashboard HTML ────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-visualize dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e0e0e0;padding:20px}
h1{font-size:24px;margin-bottom:20px;color:#fff}
h2{font-size:16px;color:#aaa;margin-bottom:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px;margin-bottom:30px}
.card{background:#1a1d27;border-radius:10px;padding:16px;border:1px solid #2a2d37}
.card svg{width:100%;height:auto;border-radius:6px}
.stats{display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.stat{background:#1a1d27;border-radius:8px;padding:16px 24px;border:1px solid #2a2d37;min-width:140px}
.stat .value{font-size:28px;font-weight:700;color:#4e79a7}
.stat .label{font-size:12px;color:#888;margin-top:4px}
.api-test{background:#1a1d27;border-radius:10px;padding:16px;border:1px solid #2a2d37;margin-bottom:20px}
select,input,button,textarea{background:#252830;border:1px solid #3a3d47;color:#e0e0e0;padding:8px 12px;border-radius:6px;font-family:inherit;font-size:13px}
button{background:#4e79a7;border:none;cursor:pointer;padding:8px 16px}
button:hover{background:#3a6590}
textarea{width:100%;height:120px;resize:vertical;font-family:monospace;font-size:12px}
.output{margin-top:10px;background:#0d0f14;border-radius:6px;padding:12px;overflow:auto}
.output svg{max-width:100%}
</style></head><body>
<h1>🐋 agent-visualize dashboard</h1>
<div class="stats" id="stats"></div>
<div class="api-test">
  <h2>Chart Generator</h2>
  <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">
    <select id="chartType" onchange="loadExample()">
      <option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option>
      <option value="donut">Donut</option><option value="scatter">Scatter</option><option value="sparkline">Sparkline</option>
      <option value="heatmap">Heatmap</option><option value="gauge">Gauge</option><option value="radar">Radar</option>
      <option value="kpi">KPI</option><option value="area">Stacked Area</option>
    </select>
    <select id="palette"><option value="default">Default</option><option value="vivid">Vivid</option>
      <option value="pastel">Pastel</option><option value="dark">Dark</option><option value="mono">Mono</option></select>
    <button onclick="generate()">Generate ▶</button>
    <button onclick="downloadSVG()">Download SVG ⬇</button>
  </div>
  <textarea id="jsonInput"></textarea>
  <div class="output" id="output"></div>
</div>
<div class="grid" id="examples"></div>
<script>
const examples = {
  bar: { data:[{label:'Q1',value:42},{label:'Q2',value:58},{label:'Q3',value:71},{label:'Q4',value:63}], title:'Quarterly Revenue ($K)', showValues:true },
  line: { datasets:[{label:'Users',data:[100,150,200,180,250,310]},{label:'Sessions',data:[200,280,350,300,420,500]}], title:'Growth', dots:true, area:true, labels:['Mon','Tue','Wed','Thu','Fri','Sat'] },
  pie: { data:[{label:'Chrome',value:65},{label:'Firefox',value:15},{label:'Safari',value:12},{label:'Edge',value:8}], title:'Browser Share' },
  donut: { data:[{label:'API',value:40},{label:'Web',value:35},{label:'Mobile',value:25}], title:'Traffic', centerLabel:'Total', centerValue:'100%' },
  scatter: { datasets:[{label:'Group A',data:[{x:1,y:2},{x:3,y:5},{x:5,y:3},{x:7,y:8}]},{label:'Group B',data:[{x:2,y:6},{x:4,y:3},{x:6,y:7},{x:8,y:4}]}] },
  sparkline: { data:[12,15,13,18,22,19,25,28,24,30,27,32], width:400, height:80, color:'#27ae60', showLast:true },
  heatmap: { matrix:[[30,45,60,20,80,90,50],[20,55,70,30,60,85,40],[40,35,50,45,70,75,60],[50,60,40,55,80,65,70],[35,40,55,65,75,50,45]], title:'Activity Heatmap', rowLabels:['Mon','Tue','Wed','Thu','Fri'], colLabels:['8am','10am','12pm','2pm','4pm','6pm','8pm'] },
  gauge: { value:73, title:'CPU Usage', unit:'%', min:0, max:100, label:'System Load' },
  radar: { datasets:[{label:'Current',data:[80,90,60,70,85]},{label:'Target',data:[90,85,80,85,90]}], title:'Performance', labels:['Speed','Accuracy','Coverage','Latency','Throughput'], dots:true },
  kpi: { items:[{label:'Revenue',value:'$42.5K',change:12.3,color:'#27ae60'},{label:'Users',value:'8,432',change:5.7,color:'#3498db'},{label:'Uptime',value:'99.9%',change:0.1,color:'#27ae60'},{label:'Errors',value:'23',change:-18.2,color:'#e74c3c'}], title:'System Overview' },
  area: { datasets:[{label:'API',data:[10,20,15,25,18]},{label:'Web',data:[5,10,8,12,15]},{label:'Mobile',data:[3,7,5,8,10]}], title:'Traffic by Channel', labels:['Mon','Tue','Wed','Thu','Fri'] },
};

function loadExample() {
  const t = document.getElementById('chartType').value;
  document.getElementById('jsonInput').value = JSON.stringify(examples[t] || {}, null, 2);
}
loadExample();

async function generate() {
  const type = document.getElementById('chartType').value;
  const palette = document.getElementById('palette').value;
  let args;
  try { args = JSON.parse(document.getElementById('jsonInput').value); } catch(e) { alert('Invalid JSON'); return; }
  args.palette = palette;
  const res = await fetch('/api/' + type, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(args) });
  const data = await res.json();
  if (data.svg) document.getElementById('output').innerHTML = data.svg;
  else document.getElementById('output').textContent = JSON.stringify(data, null, 2);
}

function downloadSVG() {
  const svg = document.querySelector('#output svg');
  if (!svg) return alert('Generate a chart first');
  const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'chart.svg';
  a.click();
}

async function loadDashboard() {
  const grid = document.getElementById('examples');
  const types = ['bar','line','pie','donut','gauge','radar','heatmap','sparkline','kpi','area'];
  for (const type of types) {
    if (!examples[type]) continue;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h2 style="margin-bottom:8px;text-transform:capitalize">' + type + '</h2><div class="chart-placeholder" data-type="' + type + '"></div>';
    grid.appendChild(card);
    try {
      const args = { ...examples[type], palette: 'vivid', width: 400, height: 280 };
      const res = await fetch('/api/' + type, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(args) });
      const data = await res.json();
      card.querySelector('.chart-placeholder').innerHTML = data.svg || '';
    } catch(e) {}
  }
}

loadDashboard();
setInterval(() => fetch('/api/stats').then(r=>r.json()).then(d => {
  document.getElementById('stats').innerHTML = '<div class="stat"><div class="value">' + (d.charts?.length||0) + '</div><div class="label">Charts</div></div>' +
    '<div class="stat"><div class="value">' + (d.palettes?.length||0) + '</div><div class="label">Palettes</div></div>' +
    '<div class="stat"><div class="value">' + types.length + '</div><div class="label">Chart Types</div></div>';
}), 10000);
const types = ['bar','line','pie','donut','scatter','sparkline','heatmap','gauge','radar','kpi','table','area'];
</script></body></html>`;
