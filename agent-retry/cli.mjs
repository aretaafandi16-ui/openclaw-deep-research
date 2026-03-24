#!/usr/bin/env node
// agent-retry/cli.mjs — Command-line interface
import { CircuitBreaker, Bulkhead, ExponentialBackoff, retry, withTimeout, HealthChecker } from './index.mjs';

const [,, cmd, ...args] = process.argv;

function parseArgs(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      flags[key] = val;
    }
  }
  return flags;
}

const HELP = `
🛡️  agent-retry CLI — Resilience toolkit for AI agents

COMMANDS:
  retry <cmd>              Execute command with exponential backoff retry
  breaker [action]         Circuit breaker operations
  bulkhead [action]        Bulkhead operations
  demo                     Run interactive demo
  serve                    Start HTTP dashboard (port 3103)
  mcp                      Start MCP server (port 3104)

RETRY FLAGS:
  --max-retries <n>        Max retry attempts (default: 3)
  --initial-ms <n>         Initial delay (default: 200)
  --max-ms <n>             Max delay (default: 30000)
  --timeout-ms <n>         Per-attempt timeout

BREAKER ACTIONS:
  breaker create --name <n> [--threshold <5>] [--reset-ms <30000>]
  breaker execute --name <n> [--success true|false]
  breaker status --name <n>
  breaker reset --name <n>
  breaker list

BULKHEAD ACTIONS:
  bulkhead create --name <n> [--max <10>] [--queued <100>]
  bulkhead status --name <n>
  bulkhead list

EXAMPLES:
  agent-retry retry "curl -s https://httpbin.org/get" --max-retries 5 --timeout-ms 5000
  agent-retry breaker create --name api --threshold 3
  agent-retry breaker execute --name api --success false
  agent-retry breaker status --name api
  agent-retry demo
`;

const breakers = new Map();
const bulkheads = new Map();

async function main() {
  const flags = parseArgs(args);

  switch (cmd) {
    case 'retry': {
      if (!args[0] || args[0].startsWith('--')) {
        console.error('Usage: agent-retry retry <command> [--max-retries 3] [--timeout-ms 5000]');
        process.exit(1);
      }
      const command = args.filter(a => !a.startsWith('--')).join(' ');
      const maxRetries = parseInt(flags['max-retries'] ?? '3');
      const timeoutMs = flags['timeout-ms'] ? parseInt(flags['timeout-ms']) : null;

      console.log(`🔄 Retrying: "${command}" (max ${maxRetries} attempts)\n`);
      const backoff = new ExponentialBackoff({ maxRetries });
      let lastErr;

      for (let i = 0; i <= maxRetries; i++) {
        try {
          const delay = backoff.nextDelay();
          if (i > 0) {
            console.log(`⏳ Attempt ${i + 1}, waited ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
          }
          const { execSync } = await import('child_process');
          const exec = () => execSync(command, { encoding: 'utf8', timeout: timeoutMs ?? 30000 });
          const result = timeoutMs ? await withTimeout(exec, timeoutMs) : exec();
          console.log(`\n✅ Success on attempt ${i + 1}`);
          console.log(result);
          return;
        } catch (err) {
          lastErr = err;
          console.log(`❌ Attempt ${i + 1} failed: ${err.message.slice(0, 100)}`);
        }
      }
      console.error(`\n💥 All ${maxRetries + 1} attempts failed: ${lastErr.message}`);
      process.exit(1);
    }

    case 'breaker': {
      const action = args.filter(a => !a.startsWith('--'))[0] ?? 'help';
      switch (action) {
        case 'create': {
          const cb = new CircuitBreaker({
            name: flags.name ?? 'default',
            failureThreshold: parseInt(flags.threshold ?? '5'),
            resetTimeoutMs: parseInt(flags['reset-ms'] ?? '30000'),
          });
          breakers.set(cb.name, cb);
          console.log(`⚡ Circuit breaker created: ${cb.name}`);
          console.log(JSON.stringify(cb.stats, null, 2));
          break;
        }
        case 'execute': {
          const cb = breakers.get(flags.name);
          if (!cb) { console.error(`Not found: ${flags.name}`); process.exit(1); }
          try {
            const result = await cb.execute(async () => {
              if (flags.success === 'false') throw new Error('Simulated failure');
              return 'ok';
            });
            console.log(`✅ Success — state: ${cb.state}`);
          } catch (err) {
            console.log(`❌ ${err.code === 'CIRCUIT_OPEN' ? '⚡ REJECTED' : 'Failed'}: ${err.message} — state: ${cb.state}`);
          }
          console.log(JSON.stringify(cb.stats, null, 2));
          break;
        }
        case 'status': {
          const cb = breakers.get(flags.name);
          if (!cb) { console.error(`Not found: ${flags.name}`); process.exit(1); }
          console.log(JSON.stringify(cb.stats, null, 2));
          break;
        }
        case 'reset': {
          const cb = breakers.get(flags.name);
          if (!cb) { console.error(`Not found: ${flags.name}`); process.exit(1); }
          cb.reset();
          console.log(`🔄 Reset: ${flags.name} → closed`);
          break;
        }
        case 'list': {
          if (breakers.size === 0) { console.log('No circuit breakers'); break; }
          for (const [name, cb] of breakers) {
            console.log(`  ${name}: ${cb.state} (${cb.stats.totalCalls} calls, ${cb.stats.failureRate} fail rate)`);
          }
          break;
        }
        default: console.log('Actions: create, execute, status, reset, list');
      }
      break;
    }

    case 'bulkhead': {
      const action = args.filter(a => !a.startsWith('--'))[0] ?? 'help';
      switch (action) {
        case 'create': {
          const bh = new Bulkhead({
            name: flags.name ?? 'default',
            maxConcurrent: parseInt(flags.max ?? '10'),
            maxQueued: parseInt(flags.queued ?? '100'),
          });
          bulkheads.set(bh.name, bh);
          console.log(`🚧 Bulkhead created: ${bh.name}`);
          console.log(JSON.stringify(bh.stats, null, 2));
          break;
        }
        case 'status': {
          const bh = bulkheads.get(flags.name);
          if (!bh) { console.error(`Not found: ${flags.name}`); process.exit(1); }
          console.log(JSON.stringify(bh.stats, null, 2));
          break;
        }
        case 'list': {
          if (bulkheads.size === 0) { console.log('No bulkheads'); break; }
          for (const [name, bh] of bulkheads) {
            console.log(`  ${name}: ${bh.active}/${bh.maxConcurrent} active, ${bh.queued} queued`);
          }
          break;
        }
        default: console.log('Actions: create, status, list');
      }
      break;
    }

    case 'demo': {
      console.log('🛡️  agent-retry demo\n');

      // 1. Exponential backoff
      console.log('── 1. Exponential Backoff ──');
      const bo = new ExponentialBackoff({ initialMs: 100, maxMs: 2000, maxRetries: 5 });
      for await (const delay of bo.delays()) {
        console.log(`  Attempt ${bo.attempt}: delay ${delay}ms`);
      }

      // 2. Circuit breaker
      console.log('\n── 2. Circuit Breaker ──');
      const cb = new CircuitBreaker({ name: 'demo-api', failureThreshold: 3, resetTimeoutMs: 2000 });
      cb.on('stateChange', e => console.log(`  ⚡ State: ${e.from} → ${e.to}`));
      for (let i = 0; i < 6; i++) {
        try {
          await cb.execute(async () => { throw new Error('fail'); });
        } catch (err) {
          console.log(`  Attempt ${i + 1}: ${err.code === 'CIRCUIT_OPEN' ? '⚡ REJECTED' : '❌ failed'} (${cb.state})`);
        }
      }

      // 3. Bulkhead
      console.log('\n── 3. Bulkhead ──');
      const bh = new Bulkhead({ name: 'demo-bh', maxConcurrent: 2, maxQueued: 3 });
      const tasks = [];
      for (let i = 0; i < 6; i++) {
        tasks.push(bh.execute(async () => {
          await new Promise(r => setTimeout(r, 100));
          return `task-${i}`;
        }).then(r => console.log(`  ✅ ${r}`)).catch(e => console.log(`  ❌ ${e.code}: ${e.message}`)));
      }
      await Promise.all(tasks);
      console.log(`  Stats: ${bh.active} active, ${bh.stats.totalExecuted} executed, ${bh.stats.totalRejected} rejected`);

      // 4. Retry with backoff
      console.log('\n── 4. Retry with Backoff ──');
      let attempts = 0;
      try {
        const result = await retry(async () => {
          attempts++;
          if (attempts < 3) throw new Error(`Attempt ${attempts} failed`);
          return 'success!';
        }, { maxRetries: 5, initialMs: 100, onRetry: ({ attempt, delay }) => console.log(`  ⏳ Retry ${attempt}, delay ${delay}ms`) });
        console.log(`  ✅ Result: ${result} (after ${attempts} attempts)`);
      } catch (err) {
        console.log(`  ❌ ${err.message}`);
      }

      console.log('\n✅ Demo complete!');
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

    default:
      console.log(HELP);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
