#!/usr/bin/env node
/**
 * agent-log HTTP Server + Web Dashboard
 *
 * Endpoints:
 *   GET  /              — Dashboard UI
 *   GET  /health        — Health check
 *   POST /log           — Write a log entry { level, message, context?, meta? }
 *   GET  /logs          — Query logs (?level, context, search, correlationId, since, until, limit)
 *   GET  /stats         — Log statistics
 *   GET  /stream        — SSE stream of new log entries
 *   POST /child         — Create & use a child logger { name, context?, level?, message }
 *   GET  /export        — Download all logs as JSON
 */

import { createServer } from "http";
import { Logger, ConsoleTransport, FileTransport, LEVELS } from "./index.mjs";

const PORT = parseInt(process.env.PORT || "3115");
const LOG_FILE = process.env.AGENT_LOG_FILE || "./agent-log.jsonl";

const logger = new Logger({
  name: "agent-log",
  level: "trace",
  transports: [
    new FileTransport({ path: LOG_FILE, level: "trace" }),
  ],
});

// SSE clients
const sseClients = new Set();
logger.on("log", (entry) => {
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { sseClients.delete(res); }
  }
});

function parseUrl(url) {
  const [path, qs] = url.split("?");
  const params = {};
  if (qs) for (const p of qs.split("&")) {
    const [k, v] = p.split("=");
    params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return { path, params };
}

function json(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data));
}

function html(res, content, status = 200) {
  res.writeHead(status, { "content-type": "text/html" });
  res.end(content);
}

// ── Dashboard HTML ─────────────────────────────────────────────────

function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-log · Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:8px;font-size:1.5rem}
.subtitle{color:#8b949e;margin-bottom:20px;font-size:.85rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{color:#8b949e;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
.card .value{color:#c9d1d9;font-size:1.5rem;font-weight:700;margin-top:4px}
.card .value.info{color:#58a6ff}.card .value.warn{color:#d29922}
.card .value.error{color:#f85149}.card .value.fatal{color:#f778ba}
.card .value.debug{color:#7ee787}.card .value.trace{color:#8b949e}
.level-bar{display:flex;height:24px;border-radius:4px;overflow:hidden;margin-bottom:20px}
.level-bar div{display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:600;min-width:30px}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #30363d;font-weight:600}
td{padding:6px 8px;border-bottom:1px solid #21262d;vertical-align:top}
.level-tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:600;text-transform:uppercase}
.level-tag.trace{background:#21262d;color:#8b949e}
.level-tag.debug{background:#0d4429;color:#7ee787}
.level-tag.info{background:#0d419d;color:#58a6ff}
.level-tag.warn{background:#4b3008;color:#d29922}
.level-tag.error{background:#4e0707;color:#f85149}
.level-tag.fatal{background:#3d0f3a;color:#f778ba}
.ctx{color:#d2a8ff;font-size:.75rem}
.meta{color:#8b949e;font-size:.72rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.controls{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.controls input,.controls select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:6px;font-size:.82rem}
.controls input{width:220px}
.controls select{min-width:100px}
.controls button{background:#238636;border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.82rem}
.controls button:hover{background:#2ea043}
.auto{display:flex;align-items:center;gap:6px;font-size:.78rem;color:#8b949e}
.auto input{accent-color:#58a6ff}
.live-dot{width:8px;height:8px;border-radius:50%;background:#238636;display:inline-block;animation:pulse 2s infinite;margin-right:4px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style></head><body>
<h1>🐋 agent-log Dashboard</h1>
<div class="subtitle"><span class="live-dot"></span>Real-time structured logging · port ${PORT}</div>
<div class="grid" id="stats"></div>
<div id="levelBar" class="level-bar"></div>
<div class="controls">
  <input id="search" placeholder="Search logs..." oninput="loadLogs()">
  <select id="levelFilter" onchange="loadLogs()">
    <option value="">All levels</option>
    <option value="trace">Trace</option><option value="debug">Debug</option>
    <option value="info">Info</option><option value="warn">Warn</option>
    <option value="error">Error</option><option value="fatal">Fatal</option>
  </select>
  <input id="ctxFilter" placeholder="Context filter..." oninput="loadLogs()">
  <button onclick="loadLogs()">Refresh</button>
  <label class="auto"><input type="checkbox" id="autoRefresh" checked onchange="toggleAuto()"> Auto-refresh</label>
  <label class="auto"><input type="checkbox" id="liveMode" onchange="toggleLive()"> Live (SSE)</label>
</div>
<table><thead><tr><th>Time</th><th>Level</th><th>Context</th><th>Message</th><th>Meta</th></tr></thead><tbody id="logs"></tbody></table>
<script>
let autoTimer=null,sse=null;
const LEVEL_COLORS={trace:'#8b949e',debug:'#7ee787',info:'#58a6ff',warn:'#d29922',error:'#f85149',fatal:'#f778ba'};
function loadStats(){fetch('/stats').then(r=>r.json()).then(s=>{
  const el=document.getElementById('stats');
  el.innerHTML=Object.entries(s.byLevel).map(([l,c])=>\`<div class="card"><div class="label">\${l}</div><div class="value \${l}">\${c}</div></div>\`).join('')
    +\`<div class="card"><div class="label">Total</div><div class="value">\${s.total}</div></div>\`
    +\`<div class="card"><div class="label">File Size</div><div class="value">\${s.sizeFormatted||'0 B'}</div></div>\`;
  const total=s.total||1;const bar=document.getElementById('levelBar');
  bar.innerHTML=Object.entries(s.byLevel).map(([l,c])=>\`<div style="width:\${(c/total*100).toFixed(1)}%;background:\${LEVEL_COLORS[l]||'#30363d'}">\${c}</div>\`).join('');
})}
function loadLogs(){
  const p=new URLSearchParams();const s=document.getElementById('search').value;
  const l=document.getElementById('levelFilter').value;const c=document.getElementById('ctxFilter').value;
  if(s)p.set('search',s);if(l)p.set('level',l);if(c)p.set('context',c);p.set('limit','200');
  fetch('/logs?'+p).then(r=>r.json()).then(logs=>{
    document.getElementById('logs').innerHTML=logs.map(e=>\`<tr>
      <td style="white-space:nowrap;color:#8b949e;font-size:.72rem">\${(e.timestamp||'').slice(11,23)}</td>
      <td><span class="level-tag \${e.level}">\${e.level}</span></td>
      <td class="ctx">\${e.context||e.logger||''}</td>
      <td>\${esc(e.message||'')}</td>
      <td class="meta">\${metaStr(e)}</td></tr>\`).join('');
  });loadStats();
}
function esc(s){return s.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function metaStr(e){const m={...e};delete m.timestamp;delete m.level;delete m.message;delete m.context;delete m.logger;delete m.pid;delete m.hostname;delete m.seq;delete m.correlationId;const s=JSON.stringify(m);return s==='{}'?'':s.slice(0,120)}
function toggleAuto(){if(document.getElementById('autoRefresh').checked){autoTimer=setInterval(loadLogs,3000)}else{clearInterval(autoTimer);autoTimer=null}}
function toggleLive(){const el=document.getElementById('liveMode');if(el.checked){sse=new EventSource('/stream');sse.onmessage=e=>{try{const d=JSON.parse(e.data);const tr=document.createElement('tr');tr.innerHTML=\`<td style="white-space:nowrap;color:#8b949e;font-size:.72rem">\${(d.timestamp||'').slice(11,23)}</td><td><span class="level-tag \${d.level}">\${d.level}</span></td><td class="ctx">\${d.context||d.logger||''}</td><td>\${esc(d.message||'')}</td><td class="meta">\${metaStr(d)}</td>\`;const tb=document.getElementById('logs');tb.insertBefore(tr,tb.firstChild);if(tb.children.length>300)tb.removeChild(tb.lastChild)}catch{}}loadStats()}else{if(sse)try{sse.close()}catch{}sse=null}}
toggleAuto();loadLogs();
</script></body></html>`;
}

// ── Server ─────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const { path, params } = parseUrl(req.url);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    res.end(); return;
  }

  try {
    // Dashboard
    if (path === "/" || path === "/dashboard") { html(res, dashboardHtml()); return; }

    // Health
    if (path === "/health") { json(res, { status: "ok", logFile: LOG_FILE, uptime: process.uptime() }); return; }

    // Write log
    if (path === "/log" && req.method === "POST") {
      const body = await readBody(req);
      const { level = "info", message, context, meta = {} } = JSON.parse(body);
      if (!message) { json(res, { error: "message required" }, 400); return; }
      if (context) {
        const child = logger.child({ name: context, context: { name: context } });
        child[level]?.(message, meta);
      } else {
        logger[level]?.(message, meta);
      }
      json(res, { logged: true, level, timestamp: new Date().toISOString() }); return;
    }

    // Query logs
    if (path === "/logs") {
      const opts = {};
      if (params.level) opts.level = params.level;
      if (params.context) opts.context = params.context;
      if (params.search) opts.search = params.search;
      if (params.correlationId) opts.correlationId = params.correlationId;
      if (params.since) opts.since = params.since;
      if (params.until) opts.until = params.until;
      opts.limit = parseInt(params.limit || "200");
      json(res, Logger.readJsonl(LOG_FILE, opts)); return;
    }

    // Stats
    if (path === "/stats") { json(res, Logger.statsJsonl(LOG_FILE)); return; }

    // SSE stream
    if (path === "/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
      res.write("retry: 1000\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // Child logger
    if (path === "/child" && req.method === "POST") {
      const body = await readBody(req);
      const { name, context, level = "info", message } = JSON.parse(body);
      if (!name || !message) { json(res, { error: "name and message required" }, 400); return; }
      const child = logger.child({ name, context: { name: context || name } });
      child[level]?.(message);
      json(res, { created: true, name }); return;
    }

    // Export
    if (path === "/export") {
      const opts = {};
      if (params.level) opts.level = params.level;
      if (params.context) opts.context = params.context;
      opts.limit = parseInt(params.limit || "10000");
      json(res, Logger.readJsonl(LOG_FILE, opts)); return;
    }

    json(res, { error: "Not found" }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => data += c);
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  logger.info(`agent-log HTTP server started on port ${PORT}`);
  console.log(`🐋 agent-log dashboard: http://localhost:${PORT}`);
});

process.on("SIGTERM", () => { logger.destroy(); process.exit(0); });
process.on("SIGINT", () => { logger.destroy(); process.exit(0); });
