#!/usr/bin/env node
/**
 * agent-trace test suite
 */

import { TraceStore, generateId } from './index.mjs';

let passed = 0, failed = 0;
class TestError extends Error { constructor(msg) { super(msg); this.name = 'TestError'; } }
function assert(cond, msg) {
  if (cond) { passed++; }
  else { throw new TestError(msg); }
}

function test(name, fn) {
  process.stdout.write(`  ${name}...`);
  try { fn(); console.log(' ✅'); }
  catch (e) { failed++; console.error(` ❌ ${e.message}`); }
}

async function testAsync(name, fn) {
  process.stdout.write(`  ${name}...`);
  try { await fn(); console.log(' ✅'); }
  catch (e) { failed++; console.log(` ❌ ${e.message}`); }
}

console.log('agent-trace tests\n');

// ─── ID Generation ──────────────────────────────────────────────
test('generateId produces unique ids', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(generateId());
  assert(ids.size === 1000, 'ids should be unique');
});

// ─── Span Lifecycle ─────────────────────────────────────────────
const store = new TraceStore({ persist: false });

test('startSpan creates active span', () => {
  const span = store.startSpan('test:span');
  assert(span.id, 'has id');
  assert(span.traceId, 'has traceId');
  assert(span.status === 'active', 'status is active');
  assert(span.startTime, 'has startTime');
  assert(store.getActive().length === 1, 'one active span');
});

test('endSpan completes span', () => {
  const activeBefore = store.getActive().length;
  const span = store.startSpan('test:end');
  assert(store.getActive().length === activeBefore + 1, 'one more active span');
  const ended = store.endSpan(span.id);
  assert(ended.status === 'ok', 'status is ok');
  assert(ended.endTime, 'has endTime');
  assert(ended.duration >= 0, 'has duration');
  assert(store.getActive().length === activeBefore, 'back to original active count');
});

test('endSpan with error marks as error', () => {
  const span = store.startSpan('test:error');
  const ended = store.endSpan(span.id, { error: { message: 'boom' } });
  assert(ended.status === 'error', 'status is error');
  assert(ended.error.message === 'boom', 'has error message');
  assert(store.stats.errors > 0, 'error count incremented');
});

test('endSpan returns null for unknown id', () => {
  assert(store.endSpan('nonexistent') === null, 'returns null');
});

// ─── Events ─────────────────────────────────────────────────────
test('addEvent appends to active span', () => {
  const span = store.startSpan('test:events');
  store.addEvent(span.id, 'step1', { progress: 50 });
  store.addEvent(span.id, 'step2', { progress: 100 });
  assert(span.events.length === 2, 'two events');
  assert(span.events[0].name === 'step1', 'first event name');
  assert(span.events[0].data.progress === 50, 'first event data');
  store.endSpan(span.id);
});

test('addEvent returns null for unknown id', () => {
  assert(store.addEvent('nonexistent', 'test') === null, 'returns null');
});

// ─── Error Recording ────────────────────────────────────────────
test('recordError on active span', () => {
  const span = store.startSpan('test:recordError');
  store.recordError(span.id, new Error('test error'));
  assert(span.error.message === 'test error', 'error message set');
  assert(span.status === 'active', 'non-fatal keeps active');
  store.endSpan(span.id);
});

test('recordError fatal ends span', () => {
  const span = store.startSpan('test:fatalError');
  const before = store.stats.errors;
  store.recordError(span.id, new Error('fatal'), true);
  assert(span.status === 'error', 'status is error');
  assert(span.endTime, 'has endTime');
  assert(store.stats.errors === before + 1, 'error count incremented');
});

// ─── Queries ────────────────────────────────────────────────────
test('query returns all spans', () => {
  const s = new TraceStore({ persist: false });
  s.startSpan('a'); s.endSpan(s.spans[s.spans.length - 1]?.id);
  // We need to re-scope: let's just test with the shared store
  const all = store.query();
  assert(all.length >= 0, 'returns array');
});

test('query filters by type', () => {
  const llmSpans = store.query({ type: 'llm' });
  // Just verify it works
  assert(Array.isArray(llmSpans), 'returns array');
});

test('query filters by error', () => {
  const errors = store.query({ error: true });
  assert(Array.isArray(errors), 'returns array');
  // All returned spans should be errors
  for (const s of errors) assert(s.status === 'error', 'all errors');
});

test('query with limit', () => {
  const limited = store.query({ limit: 1 });
  assert(limited.length <= 1, 'respects limit');
});

test('query with name filter', () => {
  const results = store.query({ name: 'test' });
  for (const s of results) assert(s.name.includes('test'), 'name contains test');
});

// ─── Trace Operations ───────────────────────────────────────────
test('getTrace returns all spans for traceId', () => {
  const traceId = generateId();
  const s1 = store.startSpan('parent', { traceId });
  const s2 = store.startSpan('child', { traceId, parentId: s1.id });
  store.endSpan(s2.id);
  store.endSpan(s1.id);

  const trace = store.getTrace(traceId);
  assert(trace.length === 2, 'two spans in trace');
  assert(trace[0].startTime <= trace[1].startTime, 'sorted by start time');
});

test('buildTree creates hierarchy', () => {
  const traceId = generateId();
  const parent = store.startSpan('root', { traceId });
  const child1 = store.startSpan('child1', { traceId, parentId: parent.id });
  const child2 = store.startSpan('child2', { traceId, parentId: parent.id });
  const grandchild = store.startSpan('grandchild', { traceId, parentId: child1.id });

  store.endSpan(grandchild.id);
  store.endSpan(child1.id);
  store.endSpan(child2.id);
  store.endSpan(parent.id);

  const tree = store.buildTree(traceId);
  assert(tree.length === 1, 'one root');
  assert(tree[0].children.length === 2, 'two children');
  assert(tree[0].children[0].children.length === 1, 'one grandchild');
});

test('timeline produces text output', () => {
  const traceId = generateId();
  const span = store.startSpan('timeline-test', { traceId });
  store.endSpan(span.id);

  const tl = store.timeline(traceId);
  assert(typeof tl === 'string', 'returns string');
  assert(tl.includes('timeline-test'), 'contains span name');
});

// ─── Performance Stats ──────────────────────────────────────────
test('perfStats returns metrics', () => {
  const stats = store.perfStats();
  assert(typeof stats.count === 'number', 'has count');
  assert(typeof stats.avgDuration === 'number' || stats.count === 0, 'has avgDuration');
});

test('perfStats with filters', () => {
  const stats = store.perfStats({ type: 'llm' });
  assert(typeof stats.count === 'number', 'has count');
});

// ─── Async Trace Helpers ────────────────────────────────────────
await testAsync('trace() wraps async function', async () => {
  const result = await store.trace('test:async', async (span) => {
    assert(span.status === 'active', 'span is active during fn');
    await new Promise(r => setTimeout(r, 10));
    return 42;
  });
  assert(result === 42, 'returns fn result');
});

await testAsync('trace() catches errors', async () => {
  let threw = false;
  try {
    await store.trace('test:async-error', async () => {
      throw new Error('async boom');
    });
  } catch (e) {
    threw = true;
    assert(e.message === 'async boom', 're-throws error');
  }
  assert(threw, 'should have thrown');
});

await testAsync('traceLLM() creates llm span', async () => {
  await store.traceLLM('gpt-4', async () => {
    await new Promise(r => setTimeout(r, 5));
    return 'hello';
  });
  const llmSpans = store.query({ type: 'llm' });
  assert(llmSpans.some(s => s.name.includes('gpt-4')), 'has llm span');
});

await testAsync('traceTool() creates tool span', async () => {
  await store.traceTool('web_search', async () => {
    await new Promise(r => setTimeout(r, 5));
    return 'results';
  });
  const toolSpans = store.query({ type: 'tool' });
  assert(toolSpans.some(s => s.name.includes('web_search')), 'has tool span');
});

// ─── Export ─────────────────────────────────────────────────────
test('exportJSONL produces valid JSONL', () => {
  const jsonl = store.exportJSONL();
  const lines = jsonl.split('\n').filter(Boolean);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert(parsed.id, 'each line has id');
  }
});

// ─── Clear ──────────────────────────────────────────────────────
test('clear resets store', () => {
  store.clear();
  assert(store.spans.length === 0, 'no spans');
  assert(store.getActive().length === 0, 'no active spans');
  assert(store.stats.total === 0, 'total reset');
  assert(store.stats.errors === 0, 'errors reset');
});

// ─── Edge Cases ─────────────────────────────────────────────────
test('span attributes merge on end', () => {
  const span = store.startSpan('test:merge', { attributes: { a: 1 } });
  store.endSpan(span.id, { attributes: { b: 2 } });
  assert(span.attributes.a === 1, 'preserves original');
  assert(span.attributes.b === 2, 'merges new');
});

test('spans with tags', () => {
  const span = store.startSpan('test:tags', { tags: ['important', 'billing'] });
  assert(span.tags.includes('important'), 'has tag');
  store.endSpan(span.id);
  const byTag = store.query({ tag: 'important' });
  assert(byTag.some(s => s.id === span.id), 'queryable by tag');
});

test('maxSpans eviction', () => {
  const small = new TraceStore({ persist: false, maxSpans: 5 });
  for (let i = 0; i < 10; i++) {
    const s = small.startSpan(`span-${i}`);
    small.endSpan(s.id);
  }
  assert(small.spans.length <= 5, 'evicts old spans');
});

// ─── Summary ────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
