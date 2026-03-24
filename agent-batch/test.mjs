/**
 * agent-batch test suite — 40 tests
 */

import { BatchProcessor, BatchRun, TokenBucket, STATES } from './index.mjs';

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error(`FAIL: ${msg}`); } }
function test(name, fn) { return fn().then(() => { passed++; }).catch(e => { failed++; console.error(`FAIL: ${name} — ${e.message}`); }); }

async function runTests() {
  const bp = new BatchProcessor({ persistRuns: false });

  // 1. Basic execute
  const r1 = await bp.execute([1,2,3], (item) => item * 2);
  assert(r1.succeeded === 3, 'basic execute succeeded');
  assert(r1.results.length === 3, 'basic execute results count');
  assert(r1.results[0].result === 2, 'basic execute result value');

  // 2. Execute with async processor
  const r2 = await bp.execute([10,20], async (item) => { await new Promise(r => setTimeout(r, 10)); return item + 1; });
  assert(r2.succeeded === 2, 'async processor succeeded');

  // 3. Execute with errors + retry
  let flakyCount = 0;
  const r3 = await bp.execute(['a','b'], async () => { flakyCount++; if (flakyCount <= 1) throw new Error('flaky'); return 'ok'; }, { retries: 2 });
  assert(r3.succeeded === 2, 'retry succeeded');
  assert(r3.retries >= 1, 'retries counted');

  // 4. Execute with item timeout
  const r4 = await bp.execute([1], async () => { await new Promise(r => setTimeout(r, 10000)); }, { itemTimeout: 50 });
  assert(r4.failed === 1, 'item timeout failed');

  // 5. Execute with filter
  const r5 = await bp.execute([1,2,3,4,5], (item) => item, { filter: (item) => item % 2 === 0 });
  assert(r5.skipped === 3, 'filter skipped odd');
  assert(r5.succeeded === 2, 'filter kept even');

  // 6. Execute with beforeEach hook
  let hookCalls = 0;
  const r6 = await bp.execute([1,2], (item) => item, { beforeEach: () => hookCalls++ });
  assert(hookCalls === 2, 'beforeEach called twice');

  // 7. Execute with afterEach hook
  let afterCalls = 0;
  const r7 = await bp.execute([1,2], (item) => item, { afterEach: () => afterCalls++ });
  assert(afterCalls === 2, 'afterEach called twice');

  // 8. Concurrency control
  let maxConcurrent = 0, current = 0;
  await bp.execute([1,2,3,4,5,6,7,8,9,10], async (item) => {
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    await new Promise(r => setTimeout(r, 20));
    current--;
  }, { concurrency: 3 });
  assert(maxConcurrent <= 3, `concurrency limited to 3 (actual: ${maxConcurrent})`);

  // 9. Rate limiting
  const r9 = await bp.execute([1,2,3,4,5], (item) => item, { rateLimit: 2, concurrency: 1 });
  assert(r9.duration >= 500, 'rate limited took time');

  // 10. Map
  const r10 = await bp.map([1,2,3], (item) => item * 10);
  assert(r10.results.map(r => r.result).join(',') === '10,20,30', 'map results correct');

  // 11. Filter
  const r11 = await bp.filter([1,2,3,4,5], (item) => item > 3);
  assert(r11.filtered.join(',') === '4,5', 'filter results correct');

  // 12. Reduce
  const bp12 = new BatchProcessor({ persistRuns: false });
  const r12 = await bp12.reduce([1,2,3,4,5], (acc, item) => acc + item, 0);
  assert(r12.accumulator === 15, 'reduce sum correct');

  // 13. Chunk
  const chunks = bp.chunk([1,2,3,4,5,6,7], 3);
  assert(chunks.length === 3, 'chunk count');
  assert(chunks[0].length === 3 && chunks[2].length === 1, 'chunk sizes');

  // 14. Retry single fn
  let retryCount = 0;
  const r14 = await bp.retry(() => { retryCount++; if (retryCount < 3) throw new Error('fail'); return 'ok'; }, { retries: 3, delay: 10 });
  assert(r14 === 'ok', 'retry result');
  assert(retryCount === 3, 'retry attempts');

  // 15. Retry exhaustion
  try {
    await bp.retry(() => { throw new Error('always fail'); }, { retries: 2, delay: 10 });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.message === 'always fail', 'retry exhaustion throws');
  }

  // 16. Pause/resume
  const run16 = bp.create([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], async (item) => { await new Promise(r => setTimeout(r, 50)); return item; }, { concurrency: 3 });
  const p16 = run16.run();
  await new Promise(r => setTimeout(r, 120));
  run16.pause();
  assert(run16.state === STATES.PAUSED, 'pause state');
  await new Promise(r => setTimeout(r, 60));
  run16.resume();
  await p16;
  assert(run16.state === STATES.COMPLETED, 'resume completes');

  // 17. Cancel
  const run17 = bp.create([1,2,3,4,5,6,7,8,9,10], async (item) => { await new Promise(r => setTimeout(r, 100)); return item; });
  const p17 = run17.run();
  await new Promise(r => setTimeout(r, 50));
  run17.cancel();
  await p17;
  assert(run17.state === STATES.CANCELLED, 'cancel state');

  // 18. Progress tracking
  const run18 = bp.create([1,2,3], (item) => item);
  const p18 = run18.run();
  await new Promise(r => setTimeout(r, 10));
  const prog = run18.getProgress();
  assert(prog.percent >= 0, 'progress percent');
  assert(prog.state === 'running' || prog.state === 'completed', 'progress state');
  await p18;

  // 19. BatchRun toJSON
  const run19 = bp.create([1], (item) => item);
  await run19.run();
  const json19 = run19.toJSON();
  assert(json19.id && json19.state === 'completed', 'toJSON format');

  // 20. Stats aggregation
  const stats = bp.getStats();
  assert(stats.totalBatches >= 10, 'total batches count');
  assert(stats.totalItems >= 0, 'total items count');

  // 21. getRuns
  const runs = bp.getRuns();
  assert(Array.isArray(runs), 'getRuns array');
  assert(runs.length >= 10, 'getRuns has entries');

  // 22. getHistory
  const history = bp.getHistory();
  assert(Array.isArray(history), 'history array');

  // 23. getRun
  const run = bp.getRun(r1.batchId);
  assert(run !== undefined, 'getRun found');

  // 24. EventEmitter - start event
  let startFired = false;
  const bp24 = new BatchProcessor({ persistRuns: false });
  bp24.on('start', () => { startFired = true; });
  await bp24.execute([1], (item) => item);
  assert(startFired, 'start event fired');

  // 25. EventEmitter - complete event
  let completeFired = false;
  const bp25 = new BatchProcessor({ persistRuns: false });
  bp25.on('complete', () => { completeFired = true; });
  await bp25.execute([1], (item) => item);
  assert(completeFired, 'complete event fired');

  // 26. Item events
  let itemEvents = 0;
  const bp26 = new BatchProcessor({ persistRuns: false });
  bp26.on('item-complete', () => { itemEvents++; });
  await bp26.execute([1,2,3], (item) => item);
  assert(itemEvents === 3, 'item-complete events');

  // 27. Skip event
  let skipCount = 0;
  const bp27 = new BatchProcessor({ persistRuns: false });
  bp27.on('skip', () => { skipCount++; });
  await bp27.execute([1,2,3,4,5], (item) => item, { filter: (item) => item > 2 });
  assert(skipCount === 2, 'skip events');

  // 28. Error event
  let errorFired = false;
  const bp28 = new BatchProcessor({ persistRuns: false });
  bp28.on('item-fail', () => { errorFired = true; });
  await bp28.execute([1], () => { throw new Error('test'); });
  assert(errorFired, 'item-fail event');

  // 29. collectResults=false
  const r29 = await bp.execute([1,2,3], (item) => item, { collectResults: false });
  assert(r29.results === undefined || r29.results.length === 0, 'no results when collectResults=false');

  // 30. global timeout
  const run30 = bp.create([1,2,3], async () => { await new Promise(r => setTimeout(r, 10000)); }, { globalTimeout: 50 });
  const r30 = await run30.run();
  assert(r30.state === STATES.CANCELLED, 'global timeout cancelled');

  // 31. TokenBucket basic
  const tb = new TokenBucket(10);
  const start31 = Date.now();
  for (let i = 0; i < 5; i++) await tb.acquire();
  assert(Date.now() - start31 < 1000, 'token bucket burst');

  // 32. TokenBucket rate limit
  const tb32 = new TokenBucket(2, 1);
  const start32 = Date.now();
  for (let i = 0; i < 3; i++) await tb32.acquire();
  assert(Date.now() - start32 >= 500, 'token bucket rate limited');

  // 33. Chunked processing
  const chunks33 = [];
  const bp33 = new BatchProcessor({ persistRuns: false });
  bp33.on('chunk-start', (d) => chunks33.push(d.chunk));
  await bp33.execute([1,2,3,4,5,6,7,8,9,10], (item) => item, { chunkSize: 3 });
  assert(chunks33.length === 4, 'chunked processing chunks');

  // 34. BeforeEach errors don't crash
  const r34 = await bp.execute([1], (item) => item, { beforeEach: () => { throw new Error('hook fail'); } });
  assert(r34.succeeded === 1, 'beforeEach error ignored');

  // 35. AfterEach errors don't crash
  const r35 = await bp.execute([1], (item) => item, { afterEach: () => { throw new Error('hook fail'); } });
  assert(r35.succeeded === 1, 'afterEach error ignored');

  // 36. Empty items
  const r36 = await bp.execute([], (item) => item);
  assert(r36.total === 0, 'empty batch total');
  assert(r36.processed === 0, 'empty batch processed');

  // 37. Large batch performance
  const items37 = Array.from({ length: 100 }, (_, i) => i);
  const r37 = await bp.execute(items37, (item) => item * 2, { concurrency: 10 });
  assert(r37.succeeded === 100, 'large batch succeeded');
  assert(r37.duration < 5000, 'large batch fast');

  // 38. Error details
  const r38 = await bp.execute([1, 2], (item) => { if (item === 2) throw new Error('item2fail'); return item; });
  assert(r38.errors.length === 1, 'error count');
  assert(r38.errors[0].error === 'item2fail', 'error message');

  // 39. loadHistory (no file)
  const bp39 = new BatchProcessor({ dataDir: '/tmp/agent-batch-test-' + Date.now() });
  bp39.loadHistory(); // should not throw
  assert(true, 'loadHistory no crash');

  // 40. Nested reduce
  const r40 = await bp.reduce([{ v: 1 }, { v: 2 }, { v: 3 }], (acc, item) => acc + item.v, 0);
  assert(r40.accumulator === 6, 'nested reduce');

  console.log(`\n✅ ${passed} passed, ❌ ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => { console.error(e); process.exit(1); });
