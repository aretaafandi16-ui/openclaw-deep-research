#!/usr/bin/env node
/**
 * agent-chain HTTP Server — REST API + dark-theme web dashboard
 */
import { createServer } from 'node:http';
import { ChainManager, PRESETS } from './index.mjs';

const PORT = +(process.env.PORT || 3124);
const manager = new ChainManager();

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, content) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const dashboard = () => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-chain</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase}.card .value{font-size:24px;font-weight:700;color:#58a6ff}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #30363d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}tr:hover{background:#161b22}
.tag{display:inline-block;background:#1f6feb;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;margin:1px}
.conf-bar{height:4px;border-radius:2px;background:#30363d;margin-top:4px}.conf-fill{height:100%;border-radius:2px}
.green{background:#3fb950}.yellow{background:#d29922}.red{background:#f85149}
.btn{background:#238636;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px}
.btn:hover{background:#2ea043}.btn-red{background:#da3633}
input,textarea,select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:13px}
textarea{width:100%;min-height:60px;font-family:monospace}
</style></head><body>
<h1>🐋 agent-chain <span style="font-size:14px;color:#8b949e">v1.0</span></h1>
<div class="cards" id="cards"></div>
<h2 style="margin:16px 0 8px">Chains</h2>
<table><thead><tr><th>Name</th><th>Strategy</th><th>Steps</th><th>Confidence</th><th>Conclusion</th><th>Actions</th></tr></thead>
<tbody id="chains"></tbody></table>
<h2 style="margin:24px 0 8px">Create Chain</h2>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
<input id="cname" placeholder="Chain name" style="flex:1;min-width:200px">
<select id="cstrategy">${Object.keys(PRESETS).map(k => '<option value="'+k+'">'+k+'</option>').join('')}</select>
<button class="btn" onclick="createChain()">Create</button>
</div>
<div id="detail" style="display:none">
<h2 style="margin:16px 0 8px">Chain Detail</h2>
<div id="tree"></div>
<h3 style="margin:12px 0 8px">Add Step</h3>
<textarea id="stepThought" placeholder="Reasoning thought..."></textarea>
<div style="display:flex;gap:8px;margin-top:8px">
<input id="stepLabel" placeholder="Label" style="flex:1">
<input id="stepConf" placeholder="Confidence (0-1)" style="width:120px" value="0.5">
<button class="btn" onclick="addStep()">Add Step</button>
</div></div>
<script>
async function api(path,method='GET',d=null){const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:d?JSON.stringify(d):undefined});return r.json()}
async function refresh(){const[g,c]=await Promise.all([api('/global-stats'),api('/chains')]);
document.getElementById('cards').innerHTML=[['Chains',g.totalChains],['Steps',g.totalSteps],['Avg Confidence',(g.avgConfidence*100).toFixed(0)+'%'],['Conclusions',g.withConclusions]]
.map(([l,v])=>'<div class="card"><div class="label">'+l+'</div><div class="value">'+v+'</div></div>').join('');
document.getElementById('chains').innerHTML=c.map(ch=>{
const cc=ch.avgConfidence;const cls=cc>0.7?'green':cc>0.4?'yellow':'red';
return '<tr><td><b>'+ch.name+'</b></td><td>'+ch.strategy+'</td><td>'+ch.totalSteps+'</td><td><div class="conf-bar"><div class="conf-fill '+cls+'" style="width:'+(cc*100)+'%"></div></div>'+(cc*100).toFixed(0)+'%</td><td>'+(ch.conclusion||'—')+'</td><td><button class="btn" onclick="viewChain(\\''+ch.id+'\\')">View</button></td></tr>'}).join('')}
async function createChain(){const n=document.getElementById('cname').value||'chain';const s=document.getElementById('cstrategy').value;
await api('/chains','POST',{name:n,strategy:s});document.getElementById('cname').value='';refresh()}
let currentChain=null;
async function viewChain(id){currentChain=id;document.getElementById('detail').style.display='block';
const tree=await api('/chains/'+id+'/tree');document.getElementById('tree').innerHTML='<pre>'+JSON.stringify(tree,null,2)+'</pre>'}
async function addStep(){if(!currentChain)return;
await api('/chains/'+currentChain+'/steps','POST',{label:document.getElementById('stepLabel').value,thought:document.getElementById('stepThought').value,
confidence:+document.getElementById('stepConf').value});document.getElementById('stepLabel').value='';document.getElementById('stepThought').value='';
viewChain(currentChain);refresh()}
refresh();setInterval(refresh,5000);
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return;
  }

  try {
    if (path === '/' || path === '/dashboard') return html(res, dashboard());
    if (path === '/api/global-stats') return json(res, manager.globalStats());
    if (path === '/api/chains' && req.method === 'GET') return json(res, manager.list());
    if (path === '/api/chains' && req.method === 'POST') {
      const d = await body(req);
      const preset = PRESETS[d.strategy] || {};
      const c = manager.create({ name: d.name, strategy: d.strategy, maxDepth: d.maxDepth || preset.maxDepth,
        confidenceThreshold: d.confidenceThreshold ?? preset.confidenceThreshold });
      return json(res, c.stats(), 201);
    }

    const chainMatch = path.match(/^\/api\/chains\/([^/]+)$/);
    if (chainMatch && req.method === 'GET') {
      const c = manager.get(chainMatch[1]);
      return c ? json(res, c.stats()) : json(res, { error: 'Not found' }, 404);
    }
    if (chainMatch && req.method === 'DELETE') {
      manager.remove(chainMatch[1]);
      return json(res, { ok: true });
    }

    const treeMatch = path.match(/^\/api\/chains\/([^/]+)\/tree$/);
    if (treeMatch) {
      const c = manager.get(treeMatch[1]);
      return c ? json(res, c.getTree()) : json(res, { error: 'Not found' }, 404);
    }

    const stepsMatch = path.match(/^\/api\/chains\/([^/]+)\/steps$/);
    if (stepsMatch && req.method === 'POST') {
      const c = manager.get(stepsMatch[1]);
      if (!c) return json(res, { error: 'Not found' }, 404);
      const d = await body(req);
      const step = c.addStep(d);
      manager.save(stepsMatch[1]);
      return json(res, step.toJSON(), 201);
    }

    const pathMatch = path.match(/^\/api\/chains\/([^/]+)\/path$/);
    if (pathMatch) {
      const c = manager.get(pathMatch[1]);
      return c ? json(res, c.getPath(url.searchParams.get('step') || null)) : json(res, { error: 'Not found' }, 404);
    }

    const searchMatch = path.match(/^\/api\/chains\/([^/]+)\/search$/);
    if (searchMatch) {
      const c = manager.get(searchMatch[1]);
      return c ? json(res, c.branchAndBound()) : json(res, { error: 'Not found' }, 404);
    }

    const concludeMatch = path.match(/^\/api\/chains\/([^/]+)\/conclude$/);
    if (concludeMatch && req.method === 'POST') {
      const c = manager.get(concludeMatch[1]);
      if (!c) return json(res, { error: 'Not found' }, 404);
      const d = await body(req);
      c.conclude(d.text, d.confidence);
      manager.save(concludeMatch[1]);
      return json(res, { conclusion: c.conclusion, confidence: c.conclusionConfidence });
    }

    const evalMatch = path.match(/^\/api\/chains\/([^/]+)\/evaluate$/);
    if (evalMatch && req.method === 'POST') {
      const c = manager.get(evalMatch[1]);
      if (!c) return json(res, { error: 'Not found' }, 404);
      const d = await body(req);
      c.evaluate(d.stepId, d.score, d.notes);
      manager.save(evalMatch[1]);
      return json(res, { ok: true });
    }

    const backtrackMatch = path.match(/^\/api\/chains\/([^/]+)\/backtrack$/);
    if (backtrackMatch && req.method === 'POST') {
      const c = manager.get(backtrackMatch[1]);
      if (!c) return json(res, { error: 'Not found' }, 404);
      const d = await body(req);
      c.backtrack(d.stepId);
      manager.save(backtrackMatch[1]);
      return json(res, c.stats());
    }

    const exportMatch = path.match(/^\/api\/chains\/([^/]+)\/export$/);
    if (exportMatch) {
      const c = manager.get(exportMatch[1]);
      if (!c) return json(res, { error: 'Not found' }, 404);
      return url.searchParams.get('format') === 'markdown'
        ? (res.writeHead(200, {'Content-Type':'text/markdown'}), res.end(c.toMarkdown()))
        : json(res, c.toJSON());
    }

    json(res, { error: 'Not found' }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => console.log(`🐋 agent-chain dashboard → http://localhost:${PORT}/dashboard`));
