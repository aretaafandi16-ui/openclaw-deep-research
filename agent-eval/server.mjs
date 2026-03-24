#!/usr/bin/env node
/**
 * agent-eval HTTP Server + Dashboard
 *
 * Endpoints:
 *   GET  /              — Dashboard UI
 *   GET  /api/suites    — List suites
 *   POST /api/suites    — Create suite
 *   GET  /api/suites/:name — Get suite cases
 *   POST /api/suites/:name/cases — Add case
 *   DELETE /api/suites/:name/cases/:id — Remove case
 *   POST /api/suites/:name/run — Run suite
 *   GET  /api/suites/:name/history — Run history
 *   POST /api/score     — Score output
 *   GET  /api/scorers   — List scorers
 *   GET  /api/health    — Health check
 */

import { createServer } from 'node:http';
import { EvalSuite, BenchmarkRunner, Scorers, generateReport } from './index.mjs';

const suites = new Map();

function getSuite(name, create = true) {
  if (!suites.has(name) && create) suites.set(name, new EvalSuite({ name }));
  return suites.get(name);
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    // Dashboard
    if (path === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(DASHBOARD_HTML);
    }

    // Health
    if (path === '/api/health') return json(res, { status: 'ok', suites: suites.size, uptime: process.uptime() });

    // Scorers
    if (path === '/api/scorers') return json(res, Object.keys(Scorers));

    // Score
    if (path === '/api/score' && method === 'POST') {
      const body = await readBody(req);
      const scorer = body.scorer || 'contains';
      const fn = Scorers[scorer];
      if (!fn) return json(res, { error: `Unknown scorer: ${scorer}` }, 400);
      return json(res, fn(body.expected, body.actual, body.opts || {}));
    }

    // Suites list
    if (path === '/api/suites' && method === 'GET') {
      const list = [...suites.values()].map(s => ({ name: s.name, description: s.description, cases: s.cases.length }));
      return json(res, list);
    }

    // Create suite
    if (path === '/api/suites' && method === 'POST') {
      const body = await readBody(req);
      const suite = new EvalSuite(body);
      suites.set(body.name || `suite_${Date.now()}`, suite);
      return json(res, { name: suite.name, created: true });
    }

    // Suite detail
    const suiteMatch = path.match(/^\/api\/suites\/([^/]+)$/);
    if (suiteMatch && method === 'GET') {
      const suite = getSuite(suiteMatch[1], false);
      if (!suite) return json(res, { error: 'Suite not found' }, 404);
      return json(res, { name: suite.name, description: suite.description, cases: suite.cases });
    }

    // Add case
    const caseMatch = path.match(/^\/api\/suites\/([^/]+)\/cases$/);
    if (caseMatch && method === 'POST') {
      const suite = getSuite(caseMatch[1]);
      const body = await readBody(req);
      const tc = suite.add(body);
      return json(res, tc, 201);
    }

    // Remove case
    const removeMatch = path.match(/^\/api\/suites\/([^/]+)\/cases\/([^/]+)$/);
    if (removeMatch && method === 'DELETE') {
      const suite = getSuite(removeMatch[1], false);
      if (!suite) return json(res, { error: 'Suite not found' }, 404);
      const ok = suite.remove(decodeURIComponent(removeMatch[2]));
      return json(res, { removed: ok });
    }

    // Run suite
    const runMatch = path.match(/^\/api\/suites\/([^/]+)\/run$/);
    if (runMatch && method === 'POST') {
      const suite = getSuite(runMatch[1], false);
      if (!suite) return json(res, { error: 'Suite not found' }, 404);
      const body = await readBody(req);
      const { runId, results, summary } = await suite.run(async (input) => input, { parallel: body.parallel, concurrency: body.concurrency });
      return json(res, { runId, summary, results });
    }

    // History
    const historyMatch = path.match(/^\/api\/suites\/([^/]+)\/history$/);
    if (historyMatch && method === 'GET') {
      const suite = getSuite(historyMatch[1], false);
      if (!suite) return json(res, { error: 'Suite not found' }, 404);
      return json(res, suite.getHistory());
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
});

const PORT = parseInt(process.env.PORT || '3106');
server.listen(PORT, () => console.log(`agent-eval dashboard: http://localhost:${PORT}`));

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-eval Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
.header{background:linear-gradient(135deg,#1a1b26,#24283b);padding:24px 32px;border-bottom:1px solid #30363d}
.header h1{font-size:24px;color:#7aa2f7}.header p{color:#9aa5b4;margin-top:4px;font-size:14px}
.container{max-width:1200px;margin:0 auto;padding:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px}
.card{background:#1a1b26;border:1px solid #30363d;border-radius:12px;padding:20px}
.card h3{font-size:14px;color:#9aa5b4;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px}
.card .value{font-size:28px;font-weight:700;color:#73daca}
.card .sub{font-size:13px;color:#565f89;margin-top:4px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;color:#9aa5b4;font-size:12px;text-transform:uppercase;border-bottom:1px solid #30363d}
td{padding:10px 12px;border-bottom:1px solid #21262d;font-size:14px}
.pass{color:#73daca}.fail{color:#f7768e}.warn{color:#e0af68}
button{background:#7aa2f7;color:#1a1b26;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px}
button:hover{background:#89b4fa}
input,textarea,select{background:#1a1b26;border:1px solid #30363d;color:#e1e4e8;padding:8px 12px;border-radius:6px;font-size:14px;width:100%}
.form-row{display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.form-row>*{flex:1;min-width:200px}
.section{margin-bottom:32px}
.section h2{font-size:18px;color:#c0caf5;margin-bottom:16px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge.pass{background:#1a3a2a;color:#73daca}.badge.fail{background:#3a1a1a;color:#f7768e}
</style></head><body>
<div class="header"><h1>🧪 agent-eval Dashboard</h1><p>Evaluate & benchmark AI agent outputs</p></div>
<div class="container">
<div class="grid" id="stats"></div>
<div class="section"><h2>Quick Score</h2>
<div class="form-row">
  <div><label>Expected</label><textarea id="qExpected" rows="2" placeholder="Expected output"></textarea></div>
  <div><label>Actual</label><textarea id="qActual" rows="2" placeholder="Actual output"></textarea></div>
  <div><label>Scorer</label><select id="qScorer"><option value="exact">Exact</option><option value="contains" selected>Contains</option><option value="regex">Regex</option><option value="similarity">Similarity</option><option value="json_schema">JSON Schema</option><option value="numeric">Numeric</option><option value="length">Length</option><option value="notEmpty">Not Empty</option></select></div>
</div>
<button onclick="quickScore()">Score</button>
<pre id="scoreResult" style="margin-top:12px;padding:12px;background:#16161e;border-radius:8px;max-height:200px;overflow:auto;display:none"></pre>
</div>
<div class="section"><h2>Test Suites</h2>
<div class="form-row"><input id="suiteName" placeholder="Suite name"><button onclick="createSuite()">Create Suite</button></div>
<div id="suiteList"></div></div>
<div class="section"><h2>Run History</h2><div id="history"></div></div>
</div>
<script>
const API='';
async function load(){
  try{
    const suites=await fetch(API+'/api/suites').then(r=>r.json());
    document.getElementById('stats').innerHTML=\`
      <div class="card"><h3>Total Suites</h3><div class="value">\${suites.length}</div></div>
      <div class="card"><h3>Total Cases</h3><div class="value">\${suites.reduce((s,x)=>s+x.cases,0)}</div></div>
    \`;
    const html=suites.map(s=>\`<div class="card"><h3>\${s.name}</h3><div class="value">\${s.cases}</div><div class="sub">test cases</div></div>\`).join('');
    document.getElementById('suiteList').innerHTML=\`<div class="grid">\${html || '<p style="color:#565f89">No suites yet. Create one above.</p>'}</div>\`;
  }catch(e){console.error(e)}
}
async function quickScore(){
  const expected=document.getElementById('qExpected').value;
  const actual=document.getElementById('qActual').value;
  const scorer=document.getElementById('qScorer').value;
  const r=await fetch(API+'/api/score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected,actual,scorer})}).then(r=>r.json());
  const el=document.getElementById('scoreResult');
  el.style.display='block';
  el.innerHTML=\`<span class="\${r.pass?'pass':'fail'}">\${r.pass?'✅ PASS':'❌ FAIL'}</span> — \${r.detail}\\nScore: \${r.score}\\n\${JSON.stringify(r,null,2)}\`;
}
async function createSuite(){
  const name=document.getElementById('suiteName').value;
  if(!name)return;
  await fetch(API+'/api/suites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  document.getElementById('suiteName').value='';
  load();
}
load();setInterval(load,10000);
</script></body></html>`;

export default server;
