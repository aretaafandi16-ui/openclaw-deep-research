#!/usr/bin/env node
/**
 * agent-stream Test Suite
 */

import { StreamEngine, Aggregations } from './index.mjs';

let passed = 0, failed = 0, total = 0;

function assert(condition, name) {
  total++;
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}`); }
}

function assertEqual(actual, expected, name) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${name} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// ── Tests ─────────────────────────────────────────────────────────

console.log('🐋 agent-stream Test Suite\n');

console.log('── Source ──────────────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3]).run();
  assertEqual(r, [1, 2, 3], 'from array');
}

{
  async function* gen() { yield 10; yield 20; }
  const r = await StreamEngine.fromGenerator(gen()).run();
  assertEqual(r, [10, 20], 'from generator');
}

console.log('\n── Map ─────────────────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3]).map(x => x * 2).run();
  assertEqual(r, [2, 4, 6], 'map multiply');
}

{
  const r = await StreamEngine.from([{ a: 1 }, { a: 2 }]).map(x => x.a + 10).run();
  assertEqual(r, [11, 12], 'map extract+transform');
}

console.log('\n── Filter ──────────────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3, 4, 5]).filter(x => x > 3).run();
  assertEqual(r, [4, 5], 'filter gt');
}

{
  const r = await StreamEngine.from(['a', 'b', '', 'c', null]).filter(x => !!x).run();
  assertEqual(r, ['a', 'b', 'c'], 'filter truthy');
}

console.log('\n── Take & Skip ─────────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3, 4, 5]).take(3).run();
  assertEqual(r, [1, 2, 3], 'take 3');
}

{
  const r = await StreamEngine.from([1, 2, 3, 4, 5]).skip(2).run();
  assertEqual(r, [3, 4, 5], 'skip 2');
}

console.log('\n── Batch ───────────────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3, 4, 5]).batch(2).run();
  assertEqual(r, [[1, 2], [3, 4]], 'batch 2 (drops remainder)');
}

{
  const r = await StreamEngine.from([1, 2, 3, 4, 5, 6]).batch(3).run();
  assertEqual(r, [[1, 2, 3], [4, 5, 6]], 'batch 3 exact');
}

console.log('\n── Distinct ────────────────────────────');

{
  const r = await StreamEngine.from([1, 2, 2, 3, 1, 3]).distinct().run();
  assertEqual(r, [1, 2, 3], 'distinct numbers');
}

{
  const r = await StreamEngine.from([{ id: 1 }, { id: 1 }, { id: 2 }]).distinct(x => x.id).run();
  assertEqual(r.length, 2, 'distinct by key');
}

console.log('\n── Pluck ───────────────────────────────');

{
  const r = await StreamEngine.from([{ name: 'a' }, { name: 'b' }]).pluck('name').run();
  assertEqual(r, ['a', 'b'], 'pluck name');
}

console.log('\n── Compact ─────────────────────────────');

{
  const r = await StreamEngine.from([0, 1, null, 2, '', 3, false, 4]).compact().run();
  assertEqual(r, [1, 2, 3, 4], 'compact removes falsy');
}

console.log('\n── Flatten ─────────────────────────────');

{
  const r = await StreamEngine.from([[1, 2], [3, [4, 5]]]).flatten().run();
  assertEqual(r, [1, 2, 3, 4, 5], 'flatten nested');
}

console.log('\n── FlatMap ─────────────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3]).flatMap(x => [x, x * 10]).run();
  assertEqual(r, [1, 10, 2, 20, 3, 30], 'flatMap');
}

console.log('\n── Window (tumbling) ───────────────────');

{
  const r = await StreamEngine.from([1, 2, 3, 4, 5, 6]).window(3, 'tumbling').run();
  assertEqual(r, [[1, 2, 3], [4, 5, 6]], 'tumbling window size 3');
}

console.log('\n── Window (sliding) ────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3, 4, 5]).window(3, 'sliding').run();
  assert(r.length >= 2, 'sliding produces multiple windows');
}

console.log('\n── Chained Pipeline ────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    .filter(x => x % 2 === 0)
    .map(x => x * 10)
    .take(3)
    .run();
  assertEqual(r, [20, 40, 60], 'filter→map→take');
}

{
  const r = await StreamEngine.from([
    { dept: 'eng', name: 'alice' },
    { dept: 'eng', name: 'bob' },
    { dept: 'sales', name: 'carol' },
  ])
    .filter(x => x.dept === 'eng')
    .pluck('name')
    .run();
  assertEqual(r, ['alice', 'bob'], 'filter→pluck pipeline');
}

console.log('\n── Async Map ───────────────────────────');

{
  const r = await StreamEngine.from([1, 2, 3])
    .map(async x => { await new Promise(r => setTimeout(r, 10)); return x * 3; })
    .run();
  assertEqual(r, [3, 6, 9], 'async map');
}

console.log('\n── Sink ────────────────────────────────');

{
  const collected = [];
  const engine = new StreamEngine();
  engine.from([1, 2, 3]).to(x => collected.push(x));
  await engine.run();
  assertEqual(collected, [1, 2, 3], 'sink callback');
}

console.log('\n── Statistics ──────────────────────────');

{
  const engine = new StreamEngine();
  engine.from([1, 2, 3, 4, 5]).filter(x => x > 2);
  await engine.run();
  const stats = engine.getStats();
  assert(stats.itemsReceived === 5, 'itemsReceived=5');
  assert(stats.itemsProcessed === 3, 'itemsProcessed=3');
  assert(stats.itemsDropped === 2, 'itemsDropped=2');
  assert(stats.throughput > 0, 'throughput > 0');
}

console.log('\n── Events ──────────────────────────────');

{
  let startFired = false, endFired = false, dataCount = 0;
  const engine = new StreamEngine();
  engine.on('start', () => startFired = true);
  engine.on('end', () => endFired = true);
  engine.on('data', () => dataCount++);
  engine.from([1, 2, 3]);
  await engine.run();
  assert(startFired, 'start event fired');
  assert(endFired, 'end event fired');
  assert(dataCount === 3, 'data event fired 3 times');
}

console.log('\n── Describe ────────────────────────────');

{
  const engine = new StreamEngine({ id: 'test-123' });
  engine.from([1]).map(x => x).filter(x => true);
  const desc = engine.describe();
  assert(desc.id === 'test-123', 'describe has id');
  assert(desc.stages.length === 2, 'describe has 2 stages');
  assert(desc.source === 'array', 'describe source type');
}

console.log('\n── Aggregations ────────────────────────');

{
  assertEqual(Aggregations.sum([1, 2, 3, 4, 5]), 15, 'sum');
  assertEqual(Aggregations.avg([10, 20, 30]), 20, 'avg');
  assertEqual(Aggregations.min([5, 3, 8, 1]), 1, 'min');
  assertEqual(Aggregations.max([5, 3, 8, 1]), 8, 'max');
  assertEqual(Aggregations.count([1, 2, 3]), 3, 'count');
  assertEqual(Aggregations.median([1, 2, 3, 4, 5]), 3, 'median odd');
  assertEqual(Aggregations.median([1, 2, 3, 4]), 2.5, 'median even');
  assertEqual(Aggregations.first([10, 20, 30]), 10, 'first');
  assertEqual(Aggregations.last([10, 20, 30]), 30, 'last');
}

{
  const result = Aggregations.sum([{ v: 1 }, { v: 2 }, { v: 3 }], 'v');
  assertEqual(result, 6, 'sum with key');
}

{
  const result = Aggregations.avg([{ v: 10 }, { v: 20 }], 'v');
  assertEqual(result, 15, 'avg with key');
}

{
  const groups = Aggregations.groupBy([{ dept: 'a', x: 1 }, { dept: 'b', x: 2 }, { dept: 'a', x: 3 }], 'dept');
  assertEqual(Object.keys(groups).sort(), ['a', 'b'], 'groupBy keys');
  assertEqual(groups.a.length, 2, 'groupBy a has 2');
  assertEqual(groups.b.length, 1, 'groupBy b has 1');
}

console.log('\n── Static Merge ────────────────────────');

{
  const s1 = StreamEngine.from([1, 2]);
  const s2 = StreamEngine.from([3, 4]);
  const merged = StreamEngine.merge(s1, s2);
  const r = await merged.run();
  assertEqual(r.sort(), [1, 2, 3, 4], 'merge two streams');
}

console.log('\n── Static Concat ───────────────────────');

{
  const s1 = StreamEngine.from([1, 2]);
  const s2 = StreamEngine.from([3, 4]);
  const concated = StreamEngine.concat(s1, s2);
  const r = await concated.run();
  assertEqual(r, [1, 2, 3, 4], 'concat preserves order');
}

console.log('\n── Error Handling ──────────────────────');

{
  let errorCaught = false;
  const engine = new StreamEngine({
    onError: (err, item) => {
      errorCaught = true;
      return StreamEngine.DROP;
    }
  });
  engine.from([1, 2, 3]).map(x => { if (x === 2) throw new Error('boom'); return x; });
  const r = await engine.run();
  assert(errorCaught, 'error handler called');
  assertEqual(r, [1, 3], 'errored item dropped');
}

console.log('\n── Pause & Resume ──────────────────────');

{
  const engine = new StreamEngine();
  engine.from(Array.from({ length: 100 }, (_, i) => i));
  const promise = engine.run();
  
  // Start consuming, pause after a bit
  await new Promise(r => setTimeout(r, 10));
  engine.pause();
  assert(engine.paused, 'engine paused');
  
  await new Promise(r => setTimeout(r, 50));
  engine.resume();
  assert(!engine.paused, 'engine resumed');
  
  engine.stop();
}

console.log('\n── Stop ────────────────────────────────');

{
  const engine = new StreamEngine();
  let endFired = false;
  engine.on('end', () => endFired = true);
  engine.from(Array.from({ length: 1000 }, (_, i) => i));
  const promise = engine.run();
  
  await new Promise(r => setTimeout(r, 10));
  engine.stop();
  await promise.catch(() => {});
  
  assert(!engine.running, 'engine stopped');
}

// ── Summary ───────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(40)}`);
console.log(`  ${passed}/${total} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}`);

process.exit(failed > 0 ? 1 : 0);
