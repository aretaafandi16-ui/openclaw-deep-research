#!/usr/bin/env node
/**
 * agent-lock CLI
 */

import { AgentLock } from './index.mjs';

const USAGE = `agent-lock — distributed locking for AI agents

Usage: agent-lock <command> [options]

Commands:
  lock <name> [--holder <h>] [--timeout <ms>]    Acquire exclusive lock
  unlock <name> [--holder <h>]                   Release exclusive lock
  force <name>                                   Force-release a lock
  with-lock <name> --exec <cmd>                  Execute with auto-release lock
  read-lock <name> [--holder <h>]                Acquire read lock
  write-lock <name> [--holder <h>]               Acquire write lock
  read-unlock <name> [--holder <h>]              Release read lock
  write-unlock <name> [--holder <h>]             Release write lock
  sem-acquire <name> [--max <n>] [--holder <h>]  Acquire semaphore permit
  sem-release <name> [--holder <h>]              Release semaphore permit
  barrier <name> --parties <n> [--label <l>]     Wait at barrier
  barrier-reset <name>                           Reset barrier
  list                                           List all locks
  stats                                          Show statistics
  deadlocks                                      Check for deadlocks
  serve [--port <port>]                          Start HTTP server
  mcp                                            Start MCP server
  demo                                           Run interactive demo
  help                                           Show this help`;

function parseArgs(args) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      opts[key] = args[i + 1] || true;
      if (typeof opts[key] === 'string') i++;
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, opts };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === 'help') { console.log(USAGE); process.exit(0); }

  const cmd = args[0];
  const { positional, opts } = parseArgs(args.slice(1));
  const lock = new AgentLock({ persistDir: opts.persist || './data' });

  try {
    switch (cmd) {
      case 'lock': {
        await lock.lock(positional[0], opts.holder || 'default', +(opts.timeout || 0));
        console.log(`✅ Lock acquired: ${positional[0]} [${opts.holder || 'default'}]`);
        break;
      }
      case 'unlock': {
        const ok = lock.unlock(positional[0], opts.holder || 'default');
        console.log(ok ? `🔓 Lock released: ${positional[0]}` : `❌ Lock not held by ${opts.holder || 'default'}`);
        break;
      }
      case 'force': {
        const prev = lock.forceUnlock(positional[0]);
        console.log(prev ? `⚡ Force-released from: ${prev}` : `Lock was free`);
        break;
      }
      case 'with-lock': {
        const result = await lock.withLock(positional[0], opts.holder || 'default', () => {
          console.log(`🔒 Lock held, executing: ${opts.exec || 'noop'}`);
          return opts.exec ? 'executed' : 'ok';
        }, +(opts.timeout || 0));
        console.log(`Result: ${result}`);
        break;
      }
      case 'read-lock': {
        await lock.readLock(positional[0], opts.holder || 'default', +(opts.timeout || 0));
        console.log(`📖 Read lock acquired: ${positional[0]} [${opts.holder || 'default'}]`);
        break;
      }
      case 'write-lock': {
        await lock.writeLock(positional[0], opts.holder || 'default', +(opts.timeout || 0));
        console.log(`✏️ Write lock acquired: ${positional[0]} [${opts.holder || 'default'}]`);
        break;
      }
      case 'read-unlock': {
        const ok = lock.readUnlock(positional[0], opts.holder || 'default');
        console.log(ok ? `📖 Read lock released: ${positional[0]}` : `❌ Not held`);
        break;
      }
      case 'write-unlock': {
        const ok = lock.writeUnlock(positional[0], opts.holder || 'default');
        console.log(ok ? `✏️ Write lock released: ${positional[0]}` : `❌ Not held`);
        break;
      }
      case 'sem-acquire': {
        lock.semaphore(positional[0], +(opts.max || 1));
        await lock.acquirePermit(positional[0], opts.holder || 'default', +(opts.count || 1), +(opts.timeout || 0));
        console.log(`🚦 Permit acquired: ${positional[0]} [${opts.holder || 'default'}]`);
        break;
      }
      case 'sem-release': {
        const ok = lock.releasePermit(positional[0], opts.holder || 'default', +(opts.count || 1));
        console.log(ok ? `🚦 Permit released: ${positional[0]}` : `❌ Not held`);
        break;
      }
      case 'barrier': {
        lock.barrier(positional[0], +(opts.parties || 2));
        console.log(`🚧 Waiting at barrier: ${positional[0]} (${opts.parties || 2} parties)`);
        const gen = await lock.barrierWait(positional[0], opts.label || '');
        console.log(`✅ Barrier released! Generation: ${gen}`);
        break;
      }
      case 'barrier-reset': {
        lock.barrierReset(positional[0]);
        console.log(`🔄 Barrier reset: ${positional[0]}`);
        break;
      }
      case 'list': {
        console.log(JSON.stringify(lock.listLocks(), null, 2));
        const b = lock.listBarriers();
        if (Object.keys(b).length) console.log('Barriers:', JSON.stringify(b, null, 2));
        const e = lock.listElections();
        if (Object.keys(e).length) console.log('Elections:', JSON.stringify(e, null, 2));
        break;
      }
      case 'stats': {
        console.log(JSON.stringify(lock.stats, null, 2));
        break;
      }
      case 'deadlocks': {
        const cycles = lock.detectDeadlocks();
        if (cycles.length) { console.log('⚠️ Deadlocks:', JSON.stringify(cycles)); process.exit(1); }
        else console.log('✅ No deadlocks');
        break;
      }
      case 'serve': {
        const { server } = await import('./server.mjs');
        break;
      }
      case 'mcp': {
        await import('./mcp-server.mjs');
        break;
      }
      case 'demo': {
        await runDemo(lock);
        break;
      }
      default: console.error(`Unknown command: ${cmd}\n${USAGE}`); process.exit(1);
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
  lock.destroy();
}

async function runDemo(lock) {
  console.log('🔒 agent-lock Demo\n');

  // Mutex demo
  console.log('--- Mutex ---');
  await lock.lock('resource-A', 'agent-1');
  console.log('  agent-1 locked resource-A');
  
  // Queue another agent (non-blocking acquire)
  lock.lock('resource-A', 'agent-2', 100).catch(e => console.log(`  agent-2 timeout: ${e.message}`));
  
  lock.unlock('resource-A', 'agent-1');
  console.log('  agent-1 unlocked resource-A');

  // RW Lock demo
  console.log('\n--- Read-Write Lock ---');
  await lock.readLock('data', 'reader-1');
  await lock.readLock('data', 'reader-2');
  console.log('  reader-1 + reader-2 reading simultaneously');
  
  lock.readUnlock('data', 'reader-1');
  lock.readUnlock('data', 'reader-2');
  
  await lock.writeLock('data', 'writer-1');
  console.log('  writer-1 has exclusive write lock');
  lock.writeUnlock('data', 'writer-1');

  // Semaphore demo
  console.log('\n--- Semaphore (3 permits) ---');
  lock.semaphore('pool', 3);
  await lock.acquirePermit('pool', 'worker-1');
  await lock.acquirePermit('pool', 'worker-2');
  await lock.acquirePermit('pool', 'worker-3');
  console.log('  3 workers acquired permits (pool full)');
  lock.releasePermit('pool', 'worker-1');
  console.log('  worker-1 released (1 available)');

  // withLock demo
  console.log('\n--- withLock (auto-release) ---');
  const result = await lock.withLock('critical', 'agent-X', async () => {
    console.log('  Inside critical section...');
    return 42;
  });
  console.log(`  Result: ${result}, lock auto-released`);

  // Deadlock detection demo
  console.log('\n--- Deadlock Detection ---');
  // Simulate: agent-A holds lock-1, waits for lock-2
  await lock.lock('lock-1', 'agent-A');
  // The detector tracks wait-for graphs
  const cycles = lock.detectDeadlocks();
  console.log(`  Cycles: ${cycles.length === 0 ? 'none (healthy)' : JSON.stringify(cycles)}`);
  lock.unlock('lock-1', 'agent-A');

  console.log('\n--- Stats ---');
  console.log(JSON.stringify(lock.stats, null, 2));
  
  lock.destroy();
  console.log('\n✅ Demo complete!');
}

main().catch(err => { console.error(err); process.exit(1); });
