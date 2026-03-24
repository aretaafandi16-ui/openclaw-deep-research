#!/usr/bin/env node
// agent-metrics test suite
import { MetricsStore, Counter, Gauge, Histogram, Timer, SlidingWindowCounter, percentile, mean, stddev } from './index.mjs';
import { strict as assert } from 'node:assert';
import { rmSync, existsSync } from 'node:fs';

let passed = 0, failed = 0, total = 0;

function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

async function atest(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

// ─── Helpers ──────────────────────────────────────────────────────────
console.log('🧪 agent-metrics test suite\n');

console.log('── Math helpers ──');
test('percentile: empty array', () => { assert.equal(percentile([], 50), 0); });
test('percentile: single value', () => { assert.equal(percentile([10], 50), 10); });
test('percentile: two values', () => { assert.equal(percentile([10, 20], 50), 15); });
test('percentile: p50 of sorted', () => { assert.equal(percentile([1, 2, 3, 4, 5], 50), 3); });
test('percentile: p90', () => { const p = percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90); assert.ok(p >= 9 && p <= 10); });
test('percentile: p99', () => { const p = percentile(Array.from({length:100}, (_,i) => i+1), 99); assert.ok(p >= 99); });
test('mean', () => { assert.equal(mean([1, 2, 3, 4, 5]), 3); });
test('mean: empty', () => { assert.equal(mean([]), 0); });
test('stddev', () => { assert.ok(stddev([1, 2, 3, 4, 5]) > 0); });
test('stddev: single', () => { assert.equal(stddev([5]), 0); });

// ─── Counter ──────────────────────────────────────────────────────────
console.log('\n── Counter ──');
test('counter: inc default', () => { const c = new Counter('test'); c.inc(); assert.equal(c.value, 1); });
test('counter: inc by N', () => { const c = new Counter('test'); c.inc(5); assert.equal(c.value, 5); });
test('counter: dec', () => { const c = new Counter('test'); c.inc(10); c.dec(3); assert.equal(c.value, 7); });
test('counter: reset', () => { const c = new Counter('test'); c.inc(10); c.reset(); assert.equal(c.value, 0); });
test('counter: toJSON', () => { const c = new Counter('req', {method:'GET'}); c.inc(5); const j = c.toJSON(); assert.equal(j.type, 'counter'); assert.equal(j.value, 5); assert.equal(j.tags.method, 'GET'); });

// ─── Gauge ────────────────────────────────────────────────────────────
console.log('\n── Gauge ──');
test('gauge: set', () => { const g = new Gauge('mem'); g.set(100); assert.equal(g.value, 100); });
test('gauge: inc', () => { const g = new Gauge('mem'); g.set(100); g.inc(50); assert.equal(g.value, 150); });
test('gauge: dec', () => { const g = new Gauge('mem'); g.set(100); g.dec(30); assert.equal(g.value, 70); });
test('gauge: toJSON', () => { const g = new Gauge('cpu', {host:'a'}); g.set(42); const j = g.toJSON(); assert.equal(j.type, 'gauge'); assert.equal(j.value, 42); });

// ─── Histogram ────────────────────────────────────────────────────────
console.log('\n── Histogram ──');
test('histogram: observe', () => { const h = new Histogram('lat'); h.observe(10); h.observe(20); assert.equal(h.count, 2); });
test('histogram: sum', () => { const h = new Histogram('lat'); h.observe(10); h.observe(20); assert.equal(h.sum, 30); });
test('histogram: min/max', () => { const h = new Histogram('lat'); h.observe(10); h.observe(50); h.observe(30); assert.equal(h.min, 10); assert.equal(h.max, 50); });
test('histogram: stats', () => { const h = new Histogram('lat'); [10,20,30,40,50].forEach(v => h.observe(v)); const s = h.stats(); assert.equal(s.count, 5); assert.equal(s.mean, 30); assert.equal(s.p50, 30); });
test('histogram: buckets', () => { const h = new Histogram('lat', {}, {buckets:[10,50]}); [5,15,55].forEach(v => h.observe(v)); const b = h.buckets(); assert.equal(b[0].count, 1); assert.equal(b[1].count, 2); });
test('histogram: maxSize eviction', () => { const h = new Histogram('lat', {}, {maxSize:5}); for(let i=0;i<10;i++) h.observe(i); assert.ok(h.count <= 5); });

// ─── Timer ────────────────────────────────────────────────────────────
console.log('\n── Timer ──');
test('timer: record', () => { const t = new Timer('db'); t.record(10); t.record(20); assert.equal(t.count, 2); });
test('timer: start/stop', () => { const t = new Timer('db'); const r = t.start(); const dt = r.stop(); assert.equal(t.count, 1); assert.ok(dt >= 0); });
test('timer: stats', () => { const t = new Timer('db'); [10,20,30].forEach(v => t.record(v)); const s = t.stats(); assert.equal(s.count, 3); assert.equal(s.mean, 20); });

// ─── SlidingWindowCounter ────────────────────────────────────────────
console.log('\n── SlidingWindowCounter ──');
test('sliding window: inc', () => { const sw = new SlidingWindowCounter(60000, 60); sw.inc(); sw.inc(5); assert.equal(sw.value, 6); });
test('sliding window: rate', () => { const sw = new SlidingWindowCounter(60000, 60); sw.inc(60); assert.ok(sw.rate() > 0); });

// ─── MetricsStore ─────────────────────────────────────────────────────
console.log('\n── MetricsStore ──');
test('store: counter creation', () => { const s = new MetricsStore(); const c = s.counter('req'); c.inc(3); assert.equal(c.value, 3); });
test('store: gauge creation', () => { const s = new MetricsStore(); const g = s.gauge('mem'); g.set(42); assert.equal(g.value, 42); });
test('store: histogram creation', () => { const s = new MetricsStore(); const h = s.histogram('lat'); h.observe(10); assert.equal(h.count, 1); });
test('store: timer creation', () => { const s = new MetricsStore(); const t = s.timer('db'); t.record(10); assert.equal(t.count, 1); });
test('store: rate creation', () => { const s = new MetricsStore(); const r = s.rate('rps'); r.inc(5); assert.ok(r.value >= 5); });
test('store: same metric reused', () => { const s = new MetricsStore(); const c1 = s.counter('x', {a:'1'}); const c2 = s.counter('x', {a:'1'}); assert.equal(c1, c2); });
test('store: different tags create different metrics', () => { const s = new MetricsStore(); s.counter('x', {a:'1'}).inc(); s.counter('x', {a:'2'}).inc(2); assert.equal(s.counter('x', {a:'1'}).value, 1); assert.equal(s.counter('x', {a:'2'}).value, 2); });
test('store: snapshot', () => { const s = new MetricsStore(); s.counter('a').inc(); s.gauge('b').set(5); const snap = s.snapshot(); assert.ok(Object.keys(snap).length >= 2); });
test('store: list', () => { const s = new MetricsStore(); s.counter('a').inc(); const list = s.list(); assert.equal(list.length, 1); assert.equal(list[0].type, 'counter'); });
test('store: prometheus export', () => { const s = new MetricsStore(); s.counter('http_total').inc(10); const p = s.prometheus(); assert.ok(p.includes('# TYPE http_total counter')); assert.ok(p.includes('http_total 10')); });
test('store: prometheus histogram', () => { const s = new MetricsStore(); s.histogram('lat', {}, {buckets:[10,50]}).observe(20); const p = s.prometheus(); assert.ok(p.includes('# TYPE lat histogram')); assert.ok(p.includes('lat_bucket')); });
test('store: clear', () => { const s = new MetricsStore(); s.counter('a').inc(); s.clear(); assert.equal(s.list().length, 0); });
test('store: events', () => { const s = new MetricsStore(); let fired = false; s.on('metric:created', () => { fired = true; }); s.counter('new_metric'); assert.ok(fired); });

// ─── Auto-timer ───────────────────────────────────────────────────────
console.log('\n── Auto-timer ──');
await atest('store.time: success', async () => {
  const s = new MetricsStore();
  const result = await s.time('op', async () => { await new Promise(r => setTimeout(r, 10)); return 42; });
  assert.equal(result, 42);
  assert.equal(s.timer('op').count, 1);
});
await atest('store.time: error', async () => {
  const s = new MetricsStore();
  try { await s.time('op', async () => { throw new Error('fail'); }); } catch {}
  assert.equal(s.counter('op_errors').value, 1);
});

// ─── Persistence ──────────────────────────────────────────────────────
console.log('\n── Persistence ──');
test('persist + restore', () => {
  const dir = '/tmp/agent-metrics-test-' + Date.now();
  const s1 = new MetricsStore({ persistDir: dir });
  s1.counter('saved', {k:'v'}).inc(42);
  s1.gauge('g').set(99);
  s1._persist();
  s1.close();
  const s2 = new MetricsStore({ persistDir: dir });
  assert.equal(s2.counter('saved', {k:'v'}).value, 42);
  assert.equal(s2.gauge('g').value, 99);
  rmSync(dir, { recursive: true, force: true });
});

// ─── Summary ──────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('✅ All tests passed!');
