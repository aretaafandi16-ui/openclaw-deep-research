#!/usr/bin/env node
/**
 * agent-context HTTP Server
 * Dark-theme web dashboard + REST API
 */

import { createServer } from 'http';
import { ContextManager, MODEL_PRESETS, estimateTokens, estimateMessageTokens } from './index.mjs';

const PORT = parseInt(process.argv[2] || '3116');
const managers = new Map();
const defaultMgr = new ContextManager();

function getMgr(id) {
  if (!id || id === 'default') return defaultMgr;
  if (!managers.has(id)) managers.set(id, new ContextManager());
  return managers.get(id);
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  
  try {
    // REST API
    if (path === '/api/add' && req.method === 'POST') {
      const body = await readBody(req);
      const mgr = getMgr(body.manager_id);
      const msg = mgr.add(body);
      return json(res, { ok: true, id: msg._id, tokens: msg._tokens, totalTokens: mgr.inputTokens });
    }
    
    if (path === '/api/get' && req.method === 'POST') {
      const body = await readBody(req);
      const mgr = getMgr(body.manager_id);
      const msgs = mgr.getMessages({ strategy: body.strategy, maxTokens: body.max_tokens });
      return json(res, { messages: msgs, count: msgs.length, tokens: mgr._countTokens(msgs) });
    }
    
    if (path === '/api/stats') {
      const mgr = getMgr(url.searchParams.get('id'));
      return json(res, mgr.getStats());
    }
    
    if (path === '/api/budget') {
      const mgr = getMgr(url.searchParams.get('id'));
      const enforce = url.searchParams.get('enforce') === 'true';
      return json(res, enforce ? mgr.enforceBudgets() : mgr.getBudgetBreakdown());
    }
    
    if (path === '/api/compress' && req.method === 'POST') {
      const body = await readBody(req);
      const mgr = getMgr(body.manager_id);
      return json(res, mgr.compress(body));
    }
    
    if (path === '/api/clear' && req.method === 'POST') {
      const body = await readBody(req);
      const mgr = getMgr(body.manager_id);
      mgr.clear(body.keep_persistent !== false);
      return json(res, { cleared: true, remaining: mgr.messages.length });
    }
    
    if (path === '/api/breakdown') {
      const mgr = getMgr(url.searchParams.get('id'));
      return json(res, mgr.getTokenBreakdown());
    }
    
    if (path === '/api/models') {
      return json(res, Object.entries(MODEL_PRESETS).map(([name, p]) => ({ name, ...p })));
    }
    
    if (path === '/api/estimate' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.messages) {
        return json(res, { tokens: body.messages.reduce((s, m) => s + estimateMessageTokens(m), 0) });
      }
      return json(res, { tokens: estimateTokens(body.text || '') });
    }
    
    if (path === '/api/configure' && req.method === 'POST') {
      const body = await readBody(req);
      const mgr = getMgr(body.manager_id);
      if (body.model) {
        const preset = MODEL_PRESETS[body.model];
        if (!preset) return json(res, { error: `Unknown model: ${body.model}` }, 400);
        mgr.model = body.model;
        mgr.maxTokens = preset.maxTokens;
        mgr.reserveOutput = preset.reserveOutput;
      }
      if (body.max_tokens) mgr.maxTokens = body.max_tokens;
      if (body.reserve_output) mgr.reserveOutput = body.reserve_output;
      return json(res, { configured: true, model: mgr.model, maxTokens: mgr.maxTokens, budgets: mgr.budgets });
    }

    if (path === '/api/last') {
      const mgr = getMgr(url.searchParams.get('id'));
      const n = parseInt(url.searchParams.get('n') || '10');
      return json(res, mgr.last(n));
    }

    if (path === '/api/export') {
      const mgr = getMgr(url.searchParams.get('id'));
      return json(res, mgr.export());
    }
    
    // Dashboard
    if (path === '/' || path === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(DASHBOARD_HTML);
    }
    
    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`agent-context dashboard: http://localhost:${PORT}`);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-context</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:20px;font-size:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:12px;text-transform:uppercase;margin-bottom:8px}
.card .val{color:#58a6ff;font-size:28px;font-weight:bold}
.card .sub{color:#8b949e;font-size:12px;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d;font-size:13px}
th{color:#8b949e;font-weight:600}
.role-system{color:#f0883e}.role-user{color:#58a6ff}.role-assistant{color:#3fb950}.role-tool{color:#d2a8ff}
.bar{height:20px;background:#21262d;border-radius:4px;overflow:hidden;margin:4px 0}
.bar-fill{height:100%;border-radius:4px;transition:width .3s}
.progress-row{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px}
.progress-label{width:80px;text-align:right;color:#8b949e}
.auto{color:#8b949e;font-size:11px;margin-top:8px}
select,button,input{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:4px;font-size:12px}
button{cursor:pointer;background:#238636;border-color:#238636;color:#fff}
button:hover{background:#2ea043}
.form{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap;align-items:center}
</style></head><body>
<h1>🧠 agent-context Dashboard</h1>
<div class="grid" id="cards"></div>
<div class="card">
  <h3>Token Usage by Role</h3>
  <div id="roles"></div>
</div>
<div class="card" style="margin-top:16px">
  <h3>Messages</h3>
  <div class="form">
    <select id="role"><option value="user">user</option><option value="system">system</option><option value="assistant">assistant</option><option value="tool">tool</option></select>
    <input id="content" placeholder="Message content..." style="flex:1;min-width:200px">
    <button onclick="addMsg()">Add</button>
    <button onclick="compress()" style="background:#1f6feb">Compress</button>
    <button onclick="clearAll()" style="background:#da3633">Clear</button>
  </div>
  <table><thead><tr><th>Role</th><th>Content</th><th>Tokens</th><th>Priority</th></tr></thead><tbody id="msgs"></tbody></table>
</div>
<div class="auto">Auto-refresh: 3s</div>
<script>
async function api(p,o={}){const r=await fetch(p,o);return r.json()}
async function refresh(){
  const s=await api('/api/stats');
  document.getElementById('cards').innerHTML=\`
    <div class="card"><h3>Current Tokens</h3><div class="val">\${s.currentTokens.toLocaleString()}</div><div class="sub">of \${s.maxTokens.toLocaleString()} max</div></div>
    <div class="card"><h3>Utilization</h3><div class="val">\${s.utilizationPercent}%</div><div class="bar"><div class="bar-fill" style="width:\${Math.min(s.utilizationPercent,100)}%;background:\${s.utilizationPercent>90?'#da3633':s.utilizationPercent>70?'#f0883e':'#3fb950'}"></div></div></div>
    <div class="card"><h3>Messages</h3><div class="val">\${s.messageCount}</div><div class="sub">Peak: \${s.peakTokens.toLocaleString()} tokens</div></div>
    <div class="card"><h3>Remaining</h3><div class="val">\${s.remainingTokens.toLocaleString()}</div><div class="sub">Output reserve: \${s.reserveOutput.toLocaleString()}</div></div>
    <div class="card"><h3>Operations</h3><div class="val">+\${s.totalAdded}</div><div class="sub">\${s.totalTruncated} truncated · \${s.totalCompressed} compressed</div></div>
    <div class="card"><h3>Model</h3><div class="val" style="font-size:18px">\${s.model||'Custom'}</div></div>\`;
  const roleHtml=Object.entries(s.roleCounts||{}).map(([role,count])=>{
    const pct=Math.round((s.roleTokens[role]||0)/s.currentTokens*100);
    return \`<div class="progress-row"><span class="progress-label role-\${role}">\${role}</span><div class="bar" style="flex:1"><div class="bar-fill" style="width:\${pct}%;background:\${role==='system'?'#f0883e':role==='user'?'#58a6ff':role==='assistant'?'#3fb950':'#d2a8ff'}"></div></div><span>\${(s.roleTokens[role]||0).toLocaleString()} tok (\${pct}%)</span></div>\`;
  }).join('');
  document.getElementById('roles').innerHTML=roleHtml||'<p style="color:#8b949e">No messages yet</p>';
  const msgs=await api('/api/last?n=50');
  document.getElementById('msgs').innerHTML=msgs.map(m=>\`<tr><td class="role-\${m.role}">\${m.role}</td><td>\${(typeof m.content==='string'?m.content:'[complex]').slice(0,120)}</td><td>\${m._tokens}</td><td>\${m._priority}</td></tr>\`).join('');
}
async function addMsg(){const c=document.getElementById('content').value;if(!c)return;await api('/api/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:document.getElementById('role').value,content:c})});document.getElementById('content').value='';refresh()}
async function compress(){await api('/api/compress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});refresh()}
async function clearAll(){await api('/api/clear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});refresh()}
refresh();setInterval(refresh,3000);
</script></body></html>`;
