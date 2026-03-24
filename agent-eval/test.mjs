#!/usr/bin/env node
/**
 * agent-eval Test Suite
 */

import { EvalSuite, BenchmarkRunner, Scorers, generateReport } from './index.mjs';
import assert from 'node:assert';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';

const dataDir = new URL('./test-data', import.meta.url).pathname;
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
async function testAsync(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('🧪 agent-eval Tests\n');

// ─── Scorers ──────────────────────────────────────────────────────────────────

console.log('Scorers:');

test('exact — match', () => {
  const r = Scorers.exact('hello', 'hello');
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.score, 1);
});

test('exact — case insensitive', () => {
  const r = Scorers.exact('Hello', 'hello');
  assert.strictEqual(r.pass, true);
});

test('exact — case sensitive', () => {
  const r = Scorers.exact('Hello', 'hello', { caseSensitive: true });
  assert.strictEqual(r.pass, false);
});

test('exact — mismatch', () => {
  const r = Scorers.exact('hello', 'world');
  assert.strictEqual(r.pass, false);
  assert.strictEqual(r.score, 0);
});

test('contains — match', () => {
  const r = Scorers.contains('answer is 42', 'The answer is 42!');
  assert.strictEqual(r.pass, true);
});

test('contains — miss', () => {
  const r = Scorers.contains('xyz', 'hello world');
  assert.strictEqual(r.pass, false);
});

test('contains — case sensitive', () => {
  const r = Scorers.contains('Hello', 'hello world', { caseSensitive: true });
  assert.strictEqual(r.pass, false);
});

test('regex — match', () => {
  const r = Scorers.regex('\\d+', 'Order #123 confirmed');
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.match, '123');
});

test('regex — miss', () => {
  const r = Scorers.regex('\\d+', 'no numbers here');
  assert.strictEqual(r.pass, false);
});

test('regex — with flags', () => {
  const r = Scorers.regex('hello', 'HELLO', { flags: 'i' });
  assert.strictEqual(r.pass, true);
});

test('similarity — identical', () => {
  const r = Scorers.similarity('hello world', 'hello world');
  assert.strictEqual(r.score, 1);
  assert.strictEqual(r.pass, true);
});

test('similarity — similar', () => {
  const r = Scorers.similarity('The quick brown fox', 'The fast brown fox');
  assert(r.score > 0.6);
});

test('similarity — different', () => {
  const r = Scorers.similarity('hello', 'xyz');
  assert(r.score < 0.3);
});

test('similarity — threshold', () => {
  const r = Scorers.similarity('hello', 'helpo', { threshold: 0.9 });
  assert.strictEqual(r.pass, false);
});

test('json_schema — valid object', () => {
  const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
  const r = Scorers.jsonSchema(schema, '{"name":"test"}');
  assert.strictEqual(r.pass, true);
});

test('json_schema — missing field', () => {
  const schema = { type: 'object', required: ['name', 'age'] };
  const r = Scorers.jsonSchema(schema, '{"name":"test"}');
  assert.strictEqual(r.pass, false);
  assert(r.detail.includes('age'));
});

test('json_schema — wrong type', () => {
  const schema = { type: 'object', properties: { count: { type: 'number' } } };
  const r = Scorers.jsonSchema(schema, '{"count":"not a number"}');
  assert.strictEqual(r.pass, false);
});

test('json_schema — invalid JSON', () => {
  const r = Scorers.jsonSchema({}, 'not json');
  assert.strictEqual(r.pass, false);
});

test('json_schema — array', () => {
  const r = Scorers.jsonSchema({ type: 'array', items: { type: 'number' } }, '[1,2,3]');
  assert.strictEqual(r.pass, true);
});

test('json_schema — enum', () => {
  const r = Scorers.jsonSchema({ enum: ['a', 'b', 'c'] }, '"b"');
  assert.strictEqual(r.pass, true);
});

test('json_schema — enum fail', () => {
  const r = Scorers.jsonSchema({ enum: ['a', 'b'] }, '"z"');
  assert.strictEqual(r.pass, false);
});

test('numeric — within tolerance', () => {
  const r = Scorers.numeric(3.14159, '3.14');
  assert.strictEqual(r.pass, true);
});

test('numeric — outside tolerance', () => {
  const r = Scorers.numeric(100, '50');
  assert.strictEqual(r.pass, false);
});

test('numeric — NaN', () => {
  const r = Scorers.numeric(0, 'abc');
  assert.strictEqual(r.pass, false);
});

test('length — equal', () => {
  const r = Scorers.length(5, 'hello');
  assert.strictEqual(r.pass, true);
});

test('length — greater than', () => {
  const r = Scorers.length(10, 'hello world', { operator: 'gte' });
  assert.strictEqual(r.pass, true);
});

test('length — between', () => {
  const r = Scorers.length([5, 20], 'hello world', { operator: 'between' });
  assert.strictEqual(r.pass, true);
});

test('length — between fail', () => {
  const r = Scorers.length([20, 30], 'hello', { operator: 'between' });
  assert.strictEqual(r.pass, false);
});

test('notEmpty — not empty', () => {
  const r = Scorers.notEmpty(null, 'something');
  assert.strictEqual(r.pass, true);
});

test('notEmpty — empty', () => {
  const r = Scorers.notEmpty(null, '');
  assert.strictEqual(r.pass, false);
});

test('notEmpty — whitespace only', () => {
  const r = Scorers.notEmpty(null, '   ');
  assert.strictEqual(r.pass, false);
});

test('custom — boolean', () => {
  const r = Scorers.custom(() => true, null, 'test');
  assert.strictEqual(r.pass, true);
});

test('custom — result object', () => {
  const r = Scorers.custom(() => ({ score: 0.8, pass: true, detail: 'ok' }), null, 'test');
  assert.strictEqual(r.score, 0.8);
});

// ─── EvalSuite ────────────────────────────────────────────────────────────────

console.log('\nEvalSuite:');

await testAsync('add and list cases', () => {
  const suite = new EvalSuite({ name: 'test-add' });
  suite.add({ name: 'test1', input: 'hello', expected: 'hello', scorer: 'exact' });
  suite.add({ name: 'test2', input: 'world', expected: 'WORLD', scorer: 'contains' });
  assert.strictEqual(suite.cases.length, 2);
  assert.strictEqual(suite.getCases().length, 2);
});

await testAsync('filter by tag', () => {
  const suite = new EvalSuite({ name: 'test-tags' });
  suite.add({ name: 'a', input: 'x', expected: 'x', tags: ['fast'] });
  suite.add({ name: 'b', input: 'y', expected: 'y', tags: ['slow'] });
  suite.add({ name: 'c', input: 'z', expected: 'z', tags: ['fast', 'critical'] });
  assert.strictEqual(suite.getCases({ tag: 'fast' }).length, 2);
  assert.strictEqual(suite.getCases({ tag: 'slow' }).length, 1);
  assert.strictEqual(suite.getCases({ tag: 'critical' }).length, 1);
});

await testAsync('remove case', () => {
  const suite = new EvalSuite({ name: 'test-remove' });
  const tc = suite.add({ name: 'temp', input: 'x', expected: 'x' });
  assert.strictEqual(suite.cases.length, 1);
  suite.remove(tc.id);
  assert.strictEqual(suite.cases.length, 0);
});

await testAsync('run suite (echo executor)', async () => {
  const suite = new EvalSuite({ name: 'test-run' });
  suite.add({ name: 'match', input: 'hello', expected: 'hello', scorer: 'exact' });
  suite.add({ name: 'fail', input: 'hello', expected: 'world', scorer: 'exact' });
  const { results, summary } = await suite.run(async (input) => input);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(summary.passed, 1);
  assert.strictEqual(summary.failed, 1);
  assert.strictEqual(summary.passRate, 50);
});

await testAsync('run with retries', async () => {
  const suite = new EvalSuite({ name: 'test-retry' });
  let attempts = 0;
  suite.add({ name: 'retry-test', input: 'ok', expected: 'ok', scorer: 'exact', retries: 2 });
  const { results } = await suite.run(async () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'ok';
  });
  assert.strictEqual(results[0].pass, true);
  assert.strictEqual(results[0].attempts, 3);
});

await testAsync('run with timeout', async () => {
  const suite = new EvalSuite({ name: 'test-timeout' });
  suite.add({ name: 'timeout-test', input: 'x', expected: 'x', timeout: 100 });
  const { results } = await suite.run(async () => {
    await new Promise(r => setTimeout(r, 500));
    return 'x';
  });
  assert.strictEqual(results[0].pass, false);
  assert(results[0].error.includes('Timeout'));
});

await testAsync('run parallel', async () => {
  const suite = new EvalSuite({ name: 'test-parallel' });
  for (let i = 0; i < 8; i++) {
    suite.add({ name: `p${i}`, input: `val${i}`, expected: `val${i}`, scorer: 'exact' });
  }
  const { summary } = await suite.run(async (input) => input, { parallel: true, concurrency: 4 });
  assert.strictEqual(summary.passed, 8);
  assert.strictEqual(summary.total, 8);
});

await testAsync('run events', async () => {
  const suite = new EvalSuite({ name: 'test-events' });
  suite.add({ name: 'e1', input: 'x', expected: 'x' });
  const events = [];
  suite.on('run:start', () => events.push('run:start'));
  suite.on('case:result', () => events.push('case:result'));
  suite.on('run:complete', () => events.push('run:complete'));
  await suite.run(async (input) => input);
  assert(events.includes('run:start'));
  assert(events.includes('case:result'));
  assert(events.includes('run:complete'));
});

await testAsync('export and import', () => {
  const suite = new EvalSuite({ name: 'test-export' });
  suite.add({ name: 'a', input: 'x', expected: 'x' });
  suite.add({ name: 'b', input: 'y', expected: 'y' });
  const exported = suite.export();
  assert.strictEqual(exported.cases.length, 2);

  const suite2 = new EvalSuite({ name: 'test-import' });
  const count = suite2.import(exported);
  assert.strictEqual(count, 2);
  assert.strictEqual(suite2.cases.length, 2);
});

await testAsync('tag-based summary', async () => {
  const suite = new EvalSuite({ name: 'test-tags-summary' });
  suite.add({ name: 't1', input: 'a', expected: 'a', scorer: 'exact', tags: ['unit'] });
  suite.add({ name: 't2', input: 'b', expected: 'b', scorer: 'exact', tags: ['unit'] });
  suite.add({ name: 't3', input: 'c', expected: 'z', scorer: 'exact', tags: ['integration'] });
  const { summary } = await suite.run(async (input) => input);
  assert.strictEqual(summary.byTag['unit'].passed, 2);
  assert.strictEqual(summary.byTag['integration'].passed, 0);
});

// ─── BenchmarkRunner ──────────────────────────────────────────────────────────

console.log('\nBenchmarkRunner:');

await testAsync('run all models', async () => {
  const bench = new BenchmarkRunner();
  const suite = bench.addSuite({ name: 'bench-test', cases: [] });
  suite.add({ name: 'b1', input: 'hello', expected: 'hello', scorer: 'exact' });
  suite.add({ name: 'b2', input: 'world', expected: 'WORLD', scorer: 'contains' });

  bench.addModel('perfect', async (input) => input);
  bench.addModel('upper', async (input) => input.toUpperCase());

  const result = await bench.runAll('bench-test');
  assert.strictEqual(Object.keys(result.results).length, 2);
  assert(result.comparison.ranked.length === 2);
  assert(result.comparison.best);
});

await testAsync('A/B test', async () => {
  const bench = new BenchmarkRunner();
  const resultsA = { model: 'A', results: Array(20).fill(null).map(() => ({ score: 0.8 + Math.random() * 0.1 })) };
  const resultsB = { model: 'B', results: Array(20).fill(null).map(() => ({ score: 0.5 + Math.random() * 0.1 })) };
  const ab = bench.abTest(resultsA, resultsB);
  assert.strictEqual(ab.modelA, 'A');
  assert.strictEqual(ab.modelB, 'B');
  assert(ab.meanA > ab.meanB);
  assert.strictEqual(ab.significant, true);
  assert.strictEqual(ab.winner, 'A');
});

await testAsync('A/B test — no significance', async () => {
  const bench = new BenchmarkRunner();
  const resultsA = { model: 'A', results: Array(10).fill(null).map(() => ({ score: 0.7 })) };
  const resultsB = { model: 'B', results: Array(10).fill(null).map(() => ({ score: 0.7 })) };
  const ab = bench.abTest(resultsA, resultsB);
  assert.strictEqual(ab.significant, false);
});

// ─── Report ───────────────────────────────────────────────────────────────────

console.log('\nReport:');

test('generate report', () => {
  const report = generateReport({
    suite: 'test',
    results: {
      modelA: { results: [{ name: 't1', pass: true }, { name: 't2', pass: false, detail: 'wrong' }], summary: { passRate: 50, avgScore: 0.5, avgDuration: 100, passed: 1, total: 2, errored: 0 } }
    },
    comparison: { ranked: [{ model: 'modelA', passRate: 50, avgScore: 0.5, avgDuration: 100, passed: 1, total: 2, errored: 0 }], best: 'modelA', fastest: 'modelA', mostReliable: 'modelA' }
  });
  assert(report.includes('Benchmark Report'));
  assert(report.includes('Leaderboard'));
  assert(report.includes('modelA'));
  assert(report.includes('Failures'));
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

try { unlinkSync(new URL('./data/bench-test_results.jsonl', import.meta.url).pathname); } catch {}

console.log(`\n📊 Results: ${passed}/${total} passed (${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
