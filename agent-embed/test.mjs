/**
 * agent-embed tests
 */

import { EmbedStore, Distances, matchesFilter } from './index.mjs';
import { strict as assert } from 'node:assert';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const tmpDir = '/tmp/agent-embed-test';
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

async function atest(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('agent-embed tests\n');

// ── Distance Functions ────────────────────────────────────────────────────────

console.log('Distance Functions');

test('cosine similarity — identical vectors = 1', () => {
  assert.equal(Distances.cosine([1, 0, 0], [1, 0, 0]), 1);
});

test('cosine similarity — orthogonal vectors = 0', () => {
  assert.equal(Distances.cosine([1, 0], [0, 1]), 0);
});

test('cosine similarity — opposite vectors = -1', () => {
  assert.equal(Distances.cosine([1, 0], [-1, 0]), -1);
});

test('euclidean — identical = 1', () => {
  assert.equal(Distances.euclidean([1, 2, 3], [1, 2, 3]), 1);
});

test('euclidean — distance > 0', () => {
  const d = Distances.euclidean([0, 0], [3, 4]);
  assert.ok(d > 0 && d < 1);
});

test('dot product — basic', () => {
  assert.equal(Distances.dot([1, 2, 3], [4, 5, 6]), 32);
});

// ── Metadata Filters ─────────────────────────────────────────────────────────

console.log('\nMetadata Filters');

test('filter — direct equality', () => {
  assert.ok(matchesFilter({ tag: 'test' }, { tag: 'test' }));
  assert.ok(!matchesFilter({ tag: 'test' }, { tag: 'other' }));
});

test('filter — $eq', () => {
  assert.ok(matchesFilter({ score: 5 }, { score: { $eq: 5 } }));
  assert.ok(!matchesFilter({ score: 3 }, { score: { $eq: 5 } }));
});

test('filter — $ne', () => {
  assert.ok(matchesFilter({ score: 3 }, { score: { $ne: 5 } }));
  assert.ok(!matchesFilter({ score: 5 }, { score: { $ne: 5 } }));
});

test('filter — $gt, $gte, $lt, $lte', () => {
  assert.ok(matchesFilter({ val: 10 }, { val: { $gt: 5 } }));
  assert.ok(!matchesFilter({ val: 3 }, { val: { $gt: 5 } }));
  assert.ok(matchesFilter({ val: 5 }, { val: { $gte: 5 } }));
  assert.ok(matchesFilter({ val: 3 }, { val: { $lt: 5 } }));
  assert.ok(matchesFilter({ val: 5 }, { val: { $lte: 5 } }));
});

test('filter — $in, $nin', () => {
  assert.ok(matchesFilter({ tag: 'a' }, { tag: { $in: ['a', 'b'] } }));
  assert.ok(!matchesFilter({ tag: 'c' }, { tag: { $in: ['a', 'b'] } }));
  assert.ok(matchesFilter({ tag: 'c' }, { tag: { $nin: ['a', 'b'] } }));
});

test('filter — $exists', () => {
  assert.ok(matchesFilter({ a: 1 }, { b: { $exists: false } }));
  assert.ok(!matchesFilter({ a: 1 }, { b: { $exists: true } }));
  assert.ok(matchesFilter({ a: 1 }, { a: { $exists: true } }));
});

test('filter — $contains', () => {
  assert.ok(matchesFilter({ text: 'hello world' }, { text: { $contains: 'world' } }));
  assert.ok(matchesFilter({ tags: ['a', 'b'] }, { tags: { $contains: 'a' } }));
});

test('filter — $and', () => {
  assert.ok(matchesFilter({ a: 1, b: 2 }, { $and: [{ a: 1 }, { b: 2 }] }));
  assert.ok(!matchesFilter({ a: 1, b: 3 }, { $and: [{ a: 1 }, { b: 2 }] }));
});

test('filter — $or', () => {
  assert.ok(matchesFilter({ a: 1 }, { $or: [{ a: 1 }, { b: 2 }] }));
  assert.ok(matchesFilter({ b: 2 }, { $or: [{ a: 1 }, { b: 2 }] }));
  assert.ok(!matchesFilter({ c: 3 }, { $or: [{ a: 1 }, { b: 2 }] }));
});

test('filter — $not', () => {
  assert.ok(matchesFilter({ a: 1 }, { $not: { a: 2 } }));
  assert.ok(!matchesFilter({ a: 1 }, { $not: { a: 1 } }));
});

test('filter — null/undefined filter = match all', () => {
  assert.ok(matchesFilter({ a: 1 }, null));
  assert.ok(matchesFilter({ a: 1 }, undefined));
});

// ── EmbedStore Core ──────────────────────────────────────────────────────────

console.log('\nEmbedStore Core');

test('create store with auto-dimension', () => {
  const store = new EmbedStore();
  const { id, created } = store.upsert('v1', [1, 2, 3]);
  assert.equal(id, 'v1');
  assert.ok(created);
  assert.equal(store.dim, 3);
});

test('upsert — update existing', () => {
  const store = new EmbedStore({ dimension: 3 });
  store.upsert('v1', [1, 2, 3], { tag: 'old' });
  const { created } = store.upsert('v1', [4, 5, 6], { tag: 'new' });
  assert.ok(!created);
  const entry = store.get('v1');
  assert.equal(entry.metadata.tag, 'new');
  assert.deepEqual(entry.vector, [4, 5, 6]);
});

test('get — returns entry', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0], { type: 'test' });
  const e = store.get('a');
  assert.equal(e.id, 'a');
  assert.deepEqual(e.vector, [1, 0]);
  assert.equal(e.metadata.type, 'test');
  assert.ok(e.createdAt > 0);
});

test('get — missing returns null', () => {
  const store = new EmbedStore({ dimension: 2 });
  assert.equal(store.get('nope'), null);
});

test('has — check existence', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0]);
  assert.ok(store.has('a'));
  assert.ok(!store.has('b'));
});

test('delete — removes entry', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0]);
  assert.ok(store.delete('a'));
  assert.ok(!store.has('a'));
});

test('delete — missing returns false', () => {
  const store = new EmbedStore({ dimension: 2 });
  assert.ok(!store.delete('nope'));
});

test('updateMetadata — merges metadata', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0], { x: 1 });
  store.updateMetadata('a', { y: 2 });
  const e = store.get('a');
  assert.equal(e.metadata.x, 1);
  assert.equal(e.metadata.y, 2);
});

test('updateMetadata — missing returns false', () => {
  const store = new EmbedStore({ dimension: 2 });
  assert.ok(!store.updateMetadata('nope', { x: 1 }));
});

test('clear — removes all', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0]);
  store.upsert('b', [0, 1]);
  const count = store.clear();
  assert.equal(count, 2);
  assert.equal(store.getInfo().count, 0);
});

test('dimension mismatch throws', () => {
  const store = new EmbedStore({ dimension: 3 });
  assert.throws(() => store.upsert('a', [1, 2]), /dimension mismatch/);
});

test('NaN in vector throws', () => {
  const store = new EmbedStore({ dimension: 3 });
  assert.throws(() => store.upsert('a', [1, NaN, 3]), /not a valid number/);
});

test('empty vector throws', () => {
  const store = new EmbedStore();
  assert.throws(() => store.upsert('a', []), /must not be empty/);
});

test('auto-id with upsertBatch', () => {
  const store = new EmbedStore({ dimension: 2 });
  const result = store.upsertBatch([
    { vector: [1, 0], metadata: { a: 1 } },
    { vector: [0, 1], metadata: { b: 2 } }
  ]);
  assert.equal(result.inserted, 2);
  assert.equal(result.skipped, 0);
  assert.equal(store.getInfo().count, 2);
});

test('upsertBatch — partial failure', () => {
  const store = new EmbedStore({ dimension: 2 });
  const result = store.upsertBatch([
    { id: 'ok', vector: [1, 0] },
    { id: 'bad', vector: [1, 2, 3] }, // wrong dim
    { id: 'ok2', vector: [0, 1] }
  ]);
  assert.equal(result.inserted, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors[0].id, 'bad');
});

// ── Search ────────────────────────────────────────────────────────────────────

console.log('\nSearch');

test('search — cosine top-k', () => {
  const store = new EmbedStore({ dimension: 3, distance: 'cosine' });
  store.upsert('a', [1, 0, 0], { name: 'x' });
  store.upsert('b', [0, 1, 0], { name: 'y' });
  store.upsert('c', [0.7, 0.7, 0], { name: 'z' });

  const results = store.search([1, 0, 0], 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'a');
  assert.equal(results[0].score, 1);
});

test('search — with metadata filter', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0], { type: 'img' });
  store.upsert('b', [1, 0], { type: 'text' });
  store.upsert('c', [0.9, 0.1], { type: 'img' });

  const results = store.search([1, 0], 10, { filter: { type: 'img' } });
  assert.equal(results.length, 2);
  assert.ok(results.every(r => r.metadata.type === 'img'));
});

test('search — with threshold', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0]);
  store.upsert('b', [0.5, 0.5]);
  store.upsert('c', [0, 1]);

  const results = store.search([1, 0], 10, { threshold: 0.9 });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a');
});

test('search — includeVectors', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0]);
  const results = store.search([1, 0], 1, { includeVectors: true });
  assert.deepEqual(results[0].vector, [1, 0]);
});

test('search — empty store returns []', () => {
  const store = new EmbedStore({ dimension: 2 });
  assert.deepEqual(store.search([1, 0]), []);
});

// ── Batch & Export ────────────────────────────────────────────────────────────

console.log('\nBatch & Export');

test('export/import roundtrip', () => {
  const store1 = new EmbedStore({ dimension: 2 });
  store1.upsert('a', [1, 0], { tag: 'x' });
  store1.upsert('b', [0, 1], { tag: 'y' });

  const exported = store1.export();
  const store2 = new EmbedStore({ dimension: 2 });
  store2.import(exported);

  assert.equal(store2.getInfo().count, 2);
  assert.deepEqual(store2.get('a').vector, [1, 0]);
  assert.equal(store2.get('b').metadata.tag, 'y');
});

test('ids() returns all ids', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0]);
  store.upsert('b', [0, 1]);
  const ids = store.ids();
  assert.ok(ids.includes('a'));
  assert.ok(ids.includes('b'));
});

test('iterator', () => {
  const store = new EmbedStore({ dimension: 2 });
  store.upsert('a', [1, 0], { x: 1 });
  const items = [...store];
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'a');
});

// ── Max Vectors ──────────────────────────────────────────────────────────────

console.log('\nMax Vectors');

test('maxVectors eviction', () => {
  const store = new EmbedStore({ dimension: 2, maxVectors: 2 });
  store.upsert('a', [1, 0]);
  store.upsert('b', [0, 1]);
  store.upsert('c', [1, 1]);
  assert.equal(store.getInfo().count, 2);
  assert.ok(!store.has('a')); // oldest evicted
  assert.ok(store.has('b'));
  assert.ok(store.has('c'));
});

// ── IVF Index ─────────────────────────────────────────────────────────────────

console.log('\nIVF Index');

test('buildIndex — creates IVF', () => {
  const store = new EmbedStore({ dimension: 2, ivfPartitions: 3 });
  for (let i = 0; i < 50; i++) {
    store.upsert(`v${i}`, [Math.random(), Math.random()]);
  }
  store.buildIndex(3);
  assert.ok(store.ivf?.trained);
});

test('search with IVF returns results', () => {
  const store = new EmbedStore({ dimension: 2, ivfPartitions: 3, nprobe: 2 });
  for (let i = 0; i < 50; i++) {
    store.upsert(`v${i}`, [Math.random(), Math.random()]);
  }
  store.buildIndex(3);
  const results = store.search([0.5, 0.5], 5);
  assert.ok(results.length > 0);
});

// ── Persistence ───────────────────────────────────────────────────────────────

console.log('\nPersistence');

test('persist and reload', () => {
  const persistPath = join(tmpDir, 'test.jsonl');
  if (existsSync(persistPath)) unlinkSync(persistPath);
  const snapPath = persistPath.replace('.jsonl', '.snapshot.json');
  if (existsSync(snapPath)) unlinkSync(snapPath);

  const store1 = new EmbedStore({ dimension: 2, persistPath });
  store1.upsert('a', [1, 0], { tag: 'x' });
  store1.upsert('b', [0, 1], { tag: 'y' });

  const store2 = new EmbedStore({ dimension: 2, persistPath });
  assert.equal(store2.getInfo().count, 2);
  assert.deepEqual(store2.get('a').vector, [1, 0]);
  assert.equal(store2.get('b').metadata.tag, 'y');
});

test('persist — delete survives reload', () => {
  const persistPath = join(tmpDir, 'test2.jsonl');
  if (existsSync(persistPath)) unlinkSync(persistPath);

  const store1 = new EmbedStore({ dimension: 2, persistPath });
  store1.upsert('a', [1, 0]);
  store1.upsert('b', [0, 1]);
  store1.delete('a');

  const store2 = new EmbedStore({ dimension: 2, persistPath });
  assert.equal(store2.getInfo().count, 1);
  assert.ok(!store2.has('a'));
  assert.ok(store2.has('b'));
});

// ── Events ────────────────────────────────────────────────────────────────────

console.log('\nEvents');

test('events — upsert, delete, clear', async () => {
  const store = new EmbedStore({ dimension: 2 });
  const events = [];
  store.on('upsert', (id, created) => events.push({ op: 'upsert', id, created }));
  store.on('delete', (id) => events.push({ op: 'delete', id }));
  store.on('clear', (count) => events.push({ op: 'clear', count }));

  store.upsert('a', [1, 0]);
  store.upsert('a', [2, 0]); // update
  store.delete('a');
  store.upsert('b', [0, 1]);
  store.clear();

  assert.equal(events.length, 5);
  assert.equal(events[0].created, true);
  assert.equal(events[1].created, false);
  assert.equal(events[2].op, 'delete');
  assert.equal(events[4].count, 1);
});

// ── Info ──────────────────────────────────────────────────────────────────────

console.log('\nInfo');

test('getInfo — stats', () => {
  const store = new EmbedStore({ dimension: 3, namespace: 'test' });
  store.upsert('a', [1, 0, 0]);
  store.upsert('b', [0, 1, 0]);
  store.search([1, 0, 0], 1);
  store.delete('a');

  const info = store.getInfo();
  assert.equal(info.namespace, 'test');
  assert.equal(info.count, 1);
  assert.equal(info.dimension, 3);
  assert.equal(info.stats.inserts, 2);
  assert.equal(info.stats.deletes, 1);
  assert.equal(info.stats.searches, 1);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
