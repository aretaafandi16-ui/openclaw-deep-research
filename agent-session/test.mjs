/**
 * agent-session test suite
 */

import { SessionManager } from './index.mjs';
import { strict as assert } from 'assert';
import { mkdirSync, rmSync } from 'fs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

const DATA_DIR = '/tmp/agent-session-test-' + Date.now();

console.log('agent-session test suite\n');

// ─── Creation ────────────────────────────────────────────────

test('create session with auto ID', () => {
  const sm = new SessionManager();
  const s = sm.create();
  assert.ok(s.id);
  assert.equal(s.namespace, 'default');
  assert.equal(s.status, 'active');
  sm.destroy_manager();
});

test('create session with custom ID', () => {
  const sm = new SessionManager();
  const s = sm.create({ id: 'my-session' });
  assert.equal(s.id, 'my-session');
  sm.destroy_manager();
});

test('create duplicate throws', () => {
  const sm = new SessionManager();
  sm.create({ id: 'dup' });
  assert.throws(() => sm.create({ id: 'dup' }), /already exists/);
  sm.destroy_manager();
});

test('create with owner, namespace, tags', () => {
  const sm = new SessionManager();
  const s = sm.create({ owner: 'alice', namespace: 'support', tags: ['urgent', 'billing'] });
  assert.equal(s.owner, 'alice');
  assert.equal(s.namespace, 'support');
  assert.deepEqual(s.tags, ['urgent', 'billing']);
  sm.destroy_manager();
});

test('max sessions eviction', () => {
  const sm = new SessionManager({ maxSessions: 3 });
  const s1 = sm.create({ id: 's1' });
  const s2 = sm.create({ id: 's2' });
  const s3 = sm.create({ id: 's3' });
  sm.create({ id: 's4' }); // should evict s1 (LRU)
  assert.equal(sm.count(), 3);
  assert.equal(sm.get('s1'), null);
  sm.destroy_manager();
});

// ─── Get / Touch / Destroy ───────────────────────────────────

test('get returns session', () => {
  const sm = new SessionManager();
  const s = sm.create({ id: 'g1' });
  assert.equal(sm.get('g1').id, 'g1');
  sm.destroy_manager();
});

test('get non-existent returns null', () => {
  const sm = new SessionManager();
  assert.equal(sm.get('nope'), null);
  sm.destroy_manager();
});

test('touch refreshes lastAccessedAt', () => {
  const sm = new SessionManager();
  const s = sm.create({ id: 't1' });
  const before = s.lastAccessedAt;
  const after = sm.touch('t1').lastAccessedAt;
  assert.ok(after >= before);
  sm.destroy_manager();
});

test('touch non-existent throws', () => {
  const sm = new SessionManager();
  assert.throws(() => sm.touch('nope'), /not found/);
  sm.destroy_manager();
});

test('destroy returns true/false', () => {
  const sm = new SessionManager();
  sm.create({ id: 'd1' });
  assert.equal(sm.destroy('d1'), true);
  assert.equal(sm.destroy('d1'), false);
  sm.destroy_manager();
});

test('emit create event', () => {
  const sm = new SessionManager();
  let fired = false;
  sm.on('create', () => fired = true);
  sm.create();
  assert.ok(fired);
  sm.destroy_manager();
});

test('emit destroy event', () => {
  const sm = new SessionManager();
  sm.create({ id: 'ev1' });
  let fired = false;
  sm.on('destroy', () => fired = true);
  sm.destroy('ev1');
  assert.ok(fired);
  sm.destroy_manager();
});

// ─── Messages ────────────────────────────────────────────────

test('add and get messages', () => {
  const sm = new SessionManager();
  const s = sm.create();
  sm.addMessage(s.id, 'user', 'hi');
  sm.addMessage(s.id, 'assistant', 'hello');
  const msgs = sm.getMessages(s.id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[1].role, 'assistant');
  sm.destroy_manager();
});

test('get messages filtered by role', () => {
  const sm = new SessionManager();
  const s = sm.create();
  sm.addMessage(s.id, 'user', 'a');
  sm.addMessage(s.id, 'assistant', 'b');
  sm.addMessage(s.id, 'user', 'c');
  assert.equal(sm.getMessages(s.id, { role: 'user' }).length, 2);
  sm.destroy_manager();
});

test('get messages with limit', () => {
  const sm = new SessionManager();
  const s = sm.create();
  for (let i = 0; i < 10; i++) sm.addMessage(s.id, 'user', `msg${i}`);
  assert.equal(sm.getMessages(s.id, { limit: 3 }).length, 3);
  sm.destroy_manager();
});

test('getLastMessage', () => {
  const sm = new SessionManager();
  const s = sm.create();
  sm.addMessage(s.id, 'user', 'first');
  sm.addMessage(s.id, 'assistant', 'last');
  assert.equal(sm.getLastMessage(s.id).content, 'last');
  sm.destroy_manager();
});

test('clearMessages', () => {
  const sm = new SessionManager();
  const s = sm.create();
  sm.addMessage(s.id, 'user', 'x');
  assert.equal(sm.clearMessages(s.id), 1);
  assert.equal(sm.getMessages(s.id).length, 0);
  sm.destroy_manager();
});

test('max messages eviction', () => {
  const sm = new SessionManager({ maxMessages: 5 });
  const s = sm.create();
  for (let i = 0; i < 10; i++) sm.addMessage(s.id, 'user', `msg${i}`);
  const msgs = sm.getMessages(s.id);
  assert.equal(msgs.length, 5);
  assert.equal(msgs[0].content, 'msg5'); // oldest evicted
  sm.destroy_manager();
});

test('message has id and timestamp', () => {
  const sm = new SessionManager();
  const s = sm.create();
  const msg = sm.addMessage(s.id, 'user', 'test');
  assert.ok(msg.id);
  assert.ok(msg.timestamp > 0);
  sm.destroy_manager();
});

// ─── State ───────────────────────────────────────────────────

test('set and get state', () => {
  const sm = new SessionManager();
  const s = sm.create();
  sm.setState(s.id, 'step', 1);
  assert.equal(sm.getState(s.id, 'step'), 1);
  sm.destroy_manager();
});

test('get all state', () => {
  const sm = new SessionManager();
  const s = sm.create();
  sm.setState(s.id, 'a', 1);
  sm.setState(s.id, 'b', 2);
  const state = sm.getState(s.id);
  assert.deepEqual(state, { a: 1, b: 2 });
  sm.destroy_manager();
});

test('delete state key', () => {
  const sm = new SessionManager();
  const s = sm.create();
  sm.setState(s.id, 'x', 42);
  sm.deleteState(s.id, 'x');
  assert.equal(sm.getState(s.id, 'x'), undefined);
  sm.destroy_manager();
});

// ─── Query ───────────────────────────────────────────────────

test('findByOwner', () => {
  const sm = new SessionManager();
  sm.create({ owner: 'alice' });
  sm.create({ owner: 'bob' });
  sm.create({ owner: 'alice' });
  assert.equal(sm.findByOwner('alice').length, 2);
  sm.destroy_manager();
});

test('findByNamespace', () => {
  const sm = new SessionManager();
  sm.create({ namespace: 'chat' });
  sm.create({ namespace: 'support' });
  sm.create({ namespace: 'chat' });
  assert.equal(sm.findByNamespace('chat').length, 2);
  sm.destroy_manager();
});

test('findByTag', () => {
  const sm = new SessionManager();
  sm.create({ tags: ['urgent'] });
  sm.create({ tags: ['normal'] });
  sm.create({ tags: ['urgent', 'billing'] });
  assert.equal(sm.findByTag('urgent').length, 2);
  sm.destroy_manager();
});

test('search with predicate', () => {
  const sm = new SessionManager();
  sm.create({ id: 'a', metadata: { score: 10 } });
  sm.create({ id: 'b', metadata: { score: 50 } });
  sm.create({ id: 'c', metadata: { score: 90 } });
  const results = sm.search(s => s.metadata.score > 20);
  assert.equal(results.length, 2);
  sm.destroy_manager();
});

test('list with offset and limit', () => {
  const sm = new SessionManager();
  for (let i = 0; i < 10; i++) sm.create({ id: `s${i}` });
  const page = sm.list({ offset: 2, limit: 3 });
  assert.equal(page.length, 3);
  sm.destroy_manager();
});

// ─── Update ──────────────────────────────────────────────────

test('update owner', () => {
  const sm = new SessionManager();
  const s = sm.create({ owner: 'alice' });
  sm.update(s.id, { owner: 'bob' });
  assert.equal(sm.findByOwner('alice').length, 0);
  assert.equal(sm.findByOwner('bob').length, 1);
  sm.destroy_manager();
});

test('update tags', () => {
  const sm = new SessionManager();
  const s = sm.create({ tags: ['a'] });
  sm.update(s.id, { tags: ['b', 'c'] });
  assert.equal(sm.findByTag('a').length, 0);
  assert.equal(sm.findByTag('b').length, 1);
  sm.destroy_manager();
});

// ─── TTL / Expiration ────────────────────────────────────────

test('expire returns null on get', () => {
  const sm = new SessionManager();
  const s = sm.create({ id: 'exp1', ttl: 1 });
  // Wait for expiry
  const start = Date.now();
  while (Date.now() - start < 10) {} // busy wait
  assert.equal(sm.get('exp1'), null);
  sm.destroy_manager();
});

test('destroyExpired cleans up', () => {
  const sm = new SessionManager();
  sm.create({ id: 'e1', ttl: 1 });
  sm.create({ id: 'e2', ttl: 1 });
  sm.create({ id: 'e3', ttl: 999999 });
  const start = Date.now();
  while (Date.now() - start < 10) {}
  const cleaned = sm.destroyExpired();
  assert.ok(cleaned >= 2);
  sm.destroy_manager();
});

test('extend updates TTL', () => {
  const sm = new SessionManager();
  const s = sm.create({ id: 'ext1', ttl: 100 });
  sm.extend('ext1', 999999);
  const s2 = sm.get('ext1');
  assert.ok(s2.expiresAt > Date.now() + 10000);
  sm.destroy_manager();
});

// ─── Bulk ────────────────────────────────────────────────────

test('destroyByOwner', () => {
  const sm = new SessionManager();
  sm.create({ owner: 'x' });
  sm.create({ owner: 'x' });
  sm.create({ owner: 'y' });
  assert.equal(sm.destroyByOwner('x'), 2);
  assert.equal(sm.count(), 1);
  sm.destroy_manager();
});

test('destroyByNamespace', () => {
  const sm = new SessionManager();
  sm.create({ namespace: 'ns1' });
  sm.create({ namespace: 'ns1' });
  sm.create({ namespace: 'ns2' });
  assert.equal(sm.destroyByNamespace('ns1'), 2);
  sm.destroy_manager();
});

test('destroyAll', () => {
  const sm = new SessionManager();
  sm.create(); sm.create(); sm.create();
  assert.equal(sm.destroyAll(), 3);
  assert.equal(sm.count(), 0);
  sm.destroy_manager();
});

// ─── Stats ───────────────────────────────────────────────────

test('stats returns correct counts', () => {
  const sm = new SessionManager();
  sm.create({ owner: 'a', namespace: 'x' });
  sm.create({ owner: 'b', namespace: 'x' });
  sm.addMessage(sm.list()[0].id, 'user', 'hi');
  const st = sm.stats();
  assert.equal(st.active, 2);
  assert.equal(st.created, 2);
  assert.equal(st.totalMessages, 1);
  assert.equal(st.owners, 2);
  assert.equal(st.namespaces, 1);
  sm.destroy_manager();
});

// ─── Persistence ─────────────────────────────────────────────

test('persist and reload from disk', () => {
  const sm1 = new SessionManager({ persistDir: DATA_DIR });
  sm1.create({ id: 'persist-test', owner: 'alice' });
  sm1.addMessage('persist-test', 'user', 'hello');
  sm1.setState('persist-test', 'x', 42);
  sm1._snapshot();
  sm1.destroy_manager();

  const sm2 = new SessionManager({ persistDir: DATA_DIR });
  const s = sm2.get('persist-test');
  assert.ok(s);
  assert.equal(s.owner, 'alice');
  assert.equal(s.messageCount, 1);
  sm2.destroy_manager();
});

// ─── Cleanup ─────────────────────────────────────────────────

try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
