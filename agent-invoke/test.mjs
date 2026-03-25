#!/usr/bin/env node
/**
 * AgentInvoke Test Suite — 42 tests
 */
import { AgentInvoke } from './index.mjs';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
function test(name, fn) {
  try { fn(); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const e = () => new AgentInvoke();

console.log('AgentInvoke Tests\n');

// ─── Registration ───
console.log('── Registration ──');
test('register tool', () => {
  const inv = e();
  inv.register('test', async () => 'ok');
  assert(inv.getTool('test') !== null, 'tool registered');
  assert(inv.listTools().length === 1, 'list count');
});
test('register duplicate throws', () => {
  const inv = e();
  inv.register('dup', async () => {});
  let threw = false;
  try { inv.register('dup', async () => {}); } catch { threw = true; }
  assert(threw, 'duplicate throws');
});
test('unregister tool', () => {
  const inv = e();
  inv.register('temp', async () => {});
  inv.unregister('temp');
  assert(inv.getTool('temp') === null, 'unregistered');
});
test('register with options', () => {
  const inv = e();
  inv.register('opts', async () => {}, { description: 'test', tags: ['a'], version: '2.0.0' });
  const t = inv.getTool('opts');
  assert(t.description === 'test', 'description');
  assert(t.tags[0] === 'a', 'tags');
  assert(t.version === '2.0.0', 'version');
});
test('list tools with filter', () => {
  const inv = e();
  inv.register('a', async () => {}, { tags: ['math'] });
  inv.register('b', async () => {}, { tags: ['string'] });
  assert(inv.listTools({ tag: 'math' }).length === 1, 'tag filter');
  assert(inv.listTools({ search: 'b' }).length === 1, 'search filter');
});

// ─── Schema Validation ───
console.log('── Schema Validation ──');
test('validate type string', () => {
  const inv = e();
  const r = inv.validate('hello', { type: 'string' });
  assert(r.valid, 'string valid');
});
test('validate type number', () => {
  const inv = e();
  assert(inv.validate(42, { type: 'number' }).valid, 'number valid');
  assert(!inv.validate('42', { type: 'number' }).valid, 'string not number');
});
test('validate required fields', () => {
  const inv = e();
  const r = inv.validate({}, { type: 'object', required: ['name'] });
  assert(!r.valid, 'missing required');
});
test('validate enum', () => {
  const inv = e();
  assert(inv.validate('a', { enum: ['a', 'b'] }).valid, 'enum valid');
  assert(!inv.validate('c', { enum: ['a', 'b'] }).valid, 'enum invalid');
});
test('validate min/max', () => {
  const inv = e();
  assert(inv.validate(5, { type: 'number', minimum: 0, maximum: 10 }).valid, 'in range');
  assert(!inv.validate(11, { type: 'number', maximum: 10 }).valid, 'over max');
});
test('validate array items', () => {
  const inv = e();
  assert(inv.validate([1, 2], { type: 'array', items: { type: 'number' } }).valid, 'items valid');
  assert(!inv.validate([1, 'a'], { type: 'array', items: { type: 'number' } }).valid, 'items invalid');
});
test('validate object properties', () => {
  const inv = e();
  const schema = { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } } };
  assert(inv.validate({ name: 'test', age: 25 }, schema).valid, 'props valid');
  assert(!inv.validate({ name: 42 }, schema).valid, 'props invalid');
});
test('validate null schema passes', () => {
  const inv = e();
  assert(inv.validate('anything', null).valid, 'null schema');
});

// ─── Core Execution ───
console.log('── Core Execution ──');
test('call tool', async () => {
  const inv = e();
  inv.register('add', async ({ a, b }) => ({ r: a + b }));
  const r = await inv.call('add', { a: 3, b: 7 });
  assert(r.success, 'success');
  assert(r.output.r === 10, 'result correct');
});
test('call unknown tool throws', async () => {
  const inv = e();
  let threw = false;
  try { await inv.call('nope'); } catch { threw = true; }
  assert(threw, 'unknown throws');
});
test('call with input validation', async () => {
  const inv = e();
  inv.register('strict', async (i) => i, {
    inputSchema: { type: 'object', required: ['x'], properties: { x: { type: 'number' } } }
  });
  const r = await inv.call('strict', { x: 'wrong' });
  assert(!r.success, 'validation fails');
});
test('call records history', async () => {
  const inv = e();
  inv.register('hist', async () => 'ok');
  await inv.call('hist');
  assert(inv.getHistory().length === 1, 'history recorded');
});
test('call tracks stats', async () => {
  const inv = e();
  inv.register('stat', async () => 'ok');
  await inv.call('stat');
  const s = inv.getStats();
  assert(s.totalCalls === 1, 'total calls');
  assert(s.successCalls === 1, 'success calls');
});

// ─── Timeout ───
console.log('── Timeout ──');
test('call with timeout', async () => {
  const inv = e();
  inv.register('slow', async () => new Promise(r => setTimeout(r, 5000)), { timeout: 100 });
  const r = await inv.call('slow');
  assert(!r.success, 'timeout fails');
  assert(r.error.includes('Timeout'), 'timeout error');
});

// ─── Retry ───
console.log('── Retry ──');
test('retry on failure', async () => {
  const inv = e();
  let count = 0;
  inv.register('flaky', async () => { count++; if (count < 3) throw new Error('fail'); return 'ok'; }, { retries: 3 });
  const r = await inv.call('flaky');
  assert(r.success, 'retry succeeds');
  assert(r.attempt === 2, 'attempt count');
});

// ─── Caching ───
console.log('── Caching ──');
test('cache hit', async () => {
  const inv = e();
  let calls = 0;
  inv.register('cached', async () => { calls++; return { n: calls }; }, { cacheTTL: 60000 });
  await inv.call('cached', { x: 1 });
  await inv.call('cached', { x: 1 });
  assert(calls === 1, 'cached');
  assert(inv.getStats().cachedCalls === 1, 'cache hit stat');
});
test('clear cache', async () => {
  const inv = e();
  inv.register('cc', async () => Math.random(), { cacheTTL: 60000 });
  await inv.call('cc', { x: 1 });
  inv.clearCache();
  assert(inv.getStats().cacheSize === 0, 'cache cleared');
});

// ─── Composition ───
console.log('── Composition ──');
test('chain', async () => {
  const inv = e();
  inv.register('double', async ({ n }) => ({ n: n * 2 }));
  const r = await inv.chain([
    { tool: 'double', input: { n: 5 } },
    { tool: 'double', transform: prev => ({ n: prev.output.n }) }
  ]);
  assert(r.success, 'chain success');
  assert(r.result.n === 20, 'chain result');
});
test('chain stops on error', async () => {
  const inv = e();
  inv.register('ok1', async () => 'ok');
  inv.register('fail', async () => { throw new Error('boom'); });
  const r = await inv.chain([
    { tool: 'ok1' },
    { tool: 'fail' },
    { tool: 'ok1' }
  ]);
  assert(!r.success, 'chain fails');
  assert(r.results.length === 2, 'stops at error');
});
test('chain continueOnError', async () => {
  const inv = e();
  inv.register('ok1', async () => 'ok');
  inv.register('fail', async () => { throw new Error('boom'); });
  const r = await inv.chain([
    { tool: 'ok1' },
    { tool: 'fail', continueOnError: true },
    { tool: 'ok1' }
  ]);
  assert(r.results.length === 3, 'continues on error');
});
test('parallel', async () => {
  const inv = e();
  inv.register('p1', async () => 'a');
  inv.register('p2', async () => 'b');
  const r = await inv.parallel([{ tool: 'p1' }, { tool: 'p2' }]);
  assert(r.length === 2, 'parallel count');
  assert(r[0].status === 'fulfilled', 'parallel fulfilled');
});
test('conditional true', async () => {
  const inv = e();
  inv.register('yes', async () => 'yes');
  inv.register('no', async () => 'no');
  const r = await inv.conditional(true, 'yes', 'no');
  assert(r.output === 'yes', 'true branch');
});
test('conditional false', async () => {
  const inv = e();
  inv.register('yes', async () => 'yes');
  inv.register('no', async () => 'no');
  const r = await inv.conditional(false, 'yes', 'no');
  assert(r.output === 'no', 'false branch');
});
test('fallback', async () => {
  const inv = e();
  inv.register('f1', async () => { throw new Error('fail'); });
  inv.register('f2', async () => 'ok');
  const r = await inv.fallback([{ tool: 'f1' }, { tool: 'f2' }]);
  assert(r.output === 'ok', 'fallback works');
});

// ─── Rate Limiting ───
console.log('── Rate Limiting ──');
test('rate limit', async () => {
  const inv = e();
  inv.register('limited', async () => 'ok', { rateLimit: { max: 2, windowMs: 10000 } });
  await inv.call('limited');
  await inv.call('limited');
  const r = await inv.call('limited');
  assert(!r.success, 'rate limited');
  assert(r.error.includes('Rate limit'), 'rate limit error');
});

// ─── Middleware ───
console.log('── Middleware ──');
test('before middleware', async () => {
  const inv = e();
  let called = false;
  inv.before(ctx => { called = true; });
  inv.register('mw', async () => 'ok');
  await inv.call('mw');
  assert(called, 'before called');
});
test('after middleware', async () => {
  const inv = e();
  let result = null;
  inv.after((ctx, r) => { result = r; });
  inv.register('mw2', async () => 'ok');
  await inv.call('mw2');
  assert(result !== null, 'after called');
});
test('error middleware', async () => {
  const inv = e();
  let errResult = null;
  inv.onError((ctx, entry, err) => { errResult = err; });
  inv.register('mw3', async () => { throw new Error('boom'); });
  await inv.call('mw3');
  assert(errResult !== null, 'error middleware called');
});

// ─── Events ───
console.log('── Events ──');
test('emit tool:registered', () => {
  const inv = e();
  let emitted = false;
  inv.on('tool:registered', () => emitted = true);
  inv.register('evt', async () => {});
  assert(emitted, 'registered event');
});
test('emit tool:success', async () => {
  const inv = e();
  let emitted = false;
  inv.on('tool:success', () => emitted = true);
  inv.register('evt2', async () => 'ok');
  await inv.call('evt2');
  assert(emitted, 'success event');
});
test('emit tool:error', async () => {
  const inv = e();
  let emitted = false;
  inv.on('tool:error', () => emitted = true);
  inv.register('evt3', async () => { throw new Error('x'); });
  await inv.call('evt3');
  assert(emitted, 'error event');
});
test('emit tool:cache_hit', async () => {
  const inv = e();
  let emitted = false;
  inv.register('evt4', async () => 'ok', { cacheTTL: 60000 });
  await inv.call('evt4', { x: 1 });
  inv.on('tool:cache_hit', () => emitted = true);
  await inv.call('evt4', { x: 1 });
  assert(emitted, 'cache hit event');
});
test('emit tool:retry', async () => {
  const inv = e();
  let emitted = false;
  inv.on('tool:retry', () => emitted = true);
  inv.register('evt5', async () => { throw new Error('x'); }, { retries: 1 });
  await inv.call('evt5');
  assert(emitted, 'retry event');
});

// ─── History Filtering ───
console.log('── History Filtering ──');
test('history filter by tool', async () => {
  const inv = e();
  inv.register('h1', async () => 'a');
  inv.register('h2', async () => 'b');
  await inv.call('h1');
  await inv.call('h2');
  assert(inv.getHistory({ tool: 'h1' }).length === 1, 'tool filter');
});
test('history filter by success', async () => {
  const inv = e();
  inv.register('hs', async () => 'ok');
  inv.register('hf', async () => { throw new Error('x'); });
  await inv.call('hs');
  await inv.call('hf');
  assert(inv.getHistory({ success: true }).length === 1, 'success filter');
});
test('history limit', async () => {
  const inv = e();
  inv.register('hl', async () => 'ok');
  for (let i = 0; i < 10; i++) await inv.call('hl');
  assert(inv.getHistory({ limit: 3 }).length === 3, 'limit works');
});

// ─── MCP Compatibility ───
console.log('── MCP Compatibility ──');
test('toMCPTools', () => {
  const inv = e();
  inv.register('mcp1', async () => 'ok', {
    description: 'MCP tool',
    inputSchema: { type: 'object', properties: { x: { type: 'string' } } }
  });
  const tools = inv.toMCPTools();
  assert(tools.length === 1, 'mcp tools count');
  assert(tools[0].name === 'mcp1', 'mcp tool name');
  assert(tools[0].description === 'MCP tool', 'mcp tool desc');
});
test('callMCP', async () => {
  const inv = e();
  inv.register('mcp2', async ({ x }) => ({ doubled: x * 2 }));
  const r = await inv.callMCP('mcp2', { x: 5 });
  assert(r.doubled === 10, 'mcp call result');
});
test('callMCP throws on failure', async () => {
  const inv = e();
  inv.register('mcpf', async () => { throw new Error('fail'); });
  let threw = false;
  try { await inv.callMCP('mcpf'); } catch { threw = true; }
  assert(threw, 'mcp call throws');
});

// ─── Stats ───
console.log('── Stats ──');
test('getToolStats', async () => {
  const inv = e();
  inv.register('ts', async () => 'ok');
  await inv.call('ts');
  const s = inv.getToolStats('ts');
  assert(s.calls === 1, 'tool stats calls');
  assert(s.success === 1, 'tool stats success');
});
test('stats include registry count', () => {
  const inv = e();
  inv.register('a', async () => {});
  inv.register('b', async () => {});
  assert(inv.getStats().registeredTools === 2, 'registered count');
});

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
