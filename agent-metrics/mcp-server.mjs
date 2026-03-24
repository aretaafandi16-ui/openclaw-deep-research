#!/usr/bin/env node
// agent-metrics MCP Server — JSON-RPC stdio
import { MetricsStore } from './index.mjs';

const store = new MetricsStore();
let id = 0;
const tools = {
  metrics_counter: { desc: 'Increment/decrement a counter', params: { name: { type: 'string' }, value: { type: 'number', default: 1 }, op: { type: 'string', default: 'inc', enum: ['inc', 'dec'] }, tags: { type: 'object' } } },
  metrics_gauge: { desc: 'Set/increment/decrement a gauge', params: { name: { type: 'string' }, value: { type: 'number' }, op: { type: 'string', default: 'set', enum: ['set', 'inc', 'dec'] }, tags: { type: 'object' } } },
  metrics_histogram: { desc: 'Record a histogram observation', params: { name: { type: 'string' }, value: { type: 'number' }, tags: { type: 'object' } } },
  metrics_timer: { desc: 'Record a timing value in ms', params: { name: { type: 'string' }, value: { type: 'number' }, tags: { type: 'object' } } },
  metrics_snapshot: { desc: 'Get full metrics snapshot', params: {} },
  metrics_list: { desc: 'List all metrics with types', params: {} },
  metrics_prometheus: { desc: 'Export metrics in Prometheus text format', params: {} },
  metrics_get: { desc: 'Get a specific metric by key', params: { key: { type: 'string' } } },
  metrics_reset: { desc: 'Clear all metrics', params: {} },
  metrics_stats: { desc: 'Get histogram/timer stats (mean, percentiles)', params: { name: { type: 'string' } } },
};

function respond(result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: id++, result }) + '\n');
}

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try { handleRequest(JSON.parse(line)); } catch {}
  }
});

function handleRequest(req) {
  const { method, params, id: reqId } = req;

  if (method === 'initialize') {
    reply(reqId, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-metrics', version: '1.0.0' } });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    reply(reqId, { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.desc, inputSchema: { type: 'object', properties: t.params } })) });
    return;
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try { handleTool(reqId, name, args || {}); } catch (e) { replyError(reqId, e.message); }
    return;
  }
  replyError(reqId, `Unknown method: ${method}`);
}

function handleTool(reqId, name, args) {
  switch (name) {
    case 'metrics_counter': {
      const c = store.counter(args.name, args.tags || {});
      if (args.op === 'dec') c.dec(args.value || 1); else c.inc(args.value || 1);
      reply(reqId, { content: [{ type: 'text', text: `${args.name}: ${c.value}` }] });
      break;
    }
    case 'metrics_gauge': {
      const g = store.gauge(args.name, args.tags || {});
      if (args.op === 'inc') g.inc(args.value || 1);
      else if (args.op === 'dec') g.dec(args.value || 1);
      else g.set(args.value ?? 0);
      reply(reqId, { content: [{ type: 'text', text: `${args.name}: ${g.value}` }] });
      break;
    }
    case 'metrics_histogram': {
      store.histogram(args.name, args.tags || {}).observe(args.value ?? 0);
      const s = store.histogram(args.name).stats();
      reply(reqId, { content: [{ type: 'text', text: `${args.name}: count=${s.count} mean=${s.mean.toFixed(2)} p50=${s.p50.toFixed(2)} p95=${s.p95.toFixed(2)} p99=${s.p99.toFixed(2)}` }] });
      break;
    }
    case 'metrics_timer': {
      store.timer(args.name, args.tags || {}).record(args.value ?? 0);
      reply(reqId, { content: [{ type: 'text', text: `${args.name}: recorded ${args.value}ms` }] });
      break;
    }
    case 'metrics_snapshot': {
      reply(reqId, { content: [{ type: 'text', text: JSON.stringify(store.snapshot(), null, 2) }] });
      break;
    }
    case 'metrics_list': {
      reply(reqId, { content: [{ type: 'text', text: JSON.stringify(store.list(), null, 2) }] });
      break;
    }
    case 'metrics_prometheus': {
      reply(reqId, { content: [{ type: 'text', text: store.prometheus() }] });
      break;
    }
    case 'metrics_get': {
      const m = store.get(args.key);
      reply(reqId, { content: [{ type: 'text', text: m ? JSON.stringify(m.toJSON(), null, 2) : 'null' }] });
      break;
    }
    case 'metrics_reset': {
      store.clear();
      reply(reqId, { content: [{ type: 'text', text: 'All metrics cleared' }] });
      break;
    }
    case 'metrics_stats': {
      const m = store.get(args.name);
      if (!m) { reply(reqId, { content: [{ type: 'text', text: 'Metric not found' }] }); break; }
      const s = m.stats ? m.stats() : m.toJSON();
      reply(reqId, { content: [{ type: 'text', text: JSON.stringify(s, null, 2) }] });
      break;
    }
    default: replyError(reqId, `Unknown tool: ${name}`);
  }
}

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function replyError(id, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32600, message } }) + '\n'); }
