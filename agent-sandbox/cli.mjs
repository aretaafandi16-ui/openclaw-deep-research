#!/usr/bin/env node
/**
 * agent-sandbox CLI
 */

import { AgentSandbox } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

const HELP = `
agent-sandbox — Isolated code execution for AI agents

Usage:
  agent-sandbox run <code>             Run code in sandbox
  agent-sandbox eval <expression>      Evaluate expression
  agent-sandbox batch <file>           Run code lines from file
  agent-sandbox snapshot <name> <code> Create context snapshot
  agent-sandbox exec-snap <name> <c>   Run code in snapshot
  agent-sandbox stats                  Show statistics
  agent-sandbox history [limit]        Show execution history
  agent-sandbox serve [--port N]       Start HTTP server
  agent-sandbox mcp                    Start MCP server
  agent-sandbox demo                   Run demo
  agent-sandbox help                   Show this help

Options:
  --timeout <ms>    Execution timeout (default: 5000)
  --json            Output as JSON
`;

function output(data, asJson = false) {
  if (asJson) console.log(JSON.stringify(data, null, 2));
  else {
    if (data.success) {
      if (data.stdout) console.log(data.stdout);
      console.log('→', data.value !== undefined ? JSON.stringify(data.value) : 'undefined');
    } else {
      console.error('✗', data.error?.message || 'Unknown error');
    }
  }
}

const sb = new AgentSandbox();
const json = args.includes('--json');
const timeoutIdx = args.indexOf('--timeout');
const timeout = timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1]) : undefined;

switch (cmd) {
  case 'run': {
    const code = args.slice(1).filter(a => !a.startsWith('--') && a !== String(timeout)).join(' ');
    output(sb.run(code, { timeout }), json);
    break;
  }
  case 'eval': {
    const expr = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    output(sb.runExpression(expr, {}), json);
    break;
  }
  case 'batch': {
    const file = args[1];
    const { readFileSync } = await import('fs');
    const lines = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
    sb.runBatch(lines, { concurrency: 3 }).then(results => {
      if (json) console.log(JSON.stringify(results, null, 2));
      else results.forEach((r, i) => {
        console.log(`[${i}] ${r.success ? '✓' : '✗'} ${r.success ? JSON.stringify(r.value) : r.error?.message} (${r.durationMs}ms)`);
      });
    });
    break;
  }
  case 'snapshot': {
    const name = args[1];
    const code = args.slice(2).join(' ');
    console.log(JSON.stringify(sb.snapshot(name, code), null, 2));
    break;
  }
  case 'exec-snap': {
    const name = args[1];
    const code = args.slice(2).join(' ');
    output(sb.runInSnapshot(name, code), json);
    break;
  }
  case 'stats': {
    console.log(JSON.stringify(sb.getStats(), null, 2));
    break;
  }
  case 'history': {
    const limit = parseInt(args[1]) || 20;
    const hist = sb.getHistory({ limit });
    if (json) console.log(JSON.stringify(hist, null, 2));
    else hist.forEach(r => console.log(`${r.success ? '✓' : '✗'} ${r.durationMs}ms | ${r.stdout?.slice(0, 60) || (r.success ? JSON.stringify(r.value)?.slice(0, 60) : r.error?.message?.slice(0, 60)) || '—'}`));
    break;
  }
  case 'serve': {
    await import('./server.mjs');
    break;
  }
  case 'mcp': {
    await import('./mcp-server.mjs');
    break;
  }
  case 'demo': {
    console.log('=== agent-sandbox demo ===\n');

    console.log('1. Basic arithmetic:');
    output(sb.run('1 + 2 + 3'));

    console.log('\n2. Object manipulation:');
    output(sb.run('({ name: "Laboon", type: "whale", power: 9001 })'));

    console.log('\n3. Array processing:');
    output(sb.run('[1,2,3,4,5].filter(x => x % 2 === 0).map(x => x * 10)'));

    console.log('\n4. Console capture:');
    output(sb.run('console.log("Hello from sandbox!"); console.warn("careful"); "returned"'));

    console.log('\n5. Context injection:');
    output(sb.run('`Hello ${name}! You have ${items.length} items.`', { globals: { name: 'Reza', items: [1, 2, 3] } }));

    console.log('\n6. Function execution:');
    output(sb.runFunction((a, b) => `Sum: ${a + b}`, [10, 20]));

    console.log('\n7. Error handling:');
    output(sb.run('JSON.parse("not json")'));

    console.log('\n8. Fibonacci:');
    output(sb.run('function fib(n){return n<=1?n:fib(n-1)+fib(n-2)} fib(12)'));

    console.log('\n9. Snapshot (persistent state):');
    sb.snapshot('demo', 'let count = 0;');
    output(sb.runInSnapshot('demo', '++count'));
    output(sb.runInSnapshot('demo', '++count'));
    output(sb.runInSnapshot('demo', 'count'));

    console.log('\n10. Batch execution:');
    const results = await sb.runBatch(['1+1', '"hello".length', 'Math.PI']);
    results.forEach((r, i) => console.log(`  [${i}] → ${JSON.stringify(r.value)} (${r.durationMs}ms)`));

    console.log('\nStats:', JSON.stringify(sb.getStats()));
    break;
  }
  default:
    console.log(HELP);
}
