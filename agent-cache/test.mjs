// agent-cache tests
import { AgentCache } from './index.mjs';

let passed = 0, failed = 0;
function assert(name, condition) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('agent-cache tests\n');

// ── Basic CRUD ─────────────────────────────────────────────────────
console.log('Basic CRUD');
{
  const c = new AgentCache({ defaultTTL: 10000 });

  await c.set('k1', 'v1');
  assert('set+get', (await c.get('k1')) === 'v1');

  await c.set('k2', { nested: true, arr: [1, 2] });
  const v2 = await c.get('k2');
  assert('get object', v2.nested === true && v2.arr.length === 2);

  await c.delete('k1');
  assert('delete removes', (await c.get('k1')) === null);

  assert('has returns true', c.has('k2'));
  assert('has returns false for missing', !c.has('nope'));

  await c.clear();
  assert('clear empties', c.stats().size === 0);
}

// ── TTL & Expiration ───────────────────────────────────────────────
console.log('TTL & Expiration');
{
  const c = new AgentCache({ defaultTTL: 50 });
  await c.set('exp1', 'val', { ttl: 50 });
  assert('before expiry', (await c.get('exp1')) === 'val');
  await new Promise(r => setTimeout(r, 80));
  assert('after expiry', (await c.get('exp1')) === null);
  assert('stat expiration', c.stats().expirations >= 1);

  await c.set('exp2', 'val', { ttl: 0 }); // no expiry
  await new Promise(r => setTimeout(r, 60));
  assert('ttl=0 never expires', (await c.get('exp2')) === 'val');
}

// ── LRU Eviction ───────────────────────────────────────────────────
console.log('LRU Eviction');
{
  const c = new AgentCache({ maxSize: 3 });
  await c.set('a', 1);
  await c.set('b', 2);
  await c.set('c', 3);
  await c.set('d', 4); // should evict 'a'
  assert('evicts oldest', (await c.get('a')) === null);
  assert('keeps new', (await c.get('d')) === 4);

  // Touch 'b', then add 'e' — 'c' should be evicted
  await c.get('b');
  await c.set('e', 5);
  assert('touch updates LRU', (await c.get('c')) === null);
  assert('touched survives', (await c.get('b')) === 2);
}

// ── Tags ───────────────────────────────────────────────────────────
console.log('Tags');
{
  const c = new AgentCache();
  await c.set('u1', 'user1', { tags: ['users', 'active'] });
  await c.set('u2', 'user2', { tags: ['users'] });
  await c.set('p1', 'post1', { tags: ['posts'] });

  const tagCounts = c.tags();
  assert('tag counts', tagCounts.users === 2 && tagCounts.active === 1 && tagCounts.posts === 1);

  const invalidated = await c.invalidateTag('users');
  assert('invalidate count', invalidated === 2);
  assert('invalidate removes', (await c.get('u1')) === null && (await c.get('u2')) === null);
  assert('other tags unaffected', (await c.get('p1')) === 'post1');
}

// ── Pattern Invalidation ───────────────────────────────────────────
console.log('Pattern Invalidation');
{
  const c = new AgentCache();
  await c.set('user:1', 'a');
  await c.set('user:2', 'b');
  await c.set('post:1', 'c');

  const count = await c.invalidatePattern('user:*');
  assert('pattern count', count === 2);
  assert('pattern removes users', (await c.get('user:1')) === null);
  assert('pattern spares posts', (await c.get('post:1')) === 'c');
}

// ── Keys ───────────────────────────────────────────────────────────
console.log('Keys');
{
  const c = new AgentCache();
  await c.set('a:x', 1);
  await c.set('a:y', 2);
  await c.set('b:z', 3);

  const all = c.keys();
  assert('all keys', all.length === 3);

  const filtered = c.keys('a:*');
  assert('filtered keys', filtered.length === 2 && filtered.includes('a:x') && filtered.includes('a:y'));
}

// ── Batch ──────────────────────────────────────────────────────────
console.log('Batch');
{
  const c = new AgentCache();
  await c.mset([
    { key: 'bm1', value: 'a' },
    { key: 'bm2', value: 'b', tags: ['batch'] },
    { key: 'bm3', value: 'c' },
  ]);
  const r = await c.mget(['bm1', 'bm2', 'bm3', 'missing']);
  assert('mget returns values', r.bm1 === 'a' && r.bm2 === 'b' && r.bm3 === 'c');
  assert('mget null for missing', r.missing === null);
}

// ── getOrSet / wrap ────────────────────────────────────────────────
console.log('getOrSet / wrap');
{
  const c = new AgentCache();
  let calls = 0;
  const fn = () => { calls++; return 'computed'; };

  const v1 = await c.getOrSet('gos', fn);
  const v2 = await c.getOrSet('gos', fn);
  assert('getOrSet computes once', v1 === 'computed' && v2 === 'computed' && calls === 1);

  const v3 = await c.wrap('wrap1', () => 'wrapped');
  assert('wrap works', v3 === 'wrapped');
}

// ── Touch ──────────────────────────────────────────────────────────
console.log('Touch');
{
  const c = new AgentCache({ defaultTTL: 50 });
  await c.set('t1', 'val', { ttl: 50 });
  await new Promise(r => setTimeout(r, 30));
  await c.touch('t1', 50); // reset TTL
  await new Promise(r => setTimeout(r, 30));
  assert('touch extends TTL', (await c.get('t1')) === 'val');
}

// ── Stats ──────────────────────────────────────────────────────────
console.log('Stats');
{
  const c = new AgentCache();
  await c.set('s1', 1);
  await c.get('s1');
  await c.get('miss1');
  await c.get('miss2');
  const s = c.stats();
  assert('stats hits', s.hits === 1);
  assert('stats misses', s.misses === 2);
  assert('stats size', s.size === 1);
  assert('stats hitRate', s.hitRate > 0 && s.hitRate < 1);
}

// ── Events ─────────────────────────────────────────────────────────
console.log('Events');
{
  const c = new AgentCache();
  const events = [];
  c.on('hit', () => events.push('hit'));
  c.on('miss', () => events.push('miss'));
  c.on('set', () => events.push('set'));
  c.on('evict', () => events.push('evict'));
  c.on('expire', () => events.push('expire'));

  await c.set('e1', 'v');
  await c.get('e1');
  await c.get('nope');
  await c.delete('e1');

  assert('events emitted', events.includes('set') && events.includes('hit') && events.includes('miss') && events.includes('evict'));
}

// ── Export ──────────────────────────────────────────────────────────
console.log('Export');
{
  const c = new AgentCache();
  await c.set('ex1', 'v1', { tags: ['t1'] });
  await c.set('ex2', 'v2');
  const exported = c.export();
  assert('export length', exported.length === 2);
  const ex1 = exported.find(e => e.key === 'ex1');
  assert('export includes tags', ex1.tags.includes('t1'));
  assert('export includes value', ex1.value === 'v1');
}

// ── Clear ──────────────────────────────────────────────────────────
console.log('Clear');
{
  const c = new AgentCache();
  await c.set('c1', 1);
  await c.set('c2', 2);
  const cleared = await c.clear();
  assert('clear returns count', cleared === 2);
  assert('clear empties store', c.stats().size === 0);
}

// ── Peek (get without side effects) ────────────────────────────────
console.log('Peek');
{
  const c = new AgentCache();
  await c.set('pk', 'val');
  const v1 = await c.peek('pk');
  const v2 = await c.peek('pk');
  const entry = c._store.get('pk');
  assert('peek returns value', v1 === 'val');
  assert('peek does not increment hits', entry.hits === 0);
}

// ── Result ─────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
