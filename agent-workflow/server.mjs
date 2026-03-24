import { createServer } from 'node:http';
import { Workflow, WorkflowRegistry, uuid } from './index.mjs';
import { readFileSync } from 'node:fs';

const PORT = parseInt(process.env.PORT || '3112');
const registry = new WorkflowRegistry();

// ─── HTTP Helpers ──────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}

// ─── Dashboard HTML ────────────────────────────────────────────────────────────
function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Workflow</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{font-size:1.5em;margin-bottom:16px;display:flex;align-items:center;gap:8px}
h1 span{font-size:1.8em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:.8em;text-transform:uppercase}
.card .value{font-size:1.6em;font-weight:700;margin-top:4px}
.green{color:#3fb950}.red{color:#f85149}.blue{color:#58a6ff}.yellow{color:#d29922}
.section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px}
.section h2{font-size:1.1em;margin-bottom:12px;color:#58a6ff}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d;font-size:.85em}
th{color:#8b949e;font-weight:600}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.75em;font-weight:600}
.badge-running{background:#1f6feb33;color:#58a6ff}
.badge-completed{background:#23883322;color:#3fb950}
.badge-failed{background:#f8514922;color:#f85149}
.badge-task{background:#30363d;color:#c9d1d9}
.badge-condition{background:#d2992222;color:#d29922}
.badge-parallel{background:#1f6feb33;color:#58a6ff}
.btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.85em}
.btn:hover{background:#30363d}
.btn-primary{background:#1f6feb;border-color:#1f6feb;color:#fff}
.mermaid{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;font-family:monospace;font-size:.8em;white-space:pre-wrap;margin-top:12px;max-height:400px;overflow:auto}
input,select,textarea{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:6px;font-size:.85em}
textarea{width:100%;min-height:120px;font-family:monospace}
label{font-size:.85em;color:#8b949e;margin-bottom:4px;display:block}
.form-group{margin-bottom:12px}
#flash{position:fixed;top:16px;right:16px;padding:10px 16px;border-radius:8px;font-size:.85em;z-index:999;display:none}
.flash-ok{background:#23883322;border:1px solid #3fb950;color:#3fb950}
.flash-err{background:#f8514922;border:1px solid #f85149;color:#f85149}
</style>
</head>
<body>
<h1><span>⚡</span> Agent Workflow</h1>
<div class="cards" id="stats-cards"></div>

<div class="section">
  <h2>Workflows</h2>
  <div id="workflows-table"><p style="color:#8b949e">Loading...</p></div>
</div>

<div class="section" id="dag-section" style="display:none">
  <h2>DAG — <span id="dag-title"></span></h2>
  <pre class="mermaid" id="dag-view"></pre>
</div>

<div class="section">
  <h2>Create Workflow</h2>
  <div class="form-group"><label>Workflow JSON</label>
    <textarea id="wf-json" placeholder='{"name":"my-workflow","steps":[{"id":"step1","name":"Fetch Data","type":"task"}]}'></textarea>
  </div>
  <button class="btn btn-primary" onclick="createWF()">Create</button>
</div>

<div id="flash"></div>

<script>
const API='/api';
async function api(path,opts={}){const r=await fetch(API+path,{headers:{'Content-Type':'application/json'},...opts,body:opts.body?JSON.stringify(opts.body):undefined});return r.json()}
function flash(msg,ok=true){const el=document.getElementById('flash');el.textContent=msg;el.className=ok?'flash-ok':'flash-err';el.style.display='block';setTimeout(()=>el.style.display='none',3000)}
function badge(s,cls){return '<span class="badge badge-'+cls+'">'+s+'</span>'}
function fmt(ms){return ms<1000?ms+'ms':(ms/1000).toFixed(1)+'s'}

async function refresh(){
  const stats=await api('/stats');
  document.getElementById('stats-cards').innerHTML=`
    <div class="card"><div class="label">Workflows</div><div class="value blue">${stats.workflows}</div></div>
    <div class="card"><div class="label">Total Runs</div><div class="value">${stats.totalRuns}</div></div>
    <div class="card"><div class="label">Completed</div><div class="value green">${stats.completed}</div></div>
    <div class="card"><div class="label">Failed</div><div class="value red">${stats.failed}</div></div>
    <div class="card"><div class="label">Success Rate</div><div class="value ${stats.successRate>80?'green':stats.successRate>50?'yellow':'red'}">${stats.successRate}%</div></div>`;

  const wfs=await api('/workflows');
  if(!wfs.length){document.getElementById('workflows-table').innerHTML='<p style="color:#8b949e">No workflows yet</p>';return}
  let h='<table><tr><th>Name</th><th>Steps</th><th>Runs</th><th>Success</th><th>Avg Duration</th><th></th></tr>';
  for(const w of wfs){h+=\`<tr><td>\${w.name}</td><td>\${w.steps}</td><td>\${w.stats.totalRuns}</td><td>\${badge(w.stats.successRate+'%',w.stats.successRate>80?'completed':'failed')}</td><td>\${w.stats.avgDuration?fmt(w.stats.avgDuration):'-'}</td><td><button class="btn" onclick="viewDAG('\${w.id}','\${w.name}')">DAG</button> <button class="btn btn-primary" onclick="runWF('\${w.id}')">Run</button></td></tr>\`}
  h+='</table>';
  document.getElementById('workflows-table').innerHTML=h;
}

async function viewDAG(id,name){
  const d=await api('/workflows/'+id+'/dag');
  document.getElementById('dag-section').style.display='block';
  document.getElementById('dag-title').textContent=name;
  document.getElementById('dag-view').textContent=d.mermaid||d.dot||'No steps';
}

async function runWF(id){
  try{const r=await api('/workflows/'+id+'/run',{method:'POST',body:{}});flash(r.status==='completed'?'Run completed in '+fmt(r.duration):'Run failed: '+r.error,r.status==='completed');refresh()}catch(e){flash('Error: '+e.message,false)}
}

async function createWF(){
  try{const def=JSON.parse(document.getElementById('wf-json').value);await api('/workflows',{method:'POST',body:{definition:def}});flash('Workflow created');refresh()}catch(e){flash('Invalid JSON: '+e.message,false)}
}

refresh();setInterval(refresh,5000);
</script>
</body></html>`;
}

// ─── Routes ────────────────────────────────────────────────────────────────────
async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }

  // Dashboard
  if (path === '/' || path === '/dashboard') return html(res, dashboardHTML());

  // API routes
  if (path === '/api/stats') return json(res, registry.globalStats);
  if (path === '/api/workflows' && req.method === 'GET') return json(res, registry.list());
  if (path === '/api/workflows' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.definition) return json(res, { error: 'Missing definition' }, 400);
    const wf = registry.create(body.definition, body);
    return json(res, { id: wf.id, name: wf.name, steps: wf.steps.length });
  }

  const wfMatch = path.match(/^\/api\/workflows\/([^\/]+)$/);
  if (wfMatch) {
    const wf = registry.get(wfMatch[1]);
    if (!wf) return json(res, { error: 'Not found' }, 404);
    if (req.method === 'GET') return json(res, { id: wf.id, name: wf.name, steps: wf.steps.length, definition: wf.toJSON(), stats: wf.stats });
    if (req.method === 'DELETE') { registry.remove(wfMatch[1]); return json(res, { removed: true }); }
  }

  const runMatch = path.match(/^\/api\/workflows\/([^\/]+)\/run$/);
  if (runMatch && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const result = await registry.run(runMatch[1], body.data || {});
      return json(res, result);
    } catch (e) { return json(res, { error: e.message }, 404); }
  }

  const dagMatch = path.match(/^\/api\/workflows\/([^\/]+)\/dag$/);
  if (dagMatch && req.method === 'GET') {
    const wf = registry.get(dagMatch[1]);
    if (!wf) return json(res, { error: 'Not found' }, 404);
    const format = url.searchParams.get('format') || 'mermaid';
    return json(res, format === 'dot' ? { dot: wf.toDot() } : { mermaid: wf.toMermaid() });
  }

  const runsMatch = path.match(/^\/api\/workflows\/([^\/]+)\/runs$/);
  if (runsMatch && req.method === 'GET') {
    const wf = registry.get(runsMatch[1]);
    if (!wf) return json(res, { error: 'Not found' }, 404);
    return json(res, { runs: wf.runs, stats: wf.stats });
  }

  const stepsMatch = path.match(/^\/api\/workflows\/([^\/]+)\/steps$/);
  if (stepsMatch && req.method === 'POST') {
    const wf = registry.get(stepsMatch[1]);
    if (!wf) return json(res, { error: 'Not found' }, 404);
    const body = await readBody(req);
    wf.addStep(body.step);
    return json(res, { steps: wf.steps.length });
  }

  json(res, { error: 'Not found' }, 404);
}

// ─── Start ─────────────────────────────────────────────────────────────────────
const server = createServer(handler);
server.listen(PORT, () => console.log(`agent-workflow dashboard on http://localhost:${PORT}`));

// ─── Demo ──────────────────────────────────────────────────────────────────────
if (process.argv.includes('--demo')) {
  const wf = registry.create({
    name: 'Data Pipeline Demo',
    steps: [
      { id: 'fetch', name: 'Fetch Data', type: 'task', run: async () => { await new Promise(r => setTimeout(r, 200)); return { items: [1,2,3,4,5], count: 5 }; } },
      { id: 'validate', name: 'Validate', type: 'task', dependsOn: ['fetch'], run: async (ctx) => { const d = ctx.outputs.get('fetch'); if (!d?.items) throw new Error('Bad data'); return { valid: true }; } },
      { id: 'transform', name: 'Transform', type: 'transform', dependsOn: ['validate'], input: 'fetch', transform: async (input) => ({ doubled: input.items.map(x => x*2) }) },
      { id: 'check', name: 'Check Count', type: 'condition', dependsOn: ['transform'], condition: async (ctx) => ctx.outputs.get('check')?.result?.doubled?.length > 0 },
      { id: 'save', name: 'Save Results', type: 'task', dependsOn: ['check'], run: async (ctx) => { await new Promise(r => setTimeout(r, 100)); return { saved: true, items: ctx.outputs.get('transform')?.result?.doubled }; } },
      { id: 'notify', name: 'Notify', type: 'log', dependsOn: ['save'], message: (ctx) => \`Pipeline complete! Saved \${ctx.outputs.get('save')?.result?.items?.length || 0} items\` },
    ],
  });
  console.log(`Demo workflow "${wf.name}" created: ${wf.id}`);
  console.log('DAG:', wf.toMermaid());
}
