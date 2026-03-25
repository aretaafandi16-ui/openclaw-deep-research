/**
 * agent-dispatch test suite
 */

import { Dispatcher, Classifier, matchPattern, matchFilter, applyTransform, PriorityQueue, RateLimiter } from './index.mjs';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

async function test(name, fn) {
  try { await fn(); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log('🧪 agent-dispatch tests\n');

// ── PriorityQueue ─────────────────────────────────────────────────

await test('PriorityQueue: push/pop order', () => {
  const q = new PriorityQueue();
  q.push('low', 'low');
  q.push('critical', 'critical');
  q.push('normal', 'normal');
  q.push('high', 'high');
  assert(q.pop() === 'critical', 'critical first');
  assert(q.pop() === 'high', 'high second');
  assert(q.pop() === 'normal', 'normal third');
  assert(q.pop() === 'low', 'low last');
  assert(q.size === 0, 'empty after pops');
});

await test('PriorityQueue: sizes', () => {
  const q = new PriorityQueue();
  q.push(1, 'high');
  q.push(2, 'high');
  q.push(3, 'low');
  const s = q.sizes();
  assert(s.high === 2, 'high=2');
  assert(s.low === 1, 'low=1');
});

// ── RateLimiter ───────────────────────────────────────────────────

await test('RateLimiter: basic', () => {
  const rl = new RateLimiter(3, 1000);
  assert(rl.tryConsume() === true, 'first ok');
  assert(rl.tryConsume() === true, 'second ok');
  assert(rl.tryConsume() === true, 'third ok');
  assert(rl.tryConsume() === false, 'fourth blocked');
  assert(rl.remaining === 0, 'remaining=0');
});

// ── Pattern Matching ──────────────────────────────────────────────

await test('matchPattern: exact', () => {
  assert(matchPattern({ type: 'order.created' }, { type: 'exact', field: 'type', value: 'order.created' }), 'exact match');
  assert(!matchPattern({ type: 'order.cancelled' }, { type: 'exact', field: 'type', value: 'order.created' }), 'exact no match');
});

await test('matchPattern: contains', () => {
  assert(matchPattern({ type: 'order.created' }, { type: 'contains', field: 'type', value: 'order' }), 'contains match');
  assert(!matchPattern({ type: 'user.login' }, { type: 'contains', field: 'type', value: 'order' }), 'contains no match');
});

await test('matchPattern: prefix', () => {
  assert(matchPattern({ type: 'order.created' }, { type: 'prefix', field: 'type', value: 'order.' }), 'prefix match');
  assert(!matchPattern({ type: 'user.login' }, { type: 'prefix', field: 'type', value: 'order.' }), 'prefix no match');
});

await test('matchPattern: regex', () => {
  assert(matchPattern({ type: 'order.123' }, { type: 'regex', field: 'type', value: '^order\\.\\d+$' }), 'regex match');
  assert(!matchPattern({ type: 'order.abc' }, { type: 'regex', field: 'type', value: '^order\\.\\d+$' }), 'regex no match');
});

await test('matchPattern: glob', () => {
  assert(matchPattern({ type: 'order.created' }, { type: 'glob', field: 'type', value: 'order.*' }), 'glob match');
  assert(matchPattern({ type: 'order.123' }, { type: 'glob', field: 'type', value: 'order.???' }), 'glob ? match');
});

await test('matchPattern: in', () => {
  assert(matchPattern({ type: 'a' }, { type: 'in', field: 'type', values: ['a', 'b'] }), 'in match');
  assert(!matchPattern({ type: 'c' }, { type: 'in', field: 'type', values: ['a', 'b'] }), 'in no match');
});

await test('matchPattern: range', () => {
  assert(matchPattern({ amount: 500 }, { type: 'range', field: 'amount', min: 100, max: 1000 }), 'range match');
  assert(!matchPattern({ amount: 50 }, { type: 'range', field: 'amount', min: 100, max: 1000 }), 'range no match');
});

await test('matchPattern: custom', () => {
  assert(matchPattern({ amount: 500 }, { type: 'custom', value: (msg) => msg.amount > 100 }), 'custom match');
  assert(!matchPattern({ amount: 50 }, { type: 'custom', value: (msg) => msg.amount > 100 }), 'custom no match');
});

await test('matchPattern: function', () => {
  assert(matchPattern({ x: 1 }, (msg) => msg.x === 1), 'function match');
  assert(!matchPattern({ x: 2 }, (msg) => msg.x === 1), 'function no match');
});

await test('matchPattern: null pattern matches all', () => {
  assert(matchPattern({ anything: true }, null), 'null pattern');
  assert(matchPattern({ anything: true }, undefined), 'undefined pattern');
});

// ── Filter Engine ─────────────────────────────────────────────────

await test('matchFilter: $eq/$ne', () => {
  assert(matchFilter({ status: 'active' }, { status: { $eq: 'active' } }), '$eq match');
  assert(!matchFilter({ status: 'inactive' }, { status: { $eq: 'active' } }), '$eq no match');
  assert(matchFilter({ status: 'active' }, { status: { $ne: 'inactive' } }), '$ne match');
});

await test('matchFilter: $gt/$gte/$lt/$lte', () => {
  assert(matchFilter({ amount: 500 }, { amount: { $gt: 100 } }), '$gt match');
  assert(matchFilter({ amount: 100 }, { amount: { $gte: 100 } }), '$gte match');
  assert(matchFilter({ amount: 50 }, { amount: { $lt: 100 } }), '$lt match');
  assert(matchFilter({ amount: 100 }, { amount: { $lte: 100 } }), '$lte match');
});

await test('matchFilter: $in/$nin', () => {
  assert(matchFilter({ role: 'admin' }, { role: { $in: ['admin', 'owner'] } }), '$in match');
  assert(matchFilter({ role: 'user' }, { role: { $nin: ['admin', 'owner'] } }), '$nin match');
});

await test('matchFilter: $exists', () => {
  assert(matchFilter({ name: 'test' }, { name: { $exists: true } }), '$exists true match');
  assert(matchFilter({}, { name: { $exists: false } }), '$exists false match');
});

await test('matchFilter: $contains', () => {
  assert(matchFilter({ msg: 'hello world' }, { msg: { $contains: 'world' } }), '$contains match');
});

await test('matchFilter: $regex', () => {
  assert(matchFilter({ email: 'test@example.com' }, { email: { $regex: '^[^@]+@[^@]+$' } }), '$regex match');
});

await test('matchFilter: $type', () => {
  assert(matchFilter({ count: 42 }, { count: { $type: 'number' } }), '$type match');
  assert(matchFilter({ name: 'hi' }, { name: { $type: 'string' } }), '$type match string');
});

await test('matchFilter: $and/$or', () => {
  assert(matchFilter({ a: 1, b: 2 }, { $and: [{ a: 1 }, { b: 2 }] }), '$and match');
  assert(!matchFilter({ a: 1, b: 3 }, { $and: [{ a: 1 }, { b: 2 }] }), '$and fail');
  assert(matchFilter({ a: 1 }, { $or: [{ a: 1 }, { b: 2 }] }), '$or match');
});

await test('matchFilter: nested fields', () => {
  assert(matchFilter({ user: { name: 'reza' } }, { 'user.name': 'reza' }), 'nested match');
});

await test('matchFilter: $between', () => {
  assert(matchFilter({ val: 50 }, { val: { $between: [0, 100] } }), '$between match');
  assert(!matchFilter({ val: 150 }, { val: { $between: [0, 100] } }), '$between no match');
});

// ── Transforms ────────────────────────────────────────────────────

await test('applyTransform: set/delete/rename', () => {
  let r = applyTransform({ a: 1 }, [{ op: 'set', field: 'b', value: 2 }]);
  assert(r.b === 2, 'set');

  r = applyTransform({ a: 1, b: 2 }, [{ op: 'delete', field: 'b' }]);
  assert(r.b === undefined, 'delete');

  r = applyTransform({ a: 1 }, [{ op: 'rename', field: 'a', value: 'x' }]);
  assert(r.x === 1 && r.a === undefined, 'rename');
});

await test('applyTransform: uppercase/lowercase/trim', () => {
  assert(applyTransform({ n: 'hello' }, [{ op: 'uppercase', field: 'n' }]).n === 'HELLO', 'uppercase');
  assert(applyTransform({ n: 'HELLO' }, [{ op: 'lowercase', field: 'n' }]).n === 'hello', 'lowercase');
  assert(applyTransform({ n: '  hi  ' }, [{ op: 'trim', field: 'n' }]).n === 'hi', 'trim');
});

await test('applyTransform: default', () => {
  assert(applyTransform({}, [{ op: 'default', field: 'x', value: 42 }]).x === 42, 'default set');
  assert(applyTransform({ x: 1 }, [{ op: 'default', field: 'x', value: 42 }]).x === 1, 'default skip');
});

await test('applyTransform: template', () => {
  const r = applyTransform({ name: 'reza', type: 'greet' }, [{ op: 'set', field: 'label', template: '{{name}} - {{type}}' }]);
  assert(r.label === 'reza - greet', 'template');
});

// ── Dispatcher ────────────────────────────────────────────────────

await test('Dispatcher: submit + route matching', async () => {
  const d = new Dispatcher();
  let delivered = false;
  d.addRoute({ name: 'test', pattern: { type: 'exact', field: 'type', value: 'ping' }, handler: () => { delivered = true; } });
  await d.submit({ type: 'ping' });
  assert(delivered, 'handler called');
  assert(d.stats.dispatched === 1, 'dispatched=1');
  d.destroy();
});

await test('Dispatcher: first-match strategy', async () => {
  const d = new Dispatcher({ strategy: 'first-match' });
  let count = 0;
  d.addRoute({ name: 'r1', pattern: null, handler: () => count++ });
  d.addRoute({ name: 'r2', pattern: null, handler: () => count++ });
  await d.submit({ type: 'test' });
  assert(count === 1, 'only first matched');
  d.destroy();
});

await test('Dispatcher: all-match strategy', async () => {
  const d = new Dispatcher({ strategy: 'all-match' });
  let count = 0;
  d.addRoute({ name: 'r1', pattern: null, handler: () => count++ });
  d.addRoute({ name: 'r2', pattern: null, handler: () => count++ });
  await d.submit({ type: 'test' });
  assert(count === 2, 'both matched');
  d.destroy();
});

await test('Dispatcher: unmatched goes to DLQ', async () => {
  const d = new Dispatcher();
  d.addRoute({ name: 'specific', pattern: { type: 'exact', field: 'type', value: 'only-this' } });
  await d.submit({ type: 'other' });
  assert(d.dlq.length === 1, 'dlq has entry');
  assert(d.dlq[0].reason === 'no_matching_route', 'correct reason');
  d.destroy();
});

await test('Dispatcher: enqueue + process', async () => {
  const d = new Dispatcher();
  let count = 0;
  d.addRoute({ name: 'all', pattern: null, handler: () => count++ });
  await d.submit({ type: 'a' }, { enqueue: true, priority: 'high' });
  await d.submit({ type: 'b' }, { enqueue: true, priority: 'low' });
  assert(d.queue.size === 2, 'queue has 2');
  await d.processQueue(10);
  assert(count === 2, 'both processed');
  d.destroy();
});

await test('Dispatcher: fan-out', async () => {
  const d = new Dispatcher();
  const hits = [];
  const r1 = d.addRoute({ name: 'r1', pattern: null, handler: () => hits.push('r1') });
  const r2 = d.addRoute({ name: 'r2', pattern: null, handler: () => hits.push('r2') });
  await d.fanOut({ type: 'broadcast' }, [r1.id, r2.id]);
  assert(hits.includes('r1') && hits.includes('r2'), 'both routes hit');
  d.destroy();
});

await test('Dispatcher: retry on failure', async () => {
  const d = new Dispatcher();
  let attempts = 0;
  d.addRoute({
    name: 'flaky', pattern: null,
    retry: { maxAttempts: 3, backoffMs: 10 },
    handler: () => { attempts++; if (attempts < 3) throw new Error('fail'); }
  });
  await d.submit({ type: 'test' });
  assert(attempts === 3, 'retried to 3');
  assert(d.stats.dispatched === 1, 'dispatched after retry');
  d.destroy();
});

await test('Dispatcher: middleware before/after', async () => {
  const d = new Dispatcher();
  const log = [];
  d.use('before', (msg) => { log.push('before'); });
  d.use('after', (msg) => { log.push('after'); });
  d.addRoute({ name: 'r', pattern: null, handler: () => log.push('handler') });
  await d.submit({ type: 'test' });
  assert(log.join(',') === 'before,handler,after', 'middleware order');
  d.destroy();
});

await test('Dispatcher: middleware before returning false blocks', async () => {
  const d = new Dispatcher();
  let handled = false;
  d.use('before', () => false);
  d.addRoute({ name: 'r', pattern: null, handler: () => { handled = true; } });
  await d.submit({ type: 'test' });
  assert(!handled, 'blocked by middleware');
  assert(d.stats.dropped === 1, 'dropped=1');
  d.destroy();
});

await test('Dispatcher: rate limiting', async () => {
  const d = new Dispatcher();
  let count = 0;
  d.addRoute({
    name: 'limited', pattern: null,
    rateLimit: { max: 2, windowMs: 60000 },
    handler: () => count++,
  });
  await d.submit({ type: 'a' });
  await d.submit({ type: 'b' });
  await d.submit({ type: 'c' });
  assert(count === 2, 'only 2 delivered');
  d.destroy();
});

await test('Dispatcher: transforms applied', async () => {
  const d = new Dispatcher();
  let received = null;
  d.addRoute({
    name: 'transformer', pattern: null,
    transforms: [{ op: 'set', field: 'transformed', value: true }],
    handler: (msg) => { received = msg; },
  });
  await d.submit({ type: 'test', original: true });
  assert(received.transformed === true, 'transform applied');
  assert(received.original === true, 'original preserved');
  d.destroy();
});

await test('Dispatcher: filters', async () => {
  const d = new Dispatcher();
  let delivered = false;
  d.addRoute({
    name: 'filtered', pattern: null,
    filters: [{ amount: { $gt: 100 } }],
    handler: () => { delivered = true; },
  });
  await d.submit({ type: 'test', amount: 50 });
  assert(!delivered, 'filtered out');
  delivered = false;
  await d.submit({ type: 'test', amount: 200 });
  assert(delivered, 'passed filter');
  d.destroy();
});

await test('Dispatcher: route enable/disable', async () => {
  const d = new Dispatcher();
  let count = 0;
  const r = d.addRoute({ name: 'r', pattern: null, handler: () => count++ });
  d.disableRoute(r.id);
  await d.submit({ type: 'test' });
  assert(count === 0, 'disabled route skipped');
  d.enableRoute(r.id);
  await d.submit({ type: 'test' });
  assert(count === 1, 'enabled route matched');
  d.destroy();
});

await test('Dispatcher: events emitted', async () => {
  const d = new Dispatcher();
  const events = [];
  d.on('message:received', () => events.push('received'));
  d.on('message:delivered', () => events.push('delivered'));
  d.addRoute({ name: 'r', pattern: null, handler: () => {} });
  await d.submit({ type: 'test' });
  assert(events.includes('received'), 'received emitted');
  assert(events.includes('delivered'), 'delivered emitted');
  d.destroy();
});

await test('Dispatcher: history tracking', async () => {
  const d = new Dispatcher();
  d.addRoute({ name: 'r', pattern: null, handler: () => {} });
  await d.submit({ type: 'a' });
  await d.submit({ type: 'b' });
  const h = d.getHistory();
  assert(h.length === 2, '2 history entries');
  assert(h[0].success === true, 'success');
  d.destroy();
});

await test('Dispatcher: DLQ retry', async () => {
  const d = new Dispatcher();
  d.addRoute({ name: 'r', pattern: { type: 'exact', field: 'type', value: 'specific' } });
  await d.submit({ type: 'unmatched' });
  assert(d.dlq.length === 1, 'in dlq');
  // Re-add catch-all for retry
  d.addRoute({ name: 'catch', pattern: null, handler: () => {} });
  await d.retryDLQ(10);
  assert(d.dlq.length === 0, 'dlq cleared');
  d.destroy();
});

// ── Classifier ────────────────────────────────────────────────────

await test('Classifier: basic classification', () => {
  const c = new Classifier([
    { name: 'order', pattern: { type: 'prefix', field: 'type', value: 'order.' }, tags: ['commerce'] },
    { name: 'user', pattern: { type: 'prefix', field: 'type', value: 'user.' }, tags: ['identity'] },
  ]);
  const msg = { type: 'order.created' };
  const result = c.classify(msg);
  assert(result.classes.includes('order'), 'classified as order');
  assert(msg._tags.includes('commerce'), 'tagged commerce');
});

// ── Summary ───────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`✅ ${pass} passed  ❌ ${fail} failed  (${pass + fail} total)`);
if (fail > 0) process.exit(1);
