#!/usr/bin/env node
// agent-metrics CLI
import { MetricsStore } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

const help = `agent-metrics — CLI for metrics collection

Commands:
  counter <name> [--value N] [--op inc|dec] [--tags k=v,...]   Increment/decrement counter
  gauge <name> [--value N] [--op set|inc|dec] [--tags k=v,...]  Set gauge value
  histogram <name> <value> [--tags k=v,...]                     Record histogram observation
  timer <name> <ms> [--tags k=v,...]                            Record timing value
  get <name>                                                    Get metric value
  list                                                          List all metrics
  snapshot                                                      Full snapshot (JSON)
  prometheus                                                    Export Prometheus format
  reset                                                         Clear all metrics
  stats <name>                                                  Histogram/timer stats
  serve [--port PORT]                                           Start HTTP server
  mcp                                                           Start MCP server (stdio)
  demo                                                          Run demo with sample data
  help                                                          Show this help
`;

function parseTags(str) {
  if (!str) return {};
  return Object.fromEntries(str.split(',').map(kv => { const [k, ...v] = kv.split('='); return [k, v.join('=')]; }));
}

if (!cmd || cmd === 'help') { console.log(help); process.exit(0); }

const store = new MetricsStore();

switch (cmd) {
  case 'counter': {
    const name = args[1]; if (!name) { console.error('Usage: counter <name>'); process.exit(1); }
    const val = parseFloat(args[args.indexOf('--value') + 1] || '1');
    const op = args[args.indexOf('--op') + 1] || 'inc';
    const tags = parseTags(args[args.indexOf('--tags') + 1]);
    const c = store.counter(name, tags);
    if (op === 'dec') c.dec(val); else c.inc(val);
    console.log(`${name}: ${c.value}`);
    break;
  }
  case 'gauge': {
    const name = args[1]; if (!name) { console.error('Usage: gauge <name>'); process.exit(1); }
    const val = parseFloat(args[args.indexOf('--value') + 1] || '0');
    const op = args[args.indexOf('--op') + 1] || 'set';
    const tags = parseTags(args[args.indexOf('--tags') + 1]);
    const g = store.gauge(name, tags);
    if (op === 'inc') g.inc(val); else if (op === 'dec') g.dec(val); else g.set(val);
    console.log(`${name}: ${g.value}`);
    break;
  }
  case 'histogram': {
    const name = args[1], val = parseFloat(args[2]);
    if (!name || isNaN(val)) { console.error('Usage: histogram <name> <value>'); process.exit(1); }
    const tags = parseTags(args[args.indexOf('--tags') + 1]);
    store.histogram(name, tags).observe(val);
    const s = store.histogram(name).stats();
    console.log(`${name}: count=${s.count} mean=${s.mean.toFixed(2)} p50=${s.p50.toFixed(2)} p95=${s.p95.toFixed(2)}`);
    break;
  }
  case 'timer': {
    const name = args[1], ms = parseFloat(args[2]);
    if (!name || isNaN(ms)) { console.error('Usage: timer <name> <ms>'); process.exit(1); }
    const tags = parseTags(args[args.indexOf('--tags') + 1]);
    store.timer(name, tags).record(ms);
    console.log(`${name}: recorded ${ms}ms`);
    break;
  }
  case 'get': {
    const m = store.get(args[1]);
    console.log(m ? JSON.stringify(m.toJSON(), null, 2) : 'null');
    break;
  }
  case 'list': {
    const list = store.list();
    if (!list.length) { console.log('No metrics recorded'); break; }
    for (const m of list) {
      const tags = Object.entries(m.tags || {}).map(([k,v]) => k+'='+v).join(',');
      console.log(`[${m.type.toUpperCase()}] ${m.name}${tags ? ' {'+tags+'}' : ''} → ${m.type === 'counter' || m.type === 'gauge' ? m.value : m.count + ' obs'}`);
    }
    break;
  }
  case 'snapshot': { console.log(JSON.stringify(store.snapshot(), null, 2)); break; }
  case 'prometheus': { console.log(store.prometheus()); break; }
  case 'reset': { store.clear(); console.log('All metrics cleared'); break; }
  case 'stats': {
    const m = store.get(args[1]);
    if (!m) { console.error('Metric not found'); process.exit(1); }
    console.log(JSON.stringify(m.stats ? m.stats() : m.toJSON(), null, 2));
    break;
  }
  case 'serve': {
    const PORT = args[args.indexOf('--port') + 1] || '3114';
    process.env.PORT = PORT;
    await import('./server.mjs');
    break;
  }
  case 'mcp': { await import('./mcp-server.mjs'); break; }
  case 'demo': {
    console.log('📊 Running agent-metrics demo...\n');
    // Counters
    const reqs = store.counter('http_requests_total', { method: 'GET', path: '/api' });
    reqs.inc(); reqs.inc(); reqs.inc(); reqs.inc(5);
    store.counter('http_requests_total', { method: 'POST', path: '/api' }).inc(3);
    // Gauges
    const mem = store.gauge('memory_usage_mb');
    mem.set(256); mem.inc(128);
    store.gauge('active_connections').set(42);
    // Histograms
    const latency = store.histogram('response_time_ms', {}, { buckets: [10, 50, 100, 250, 500, 1000] });
    [23, 45, 67, 12, 89, 150, 34, 56, 78, 200, 45, 67, 89, 123, 45].forEach(v => latency.observe(v));
    // Timers
    const dbTimer = store.timer('db_query', { table: 'users' });
    [15, 23, 45, 12, 67, 89, 34, 56, 78, 23].forEach(ms => dbTimer.record(ms));
    // Rate
    const rps = store.rate('requests');
    for (let i = 0; i < 150; i++) rps.inc();

    console.log('--- Counters ---');
    console.log('http_requests_total {method=GET}:', store.counter('http_requests_total', { method: 'GET' }).value);
    console.log('http_requests_total {method=POST}:', store.counter('http_requests_total', { method: 'POST' }).value);
    console.log('\n--- Gauges ---');
    console.log('memory_usage_mb:', mem.value);
    console.log('active_connections:', store.gauge('active_connections').value);
    console.log('\n--- Histogram ---');
    console.log(JSON.stringify(latency.stats(), null, 2));
    console.log('\n--- Timer ---');
    console.log(JSON.stringify(dbTimer.stats(), null, 2));
    console.log('\n--- Rate ---');
    console.log('requests (last 60s):', rps.value, '| per sec:', rps.rate().toFixed(2));
    console.log('\n--- Prometheus Export ---');
    console.log(store.prometheus());
    console.log('✅ Demo complete!');
    break;
  }
  default: { console.error(`Unknown command: ${cmd}\n` + help); process.exit(1); }
}
store.close();
