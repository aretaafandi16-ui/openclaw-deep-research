#!/usr/bin/env node
/**
 * agent-guard HTTP Server + Dashboard
 */

import { createServer } from 'node:http';
import { AgentGuard } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3104');
const guard = new AgentGuard({ dataDir: process.env.AGENT_GUARD_DATA_DIR || './data' });
guard.loadAllPresets();

// Pre-load some demo schemas
guard.addSchema('user-input', {
  type: 'object', required: ['name', 'email'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0, maximum: 150 },
  },
});

guard.addProfile('strict-input', {
  description: 'Strict input validation with PII blocking',
  schema: 'user-input',
  rules: ['no-empty-strings', 'no-pii', 'no-sql-injection'],
  contentGuard: { blockPII: true, redact: true },
  rateLimit: { limit: 100, windowMs: 60000 },
});

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(body));
  });
}

const routes = {
  'GET /health': (req, res) => json(res, { status: 'ok', uptime: process.uptime() }),
  'GET /stats': (req, res) => json(res, guard.getStats()),
  'GET /audit': (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    json(res, guard.audit.read({
      limit: parseInt(url.searchParams.get('limit')) || 50,
      operation: url.searchParams.get('operation'),
      action: url.searchParams.get('action'),
    }));
  },
  'GET /schemas': (req, res) => json(res, guard.listSchemas()),
  'GET /rules': (req, res) => json(res, guard.listRules()),
  'GET /profiles': (req, res) => json(res, guard.listProfiles()),
  'POST /validate': async (req, res) => {
    const body = JSON.parse(await readBody(req));
    if (!body.schema || !body.data) return json(res, { error: 'need schema and data' }, 400);
    const schema = typeof body.schema === 'string' ? body.schema : undefined;
    if (typeof body.schema === 'object') guard.addSchema('_inline', body.schema);
    json(res, guard.validate(body.data, schema || '_inline'));
  },
  'POST /guard': async (req, res) => {
    const body = JSON.parse(await readBody(req));
    json(res, guard.guard(body.data, {
      profile: body.profile,
      operation: body.operation || 'api',
      direction: body.direction || 'input',
      schema: body.schema,
      rules: body.rules,
      contentGuard: body.contentGuard,
    }));
  },
  'POST /detect': async (req, res) => {
    const body = JSON.parse(await readBody(req));
    json(res, { pii: guard.detectPII(body.text || ''), profanity: guard.detectProfanity(body.text || '') });
  },
  'POST /redact': async (req, res) => {
    const body = JSON.parse(await readBody(req));
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end(guard.redactPII(body.text || ''));
  },
  'POST /sanitize': async (req, res) => {
    const body = JSON.parse(await readBody(req));
    json(res, { result: guard.sanitizeText(body.text || '', body.rules || {}) });
  },
  'POST /schemas': async (req, res) => {
    const body = JSON.parse(await readBody(req));
    guard.addSchema(body.name, body.schema);
    json(res, { ok: true, message: `Schema '${body.name}' added` });
  },
  'POST /profiles': async (req, res) => {
    const body = JSON.parse(await readBody(req));
    guard.addProfile(body.name, body.profile);
    json(res, { ok: true, message: `Profile '${body.name}' added` });
  },
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const key = `${req.method} ${path}`;

  // Dashboard
  if (key === 'GET /' || key === 'GET /dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(DASHBOARD_HTML);
  }

  if (routes[key]) {
    try { await routes[key](req, res); }
    catch (err) { json(res, { error: err.message }, 500); }
  } else {
    json(res, { error: 'not found', path: key }, 404);
  }
});

server.listen(PORT, () => {
  console.log(`🛡️  agent-guard server on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-guard dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:4px}
h2{color:#8b949e;font-size:14px;margin-bottom:20px}
h3{color:#58a6ff;margin:20px 0 10px;font-size:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:12px;text-transform:uppercase}
.card .value{font-size:28px;font-weight:700;margin-top:4px}
.card .value.green{color:#3fb950}.card .value.red{color:#f85149}.card .value.yellow{color:#d29922}.card .value.blue{color:#58a6ff}
table{width:100%;border-collapse:collapse;margin:10px 0}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #30363d;font-size:13px}
th{color:#8b949e;font-weight:600}
.pass{color:#3fb950}.block{color:#f85149}.warn{color:#d29922}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge-pass{background:#238636;color:#fff}.badge-block{background:#da3633;color:#fff}.badge-warn{background:#9e6a03;color:#fff}
.input-area{display:flex;gap:8px;margin:10px 0}
textarea{flex:1;background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:10px;font-family:monospace;font-size:13px;min-height:100px;resize:vertical}
button{background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-weight:600}
button:hover{background:#2ea043}
#result{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;font-family:monospace;font-size:12px;margin-top:8px;white-space:pre-wrap;max-height:300px;overflow:auto}
select{background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 10px}
</style></head><body>
<h1>🛡️ agent-guard</h1>
<h2>Schema validation & guardrails for AI agents</h2>

<div class="grid" id="stats-grid">
<div class="card"><div class="label">Total Checks</div><div class="value blue" id="total">—</div></div>
<div class="card"><div class="label">Passed</div><div class="value green" id="passed">—</div></div>
<div class="card"><div class="label">Blocked</div><div class="value red" id="blocked">—</div></div>
<div class="card"><div class="label">Warned</div><div class="value yellow" id="warned">—</div></div>
<div class="card"><div class="label">Schemas</div><div class="value" id="schemas">—</div></div>
<div class="card"><div class="label">Profiles</div><div class="value" id="profiles">—</div></div>
</div>

<h3>🔍 Try It</h3>
<div>
<select id="action">
<option value="guard">Guard (full pipeline)</option>
<option value="validate">Validate Schema</option>
<option value="detect">Detect PII/Profanity</option>
<option value="redact">Redact PII</option>
</select>
<select id="profile-select"><option value="">No profile</option></select>
</div>
<div class="input-area">
<textarea id="input" placeholder='{"name":"Alice","email":"alice@example.com"}'></textarea>
<div style="display:flex;flex-direction:column;gap:8px">
<button onclick="runGuard()">Run ▶</button>
<button onclick="clearResult()" style="background:#30363d">Clear</button>
</div>
</div>
<div id="result"></div>

<h3>📋 Recent Audit</h3>
<table><thead><tr><th>Time</th><th>Action</th><th>Operation</th><th>Errors</th><th>Warnings</th></tr></thead>
<tbody id="audit-body"></tbody></table>

<h3>📦 Schemas</h3>
<div id="schemas-list" class="card" style="font-family:monospace;font-size:12px"></div>

<script>
async function api(path,opts){const r=await fetch(path,opts);return r.json()}
async function refresh(){
  try{
    const[s,audit,schemas,profiles]=await Promise.all([
      api('/stats'),api('/audit?limit=20'),api('/schemas'),api('/profiles')
    ]);
    document.getElementById('total').textContent=s.totalChecks;
    document.getElementById('passed').textContent=s.passed;
    document.getElementById('blocked').textContent=s.blocked;
    document.getElementById('warned').textContent=s.warned;
    document.getElementById('schemas').textContent=s.schemas;
    document.getElementById('profiles').textContent=s.profiles;
    const tbody=document.getElementById('audit-body');
    tbody.innerHTML=audit.reverse().map(e=>\`<tr>
      <td>\${new Date(e.timestamp).toLocaleTimeString()}</td>
      <td><span class="badge badge-\${e.action}">\${e.action}</span></td>
      <td>\${e.operation||'—'}</td>
      <td>\${e.errors}</td><td>\${e.warnings}</td></tr>\`).join('');
    const psel=document.getElementById('profile-select');
    const prev=psel.value;
    psel.innerHTML='<option value="">No profile</option>'+profiles.map(p=>\`<option value="\${p.name}">\${p.name} — \${p.description}</option>\`).join('');
    psel.value=prev;
    document.getElementById('schemas-list').textContent=JSON.stringify(schemas,null,2);
  }catch(e){}
}
async function runGuard(){
  const action=document.getElementById('action').value;
  const input=document.getElementById('input').value;
  const profile=document.getElementById('profile-select').value;
  const result=document.getElementById('result');
  try{
    let data;
    try{data=JSON.parse(input)}catch{data=input}
    let r;
    if(action==='guard'){
      r=await api('/guard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data,profile:profile||undefined,operation:'dashboard'})});
    }else if(action==='validate'){
      r=await api('/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema:'user-input',data})});
    }else if(action==='detect'){
      r=await api('/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:typeof data==='string'?data:JSON.stringify(data)})});
    }else if(action==='redact'){
      const resp=await api('/redact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:typeof data==='string'?data:JSON.stringify(data)})});
      r={redacted:resp};
    }
    result.textContent=JSON.stringify(r,null,2);
    setTimeout(refresh,500);
  }catch(e){result.textContent='Error: '+e.message}
}
function clearResult(){document.getElementById('result').textContent=''}
refresh();setInterval(refresh,5000);
</script></body></html>`;
