#!/usr/bin/env node
/**
 * agent-rate CLI
 */
import { AgentRate } from './index.mjs';

const [,, cmd, ...args] = process.argv;
const rate = new AgentRate();
rate.addLimiter('default', { strategy: 'fixed_window', limit: 100, windowMs: 60000 });
rate.addLimiter('strict', { strategy: 'sliding_window_log', limit: 20, windowMs: 60000 });
rate.addLimiter('api', { strategy: 'token_bucket', limit: 50, windowMs: 60000, burst: 10 });

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
function out(data) { console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2)); }

switch (cmd) {
  case 'check': {
    const key = args[0] || 'test';
    const limiter = flag('limiter', 'default');
    out(rate.check(key, limiter));
    break;
  }
  case 'is-allowed': {
    const key = args[0] || 'test';
    const limiter = flag('limiter', 'default');
    out({ allowed: rate.isAllowed(key, limiter) });
    break;
  }
  case 'consume': {
    const key = args[0] || 'test';
    const n = parseInt(args[1] || '1');
    const limiter = flag('limiter', 'default');
    out(rate.consume(key, n, limiter));
    break;
  }
  case 'reset': {
    const key = args[0];
    const limiter = flag('limiter', 'default');
    if (key) rate.reset(key, limiter);
    else rate.resetAll(limiter);
    out({ ok: true });
    break;
  }
  case 'add-limiter': {
    const name = args[0] || 'custom';
    const strategy = flag('strategy', 'fixed_window');
    const limit = parseInt(flag('limit', '100'));
    const windowMs = parseInt(flag('window', '60000'));
    const burst = parseInt(flag('burst', '0'));
    rate.addLimiter(name, { strategy, limit, windowMs, burst });
    out({ ok: true, name });
    break;
  }
  case 'list': case 'limiters': {
    out(rate.listLimiters());
    break;
  }
  case 'stats': {
    out(rate.getStats(args[0]));
    break;
  }
  case 'state': {
    out(rate.getState(args[0] || 'default'));
    break;
  }
  case 'burst': {
    const key = args[0] || 'test';
    const n = parseInt(args[1] || '10');
    const limiter = flag('limiter', 'default');
    const results = [];
    for (let i = 0; i < n; i++) results.push(rate.check(key, limiter));
    const allowed = results.filter(r => r.allowed).length;
    out({ total: n, allowed, blocked: n - allowed, results });
    break;
  }
  case 'demo': {
    console.log('=== agent-rate demo ===\n');
    // Fixed window
    console.log('--- Fixed Window (100/min) ---');
    for (let i = 0; i < 5; i++) {
      const r = rate.check('demo-user', 'default');
      console.log(`  Check ${i + 1}: ${r.allowed ? '✅' : '❌'} remaining=${r.remaining}/${r.limit}`);
    }
    // Sliding window
    console.log('\n--- Sliding Window Log (20/min) ---');
    for (let i = 0; i < 3; i++) {
      const r = rate.check('demo-user', 'strict');
      console.log(`  Check ${i + 1}: ${r.allowed ? '✅' : '❌'} remaining=${r.remaining}/${r.limit}`);
    }
    // Token bucket
    console.log('\n--- Token Bucket (50/min + 10 burst) ---');
    for (let i = 0; i < 5; i++) {
      const r = rate.check('demo-user', 'api');
      console.log(`  Check ${i + 1}: ${r.allowed ? '✅' : '❌'} remaining=${r.remaining}/${r.limit}`);
    }
    // Stats
    console.log('\n--- Stats ---');
    out(rate.getStats());
    break;
  }
  case 'serve': {
    process.env.PORT = flag('port', '3126');
    await import('./server.mjs');
    break;
  }
  case 'mcp': {
    await import('./mcp-server.mjs');
    break;
  }
  default:
    console.log(`agent-rate — Rate limiting toolkit

Commands:
  check <key> [--limiter=name]     Check rate limit
  is-allowed <key>                 Boolean check
  consume <key> <n>                Consume N tokens
  reset [key] [--limiter=name]     Reset limiter/key
  add-limiter <name> [--strategy] [--limit] [--window] [--burst]
  list                             List all limiters
  stats [limiter]                  Get stats
  state [limiter]                  Get current state
  burst <key> <n>                  Burst test
  demo                             Run demo
  serve [--port=3126]              HTTP dashboard
  mcp                              MCP server (stdio)`);
}
