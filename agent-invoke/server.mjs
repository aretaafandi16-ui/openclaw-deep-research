#!/usr/bin/env node
/**
 * AgentInvoke HTTP Server — REST API + dark-theme web dashboard
 * Port: 3141
 */
import { createServer } from 'http';
import { AgentInvoke } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3141');
const engine = new AgentInvoke({ dataDir: process.env.DATA_DIR || './data' });

// Demo tools
engine.register('echo', async (input) => input, {
  description: 'Echo back the input', tags: ['demo'],
  inputSchema: { type: 'object', properties: { message: { type: 'string' } } }
});
engine.register('timestamp', async () => ({ ts: Date.now(), iso: new Date().toISOString() }), {
  description: 'Get current timestamp', tags: ['demo']
});
engine.register('uuid', async () => ({ uuid: crypto.randomUUID() }), {
  description: 'Generate UUID', tags: ['demo']
});
engine.register('hash', async ({ text, algo = 'sha256' }) => {
  const h = (await import('crypto')).createHash(algo).update(text).digest('hex');
  return { hash: h, algo };
}, {
  description: 'Hash a string', tags: ['crypto'],
  inputSchema: { type: 'object', properties: { text: { type: 'string' }, algo: { type: 'string' } }, required: ['text'] }
});
engine.register('json_extract', async ({ data, path }) => {
  const keys = path.split('.');
  let result = data;
  for (const k of keys) result = result?.[k];
  return { result };
}, {
  description: 'Extract value from JSON by dot-path', tags: ['json'],
  inputSchema: { type: 'object', properties: { data: { type: 'object' }, path: { type: 'string' } }, required: ['data', 'path'] }
});

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d)); } catch { r({}); } }); });
}

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentInvoke</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:8px;font-size:1.5rem}
h2{color:#8b949e;font-size:1rem;margin:16px 0 8px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:8px 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.stat{text-align:center;padding:12px;background:#21262d;border-radius:6px}
.stat .v{font-size:1.5rem;font-weight:700;color:#58a6ff}
.stat .l{font-size:.75rem;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{padding:8px;text-align:left;border-bottom:1px solid #21262d;font-size:.85rem}
th{color:#8b949e;font-weight:600}
.tag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.7rem;background:#1f6feb33;color:#58a6ff;margin:0 2px}
.ok{color:#3fb950}.err{color:#f85149}.warn{color:#d29922}
button{background:#238636;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:.85rem}
button:hover{background:#2ea043}
input,select,textarea{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:6px;font-size:.85rem;width:100%}
textarea{font-family:monospace;min-height:80px}
.flex{display:flex;gap:8px;align-items:center}
.mono{font-family:monospace;font-size:.8rem}
#call-result{margin-top:8px;white-space:pre-wrap;max-height:300px;overflow:auto}
.auto{animation:fade .3s}@keyframes fade{from{opacity:.5}to{opacity:1}}
</style></head><body>
<h1>🐋 AgentInvoke</h1>
<p style="color:#8b949e;margin-bottom:16px">Tool Execution Engine for AI Agents</p>

<div class="stats" id="stats-grid"></div>

<div class="card">
  <h2>🔧 Tools</h2>
  <div class="flex" style="margin-bottom:8px">
    <input id="filter" placeholder="Filter tools..." style="max-width:300px">
  </div>
  <table><thead><tr><th>Name</th><th>Description</th><th>Tags</th><th>Calls</th><th>Success Rate</th></tr></thead>
  <tbody id="tools-table"></tbody></table>
</div>

<div class="card">
  <h2>⚡ Quick Call</h2>
  <div class="flex">
    <select id="call-tool" style="max-width:200px"></select>
    <input id="call-input" placeholder='{"key":"value"}' style="flex:1">
    <button onclick="doCall()">Call</button>
  </div>
  <div id="call-result"></div>
</div>

<div class="card">
  <h2>📜 Recent History</h2>
  <table><thead><tr><th>Time</th><th>Tool</th><th>Duration</th><th>Status</th></tr></thead>
  <tbody id="history-table"></tbody></table>
</div>

<div class="card">
  <h2>🔗 Chain Builder</h2>
  <div id="chain-steps"></div>
  <div class="flex" style="margin-top:8px">
    <button onclick="addChainStep()">+ Step</button>
    <button onclick="runChain()" style="background:#1f6feb">Run Chain</button>
  </div>
  <div id="chain-result"></div>
</div>

<script>
let tools=[], chainCount=0;
const $=s=>document.querySelector(s);

async function api(p,f){return fetch(p,f).then(r=>r.json())}

async function refresh(){
  const [s, t, h] = await Promise.all([
    api('/api/stats'), api('/api/tools'), api('/api/history?limit=20')
  ]);

  // Stats
  const sr = s.totalCalls ? ((s.successCalls/s.totalCalls)*100).toFixed(1) : '0.0';
  const avg = s.totalCalls ? (s.totalDuration/s.totalCalls).toFixed(0) : '0';
  $('#stats-grid').innerHTML = [
    ['v',s.registeredTools,'l','Tools'],
    ['v',s.totalCalls,'l','Total Calls'],
    ['v',sr+'%','l','Success Rate'],
    ['v',s.cachedCalls,'l','Cache Hits'],
    ['v',s.retriedCalls,'l','Retries'],
    ['v',avg+'ms','l','Avg Duration']
  ].map(x=>\`<div class="stat"><div class="\${x[0]}">\${x[1]}</div><div class="\${x[2]}">\${x[3]}</div></div>\`).join('');

  tools=t;
  const q=$('#filter').value?.toLowerCase()||'';
  const ft=q?t.filter(x=>x.name.includes(q)||x.description?.toLowerCase().includes(q)):t;
  $('#tools-table').innerHTML=ft.map(x=>{
    const ts=s.byTool[x.name]||{};
    const sr2=ts.calls?((ts.success/ts.calls)*100).toFixed(1)+'%':'—';
    return \`<tr><td class="mono">\${x.name}</td><td>\${x.description||'—'}</td>
      <td>\${(x.tags||[]).map(t=>\`<span class="tag">\${t}</span>\`).join('')}</td>
      <td>\${ts.calls||0}</td><td>\${sr2}</td></tr>\`;
  }).join('');

  // Call tool select
  const sel=$('#call-tool');
  const prev=sel.value;
  sel.innerHTML=t.map(x=>\`<option value="\${x.name}">\${x.name}\</option>\`).join('');
  if(prev) sel.value=prev;

  // History
  $('#history-table').innerHTML=h.slice().reverse().map(x=>\`<tr>
    <td>\${new Date(x.ts).toLocaleTimeString()}</td>
    <td class="mono">\${x.name}</td>
    <td>\${x.duration}ms</td>
    <td class="\${x.success?'ok':'err'}">\${x.success?'✓':'✗'}</td>
  </tr>\`).join('');
}

async function doCall(){
  const name=$('#call-tool').value, inp=$('#call-input').value;
  let input={}; try{input=JSON.parse(inp)}catch{}
  const r=await api('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,input})});
  $('#call-result').innerHTML=\`<pre>\${JSON.stringify(r,null,2)}</pre>\`;
  refresh();
}

function addChainStep(){
  chainCount++;
  const d=document.createElement('div'); d.className='flex'; d.style.marginTop='4px';
  d.innerHTML=\`<span style="color:#8b949e">\${chainCount}.</span>
    <select class="chain-tool" style="max-width:200px">\${tools.map(x=>\`<option>\${x.name}</option>\`).join('')}</select>
    <input class="chain-input" placeholder='{"key":"val"}' style="flex:1">\`;
  $('#chain-steps').appendChild(d);
}

async function runChain(){
  const steps=[...document.querySelectorAll('.chain-tool')].map((sel,i)=>{
    const inp=[...document.querySelectorAll('.chain-input')][i]?.value||'{}';
    let input={}; try{input=JSON.parse(inp)}catch{}
    return {tool:sel.value,input};
  });
  const r=await api('/api/chain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({steps})});
  $('#chain-result').innerHTML=\`<pre>\${JSON.stringify(r,null,2)}</pre>\`;
  refresh();
}

$('#filter').addEventListener('input',refresh);
refresh(); setInterval(refresh,5000);
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    // Dashboard
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(HTML);
    }

    // API routes
    if (url.pathname === '/api/tools' && req.method === 'GET') {
      return json(res, 200, engine.listTools({ tag: url.searchParams.get('tag'), search: url.searchParams.get('search') }));
    }
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      return json(res, 200, engine.getStats());
    }
    if (url.pathname === '/api/history' && req.method === 'GET') {
      return json(res, 200, engine.getHistory({
        tool: url.searchParams.get('tool'),
        success: url.searchParams.has('success') ? url.searchParams.get('success') === 'true' : undefined,
        limit: parseInt(url.searchParams.get('limit') || '100')
      }));
    }
    if (url.pathname === '/api/call' && req.method === 'POST') {
      const b = await body(req);
      const result = await engine.call(b.name, b.input || {}, b.opts || {});
      return json(res, result.success ? 200 : 400, result);
    }
    if (url.pathname === '/api/chain' && req.method === 'POST') {
      const b = await body(req);
      const result = await engine.chain(b.steps, b.initialInput || {});
      return json(res, result.success ? 200 : 400, result);
    }
    if (url.pathname === '/api/parallel' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, await engine.parallel(b.calls));
    }
    if (url.pathname === '/api/register' && req.method === 'POST') {
      const b = await body(req);
      const fn = new Function('input', `return (async (input) => { ${b.handler_js} })(input)`);
      engine.register(b.name, fn, { description: b.description, tags: b.tags, inputSchema: b.inputSchema });
      return json(res, 201, { registered: b.name });
    }
    if (url.pathname.startsWith('/api/unregister/') && req.method === 'DELETE') {
      const name = url.pathname.split('/').pop();
      engine.unregister(name);
      return json(res, 200, { unregistered: name });
    }
    if (url.pathname === '/api/validate' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, engine.validate(b.data, b.schema));
    }
    if (url.pathname === '/api/cache/clear' && req.method === 'POST') {
      const b = await body(req);
      if (b?.tool) engine.clearCache(k => k.startsWith(b.tool + ':'));
      else engine.clearCache();
      return json(res, 200, { cleared: true });
    }
    if (url.pathname === '/api/mcp-tools' && req.method === 'GET') {
      return json(res, 200, engine.toMCPTools());
    }

    json(res, 404, { error: 'Not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`[agent-invoke] HTTP server on :${PORT}`);
});

export { engine, server };
