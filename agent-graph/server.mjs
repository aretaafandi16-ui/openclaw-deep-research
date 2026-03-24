#!/usr/bin/env node
// agent-graph HTTP Server — REST API + web dashboard
import http from 'node:http';
import { AgentGraph } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3117');
const DIR = process.env.GRAPH_DIR || './data';
const graph = new AgentGraph({ dir: DIR });

// REST API handlers
function apiHandler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)); };

  // CORS preflight
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const args = body ? JSON.parse(body) : {};

    try {
      // Stats
      if (path === '/api/stats') return send(200, graph.stats());

      // Nodes CRUD
      if (path === '/api/nodes' && req.method === 'GET') {
        return send(200, graph.findNodes({ label: url.searchParams.get('label'), limit: parseInt(url.searchParams.get('limit') || '100') }));
      }
      if (path === '/api/nodes' && req.method === 'POST') {
        return send(201, graph.addNode(args.id, args.labels || [], args.props || {}));
      }
      const nodeMatch = path.match(/^\/api\/nodes\/(.+)$/);
      if (nodeMatch) {
        const id = decodeURIComponent(nodeMatch[1]);
        if (req.method === 'GET') return send(200, graph.getNode(id) || { error: 'not found' });
        if (req.method === 'PUT') return send(200, graph.updateNode(id, args) || { error: 'not found' });
        if (req.method === 'DELETE') return send(200, { removed: graph.removeNode(id) });
      }

      // Edges CRUD
      if (path === '/api/edges' && req.method === 'GET') {
        return send(200, graph.findEdges({ type: url.searchParams.get('type'), limit: parseInt(url.searchParams.get('limit') || '100') }));
      }
      if (path === '/api/edges' && req.method === 'POST') {
        return send(201, graph.addEdge(args.from, args.to, args.type || 'rel', args.weight ?? 1, args.props || {}));
      }
      const edgeMatch = path.match(/^\/api\/edges\/(.+)$/);
      if (edgeMatch && req.method === 'DELETE') return send(200, { removed: graph.removeEdge(decodeURIComponent(edgeMatch[1])) });

      // Neighbors
      if (path === '/api/neighbors' && req.method === 'POST') {
        return send(200, graph.neighbors(args.id, { direction: args.direction || 'both', type: args.type, limit: args.limit }));
      }

      // Algorithms
      if (path === '/api/shortest-path' && req.method === 'POST') {
        const r = graph.shortestPath(args.from, args.to, { direction: args.direction || 'out' });
        return send(200, r || { error: 'no path' });
      }
      if (path === '/api/traverse' && req.method === 'POST') {
        const algo = args.algorithm === 'dfs' ? graph.dfs : graph.bfs;
        return send(200, algo.call(graph, args.start, { maxDepth: args.maxDepth || 10, direction: args.direction || 'out' }));
      }
      if (path === '/api/pagerank') return send(200, Object.fromEntries(graph.pagerank()));
      if (path === '/api/toposort') return send(200, graph.topologicalSort());
      if (path === '/api/components') return send(200, graph.connectedComponents());
      if (path === '/api/scc') return send(200, graph.stronglyConnectedComponents());

      // Export
      if (path === '/api/export') {
        const fmt = url.searchParams.get('format') || 'json';
        if (fmt === 'mermaid') return send(200, { content: graph.toMermaid() });
        if (fmt === 'dot') return send(200, { content: graph.toDot() });
        return send(200, graph.toJSON());
      }

      // Clear
      if (path === '/api/clear' && req.method === 'POST') { graph.clear(); return send(200, { cleared: true }); }

      send(404, { error: 'not found' });
    } catch (e) {
      send(400, { error: e.message });
    }
  });
}

// Dashboard
function dashboardHTML() {
  const stats = graph.stats();
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-graph</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:16px}
h1{color:#58a6ff;margin-bottom:16px;font-size:1.5rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center}
.card .num{font-size:2rem;font-weight:bold;color:#58a6ff}
.card .label{color:#8b949e;font-size:.85rem}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #30363d}
th{color:#58a6ff;font-size:.85rem}
tr:hover{background:#161b22}
.tag{display:inline-block;background:#1f6feb;color:#fff;padding:2px 8px;border-radius:12px;font-size:.75rem;margin:2px}
.mono{font-family:monospace;color:#7ee787}
input,select,button{padding:6px 12px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#c9d1d9;font-size:.85rem}
button{background:#238636;cursor:pointer}button:hover{background:#2ea043}
.flex{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
.section{margin:20px 0}h2{color:#58a6ff;margin-bottom:8px;font-size:1.1rem}
#add-result{color:#7ee787;margin:4px 0}
</style></head><body>
<h1>🐋 agent-graph</h1>
<div class="cards">
  <div class="card"><div class="num" id="nodes">${stats.nodes}</div><div class="label">Nodes</div></div>
  <div class="card"><div class="num" id="edges">${stats.edges}</div><div class="label">Edges</div></div>
  <div class="card"><div class="num" id="labels">${stats.labels.length}</div><div class="label">Labels</div></div>
  <div class="card"><div class="num" id="etypes">${stats.edgeTypes.length}</div><div class="label">Edge Types</div></div>
</div>

<div class="section"><h2>Add Node</h2>
<div class="flex">
  <input id="nid" placeholder="ID"><input id="nlabels" placeholder="Labels (comma-sep)"><input id="nprops" placeholder='Props JSON'>
  <button onclick="addNode()">Add</button>
</div><div id="add-result"></div></div>

<div class="section"><h2>Add Edge</h2>
<div class="flex">
  <input id="efrom" placeholder="From"><input id="eto" placeholder="To"><input id="etype" placeholder="Type" value="rel">
  <input id="eweight" type="number" placeholder="Weight" value="1" style="width:80px">
  <button onclick="addEdge()">Add</button>
</div><div id="edge-result"></div></div>

<div class="section"><h2>Shortest Path</h2>
<div class="flex">
  <input id="spfrom" placeholder="From"><input id="spto" placeholder="To"><button onclick="findPath()">Find</button>
</div><div id="sp-result"></div></div>

<div class="section"><h2>Nodes</h2><table id="nodes-table"><thead><tr><th>ID</th><th>Labels</th><th>Properties</th></tr></thead><tbody></tbody></table></div>
<div class="section"><h2>Edges</h2><table id="edges-table"><thead><tr><th>ID</th><th>From</th><th>To</th><th>Type</th><th>Weight</th></tr></thead><tbody></tbody></table></div>

<script>
const api = (p, m='GET', b) => fetch('/api/'+p, {method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
async function refresh() {
  const s = await api('stats');
  document.getElementById('nodes').textContent = s.nodes;
  document.getElementById('edges').textContent = s.edges;
  document.getElementById('labels').textContent = s.labels.length;
  document.getElementById('etypes').textContent = s.edgeTypes.length;
  const nodes = await api('nodes?limit=200');
  document.querySelector('#nodes-table tbody').innerHTML = nodes.map(n=>'<tr><td class="mono">'+n.id+'</td><td>'+n.labels.map(l=>'<span class="tag">'+l+'</span>').join(' ')+'</td><td><code>'+JSON.stringify(n.props)+'</code></td></tr>').join('');
  const edges = await api('edges?limit=200');
  document.querySelector('#edges-table tbody').innerHTML = edges.map(e=>'<tr><td class="mono">'+e.id+'</td><td>'+e.from+'</td><td>'+e.to+'</td><td><span class="tag">'+e.type+'</span></td><td>'+e.weight+'</td></tr>').join('');
}
async function addNode() {
  const id = document.getElementById('nid').value.trim();
  if (!id) return;
  const labels = document.getElementById('nlabels').value.split(',').map(s=>s.trim()).filter(Boolean);
  let props = {};
  try { props = JSON.parse(document.getElementById('nprops').value || '{}'); } catch {}
  await api('nodes','POST',{id,labels,props});
  document.getElementById('add-result').textContent = '✓ Added '+id;
  refresh();
}
async function addEdge() {
  const from = document.getElementById('efrom').value.trim();
  const to = document.getElementById('eto').value.trim();
  if (!from||!to) return;
  const type = document.getElementById('etype').value.trim()||'rel';
  const weight = parseFloat(document.getElementById('eweight').value)||1;
  const r = await api('edges','POST',{from,to,type,weight});
  document.getElementById('edge-result').textContent = '✓ Edge '+r.id;
  refresh();
}
async function findPath() {
  const from = document.getElementById('spfrom').value.trim();
  const to = document.getElementById('spto').value.trim();
  if (!from||!to) return;
  const r = await api('shortest-path','POST',{from,to});
  document.getElementById('sp-result').innerHTML = r.nodes ? '<span class="mono">'+r.nodes.join(' → ')+'</span> (distance: '+r.distance+')' : 'No path found';
}
refresh();
setInterval(refresh, 5000);
</script></body></html>`;
}

function dashboardHandler(req, res) {
  if (req.url === '/' || req.url === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(dashboardHTML());
    return true;
  }
  return false;
}

// Start
const server = http.createServer((req, res) => {
  if (dashboardHandler(req, res)) return;
  if (req.url.startsWith('/api/')) return apiHandler(req, res);
  res.writeHead(404); res.end('Not found');
});
server.listen(PORT, () => console.log(`🐋 agent-graph dashboard → http://localhost:${PORT}`));
