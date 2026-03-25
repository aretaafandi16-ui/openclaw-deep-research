#!/usr/bin/env node
/**
 * agent-replay test suite
 */

import { ReplayEngine, ReplaySession, ReplayBranch, SnapshotStore, sha256, deepClone, deepEqual, stateDiff } from './index.mjs';

let pass = 0, fail = 0, errors = [];
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; errors.push(msg); console.error(`  ❌ ${msg}`); }
}
function eq(a, b, msg) { assert(deepEqual(a, b), `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function section(name) { console.log(`\n  📋 ${name}`); }

// ─── Helpers ────────────────────────────────────────────────────────

section('sha256');
assert(sha256('hello') === sha256('hello'), 'Same input → same hash');
assert(sha256('hello') !== sha256('world'), 'Different input → different hash');
assert(sha256({ a: 1 }) === sha256({ a: 1 }), 'Same object → same hash');
assert(sha256({ a: 1 }) !== sha256({ a: 2 }), 'Different object → different hash');

section('deepClone');
const obj = { a: 1, b: { c: [2, 3] } };
const clone = deepClone(obj);
assert(clone !== obj, 'Clone is new reference');
eq(clone, obj, 'Clone equals original');
obj.b.c.push(4);
assert(clone.b.c.length === 2, 'Clone is independent (array length)');
assert(!clone.b.c.includes(4), 'Clone not affected by mutation');

section('deepEqual');
assert(deepEqual(1, 1), 'equal numbers');
assert(!deepEqual(1, 2), 'different numbers');
assert(deepEqual('a', 'a'), 'equal strings');
assert(deepEqual([1, 2], [1, 2]), 'equal arrays');
assert(!deepEqual([1, 2], [1, 3]), 'different arrays');
assert(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), 'equal objects unordered');
assert(deepEqual(null, null), 'null equals null');
assert(!deepEqual(null, 0), 'null not equals 0');

section('stateDiff');
let diffs = stateDiff({ a: 1 }, { a: 2 });
assert(diffs.length === 1, 'One diff');
eq(diffs[0].path, 'a', 'Diff path');
eq(diffs[0].type, 'changed', 'Diff type');

diffs = stateDiff({ a: 1 }, { a: 1, b: 2 });
assert(diffs.length === 1, 'Added key');
eq(diffs[0].path, 'b', 'Added path');
eq(diffs[0].type, 'added', 'Added type');

diffs = stateDiff({ a: 1, b: 2 }, { a: 1 });
assert(diffs.length === 1, 'Removed key');
eq(diffs[0].type, 'removed', 'Removed type');

diffs = stateDiff({ a: 1 }, { a: 1 });
assert(diffs.length === 0, 'No diff for equal');

// ─── SnapshotStore ──────────────────────────────────────────────────

section('SnapshotStore');
const store = new SnapshotStore();
const hash1 = store.put({ x: 1 });
const hash2 = store.put({ x: 1 });
const hash3 = store.put({ x: 2 });
eq(hash1, hash2, 'Same state → same hash');
assert(hash1 !== hash3, 'Different state → different hash');
eq(store.get(hash1), { x: 1 }, 'Get returns clone');
assert(store.size === 2, 'Two unique snapshots');

// ─── ReplaySession ──────────────────────────────────────────────────

section('ReplaySession');
const s = new ReplaySession('test-session', { metadata: { agent: 'test' } });
eq(s.id, 'test-session', 'Session ID');
assert(s.isRecording, 'Recording by default');

const step1 = s.record('input', { input: 'hello', state: { count: 1 } });
eq(step1.type, 'input', 'Step type');
eq(step1.index, 0, 'Step index');
assert(step1.stateHash !== null, 'State hash set');
eq(s.getState(0), { count: 1 }, 'getState returns state');

s.record('process', { input: 'hello', output: 'HELLO', state: { count: 2 }, durationMs: 50 });
s.record('output', { output: 'HELLO', state: { count: 2, done: true }, durationMs: 10 });

assert(s.steps.length === 3, 'Three steps recorded');
assert(s.currentStep === 2, 'Current step updated');

// Navigation
s.first();
eq(s.currentStep, 0, 'first() goes to 0');
s.last();
eq(s.currentStep, 2, 'last() goes to last');
s.prev();
eq(s.currentStep, 1, 'prev() decrements');
s.next();
eq(s.currentStep, 2, 'next() increments');
s.jump(0);
eq(s.currentStep, 0, 'jump(0) works');

// Search
eq(s.filterByType('input').length, 1, 'filterByType');
eq(s.filterErrors().length, 0, 'No errors');
const found = s.searchSteps('hello');
assert(found.length > 0, 'searchSteps found results');

// ─── Diff between steps ────────────────────────────────────────────

section('Step diffs');
const s2 = s.getStep(1);
assert(s2.diff !== undefined, 'Step has diff');
assert(s2.diff.length > 0, 'Diff has changes');

// ─── Branching ─────────────────────────────────────────────────────

section('Branching');
const branch = s.branch('alt', 0);
eq(branch.name, 'alt', 'Branch name');
eq(branch.fromStep, 0, 'Branch from step');

const bs = branch.record('process', { output: 'alt result', durationMs: 30 });
eq(bs.branch, 'alt', 'Branch step tagged');
eq(s.listBranches().length, 1, 'Branch listed');
eq(s.getBranch('alt'), branch, 'getBranch works');

// ─── Assertions ────────────────────────────────────────────────────

section('Assertions');
let a = s.assertState(0, { count: 1 });
assert(a.pass, 'assertState pass');
a = s.assertState(0, { count: 99 });
assert(!a.pass, 'assertState fail');

a = s.assertOutput(2, 'HELLO');
assert(a.pass, 'assertOutput pass');
a = s.assertOutput(2, 'NOPE');
assert(!a.pass, 'assertOutput fail');

a = s.assertTypeSequence(['input', 'process', 'output']);
assert(a.pass, 'assertTypeSequence pass');
a = s.assertTypeSequence(['input', 'output']);
assert(!a.pass, 'assertTypeSequence fail');

a = s.assertNoErrors();
assert(a.pass, 'assertNoErrors pass');

a = s.assertDuration(1, 100);
assert(a.pass, 'assertDuration pass');
a = s.assertDuration(1, 10);
assert(!a.pass, 'assertDuration fail');

// runAssertions
const results = s.runAssertions([
  { type: 'sequence', expected: ['input', 'process', 'output'] },
  { type: 'output', index: 2, expected: 'HELLO' },
  { type: 'noErrors' },
]);
assert(results.every(r => r.pass), 'runAssertions all pass');

// ─── Annotations ───────────────────────────────────────────────────

section('Annotations');
const ann = s.annotate(0, 'First step', ['important']);
eq(ann.stepIndex, 0, 'Annotation step');
eq(ann.text, 'First step', 'Annotation text');
eq(s.getAnnotations(0).length, 1, 'getAnnotations by step');
assert(s.getAnnotations().length >= 1, 'getAnnotations all');

// ─── Timeline ──────────────────────────────────────────────────────

section('Timeline');
const tl = s.timeline();
assert(tl.length === 3, 'Timeline has 3 entries');
assert(tl[0].type === 'input', 'First is input');

// ─── Stats ─────────────────────────────────────────────────────────

section('Stats');
const stats = s.stats();
eq(stats.totalSteps, 3, 'Total steps');
eq(stats.errors, 0, 'No errors');
eq(stats.annotations, 1, 'One annotation');
eq(stats.branches, 1, 'One branch');
assert(stats.duration.total === 60, 'Total duration');

// ─── Export ────────────────────────────────────────────────────────

section('Export');
const json = s.toJSON();
eq(json.id, 'test-session', 'JSON has id');
assert(json.steps.length === 3, 'JSON has steps');
assert(json.stats !== undefined, 'JSON has stats');

const md = s.toMarkdown();
assert(md.includes('# Replay Session'), 'Markdown has title');
assert(md.includes('## Steps'), 'Markdown has steps section');

// ─── ReplayEngine ──────────────────────────────────────────────────

section('ReplayEngine');
const engine = new ReplayEngine();
const es = engine.createSession('eng-1');
es.record('a', { input: 1 });
es.record('b', { output: 2 });
es.stop();

const es2 = engine.createSession('eng-2');
es2.record('a', { input: 1 });
es2.record('b', { output: 99 });
es2.record('c', { output: 3 });
es2.stop();

assert(engine.getSession('eng-1') === es, 'getSession');
assert(engine.listSessions().length >= 2, 'listSessions');

// diff
const d = engine.diff('eng-1', 'eng-2');
assert(d.similarity < 1, 'Sessions differ');
assert(d.diffs.length > 0, 'Has diffs');

// merge
const merged = engine.merge('eng-1', 'eng-2');
assert(merged.steps.length === 5, 'Merged has all steps');

// global stats
const gs = engine.stats();
assert(gs.totalSessions >= 1, 'Global sessions');
assert(gs.totalSteps >= 2, 'Global steps');

// delete
engine.deleteSession('eng-1');
assert(!engine.getSession('eng-1'), 'Deleted session');

// ─── Replay with callback ──────────────────────────────────────────

section('Replay');
(async () => {
  let count = 0;
  const results = await engine.replay('eng-2', (step) => { count++; return step.type; });
  assert(count === 3, 'Replay visited all steps');
  assert(results[0].result === 'a', 'Replay result correct');

  // Error handling
  const errs = await engine.replay('eng-2', (step) => { if (step.type === 'b') throw new Error('fail'); }, { continueOnError: true });
  assert(errs[1].error === 'fail', 'Replay catches error');

  // ─── Errors ──────────────────────────────────────────────────────
  
  section('Error handling');
  const se = new ReplaySession('err-test');
  se.record('input', { input: 'ok' });
  se.record('fail', { error: 'something broke', state: { failed: true } });
  se.record('recover', { state: { failed: false } });
  se.stop();

  assert(se.filterErrors().length === 1, 'One error found');
  const noErr = se.assertNoErrors();
  assert(!noErr.pass, 'assertNoErrors fails with errors');

  // ─── Summary ─────────────────────────────────────────────────────

  console.log(`\n  ═══════════════════════════════════════`);
  console.log(`  ✅ Passed: ${pass}`);
  console.log(`  ❌ Failed: ${fail}`);
  console.log(`  📊 Total:  ${pass + fail}`);
  if (errors.length) {
    console.log(`\n  Errors:`);
    errors.forEach(e => console.log(`    - ${e}`));
  }
  console.log(`  ═══════════════════════════════════════\n`);
  process.exit(fail > 0 ? 1 : 0);
})();
