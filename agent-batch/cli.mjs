#!/usr/bin/env node
/**
 * agent-batch CLI
 */

import { BatchProcessor } from './index.mjs';
import { parseArgs } from 'node:util';

const bp = new BatchProcessor();

const [,, cmd, ...rest] = process.argv;

function help() {
  console.log(`
agent-batch — Batch processing engine for AI agents

Commands:
  execute <items> <fn>    Execute a batch (items=JSON array, fn=JS body)
  map <items> <fn>        Map items through transform function
  filter <items> <fn>     Filter items with predicate
  reduce <items> <fn> <initial>  Reduce items to single value
  retry <fn>              Retry function with backoff
  chunk <items> <size>    Split array into chunks
  demo                    Run interactive demo
  serve                   Start HTTP dashboard
  mcp                     Start MCP server (stdio)
  help                    Show this help

Options:
  --concurrency N     Concurrent workers (default: 5)
  --retries N         Retry count (default: 0)
  --timeout N         Item timeout ms (default: 30000)
  --rate-limit N      Items/sec rate limit (default: 0)
  --chunk-size N      Chunk size (default: 0)
  --delay N           Retry delay ms (default: 1000)
`);
}

async function run() {
  const opts = {};
  const args = [];
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[k] = isNaN(process.argv[i + 1]) ? true : +process.argv[++i];
    } else {
      args.push(a);
    }
  }
  const command = args[0];

  switch (command) {
    case 'execute': {
      const items = JSON.parse(args[1] || '[]');
      const fn = new Function('item', 'index', args[2] || 'return item');
      const result = await bp.execute(items, fn, { concurrency: opts.concurrency, retries: opts.retries, itemTimeout: opts.timeout, rateLimit: opts.rateLimit, chunkSize: opts.chunkSize });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'map': {
      const items = JSON.parse(args[1] || '[]');
      const fn = new Function('item', 'index', args[2] || 'return item');
      const result = await bp.map(items, fn, { concurrency: opts.concurrency, retries: opts.retries });
      console.log(JSON.stringify(result.results.map(r => r.result), null, 2));
      break;
    }
    case 'filter': {
      const items = JSON.parse(args[1] || '[]');
      const fn = new Function('item', 'index', 'return ' + (args[2] || 'true'));
      const result = await bp.filter(items, fn, { concurrency: opts.concurrency });
      console.log(JSON.stringify(result.filtered, null, 2));
      break;
    }
    case 'reduce': {
      const items = JSON.parse(args[1] || '[]');
      const fn = new Function('acc', 'item', 'index', args[2] || 'return acc');
      const initial = JSON.parse(args[3] || '0');
      const result = await bp.reduce(items, fn, initial);
      console.log('Accumulator:', result.accumulator);
      break;
    }
    case 'retry': {
      const fn = new Function('attempt', args[1] || 'return "ok"');
      try {
        const result = await bp.retry(fn, { retries: opts.retries ?? 3, delay: opts.delay ?? 1000 });
        console.log('Result:', result);
      } catch (e) {
        console.error('Failed:', e.message);
        process.exit(1);
      }
      break;
    }
    case 'chunk': {
      const items = JSON.parse(args[1] || '[]');
      const size = parseInt(args[2] || '10');
      console.log(JSON.stringify(bp.chunk(items, size), null, 2));
      break;
    }
    case 'demo': {
      console.log('Running batch processing demo...\n');
      // Demo 1: Parallel processing
      console.log('1️⃣  Parallel processing (concurrency=3, simulate 50ms work):');
      const r1 = await bp.execute([1,2,3,4,5,6,7,8,9,10], async (item) => {
        await new Promise(r => setTimeout(r, 50));
        return item * item;
      }, { concurrency: 3 });
      console.log(`   ✓ ${r1.stats.succeeded}/${r1.stats.total} succeeded in ${r1.duration}ms\n`);

      // Demo 2: With retry
      console.log('2️⃣  Retry demo (flaky function):');
      const r2 = await bp.execute(['a','b','c'], async (item) => {
        if (Math.random() < 0.5) throw new Error('Flaky!');
        return item.toUpperCase();
      }, { retries: 3, retryDelay: 100 });
      console.log(`   ✓ ${r2.stats.succeeded} succeeded, ${r2.stats.failed} failed, ${r2.stats.retries} retries\n`);

      // Demo 3: Map
      console.log('3️⃣  Map demo:');
      const r3 = await bp.map([1,2,3,4,5], async (item) => item * 10);
      console.log('   Results:', r3.results.map(r => r.result).join(', '), '\n');

      // Demo 4: Filter
      console.log('4️⃣  Filter demo (keep even):');
      const r4 = await bp.filter([1,2,3,4,5,6,7,8,9,10], (item) => item % 2 === 0);
      console.log('   Filtered:', r4.filtered.join(', '), '\n');

      // Demo 5: Reduce
      console.log('5️⃣  Reduce demo (sum):');
      const r5 = await bp.reduce([1,2,3,4,5], (acc, item) => acc + item, 0);
      console.log('   Sum:', r5.accumulator, '\n');

      // Demo 6: Chunk
      console.log('6️⃣  Chunk demo (size=3):');
      const chunks = bp.chunk([1,2,3,4,5,6,7,8,9,10], 3);
      chunks.forEach((c, i) => console.log(`   Chunk ${i}: [${c.join(', ')}]`));
      console.log();

      // Demo 7: Rate limited
      console.log('7️⃣  Rate-limited (5 items/sec):');
      const r7 = await bp.execute([1,2,3,4,5], async (item) => `processed-${item}`, { rateLimit: 5, concurrency: 1 });
      console.log(`   ✓ ${r7.stats.succeeded} items in ${r7.duration}ms (~${Math.round(r7.stats.succeeded/r7.duration*1000)} items/sec)\n`);

      // Stats
      console.log('📊 Overall stats:', JSON.stringify(bp.getStats(), null, 2));
      break;
    }
    case 'serve': {
      const mod = await import('./server.mjs');
      break;
    }
    case 'mcp': {
      const mod = await import('./mcp-server.mjs');
      break;
    }
    case 'help':
    default:
      help();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
