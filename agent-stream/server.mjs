#!/usr/bin/env node
/**
 * agent-stream HTTP Server — REST API + Web Dashboard
 */

import { createServer } from 'http';
import { StreamEngine, Aggregations } from './index.mjs';
import { readFileSync } from 'fs';

const PORT = parseInt(process.env.PORT || '3141');
const streams = new Map();
let counter = 0;

// ── Dashboard HTML ────────────────────────────────────────────────

const dashboardHTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-stream</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:12px;text-transform:uppercase}
.card .value{color:#58a6ff;font-size:28px;font-weight:bold}
table{width:100%;border-collapse:collapse;margin:16px 0}
th,td{padding:8px 12px;border:1px solid #30363d;text-align:left}
th{background:#161b22;color:#8b949e}
.btn{background:#238636;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;margin:4px}
.btn:hover{background:#2ea043}
.btn.danger{background:#da3633}
input,textarea,select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:8px;border-radius:4px;width:100%}
textarea{height:100px;font-family:monospace}
.form{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:16px 0}
.form label{display:block;color:#8b949e;margin:8px 0 4px}
pre{background:#161b22;border:1px solid #30363d;border-radius:4px;padding:12px;overflow-x:auto;max-height:400px}
.tag{display:inline-block;background:#1f6feb;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin:2px}
</style></head><body>
<h1>🐋 agent-stream v1.0</h1>
<p style="color:#8b949e">Streaming data processor for AI agents</p>

<div class="grid" id="stats"></div>

<div class="form">
  <h3>Create Stream Pipeline</h3>
  <label>Data Source (JSON array)</label>
  <textarea id="data">[{"name":"alice","score":85},{"name":"bob","score":92},{"name":"charlie","score":78},{"name":"diana","score":95},{"name":"eve","score":88}]</textarea>
  <label>Operations (comma-separated: filter:item.score>80, map:{...}, batch:2, take:3)</label>
  <input id="ops" value="filter:item.score>80, pluck:name" placeholder="filter, map, batch, take, distinct, pluck, sort">
  <br><br>
  <button class="btn" onclick="runPipeline()">▶ Run Pipeline</button>
  <button class="btn" onclick="runAgg()">📊 Aggregate</button>
  <select id="aggOp" style="width:120px;display:inline-block;margin-left:8px">
    <option>sum</option><option>avg</option><option>min</option><option>max</option>
    <option>count</option><option>median</option><option>stddev</option>
  </select>
</div>

<pre id="output" style="margin:16px 0;min-height:100px">// Results appear here</pre>

<h3>Active Streams</h3>
<table><thead><tr><th>ID</th><th>Source</th><th>Stages</th><th>Status</th><th>Stats</th></tr></thead>
<tbody id="streams"></tbody></table>

<script>
async function api(path, opts) {
  const r = await fetch('/api' + path, opts);
  return r.json();
}

async function refresh() {
  const s = await api('/stats');
  document.getElementById('stats').innerHTML = 
    '<div class="card"><h3>Active Streams</h3><div class="value">'+s.activeStreams+'</div></div>'+
    '<div class="card"><h3>Total Created</h3><div class="value">'+s.totalCreated+'</div></div>'+
    '<div class="card"><h3>Items Processed</h3><div class="value">'+s.totalProcessed+'</div></div>'+
    '<div class="card"><h3>Throughput</h3><div class="value">'+s.throughput.toFixed(0)+'/s</div></div>';
  
  const list = await api('/streams');
  document.getElementById('streams').innerHTML = list.map(s => 
    '<tr><td>'+s.id+'</td><td>'+s.source+'</td><td>'+s.stages.join(' → ')+'</td>'+
    '<td><span class="tag">'+(s.running?'running':'idle')+'</span></td>'+
    '<td>'+JSON.stringify(s.stats)+'</td></tr>'
  ).join('');
}

async function runPipeline() {
  try {
    const data = JSON.parse(document.getElementById('data').value);
    const opsStr = document.getElementById('ops').value;
    const result = await api('/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ data, operations: opsStr })
    });
    document.getElementById('output').textContent = JSON.stringify(result, null, 2);
    refresh();
  } catch(e) {
    document.getElementById('output').textContent = 'Error: ' + e.message;
  }
}

async function runAgg() {
  try {
    const data = JSON.parse(document.getElementById('data').value);
    const op = document.getElementById('aggOp').value;
    const result = await api('/aggregate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ data, operation: op })
    });
    document.getElementById('output').textContent = JSON.stringify(result, null, 2);
  } catch(e) {
    document.getElementById('output').textContent = 'Error: ' + e.message;
  }
}

refresh();
setInterval(refresh, 5000);
</script></body></html>`;

// ── HTTP Server ───────────────────────────────────────────────────

function parseOps(opsStr) {
  if (!opsStr) return [];
  return opsStr.split(',').map(s => s.trim()).filter(Boolean).map(op => {
    const [name, ...rest] = op.split(':');
    return { name, arg: rest.join(':') || null };
  });
}

async function applyOps(engine, ops) {
  for (const { name, arg } of ops) {
    switch (name) {
      case 'map': engine.map(new Function('item', `return ${arg}`)); break;
      case 'filter': engine.filter(new Function('item', `return ${arg}`)); break;
      case 'batch': engine.batch(parseInt(arg) || 10); break;
      case 'take': engine.take(parseInt(arg) || 5); break;
      case 'skip': engine.skip(parseInt(arg) || 1); break;
      case 'distinct': engine.distinct(arg ? (i => i[arg]) : null); break;
      case 'pluck': engine.pluck(arg); break;
      case 'compact': engine.compact(); break;
      case 'flatten': engine.flatten(); break;
      case 'throttle': engine.throttle(parseInt(arg) || 100); break;
      case 'window': engine.window(parseInt(arg) || 5, 'tumbling'); break;
      default: throw new Error(`Unknown operator: ${name}`);
    }
  }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // Dashboard
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(dashboardHTML);
    }

    // REST API
    if (url.pathname === '/api/stats') {
      return json(res, {
        activeStreams: streams.size,
        totalCreated: counter,
        totalProcessed: [...streams.values()].reduce((a, s) => a + s.stats.itemsProcessed, 0),
        throughput: [...streams.values()].reduce((a, s) => a + s.stats.throughput, 0),
      });
    }

    if (url.pathname === '/api/streams') {
      return json(res, [...streams.entries()].map(([id, e]) => ({
        id,
        source: e.source?.type || 'none',
        stages: e.stages.map(s => s.name),
        running: e.running,
        stats: e.getStats(),
      })));
    }

    if (url.pathname === '/api/run' && req.method === 'POST') {
      const body = await readBody(req);
      const { data, operations } = JSON.parse(body);
      const id = `stream-${++counter}`;
      const engine = new StreamEngine({ id });
      engine.from(Array.isArray(data) ? data : [data]);
      
      const ops = parseOps(operations);
      await applyOps(engine, ops);
      
      const results = await engine.run();
      streams.set(id, engine);
      
      return json(res, { id, results, stats: engine.getStats() });
    }

    if (url.pathname === '/api/aggregate' && req.method === 'POST') {
      const body = await readBody(req);
      const { data, operation, key } = JSON.parse(body);
      const fn = Aggregations[operation];
      if (!fn) return json(res, { error: `Unknown operation: ${operation}` }, 400);
      
      const result = fn(data, key);
      return json(res, { result, operation, count: data.length });
    }

    if (url.pathname === '/api/stream/stop' && req.method === 'POST') {
      const body = await readBody(req);
      const { id } = JSON.parse(body);
      const engine = streams.get(id);
      if (!engine) return json(res, { error: 'Stream not found' }, 404);
      engine.stop();
      streams.delete(id);
      return json(res, { stopped: true, stats: engine.getStats() });
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`agent-stream dashboard: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/stats`);
});
