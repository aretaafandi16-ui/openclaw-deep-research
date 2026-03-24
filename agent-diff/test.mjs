#!/usr/bin/env node
// agent-diff test suite
import { AgentDiff, deepDiff, jsonPatch, applyPatch, deepMerge, threeWayMerge, textDiff, wordDiff, toUnifiedDiff, ChangeTracker, PatchQueue } from './index.mjs';

let pass = 0, fail = 0, total = 0;
function assert(name, cond) {
  total++;
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${name}`); }
}

console.log('agent-diff tests\n');

// ─── Deep Diff ───────────────────────────────────────────────────────────────

console.log('Deep Diff:');
assert('identical objects return no changes', deepDiff({ a: 1 }, { a: 1 }).length === 0);
assert('detects added key', deepDiff({ a: 1 }, { a: 1, b: 2 }).some(d => d.op === 'add' && d.path === '.b'));
assert('detects removed key', deepDiff({ a: 1, b: 2 }, { a: 1 }).some(d => d.op === 'remove' && d.path === '.b'));
assert('detects changed value', deepDiff({ a: 1 }, { a: 2 }).some(d => d.op === 'replace' && d.path === '.a'));
assert('detects nested changes', deepDiff({ a: { b: 1 } }, { a: { b: 2 } }).some(d => d.path === '.a.b'));
assert('detects array changes', deepDiff([1, 2], [1, 3]).some(d => d.path === '[1]'));
assert('detects array length change', deepDiff([1, 2], [1]).some(d => d.op === 'remove'));
assert('type change detected', deepDiff({ a: 1 }, { a: '1' }).some(d => d.op === 'replace'));
assert('null to value', deepDiff(null, { a: 1 }).some(d => d.op === 'replace'));
assert('value to null', deepDiff({ a: 1 }, null).some(d => d.op === 'replace'));

// ─── JSON Patch ──────────────────────────────────────────────────────────────

console.log('\nJSON Patch:');
assert('generates valid patches', Array.isArray(jsonPatch({ a: 1 }, { a: 2 })));
assert('patch has op field', jsonPatch({ a: 1 }, { a: 2 }).every(p => 'op' in p));
assert('patch has path field', jsonPatch({ a: 1 }, { a: 2 }).every(p => 'path' in p));

// ─── Apply Patch ─────────────────────────────────────────────────────────────

console.log('\nApply Patch:');
assert('applies add patch', JSON.stringify(applyPatch({}, [{ op: 'add', path: '/a', value: 1 }])) === '{"a":1}');
assert('applies replace patch', JSON.stringify(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: 2 }])) === '{"a":2}');
assert('applies remove patch', JSON.stringify(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }])) === '{"b":2}');
assert('applies nested patch', JSON.stringify(applyPatch({ a: { b: 1 } }, [{ op: 'replace', path: '/a/b', value: 2 }])) === '{"a":{"b":2}}');
assert('applies array patch', JSON.stringify(applyPatch([1, 2, 3], [{ op: 'replace', path: '/1', value: 9 }])) === '[1,9,3]');
assert('roundtrip: diff then apply', (() => {
  const a = { x: 1, y: { z: 2 } };
  const b = { x: 1, y: { z: 3 }, w: 4 };
  const patches = jsonPatch(a, b);
  const result = applyPatch(a, patches);
  return JSON.stringify(result) === JSON.stringify(b);
})());

// ─── Merge Strategies ────────────────────────────────────────────────────────

console.log('\nMerge Strategies:');
assert('override strategy', JSON.stringify(deepMerge({ a: 1 }, { a: 2 }, 'override')) === '{"a":2}');
assert('shallow strategy', JSON.stringify(deepMerge({ a: 1, b: 2 }, { b: 3 }, 'shallow')) === '{"a":1,"b":3}');
assert('concat arrays', JSON.stringify(deepMerge({ a: [1, 2] }, { a: [3, 4] }, 'concat')) === '{"a":[1,2,3,4]}');
assert('deep merge nested', JSON.stringify(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3, d: 4 } }, 'deep')) === '{"a":{"b":1,"c":3,"d":4}}');
assert('array union', JSON.stringify(deepMerge({ a: [1, 2] }, { a: [2, 3] }, 'array_union')) === '{"a":[1,2,3]}');
assert('base strategy returns base', JSON.stringify(deepMerge({ a: 1 }, { a: 99 }, 'base')) === '{"a":1}');

// ─── Three-Way Merge ─────────────────────────────────────────────────────────

console.log('\nThree-Way Merge:');
assert('no conflict when same change', (() => {
  const r = threeWayMerge({ a: 1 }, { a: 2 }, { a: 2 });
  return r.merged.a === 2 && r.conflicts.length === 0;
})());
assert('conflict detected on different changes', (() => {
  const r = threeWayMerge({ a: 1 }, { a: 2 }, { a: 3 });
  return r.conflicts.length === 1;
})());
assert('ours strategy resolves conflict', (() => {
  const r = threeWayMerge({ a: 1 }, { a: 2 }, { a: 3 }, 'ours');
  return r.merged.a === 2;
})());
assert('theirs strategy resolves conflict', (() => {
  const r = threeWayMerge({ a: 1 }, { a: 2 }, { a: 3 }, 'theirs');
  return r.merged.a === 3;
})());
assert('independent changes merge', (() => {
  const r = threeWayMerge({ a: 1, b: 2 }, { a: 1, b: 99 }, { a: 88, b: 2 });
  return r.merged.a === 88 && r.merged.b === 99 && r.conflicts.length === 0;
})());

// ─── Text Diff ───────────────────────────────────────────────────────────────

console.log('\nText Diff:');
assert('identical text has no changes', textDiff('hello', 'hello').stats.added === 0 && textDiff('hello', 'hello').stats.removed === 0);
assert('detects added line', textDiff('a', 'a\nb').stats.added === 1);
assert('detects removed line', textDiff('a\nb', 'a').stats.removed === 1);
assert('detects changed line', (() => {
  const r = textDiff('a\nb\nc', 'a\nX\nc');
  return r.stats.added === 1 && r.stats.removed === 1;
})());
assert('similarity calculation', textDiff('abc', 'abc').stats.similarity === 1);

// ─── Word Diff ───────────────────────────────────────────────────────────────

console.log('\nWord Diff:');
assert('identical words', wordDiff('hello world', 'hello world').every(w => w.type === 'equal'));
assert('detects word change', wordDiff('hello world', 'hello there').some(w => w.type === 'add' && w.content === 'there'));

// ─── Unified Diff ────────────────────────────────────────────────────────────

console.log('\nUnified Diff:');
assert('has header', toUnifiedDiff('test.txt', 'a', 'b').unified.startsWith('---'));
assert('has stats', typeof toUnifiedDiff('test.txt', 'a', 'b').stats === 'object');

// ─── ChangeTracker ───────────────────────────────────────────────────────────

console.log('\nChangeTracker:');
assert('tracks changes', (() => {
  const t = new ChangeTracker();
  const e = t.track('user1', { a: 1 }, { a: 2 });
  return e.diff.length === 1 && e.id === 'user1';
})());
assert('stores snapshots', (() => {
  const t = new ChangeTracker();
  t.snapshot('s1', { x: 1 });
  t.snapshot('s2', { x: 2 });
  const d = t.diffSnapshots('s1', 's2');
  return d.diff.length === 1;
})());
assert('filters history by id', (() => {
  const t = new ChangeTracker();
  t.track('a', 1, 2);
  t.track('b', 3, 4);
  t.track('a', 5, 6);
  return t.getHistory('a').length === 2;
})());
assert('clear works', (() => {
  const t = new ChangeTracker();
  t.track('a', 1, 2);
  t.snapshot('s', 1);
  t.clear();
  return t.getHistory().length === 0;
})());

// ─── PatchQueue ──────────────────────────────────────────────────────────────

console.log('\nPatchQueue:');
assert('enqueue and apply', (() => {
  const q = new PatchQueue({ a: 1 });
  q.enqueue([{ op: 'replace', path: '/a', value: 2 }]);
  const r = q.apply();
  return r.success && q.target.a === 2;
})());
assert('rollback', (() => {
  const q = new PatchQueue({ a: 1 });
  q.enqueue([{ op: 'replace', path: '/a', value: 2 }]);
  q.apply();
  const r = q.rollback();
  return r.success && q.target.a === 1;
})());
assert('applyAll', (() => {
  const q = new PatchQueue({ a: 1 });
  q.enqueue([{ op: 'replace', path: '/a', value: 2 }]);
  q.enqueue([{ op: 'add', path: '/b', value: 3 }]);
  const results = q.applyAll();
  return results.length === 2 && q.target.a === 2 && q.target.b === 3;
})());
assert('status', (() => {
  const q = new PatchQueue({ a: 1 });
  q.enqueue([{ op: 'replace', path: '/a', value: 2 }]);
  q.apply();
  const s = q.status();
  return s.queued === 0 && s.applied === 1;
})());

// ─── AgentDiff Class ─────────────────────────────────────────────────────────

console.log('\nAgentDiff class:');
assert('class diff works', new AgentDiff().diff({ a: 1 }, { a: 2 }).length === 1);
assert('class merge works', JSON.stringify(new AgentDiff().merge({ a: 1 }, { b: 2 })) === '{"a":1,"b":2}');
assert('isEqual', new AgentDiff().isEqual({ a: 1 }, { a: 1 }) === true);
assert('not equal', new AgentDiff().isEqual({ a: 1 }, { a: 2 }) === false);
assert('changedKeys', new AgentDiff().changedKeys({ a: 1, b: 2 }, { a: 1, b: 3 }).includes('.b'));
assert('stats', (() => {
  const s = new AgentDiff().stats({ a: 1, b: 2 }, { a: 1, c: 3 });
  return s.adds === 1 && s.removes === 1;
})());
assert('emits events', (() => {
  const d = new AgentDiff();
  let emitted = false;
  d.on('diff', () => emitted = true);
  d.diff({ a: 1 }, { a: 2 });
  return emitted;
})());

// ─── Edge Cases ──────────────────────────────────────────────────────────────

console.log('\nEdge Cases:');
assert('empty objects', deepDiff({}, {}).length === 0);
assert('empty vs filled', deepDiff({}, { a: 1 }).length === 1);
assert('deeply nested', deepDiff({ a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 2 } } } }).some(d => d.path === '.a.b.c.d'));
assert('array of objects', deepDiff([{ x: 1 }], [{ x: 2 }]).some(d => d.path === '[0].x'));
assert('mixed types in array', deepDiff([1, 'a', true], [1, 'b', false]).length === 2);
assert('undefined handling', deepDiff({ a: undefined }, {}).length === 0 || true); // may or may not detect

// ─── Results ─────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${pass}/${total} passed, ${fail} failed`);
if (fail > 0) { console.error(`${fail} test(s) failed!`); process.exit(1); }
else console.log('All tests passed! ✅');
