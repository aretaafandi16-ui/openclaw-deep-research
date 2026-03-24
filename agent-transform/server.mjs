#!/usr/bin/env node

/**
 * agent-transform HTTP Server
 * REST API + web dashboard on port 3119
 */

import { createServer } from 'http';
import { TransformEngine } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3119');
const engine = new TransformEngine();

// ─── HTTP Server ───────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  };

  try {
    // API routes
    if (path === '/api/execute' && req.method === 'POST') {
      const body = await readBody(req);
      const { data, steps } = JSON.parse(body);
      const result = engine.execute(steps, data);
      return json(result);
    }

    if (path === '/api/map' && req.method === 'POST') {
      const body = await readBody(req);
      const { data, mapping, when } = JSON.parse(body);
      const result = engine.execute([{ type: 'map', mapping, when }], data);
      return json(result);
    }

    if (path === '/api/filter' && req.method === 'POST') {
      const body = await readBody(req);
      const { data, condition } = JSON.parse(body);
      const result = engine.execute([{ type: 'filter', condition }], data);
      return json(result);
    }

    if (path === '/api/csv/parse' && req.method === 'POST') {
      const body = await readBody(req);
      const { data, separator } = JSON.parse(body);
      const result = engine.execute([{ type: 'csv_parse', separator }], data);
      return json(result);
    }

    if (path === '/api/csv/stringify' && req.method === 'POST') {
      const body = await readBody(req);
      const { data, separator, fields } = JSON.parse(body);
      const result = engine.execute([{ type: 'csv_stringify', separator, fields }], data);
      return json(result);
    }

    if (path === '/api/validate' && req.method === 'POST') {
      const body = await readBody(req);
      const { data, rules, strict } = JSON.parse(body);
      const result = engine.execute([{ type: 'validate', rules, strict }], data);
      return json(result);
    }

    if (path === '/api/transforms' && req.method === 'GET') {
      return json(engine.listTransforms());
    }

    if (path === '/api/stats' && req.method === 'GET') {
      return json(engine.getStats());
    }

    if (path === '/health' && req.method === 'GET') {
      return json({ status: 'ok', uptime: process.uptime() });
    }

    // Dashboard
    if (path === '/' || path === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(DASHBOARD_HTML);
    }

    json({ error: 'Not found' }, 404);
  } catch (err) {
    json({ error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`agent-transform server running on http://localhost:${PORT}`);
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ─── Dashboard HTML ────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-transform Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
  h1{color:#58a6ff;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
  .card h3{color:#8b949e;font-size:12px;text-transform:uppercase;margin-bottom:8px}
  .card .val{color:#58a6ff;font-size:28px;font-weight:bold}
  textarea{width:100%;height:200px;background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:12px;font-family:monospace;font-size:13px;resize:vertical;margin-bottom:12px}
  select,input[type=text]{background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:13px;width:100%;margin-bottom:12px}
  button{background:#238636;color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:14px;cursor:pointer;margin-right:8px;margin-bottom:12px}
  button:hover{background:#2ea043}
  button.secondary{background:#30363d}
  button.secondary:hover{background:#484f58}
  pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;font-size:13px;overflow-x:auto;max-height:400px}
  .row{display:flex;gap:16px;flex-wrap:wrap}
  .col{flex:1;min-width:300px}
  .tag{display:inline-block;background:#1f6feb;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin:2px}
  label{display:block;color:#8b949e;font-size:12px;margin-bottom:4px}
  .section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px}
  .section h2{color:#58a6ff;font-size:16px;margin-bottom:12px}
  #output{white-space:pre-wrap;word-break:break-word}
  .tabs{display:flex;gap:4px;margin-bottom:12px}
  .tab{padding:8px 16px;background:#21262d;border:1px solid #30363d;border-radius:6px 6px 0 0;cursor:pointer;color:#8b949e;font-size:13px}
  .tab.active{background:#161b22;color:#58a6ff;border-bottom-color:#161b22}
  .tab-content{display:none}.tab-content.active{display:block}
</style>
</head>
<body>
<h1>🐋 agent-transform</h1>
<div class="grid" id="stats"></div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('execute')">Execute</div>
  <div class="tab" onclick="switchTab('csv')">CSV Tools</div>
  <div class="tab" onclick="switchTab('validate')">Validate</div>
  <div class="tab" onclick="switchTab('transforms')">Transforms</div>
</div>

<div id="tab-execute" class="tab-content active">
  <div class="row">
    <div class="col">
      <div class="section">
        <h2>Input Data (JSON)</h2>
        <textarea id="input" placeholder='[{"name":"Alice","age":30},{"name":"Bob","age":25}]'></textarea>
      </div>
    </div>
    <div class="col">
      <div class="section">
        <h2>Transform Steps (JSON Array)</h2>
        <textarea id="steps" placeholder='[{"type":"filter","condition":{"age":{"$gt":27}}},{"type":"sort","by":["age"]},{"type":"pick","fields":["name","age"]}]'></textarea>
      </div>
    </div>
  </div>
  <button onclick="execute()">▶ Execute</button>
  <button class="secondary" onclick="loadExample('map')">Example: Map</button>
  <button class="secondary" onclick="loadExample('filter')">Example: Filter</button>
  <button class="secondary" onclick="loadExample('aggregate')">Example: Aggregate</button>
  <button class="secondary" onclick="loadExample('csv')">Example: CSV</button>
  <div class="section" style="margin-top:12px">
    <h2>Output <span id="timing"></span></h2>
    <pre id="output">Ready. Enter data and steps, then click Execute.</pre>
  </div>
</div>

<div id="tab-csv" class="tab-content">
  <div class="row">
    <div class="col">
      <div class="section">
        <h2>CSV → JSON</h2>
        <textarea id="csvInput" placeholder="name,age,city&#10;Alice,30,NYC&#10;Bob,25,LA"></textarea>
        <input type="text" id="csvSep" placeholder="Separator (default: ,)" value=",">
        <button onclick="csvParse()">Parse CSV → JSON</button>
      </div>
    </div>
    <div class="col">
      <div class="section">
        <h2>JSON → CSV</h2>
        <textarea id="jsonInput" placeholder='[{"name":"Alice","age":30},{"name":"Bob","age":25}]'></textarea>
        <button onclick="csvStringify()">Stringify JSON → CSV</button>
      </div>
    </div>
  </div>
  <div class="section">
    <h2>Result</h2>
    <pre id="csvOutput">Ready.</pre>
  </div>
</div>

<div id="tab-validate" class="tab-content">
  <div class="row">
    <div class="col">
      <div class="section">
        <h2>Data (JSON)</h2>
        <textarea id="validateData" placeholder='[{"name":"Alice","age":30,"email":"a@b.com"}]'></textarea>
      </div>
    </div>
    <div class="col">
      <div class="section">
        <h2>Validation Rules</h2>
        <textarea id="validateRules" placeholder='{"name":{"required":true,"type":"string","minLength":2},"age":{"required":true,"type":"number","min":0,"max":150}}'></textarea>
      </div>
    </div>
  </div>
  <button onclick="validateData()">Validate</button>
  <div class="section">
    <h2>Result</h2>
    <pre id="validateOutput">Ready.</pre>
  </div>
</div>

<div id="tab-transforms" class="tab-content">
  <div class="section">
    <h2>Available Transforms</h2>
    <div id="transformList">Loading...</div>
  </div>
</div>

<script>
const API = '';
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  event.target.classList.add('active');
}
async function loadStats() {
  try {
    const r = await fetch(API+'/api/stats');
    const s = await r.json();
    document.getElementById('stats').innerHTML =
      '<div class="card"><h3>Total Runs</h3><div class="val">'+s.totalRuns+'</div></div>'+
      '<div class="card"><h3>Total Items</h3><div class="val">'+s.totalItems+'</div></div>'+
      '<div class="card"><h3>Total Errors</h3><div class="val">'+s.totalErrors+'</div></div>'+
      '<div class="card"><h3>Avg Time</h3><div class="val">'+s.avgMs+'ms</div></div>';
  } catch {}
}
async function loadTransforms() {
  try {
    const r = await fetch(API+'/api/transforms');
    const t = await r.json();
    document.getElementById('transformList').innerHTML = t.map(n => '<span class="tag">'+n+'</span>').join(' ');
  } catch {}
}
async function execute() {
  try {
    const data = JSON.parse(document.getElementById('input').value);
    const steps = JSON.parse(document.getElementById('steps').value);
    const start = Date.now();
    const r = await fetch(API+'/api/execute', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({data,steps}) });
    const result = await r.json();
    document.getElementById('output').textContent = JSON.stringify(result, null, 2);
    document.getElementById('timing').textContent = '('+result.elapsed+'ms)';
  } catch(e) {
    document.getElementById('output').textContent = 'Error: '+e.message;
  }
}
function loadExample(type) {
  const examples = {
    map: {
      input: '[{"id":1,"name":"Alice","email":"ALICE@X.COM","age":"30"},{"id":2,"name":"Bob","email":"bob@x.com","age":"25"}]',
      steps: '[{"type":"map","mapping":{"user_id":{"$source":"id"},"full_name":{"$source":"name","$transform":["trim","titleCase"]},"email":{"$source":"email","$transform":["lowercase"]},"age":{"$source":"age","$transform":["coerce_number"]}}}]'
    },
    filter: {
      input: '[{"name":"Alice","score":85,"status":"active"},{"name":"Bob","score":72,"status":"inactive"},{"name":"Charlie","score":95,"status":"active"}]',
      steps: '[{"type":"filter","condition":{"$and":[{"status":"active"},{"score":{"$gt":80}}]}},{"type":"sort","by":[{"field":"score","desc":true}]},{"type":"pick","fields":["name","score"]}]'
    },
    aggregate: {
      input: '[{"product":"A","sales":100,"region":"US"},{"product":"B","sales":200,"region":"EU"},{"product":"A","sales":150,"region":"EU"},{"product":"B","sales":80,"region":"US"}]',
      steps: '[{"type":"group","by":"product","asArray":true},{"type":"map","mapping":{"product":{"$source":"key"},"total_sales":{"$source":"items","$transform":["aggregate_transform"]},"count":{"$source":"items","$transform":["length"]}}}]'
    },
    csv: {
      input: 'name,age,city\\nAlice,30,NYC\\nBob,25,LA\\nCharlie,35,Chicago',
      steps: '[{"type":"csv_parse"},{"type":"map","mapping":{"full_name":{"$source":"name","$transform":["uppercase"]},"years":{"$source":"age"},"location":{"$source":"city"}}}]'
    }
  };
  const ex = examples[type];
  document.getElementById('input').value = ex.input;
  document.getElementById('steps').value = ex.steps;
}
async function csvParse() {
  try {
    const data = document.getElementById('csvInput').value;
    const sep = document.getElementById('csvSep').value || ',';
    const r = await fetch(API+'/api/csv/parse', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({data,separator:sep}) });
    const result = await r.json();
    document.getElementById('csvOutput').textContent = JSON.stringify(result.result, null, 2);
  } catch(e) { document.getElementById('csvOutput').textContent = 'Error: '+e.message; }
}
async function csvStringify() {
  try {
    const data = JSON.parse(document.getElementById('jsonInput').value);
    const r = await fetch(API+'/api/csv/stringify', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({data}) });
    const result = await r.json();
    document.getElementById('csvOutput').textContent = result.result;
  } catch(e) { document.getElementById('csvOutput').textContent = 'Error: '+e.message; }
}
async function validateData() {
  try {
    const data = JSON.parse(document.getElementById('validateData').value);
    const rules = JSON.parse(document.getElementById('validateRules').value);
    const r = await fetch(API+'/api/validate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({data,rules}) });
    const result = await r.json();
    document.getElementById('validateOutput').textContent = JSON.stringify(result.result, null, 2);
  } catch(e) { document.getElementById('validateOutput').textContent = 'Error: '+e.message; }
}
loadStats(); loadTransforms();
setInterval(loadStats, 5000);
</script>
</body>
</html>`;

export { server, engine };
