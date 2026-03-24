#!/usr/bin/env node
/**
 * agent-trace v1.0 — Zero-dep distributed tracing for AI agents
 * 
 * Track LLM calls, tool executions, agent decisions, errors.
 * Timeline view, span trees, performance metrics, search.
 */

import { createServer } from 'http';
import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── ID Generator ───────────────────────────────────────────────
let _counter = 0;
function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}-${(_counter++).toString(36)}`;
}

// ─── TraceStore ─────────────────────────────────────────────────
class TraceStore extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dir = opts.dir || join(__dirname, 'data');
    this.maxSpans = opts.maxSpans || 10000;
    this.persist = opts.persist !== false;
    this.spans = [];
    this.activeSpans = new Map(); // spanId -> span
    this.stats = { total: 0, errors: 0, byType: {}, byService: {} };
    this._timers = new Map();

    if (this.persist) {
      try { mkdirSync(this.dir, { recursive: true }); } catch {}
      this._restore();
    }
  }

  // Start a new span
  startSpan(name, opts = {}) {
    const span = {
      id: generateId(),
      traceId: opts.traceId || generateId(),
      parentId: opts.parentId || null,
      name,
      type: opts.type || 'span', // span, llm, tool, decision, error, custom
      service: opts.service || 'default',
      status: 'active',
      startTime: Date.now(),
      endTime: null,
      duration: null,
      attributes: opts.attributes || {},
      events: [],
      error: null,
      tags: opts.tags || [],
    };

    this.activeSpans.set(span.id, span);
    this._timers.set(span.id, span.startTime);
    this.stats.total++;
    this.stats.byType[span.type] = (this.stats.byType[span.type] || 0) + 1;
    this.stats.byService[span.service] = (this.stats.byService[span.service] || 0) + 1;

    this.emit('span:start', span);
    return span;
  }

  // End a span
  endSpan(spanId, result = {}) {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = result.error ? 'error' : 'ok';
    span.error = result.error || null;
    if (result.attributes) Object.assign(span.attributes, result.attributes);

    this.activeSpans.delete(spanId);
    this._timers.delete(spanId);

    if (span.status === 'error') this.stats.errors++;

    this.spans.push(span);
    if (this.spans.length > this.maxSpans) {
      this.spans = this.spans.slice(-this.maxSpans);
    }

    this.emit('span:end', span);
    if (this.persist) this._persistSpan(span);
    return span;
  }

  // Add event to active span
  addEvent(spanId, name, data = {}) {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;
    const event = { name, timestamp: Date.now(), data };
    span.events.push(event);
    this.emit('span:event', { spanId, event });
    return event;
  }

  // Record an error on active span
  recordError(spanId, error, fatal = false) {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;
    span.error = { message: error.message || String(error), stack: error.stack, fatal };
    if (fatal) {
      span.status = 'error';
      span.endTime = Date.now();
      span.duration = span.endTime - span.startTime;
      this.activeSpans.delete(spanId);
      this._timers.delete(spanId);
      this.stats.errors++;
      this.spans.push(span);
      if (this.persist) this._persistSpan(span);
    }
    this.emit('span:error', { spanId, error: span.error });
    return span;
  }

  // Convenience: trace an async function
  async trace(name, fn, opts = {}) {
    const span = this.startSpan(name, opts);
    try {
      const result = await fn(span);
      this.endSpan(span.id, { attributes: { success: true } });
      return result;
    } catch (err) {
      this.endSpan(span.id, { error: { message: err.message, stack: err.stack } });
      throw err;
    }
  }

  // Convenience: trace an LLM call
  async traceLLM(model, fn, opts = {}) {
    return this.trace(`llm:${model}`, fn, {
      ...opts,
      type: 'llm',
      attributes: { model, ...opts.attributes },
    });
  }

  // Convenience: trace a tool call
  async traceTool(toolName, fn, opts = {}) {
    return this.trace(`tool:${toolName}`, fn, {
      ...opts,
      type: 'tool',
      attributes: { tool: toolName, ...opts.attributes },
    });
  }

  // Query spans
  query(opts = {}) {
    let results = [...this.spans];

    if (opts.traceId) results = results.filter(s => s.traceId === opts.traceId);
    if (opts.type) results = results.filter(s => s.type === opts.type);
    if (opts.service) results = results.filter(s => s.service === opts.service);
    if (opts.status) results = results.filter(s => s.status === opts.status);
    if (opts.name) results = results.filter(s => s.name.includes(opts.name));
    if (opts.error) results = results.filter(s => s.status === 'error');
    if (opts.since) results = results.filter(s => s.startTime >= opts.since);
    if (opts.until) results = results.filter(s => s.startTime <= opts.until);
    if (opts.minDuration) results = results.filter(s => (s.duration || 0) >= opts.minDuration);
    if (opts.tag) results = results.filter(s => s.tags.includes(opts.tag));

    // Sort
    const sort = opts.sort || 'startTime';
    const order = opts.order === 'asc' ? 1 : -1;
    results.sort((a, b) => (a[sort] - b[sort]) * order);

    // Pagination
    if (opts.offset) results = results.slice(opts.offset);
    if (opts.limit) results = results.slice(0, opts.limit);

    return results;
  }

  // Get a single trace (all spans with same traceId)
  getTrace(traceId) {
    return this.spans.filter(s => s.traceId === traceId).sort((a, b) => a.startTime - b.startTime);
  }

  // Build span tree for a trace
  buildTree(traceId) {
    const spans = this.getTrace(traceId);
    const map = new Map();
    const roots = [];

    for (const s of spans) map.set(s.id, { ...s, children: [] });
    for (const s of spans) {
      const node = map.get(s.id);
      if (s.parentId && map.has(s.parentId)) {
        map.get(s.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  // Timeline view (text)
  timeline(traceId) {
    const tree = this.buildTree(traceId);
    const lines = [];

    function walk(nodes, depth = 0) {
      for (const n of nodes) {
        const indent = '  '.repeat(depth);
        const icon = n.status === 'error' ? '❌' : n.type === 'llm' ? '🤖' : n.type === 'tool' ? '🔧' : '📍';
        const dur = n.duration != null ? `(${n.duration}ms)` : '(active)';
        const err = n.error ? ` ERROR: ${n.error.message}` : '';
        lines.push(`${indent}${icon} ${n.name} ${dur}${err}`);
        if (n.children.length) walk(n.children, depth + 1);
      }
    }

    if (tree.length === 0) return '(empty trace)';
    walk(tree);
    return lines.join('\n');
  }

  // Performance stats
  perfStats(opts = {}) {
    const spans = this.query(opts);
    const durations = spans.map(s => s.duration).filter(d => d != null);
    if (durations.length === 0) return { count: 0 };

    durations.sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p90 = durations[Math.floor(durations.length * 0.9)];
    const p99 = durations[Math.floor(durations.length * 0.99)];

    const byType = {};
    for (const s of spans) {
      if (!byType[s.type]) byType[s.type] = { count: 0, totalDuration: 0, errors: 0 };
      byType[s.type].count++;
      byType[s.type].totalDuration += (s.duration || 0);
      if (s.status === 'error') byType[s.type].errors++;
    }

    return {
      count: spans.length,
      avgDuration: Math.round(sum / durations.length),
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p50, p90, p99,
      errorRate: spans.filter(s => s.status === 'error').length / spans.length,
      byType,
    };
  }

  // Export spans as JSONL
  exportJSONL(opts = {}) {
    return this.query(opts).map(s => JSON.stringify(s)).join('\n');
  }

  // Active spans
  getActive() {
    return [...this.activeSpans.values()];
  }

  // Clear
  clear() {
    this.spans = [];
    this.activeSpans.clear();
    this._timers.clear();
    this.stats = { total: 0, errors: 0, byType: {}, byService: {} };
    this.emit('clear');
  }

  // ─── Persistence ─────────────────────────────────────────────
  _persistSpan(span) {
    try {
      appendFileSync(join(this.dir, 'spans.jsonl'), JSON.stringify(span) + '\n');
    } catch {}
  }

  _restore() {
    const file = join(this.dir, 'spans.jsonl');
    if (!existsSync(file)) return;
    try {
      const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines.slice(-this.maxSpans)) {
        try {
          const span = JSON.parse(line);
          this.spans.push(span);
          this.stats.total++;
          this.stats.byType[span.type] = (this.stats.byType[span.type] || 0) + 1;
          this.stats.byService[span.service] = (this.stats.byService[span.service] || 0) + 1;
          if (span.status === 'error') this.stats.errors++;
        } catch {}
      }
    } catch {}
  }
}

// ─── HTTP Server ────────────────────────────────────────────────
function createHTTPServer(store, port = 3105) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-trace</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0e17;color:#c9d1d9;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:13px;padding:20px}
h1{color:#58a6ff;margin-bottom:16px;font-size:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
.card h3{color:#8b949e;font-size:11px;text-transform:uppercase;margin-bottom:6px}
.card .val{font-size:22px;font-weight:700;color:#58a6ff}
.card .val.err{color:#f85149}
.card .val.ok{color:#3fb950}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{background:#161b22;color:#8b949e;font-size:11px;text-transform:uppercase;text-align:left;padding:8px;border-bottom:1px solid #30363d}
td{padding:8px;border-bottom:1px solid #21262d}
tr:hover{background:#161b22}
.badge{padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}
.badge.ok{background:#1a3a2a;color:#3fb950}
.badge.error{background:#3a1a1a;color:#f85149}
.badge.active{background:#1a2a3a;color:#58a6ff}
.badge.llm{background:#2a1a3a;color:#bc8cff}
.badge.tool{background:#3a2a1a;color:#d29922}
.type-icon{margin-right:4px}
a{color:#58a6ff;text-decoration:none}
.panel{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:16px 0}
.panel h2{color:#c9d1d9;font-size:14px;margin-bottom:12px}
input,select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:6px;font-family:inherit;font-size:12px}
select{margin-left:8px}
button{background:#238636;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px}
button:hover{background:#2ea043}
.search-bar{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
.timeline{white-space:pre-line;line-height:1.8}
.trace-tree{padding-left:0}
.trace-tree li{list-style:none;padding:2px 0}
.trace-tree ul{padding-left:24px;border-left:1px solid #30363d;margin-left:8px}
</style></head><body>
<h1>🐋 agent-trace <span style="font-size:12px;color:#8b949e">v1.0</span></h1>
<div class="grid" id="stats"></div>
<div class="search-bar">
  <input id="q" placeholder="Search spans..." style="width:240px">
  <select id="type"><option value="">All types</option><option value="llm">LLM</option><option value="tool">Tool</option><option value="span">Span</option><option value="decision">Decision</option><option value="error">Error</option></select>
  <select id="status"><option value="">All status</option><option value="ok">OK</option><option value="error">Error</option><option value="active">Active</option></select>
  <button onclick="load()">Search</button>
</div>
<div class="panel"><h2>Spans</h2><div id="spans"></div></div>
<div class="panel"><h2>Active Spans</h2><div id="active"></div></div>
<div class="panel"><h2>Performance</h2><div id="perf"></div></div>
<script>
async function api(p){return(await fetch(p)).json()}
async function load(){
  const q=document.getElementById('q').value;
  const t=document.getElementById('type').value;
  const s=document.getElementById('status').value;
  let url='/api/spans?limit=100';
  if(q)url+='&name='+q;
  if(t)url+='&type='+t;
  if(s)url+='&status='+s;
  const[st,sp,ac,pf]=await Promise.all([api('/api/stats'),api(url),api('/api/active'),api('/api/perf')]);
  document.getElementById('stats').innerHTML=
    '<div class="card"><h3>Total Spans</h3><div class="val">'+st.total+'</div></div>'+
    '<div class="card"><h3>Errors</h3><div class="val err">'+st.errors+'</div></div>'+
    '<div class="card"><h3>Error Rate</h3><div class="val '+(st.errors/st.total>0.1?'err':'ok')+'">'+(st.total?((st.errors/st.total*100).toFixed(1)):'0')+'%</div></div>'+
    '<div class="card"><h3>Active</h3><div class="val">'+ac.length+'</div></div>'+
    '<div class="card"><h3>Avg Duration</h3><div class="val">'+(pf.avgDuration||0)+'ms</div></div>'+
    '<div class="card"><h3>P99</h3><div class="val">'+(pf.p99||0)+'ms</div></div>';
  const icons={llm:'🤖',tool:'🔧',span:'📍',decision:'🧠',error:'❌',custom:'⭐'};
  document.getElementById('spans').innerHTML='<table><tr><th></th><th>Name</th><th>Type</th><th>Status</th><th>Duration</th><th>Service</th><th>Trace</th></tr>'+
    sp.spans.map(s=>'<tr><td>'+(icons[s.type]||'')+'</td><td>'+s.name+'</td><td><span class="badge '+(s.type==='llm'?'llm':'tool')+'">'+s.type+'</span></td><td><span class="badge '+(s.status==='error'?'error':'ok')+'">'+s.status+'</span></td><td>'+(s.duration||0)+'ms</td><td>'+s.service+'</td><td><a href="#" onclick="showTrace(\\''+s.traceId+'\\')">'+s.traceId.slice(0,8)+'…</a></td></tr>').join('')+'</table>';
  document.getElementById('active').innerHTML=ac.length?ac.map(s=>'<div class="card" style="margin:4px 0"><strong>'+(icons[s.type]||'')+s.name+'</strong> <span class="badge active">active</span> started '+new Date(s.startTime).toLocaleTimeString()+'</div>').join(''):'<p style="color:#8b949e">No active spans</p>';
  document.getElementById('perf').innerHTML=
    '<p>Avg: <strong>'+pf.avgDuration+'ms</strong> | P50: '+pf.p50+'ms | P90: '+pf.p90+'ms | P99: '+pf.p99+'ms | Min: '+pf.minDuration+'ms | Max: '+pf.maxDuration+'ms</p>'+
    (pf.byType?'<table style="margin-top:8px"><tr><th>Type</th><th>Count</th><th>Avg Duration</th><th>Errors</th></tr>'+
    Object.entries(pf.byType).map(([k,v])=>'<tr><td>'+k+'</td><td>'+v.count+'</td><td>'+Math.round(v.totalDuration/v.count)+'ms</td><td>'+v.errors+'</td></tr>').join('')+'</table>':'');
}
async function showTrace(tid){
  const d=await api('/api/traces/'+tid);
  const lines=d.timeline.split('\\n');
  document.getElementById('spans').innerHTML='<div class="timeline">'+lines.map(l=>l).join('<br>')+'</div>';
}
load();setInterval(load,5000);
</script></body></html>`;

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const json = (data, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    };

    if (url.pathname === '/' || url.pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }

    if (url.pathname === '/api/stats') return json(store.stats);
    if (url.pathname === '/api/active') return json(store.getActive());

    if (url.pathname === '/api/spans') {
      const opts = {};
      for (const k of ['type', 'service', 'status', 'name', 'traceId', 'tag']) {
        if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
      }
      if (url.searchParams.get('error')) opts.error = true;
      if (url.searchParams.get('since')) opts.since = Number(url.searchParams.get('since'));
      if (url.searchParams.get('limit')) opts.limit = Number(url.searchParams.get('limit'));
      if (url.searchParams.get('minDuration')) opts.minDuration = Number(url.searchParams.get('minDuration'));
      return json({ spans: store.query(opts) });
    }

    if (url.pathname.startsWith('/api/traces/')) {
      const traceId = url.pathname.split('/api/traces/')[1];
      return json({ trace: store.getTrace(traceId), tree: store.buildTree(traceId), timeline: store.timeline(traceId) });
    }

    if (url.pathname === '/api/perf') {
      const opts = {};
      if (url.searchParams.get('type')) opts.type = url.searchParams.get('type');
      if (url.searchParams.get('service')) opts.service = url.searchParams.get('service');
      return json(store.perfStats(opts));
    }

    if (url.pathname === '/api/export') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(store.exportJSONL());
    }

    if (url.pathname === '/api/clear' && req.method === 'POST') {
      store.clear();
      return json({ ok: true });
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', active: store.getActive().length, total: store.stats.total });
    }

    json({ error: 'not found' }, 404);
  });

  server.listen(port, () => console.log(`agent-trace dashboard: http://localhost:${port}`));
  return server;
}

export { TraceStore, createHTTPServer, generateId };

// ─── CLI Entry ──────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].includes('agent-trace');
if (isMain) {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'serve';
  const store = new TraceStore();

  if (cmd === 'serve') {
    const port = Number(args.find(a => a.startsWith('--port='))?.split('=')[1] || 3105);
    createHTTPServer(store, port);
  } else if (cmd === 'demo') {
    // Run a demo trace
    console.log('Running demo trace...\n');
    (async () => {
      const traceId = generateId();

      // Simulate an agent workflow
      const root = store.startSpan('agent:plan', { traceId, type: 'decision', attributes: { task: 'Analyze market data' } });
      await new Promise(r => setTimeout(r, 50));

      const llm1 = store.startSpan('llm:gpt-4o', { traceId, parentId: root.id, type: 'llm', attributes: { model: 'gpt-4o', tokens: 1250 } });
      await new Promise(r => setTimeout(r, 320));
      store.endSpan(llm1.id, { attributes: { completion_tokens: 450 } });

      const tool1 = store.startSpan('tool:web_search', { traceId, parentId: root.id, type: 'tool', attributes: { query: 'BTC price today' } });
      await new Promise(r => setTimeout(r, 180));
      store.endSpan(tool1.id);

      const llm2 = store.startSpan('llm:gpt-4o', { traceId, parentId: root.id, type: 'llm', attributes: { model: 'gpt-4o', tokens: 2100 } });
      await new Promise(r => setTimeout(r, 450));
      store.endSpan(llm2.id);

      const tool2 = store.startSpan('tool:execute_trade', { traceId, parentId: root.id, type: 'tool', attributes: { symbol: 'BTC', action: 'buy' } });
      store.addEvent(tool2.id, 'order_placed', { orderId: 'abc123' });
      await new Promise(r => setTimeout(r, 100));
      store.endSpan(tool2.id);

      // Error span
      const tool3 = store.startSpan('tool:notify', { traceId, parentId: root.id, type: 'tool' });
      await new Promise(r => setTimeout(r, 30));
      store.recordError(tool3.id, new Error('Telegram API rate limit'), true);

      store.endSpan(root.id);

      console.log('Trace timeline:\n');
      console.log(store.timeline(traceId));
      console.log('\nPerformance stats:\n');
      const stats = store.perfStats();
      console.log(JSON.stringify(stats, null, 2));
    })();
  } else if (cmd === 'list') {
    const spans = store.query({ limit: Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] || 20) });
    for (const s of spans) {
      const icon = s.status === 'error' ? '❌' : s.type === 'llm' ? '🤖' : s.type === 'tool' ? '🔧' : '📍';
      console.log(`${icon} ${s.name} [${s.type}] ${s.duration}ms ${s.status}`);
    }
    console.log(`\n${spans.length} spans shown`);
  } else if (cmd === 'mcp') {
    // MCP server via stdio
    const { MCPStdioServer } = await import('./mcp-server.mjs');
    new MCPStdioServer(store);
  } else if (cmd === 'stats') {
    console.log(JSON.stringify(store.stats, null, 2));
    const perf = store.perfStats();
    console.log('\nPerformance:');
    console.log(JSON.stringify(perf, null, 2));
  } else {
    console.log('agent-trace — zero-dep distributed tracing for AI agents\n');
    console.log('Usage:');
    console.log('  node index.mjs serve [--port=3105]   Start HTTP dashboard');
    console.log('  node index.mjs demo                   Run demo trace');
    console.log('  node index.mjs list [--limit=20]      List recent spans');
    console.log('  node index.mjs stats                  Show stats');
    console.log('  node index.mjs mcp                    Start MCP server (stdio)');
  }
}
