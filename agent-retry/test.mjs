// agent-retry/test.mjs — Test suite
import { ExponentialBackoff, CircuitBreaker, Bulkhead, withTimeout, retry, RetryOrchestrator, HealthChecker, RetryRegistry } from './index.mjs';

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function test(name, fn) {
  console.log(`\n🧪 ${name}`);
  return fn().catch(e => { failed++; console.error(`  ❌ Error: ${e.message}`); });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── ExponentialBackoff ───────────────────────────────────────────────────────
await test('ExponentialBackoff — basic delays', async () => {
  const bo = new ExponentialBackoff({ initialMs: 100, maxMs: 1000, maxRetries: 3 });
  const delays = [];
  for await (const d of bo.delays()) delays.push(d);
  assert(delays.length === 3, `3 delays generated (got ${delays.length})`);
  assert(delays[0] >= 75 && delays[0] <= 125, `First delay ~100ms (got ${delays[0]})`);
  assert(delays[2] >= 300 && delays[2] <= 500, `Third delay ~400ms (got ${delays[2]})`);
});

await test('ExponentialBackoff — reset', async () => {
  const bo = new ExponentialBackoff({ maxRetries: 2 });
  bo.nextDelay(); bo.nextDelay();
  assert(bo.exhausted, 'exhausted after max retries');
  bo.reset();
  assert(!bo.exhausted, 'not exhausted after reset');
  assert(bo.attempt === 0, 'attempt reset to 0');
});

await test('ExponentialBackoff — max cap', async () => {
  const bo = new ExponentialBackoff({ initialMs: 1000, maxMs: 1500, multiplier: 3, maxRetries: 5, jitterFactor: 0 });
  const d1 = bo.nextDelay();
  const d2 = bo.nextDelay();
  const d3 = bo.nextDelay();
  assert(d3 <= 1500, `Capped at maxMs (got ${d3})`);
});

// ─── CircuitBreaker ───────────────────────────────────────────────────────────
await test('CircuitBreaker — starts closed', async () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3 });
  assert(cb.state === 'closed', 'initial state is closed');
  assert(cb.canExecute(), 'can execute when closed');
});

await test('CircuitBreaker — opens after threshold', async () => {
  const cb = new CircuitBreaker({ name: 'test2', failureThreshold: 3 });
  for (let i = 0; i < 3; i++) {
    try { await cb.execute(async () => { throw new Error('fail'); }); } catch {}
  }
  assert(cb.state === 'open', `opens after ${cb.failureThreshold} failures`);
  assert(!cb.canExecute(), 'cannot execute when open');
});

await test('CircuitBreaker — rejects when open', async () => {
  const cb = new CircuitBreaker({ name: 'test3', failureThreshold: 1 });
  try { await cb.execute(async () => { throw new Error('fail'); }); } catch {}
  assert(cb.state === 'open', 'open after failure');
  try {
    await cb.execute(async () => 'ok');
    assert(false, 'should have thrown');
  } catch (err) {
    assert(err.code === 'CIRCUIT_OPEN', 'throws CIRCUIT_OPEN');
    assert(cb.stats.rejectedCalls === 1, 'rejected count incremented');
  }
});

await test('CircuitBreaker — transitions to half-open', async () => {
  const cb = new CircuitBreaker({ name: 'test4', failureThreshold: 1, resetTimeoutMs: 50 });
  try { await cb.execute(async () => { throw new Error('fail'); }); } catch {}
  assert(cb.state === 'open', 'open after failure');
  await sleep(60);
  assert(cb.canExecute(), 'can execute after reset timeout (half-open)');
  assert(cb.state === 'half_open', 'state is half_open');
});

await test('CircuitBreaker — half-open success closes', async () => {
  const cb = new CircuitBreaker({ name: 'test5', failureThreshold: 1, resetTimeoutMs: 50 });
  try { await cb.execute(async () => { throw new Error('fail'); }); } catch {}
  await sleep(60);
  await cb.execute(async () => 'ok');
  assert(cb.state === 'closed', 'closes on half-open success');
});

await test('CircuitBreaker — force open/close', async () => {
  const cb = new CircuitBreaker({ name: 'test6' });
  cb.forceOpen();
  assert(cb.state === 'open', 'forced open');
  cb.forceClose();
  assert(cb.state === 'closed', 'forced closed');
});

// ─── Bulkhead ─────────────────────────────────────────────────────────────────
await test('Bulkhead — basic execution', async () => {
  const bh = new Bulkhead({ name: 'test', maxConcurrent: 2 });
  const r = await bh.execute(async () => 'hello');
  assert(r === 'hello', 'executes function');
  assert(bh.stats.totalExecuted === 1, 'executed count');
});

await test('Bulkhead — concurrency limit', async () => {
  const bh = new Bulkhead({ name: 'test2', maxConcurrent: 1, maxQueued: 0 });
  let active = 0, maxActive = 0;
  const p1 = bh.execute(async () => {
    active++; maxActive = Math.max(maxActive, active);
    await sleep(50);
    active--;
    return 1;
  });
  await sleep(10); // let p1 start
  try {
    await bh.execute(async () => 2);
    assert(false, 'should reject');
  } catch (err) {
    assert(err.code === 'BULKHEAD_FULL', 'rejects when queue full');
  }
  await p1;
});

await test('Bulkhead — queued execution', async () => {
  const bh = new Bulkhead({ name: 'test3', maxConcurrent: 1, maxQueued: 5 });
  const p1 = bh.execute(async () => { await sleep(30); return 1; });
  const p2 = bh.execute(async () => 2);
  const results = await Promise.all([p1, p2]);
  assert(results[0] === 1 && results[1] === 2, 'queued tasks complete');
  assert(bh.stats.totalExecuted === 2, 'both executed');
});

await test('Bulkhead — priority ordering', async () => {
  const bh = new Bulkhead({ name: 'test4', maxConcurrent: 1, maxQueued: 10 });
  const order = [];
  // Fill the slot
  const blocker = bh.execute(async () => { await sleep(50); order.push('blocker'); });
  await sleep(5);
  // Queue with different priorities
  const low = bh.execute(async () => { order.push('low'); }, -1);
  const high = bh.execute(async () => { order.push('high'); }, 10);
  const med = bh.execute(async () => { order.push('med'); }, 5);
  await Promise.all([blocker, low, high, med]);
  assert(order[1] === 'high', `high priority first (got: ${order.join(', ')})`);
  assert(order[2] === 'med', `medium priority second`);
  assert(order[3] === 'low', `low priority last`);
});

// ─── withTimeout ──────────────────────────────────────────────────────────────
await test('withTimeout — resolves before timeout', async () => {
  const r = await withTimeout(async () => {
    await sleep(10);
    return 'fast';
  }, 1000);
  assert(r === 'fast', 'resolves result');
});

await test('withTimeout — rejects on timeout', async () => {
  try {
    await withTimeout(async () => { await sleep(200); }, 50);
    assert(false, 'should timeout');
  } catch (err) {
    assert(err.code === 'TIMEOUT', 'throws TIMEOUT error');
  }
});

// ─── retry() ──────────────────────────────────────────────────────────────────
await test('retry — succeeds eventually', async () => {
  let n = 0;
  const r = await retry(async () => {
    n++;
    if (n < 3) throw new Error(`fail ${n}`);
    return 'ok';
  }, { maxRetries: 5, initialMs: 10 });
  assert(r === 'ok', 'returns result');
  assert(n === 3, `3 attempts (got ${n})`);
});

await test('retry — exhausts retries', async () => {
  let n = 0;
  try {
    await retry(async () => { n++; throw new Error('always fail'); }, { maxRetries: 2, initialMs: 10 });
    assert(false, 'should throw');
  } catch (err) {
    assert(err.message === 'always fail', 'throws last error');
    assert(n === 2, `2 total attempts (got ${n})`);
  }
});

await test('retry — onRetry callback', async () => {
  const retries = [];
  let n = 0;
  await retry(async () => {
    n++;
    if (n < 3) throw new Error('fail');
    return 'ok';
  }, { maxRetries: 5, initialMs: 10, onRetry: (info) => retries.push(info.attempt) });
  assert(retries.length === 2, `2 retries (got ${retries.length})`);
});

await test('retry — isRetryable filter', async () => {
  let n = 0;
  try {
    await retry(async () => {
      n++;
      const err = new Error('fatal');
      err.code = 'FATAL';
      throw err;
    }, { maxRetries: 5, initialMs: 10, isRetryable: (e) => e.code !== 'FATAL' });
    assert(false, 'should throw');
  } catch (err) {
    assert(n === 1, `stopped after 1 attempt (got ${n})`);
  }
});

// ─── RetryOrchestrator ────────────────────────────────────────────────────────
await test('RetryOrchestrator — basic retry', async () => {
  let n = 0;
  const o = new RetryOrchestrator({ name: 'test', backoff: { maxRetries: 3, initialMs: 10 } });
  const r = await o.execute(async () => {
    n++;
    if (n < 2) throw new Error('fail');
    return 'ok';
  });
  assert(r === 'ok', 'returns result');
});

await test('RetryOrchestrator — fallback', async () => {
  const o = new RetryOrchestrator({
    name: 'test-fallback',
    backoff: { maxRetries: 1, initialMs: 10 },
    fallback: (err) => 'fallback-value',
  });
  const r = await o.execute(async () => { throw new Error('always fail'); });
  assert(r === 'fallback-value', 'falls back on exhaustion');
});

await test('RetryOrchestrator — with circuit breaker', async () => {
  const o = new RetryOrchestrator({
    name: 'test-cb',
    backoff: { maxRetries: 3, initialMs: 10 },
    circuitBreaker: { failureThreshold: 2 },
  });
  // First failures
  for (let i = 0; i < 2; i++) {
    try { await o.execute(async () => { throw new Error('fail'); }); } catch {}
  }
  // Circuit should be open
  try {
    await o.execute(async () => 'ok');
    assert(false, 'should be rejected');
  } catch (err) {
    assert(err.code === 'CIRCUIT_OPEN', 'circuit opens after threshold');
  }
});

// ─── HealthChecker ────────────────────────────────────────────────────────────
await test('HealthChecker — passing checks', async () => {
  const hc = new HealthChecker();
  hc.register('db', async () => 'connected', { critical: true });
  hc.register('cache', async () => 'warm');
  const results = await hc.runAll();
  assert(results.db.ok, 'db check passes');
  assert(results.cache.ok, 'cache check passes');
  assert(hc.status.healthy, 'overall healthy');
});

await test('HealthChecker — failing critical check', async () => {
  const hc = new HealthChecker();
  hc.register('api', async () => { throw new Error('down'); }, { critical: true });
  hc.register('cache', async () => 'ok');
  await hc.runAll();
  assert(!hc.status.healthy, 'unhealthy when critical check fails');
  assert(hc.status.checks.api.consecutiveFailures === 1, 'failure count');
});

await test('HealthChecker — timeout', async () => {
  const hc = new HealthChecker();
  hc.register('slow', async () => { await sleep(200); return 'ok'; }, { timeoutMs: 50 });
  const r = await hc.runCheck('slow');
  assert(!r.ok, 'check fails on timeout');
  assert(r.error.includes('timed out'), 'timeout error message');
});

// ─── RetryRegistry ────────────────────────────────────────────────────────────
await test('RetryRegistry — creates and retrieves', async () => {
  const reg = new RetryRegistry();
  const cb1 = reg.circuitBreaker('api', { failureThreshold: 3 });
  const cb2 = reg.circuitBreaker('api');
  assert(cb1 === cb2, 'returns same instance');
  const bh = reg.bulkhead('workers', { maxConcurrent: 5 });
  assert(bh.maxConcurrent === 5, 'bulkhead configured');
  const stats = reg.allStats;
  assert(stats.circuitBreakers.length === 1, '1 breaker in registry');
  assert(stats.bulkheads.length === 1, '1 bulkhead in registry');
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log('✅ All tests passed!');
