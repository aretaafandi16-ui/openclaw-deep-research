#!/usr/bin/env node
/**
 * agent-stream CLI — Command-line streaming data processor
 */

import { StreamEngine, Aggregations } from './index.mjs';
import { readFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const cmd = args[0];

function usage() {
  console.log(`
agent-stream v1.0 — Streaming data processor for AI agents

COMMANDS:
  run <file|->              Run stream from file or stdin (JSONL)
  map <expression>          Transform items (JS expression, use 'item')
  filter <expression>       Filter items (JS boolean expression)
  batch <size>              Group items into batches
  take <n>                  Take first N items
  skip <n>                  Skip first N items
  distinct [key]            Remove duplicates
  aggregate <op> [key]      Aggregate: sum, avg, min, max, count, median, stddev
  pluck <key>               Extract property from each item
  sort [key] [desc]         Sort items
  count                     Count items
  head <n>                  Show first N items
  tail <n>                  Show last N items
  demo                      Run interactive demo
  help                      Show this help

EXAMPLES:
  echo '[1,2,3,4,5]' | agent-stream run - | agent-stream aggregate sum
  agent-stream run data.jsonl | agent-stream filter 'item.age > 18' | agent-stream pluck name
  agent-stream demo
`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function readInput() {
  if (args[1] === '-' || !args[1]) {
    return JSON.parse(await readStdin());
  }
  const path = args[1];
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  const content = readFileSync(path, 'utf-8');
  // Try JSON array first, then JSONL
  try {
    return JSON.parse(content);
  } catch {
    return content.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return l; }
    });
  }
}

async function runPipeline() {
  const data = await readInput();
  const pipeline = args.slice(2);
  let engine = new StreamEngine();
  engine.from(Array.isArray(data) ? data : [data]);

  for (let i = 0; i < pipeline.length; i++) {
    const [op, ...opArgs] = pipeline[i].split(':');
    switch (op) {
      case 'map': engine.map(new Function('item', `return ${opArgs[0]}`)); break;
      case 'filter': engine.filter(new Function('item', `return ${opArgs[0]}`)); break;
      case 'batch': engine.batch(parseInt(opArgs[0]) || 10); break;
      case 'take': engine.take(parseInt(opArgs[0]) || 5); break;
      case 'skip': engine.skip(parseInt(opArgs[0]) || 1); break;
      case 'distinct': engine.distinct(opArgs[0] ? (i => i[opArgs[0]]) : null); break;
      case 'pluck': engine.pluck(opArgs[0]); break;
      case 'compact': engine.compact(); break;
      case 'flatten': engine.flatten(); break;
      case 'sort': {
        const key = opArgs[0];
        const desc = opArgs[1] === 'desc';
        const arr = await engine.run();
        arr.sort((a, b) => {
          const va = key ? a[key] : a;
          const vb = key ? b[key] : b;
          return desc ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
        });
        console.log(JSON.stringify(arr, null, 2));
        return;
      }
      default: console.error(`Unknown operator: ${op}`); process.exit(1);
    }
  }

  const results = await engine.run();
  console.log(JSON.stringify(results, null, 2));
}

async function runAggregate() {
  const data = await readInput();
  const op = args[1] || 'count';
  const key = args[2] || null;
  const items = Array.isArray(data) ? data : [data];
  
  const fn = Aggregations[op];
  if (!fn) {
    console.error(`Unknown aggregation: ${op}. Available: ${Object.keys(Aggregations).join(', ')}`);
    process.exit(1);
  }
  
  const result = fn(items, key);
  if (typeof result === 'object') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result);
  }
}

async function runDemo() {
  console.log('🐋 agent-stream v1.0 Demo\n');

  // Demo 1: Basic pipeline
  console.log('1. Basic Pipeline: filter → map → batch');
  const r1 = await StreamEngine.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    .filter(item => item % 2 === 0)
    .map(item => ({ value: item, squared: item * item }))
    .batch(2)
    .run();
  console.log(JSON.stringify(r1, null, 2));

  // Demo 2: Aggregation
  console.log('\n2. Windowed Aggregation');
  const r2 = await StreamEngine.from([
    { name: 'alice', score: 85 },
    { name: 'bob', score: 92 },
    { name: 'charlie', score: 78 },
    { name: 'diana', score: 95 },
  ])
    .window(2)
    .run();
  console.log(JSON.stringify(r2, null, 2));

  // Demo 3: Distinct + pluck
  console.log('\n3. Distinct + Pluck');
  const r3 = await StreamEngine.from(['a', 'b', 'a', 'c', 'b', 'd'])
    .distinct()
    .run();
  console.log(JSON.stringify(r3, null, 2));

  // Demo 4: Stats
  console.log('\n4. Stream Statistics');
  const engine = new StreamEngine();
  engine.from(Array.from({ length: 100 }, (_, i) => i))
    .filter(x => x > 50)
    .map(x => x * 2);
  await engine.run();
  console.log(JSON.stringify(engine.getStats(), null, 2));

  // Demo 5: Aggregations
  console.log('\n5. Aggregations');
  const data = [10, 20, 30, 40, 50];
  console.log(`  sum([10,20,30,40,50]) = ${Aggregations.sum(data)}`);
  console.log(`  avg([10,20,30,40,50]) = ${Aggregations.avg(data)}`);
  console.log(`  median([10,20,30,40,50]) = ${Aggregations.median(data)}`);
  console.log(`  stddev([10,20,30,40,50]) = ${Aggregations.stddev(data).toFixed(2)}`);

  console.log('\n✅ Demo complete!');
}

// ── Main ──────────────────────────────────────────────────────────

try {
  switch (cmd) {
    case 'run': await runPipeline(); break;
    case 'aggregate': await runAggregate(); break;
    case 'demo': await runDemo(); break;
    case 'help': case '--help': case '-h': usage(); break;
    default:
      if (!cmd) { usage(); break; }
      // Treat as pipeline from stdin
      process.argv.splice(2, 0, 'run', '-');
      await runPipeline();
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
