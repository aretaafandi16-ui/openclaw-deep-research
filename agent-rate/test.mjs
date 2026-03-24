#!/usr/bin/env node
/**
 * agent-rate tests — 40 tests covering all strategies + features
 */
import { AgentRate } from './index.mjs';
import { strict as assert } from 'assert';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('agent-rate tests\n');

// ─── Fixed Window ───────────────────────────────────────────────────────────

test('fixed_window: allows under limit', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { strategy: 'fixed_window', limit: 5, windowMs: 1000 });
  assert.strictEqual(r.check('k1', 'fw').allowed, true);
});

test('fixed_window: blocks over limit', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { strategy: 'fixed_window', limit: 2, windowMs: 10000 });
  r.check('k1', 'fw');
  r.check('k1', 'fw');
  assert.strictEqual(r.check('k1', 'fw').allowed, false);
});

test('fixed_window: remaining decrements', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { strategy: 'fixed_window', limit: 5, windowMs: 10000 });
  assert.strictEqual(r.check('k1', 'fw').remaining, 4);
  assert.strictEqual(r.check('k1', 'fw').remaining, 3);
});

test('fixed_window: independent keys', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { strategy: 'fixed_window', limit: 1, windowMs: 10000 });
  r.check('a', 'fw');
  assert.strictEqual(r.check('a', 'fw').allowed, false);
  assert.strictEqual(r.check('b', 'fw').allowed, true);
});

test('fixed_window: reset clears key', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { strategy: 'fixed_window', limit: 1, windowMs: 10000 });
  r.check('a', 'fw');
  r.reset('a', 'fw');
  assert.strictEqual(r.check('a', 'fw').allowed, true);
});

// ─── Sliding Window Log ────────────────────────────────────────────────────

test('sliding_window_log: allows under limit', () => {
  const r = new AgentRate();
  r.addLimiter('swl', { strategy: 'sliding_window_log', limit: 5, windowMs: 10000 });
  assert.strictEqual(r.check('k1', 'swl').allowed, true);
});

test('sliding_window_log: blocks over limit', () => {
  const r = new AgentRate();
  r.addLimiter('swl', { strategy: 'sliding_window_log', limit: 2, windowMs: 10000 });
  r.check('k1', 'swl');
  r.check('k1', 'swl');
  assert.strictEqual(r.check('k1', 'swl').allowed, false);
});

test('sliding_window_log: retryAfter > 0 when blocked', () => {
  const r = new AgentRate();
  r.addLimiter('swl', { strategy: 'sliding_window_log', limit: 1, windowMs: 1000 });
  r.check('k1', 'swl');
  const res = r.check('k1', 'swl');
  assert.strictEqual(res.allowed, false);
  assert.ok(res.retryAfter > 0);
});

test('sliding_window_log: strategy tag', () => {
  const r = new AgentRate();
  r.addLimiter('swl', { strategy: 'sliding_window_log', limit: 10, windowMs: 60000 });
  assert.strictEqual(r.check('k1', 'swl').strategy, 'sliding_window_log');
});

// ─── Sliding Window Counter ────────────────────────────────────────────────

test('sliding_window_counter: allows under limit', () => {
  const r = new AgentRate();
  r.addLimiter('swc', { strategy: 'sliding_window_counter', limit: 100, windowMs: 60000 });
  assert.strictEqual(r.check('k1', 'swc').allowed, true);
});

test('sliding_window_counter: strategy tag', () => {
  const r = new AgentRate();
  r.addLimiter('swc', { strategy: 'sliding_window_counter', limit: 10, windowMs: 60000 });
  assert.strictEqual(r.check('k1', 'swc').strategy, 'sliding_window_counter');
});

// ─── Token Bucket ──────────────────────────────────────────────────────────

test('token_bucket: allows with tokens', () => {
  const r = new AgentRate();
  r.addLimiter('tb', { strategy: 'token_bucket', limit: 10, windowMs: 60000, burst: 5 });
  assert.strictEqual(r.check('k1', 'tb').allowed, true);
});

test('token_bucket: blocks when empty', () => {
  const r = new AgentRate();
  r.addLimiter('tb', { strategy: 'token_bucket', limit: 1, windowMs: 100000, burst: 0 });
  r.check('k1', 'tb');
  assert.strictEqual(r.check('k1', 'tb').allowed, false);
});

test('token_bucket: maxTokens = limit + burst', () => {
  const r = new AgentRate();
  r.addLimiter('tb', { strategy: 'token_bucket', limit: 10, windowMs: 60000, burst: 5 });
  const stats = r.getStats();
  assert.strictEqual(stats.limiters.tb.maxTokens, 15);
});

test('token_bucket: remaining shows tokens', () => {
  const r = new AgentRate();
  r.addLimiter('tb', { strategy: 'token_bucket', limit: 100, windowMs: 60000, burst: 0 });
  const res = r.check('k1', 'tb');
  assert.strictEqual(res.remaining, 99);
});

test('token_bucket: strategy tag', () => {
  const r = new AgentRate();
  r.addLimiter('tb', { strategy: 'token_bucket', limit: 10, windowMs: 60000 });
  assert.strictEqual(r.check('k1', 'tb').strategy, 'token_bucket');
});

// ─── Leaky Bucket ──────────────────────────────────────────────────────────

test('leaky_bucket: allows when not full', () => {
  const r = new AgentRate();
  r.addLimiter('lb', { strategy: 'leaky_bucket', limit: 10, windowMs: 60000 });
  assert.strictEqual(r.check('k1', 'lb').allowed, true);
});

test('leaky_bucket: blocks when full', () => {
  const r = new AgentRate();
  r.addLimiter('lb', { strategy: 'leaky_bucket', limit: 2, windowMs: 60000 });
  r.check('k1', 'lb');
  r.check('k1', 'lb');
  assert.strictEqual(r.check('k1', 'lb').allowed, false);
});

test('leaky_bucket: remaining shows capacity', () => {
  const r = new AgentRate();
  r.addLimiter('lb', { strategy: 'leaky_bucket', limit: 10, windowMs: 60000 });
  assert.strictEqual(r.check('k1', 'lb').remaining, 9);
});

test('leaky_bucket: strategy tag', () => {
  const r = new AgentRate();
  r.addLimiter('lb', { strategy: 'leaky_bucket', limit: 10, windowMs: 60000 });
  assert.strictEqual(r.check('k1', 'lb').strategy, 'leaky_bucket');
});

// ─── Multi-Limiter ─────────────────────────────────────────────────────────

test('multi-limiter: add and list', () => {
  const r = new AgentRate();
  r.addLimiter('a', { limit: 10, windowMs: 60000 });
  r.addLimiter('b', { limit: 20, windowMs: 60000 });
  assert.strictEqual(r.listLimiters().length, 2);
});

test('multi-limiter: remove limiter', () => {
  const r = new AgentRate();
  r.addLimiter('a', { limit: 10, windowMs: 60000 });
  r.removeLimiter('a');
  assert.strictEqual(r.listLimiters().length, 0);
});

test('multi-limiter: unknown limiter throws', () => {
  const r = new AgentRate();
  assert.throws(() => r.check('k', 'nope'), /not found/);
});

test('multi-limiter: unknown strategy throws', () => {
  const r = new AgentRate();
  assert.throws(() => r.addLimiter('bad', { strategy: 'magic', limit: 10, windowMs: 1000 }), /Unknown strategy/);
});

// ─── checkAll ──────────────────────────────────────────────────────────────

test('checkAll: returns worst result', () => {
  const r = new AgentRate();
  r.addLimiter('a', { strategy: 'fixed_window', limit: 10, windowMs: 60000 });
  r.addLimiter('b', { strategy: 'fixed_window', limit: 1, windowMs: 60000 });
  r.check('k1', 'b');
  const res = r.checkAll('k1', ['a', 'b']);
  assert.strictEqual(res.allowed, false);
});

// ─── isAllowed ─────────────────────────────────────────────────────────────

test('isAllowed: returns boolean', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 5, windowMs: 60000 });
  assert.strictEqual(r.isAllowed('k1', 'fw'), true);
});

// ─── consume ───────────────────────────────────────────────────────────────

test('consume: multiple tokens', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  const res = r.consume('k1', 3, 'fw');
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.consumed, 3);
});

test('consume: fails when not enough tokens', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 2, windowMs: 60000 });
  const res = r.consume('k1', 5, 'fw');
  assert.strictEqual(res.allowed, false);
});

// ─── Global Stats ──────────────────────────────────────────────────────────

test('global stats: tracks checks', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 100, windowMs: 60000 });
  r.check('a', 'fw');
  r.check('b', 'fw');
  const stats = r.getStats();
  assert.strictEqual(stats.global.totalChecks, 2);
  assert.strictEqual(stats.global.allowed, 2);
  assert.strictEqual(stats.global.rejected, 0);
});

test('global stats: tracks rejections', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 1, windowMs: 60000 });
  r.check('a', 'fw');
  r.check('a', 'fw');
  const stats = r.getStats();
  assert.strictEqual(stats.global.rejected, 1);
});

// ─── Events ────────────────────────────────────────────────────────────────

test('events: emits check event', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  let emitted = false;
  r.on('check', () => emitted = true);
  r.check('k1', 'fw');
  assert.strictEqual(emitted, true);
});

test('events: emits rejected event', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 1, windowMs: 60000 });
  let emitted = false;
  r.on('rejected', () => emitted = true);
  r.check('k1', 'fw');
  r.check('k1', 'fw');
  assert.strictEqual(emitted, true);
});

test('events: emits limiter:added', () => {
  const r = new AgentRate();
  let emitted = false;
  r.on('limiter:added', () => emitted = true);
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  assert.strictEqual(emitted, true);
});

test('events: emits reset', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  let emitted = false;
  r.on('reset', () => emitted = true);
  r.reset('k1', 'fw');
  assert.strictEqual(emitted, true);
});

// ─── State ─────────────────────────────────────────────────────────────────

test('getState: returns key states', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  r.check('k1', 'fw');
  const state = r.getState('fw');
  assert.ok(state.k1);
});

test('getStats: per-limiter stats', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  const stats = r.getStats('fw');
  assert.strictEqual(stats.type, 'fixed_window');
  assert.strictEqual(stats.limit, 10);
});

// ─── Default Limiter ───────────────────────────────────────────────────────

test('default limiter from constructor', () => {
  const r = new AgentRate({ defaultLimiter: { limit: 50, windowMs: 30000 } });
  assert.strictEqual(r.check('k1').allowed, true);
});

test('middleware: returns function', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  const mw = r.middleware('fw');
  assert.strictEqual(typeof mw, 'function');
});

test('middleware: custom keyFn', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  const mw = r.middleware('fw', req => req.headers['x-api-key']);
  assert.strictEqual(typeof mw, 'function');
});

test('token_bucket: refill over time', async () => {
  const r = new AgentRate();
  r.addLimiter('tb', { strategy: 'token_bucket', limit: 100, windowMs: 100, burst: 0 });
  r.check('k1', 'tb'); // 99 tokens
  await new Promise(res => setTimeout(res, 50)); // ~50 tokens refilled
  const res = r.check('k1', 'tb');
  assert.ok(res.remaining > 90, `Expected >90 remaining, got ${res.remaining}`);
});

// ─── Limit Fields ──────────────────────────────────────────────────────────

test('result has all expected fields', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  const res = r.check('k1', 'fw');
  assert.ok('allowed' in res);
  assert.ok('remaining' in res);
  assert.ok('limit' in res);
  assert.ok('resetAt' in res);
  assert.ok('retryAfter' in res);
  assert.ok('strategy' in res);
});

// ─── Reset All ─────────────────────────────────────────────────────────────

test('events: emits limiter:removed', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 10, windowMs: 60000 });
  let emitted = false;
  r.on('limiter:removed', () => emitted = true);
  r.removeLimiter('fw');
  assert.strictEqual(emitted, true);
});

test('resetAll clears all keys', () => {
  const r = new AgentRate();
  r.addLimiter('fw', { limit: 1, windowMs: 60000 });
  r.check('a', 'fw');
  r.check('b', 'fw');
  r.resetAll('fw');
  assert.strictEqual(r.check('a', 'fw').allowed, true);
  assert.strictEqual(r.check('b', 'fw').allowed, true);
});

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
