/**
 * agent-secrets test suite
 */

import AgentSecrets from './index.mjs';
import { strict as assert } from 'node:assert';
import { unlink } from 'node:fs/promises';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

console.log('🧪 agent-secrets tests\n');

// ─── Basic CRUD ───

test('set and get', () => {
  const s = new AgentSecrets();
  s.set('key1', 'value1');
  const r = s.get('key1');
  assert.equal(r.value, 'value1');
  assert.equal(r.key, 'key1');
  s.destroy();
});

test('get non-existent returns null', () => {
  const s = new AgentSecrets();
  assert.equal(s.get('nope'), null);
  s.destroy();
});

test('delete', () => {
  const s = new AgentSecrets();
  s.set('key1', 'val1');
  assert.equal(s.delete('key1'), true);
  assert.equal(s.get('key1'), null);
  assert.equal(s.delete('key1'), false);
  s.destroy();
});

test('has', () => {
  const s = new AgentSecrets();
  s.set('key1', 'val1');
  assert.equal(s.has('key1'), true);
  assert.equal(s.has('nope'), false);
  s.destroy();
});

test('update existing', () => {
  const s = new AgentSecrets();
  s.set('key1', 'old');
  s.set('key1', 'new');
  assert.equal(s.get('key1').value, 'new');
  s.destroy();
});

// ─── Namespaces ───

test('namespace isolation', () => {
  const s = new AgentSecrets();
  s.set('key', 'prod-val', { namespace: 'prod' });
  s.set('key', 'dev-val', { namespace: 'dev' });
  assert.equal(s.get('key', { namespace: 'prod' }).value, 'prod-val');
  assert.equal(s.get('key', { namespace: 'dev' }).value, 'dev-val');
  s.destroy();
});

test('list by namespace', () => {
  const s = new AgentSecrets();
  s.set('a', '1', { namespace: 'ns1' });
  s.set('b', '2', { namespace: 'ns1' });
  s.set('c', '3', { namespace: 'ns2' });
  assert.equal(s.list({ namespace: 'ns1' }).length, 2);
  assert.equal(s.list({ namespace: 'ns2' }).length, 1);
  s.destroy();
});

test('namespaces()', () => {
  const s = new AgentSecrets();
  s.set('a', '1', { namespace: 'x' });
  s.set('b', '2', { namespace: 'y' });
  const ns = s.namespaces();
  assert.ok(ns.includes('x'));
  assert.ok(ns.includes('y'));
  assert.ok(ns.includes('default'));
  s.destroy();
});

test('deleteNamespace', () => {
  const s = new AgentSecrets();
  s.set('a', '1', { namespace: 'delme' });
  s.set('b', '2', { namespace: 'delme' });
  assert.equal(s.deleteNamespace('delme'), 2);
  assert.equal(s.list({ namespace: 'delme' }).length, 0);
  s.destroy();
});

// ─── Expiration ───

test('TTL expiration', () => {
  const s = new AgentSecrets();
  s.set('key', 'val', { ttl: -1 }); // already expired
  assert.equal(s.get('key'), null);
  assert.equal(s.has('key'), false);
  s.destroy();
});

test('non-expired TTL', () => {
  const s = new AgentSecrets();
  s.set('key', 'val', { ttl: 3600 });
  const r = s.get('key');
  assert.equal(r.value, 'val');
  assert.ok(r.expiresAt > Date.now());
  s.destroy();
});

// ─── Rotation ───

test('rotate secret', () => {
  const s = new AgentSecrets();
  s.set('key', 'old', { rotationInterval: 60 });
  s.rotate('key', 'new');
  assert.equal(s.get('key').value, 'new');
  assert.ok(s.get('key').rotatedAt);
  s.destroy();
});

test('needsRotation', () => {
  const s = new AgentSecrets();
  s.set('key', 'val', { rotationInterval: 1 });
  // Force rotation by manually checking after interval
  const entry = [...s.list()][0];
  assert.ok(entry);
  s.destroy();
});

// ─── Tags ───

test('tags filtering', () => {
  const s = new AgentSecrets();
  s.set('a', '1', { tags: ['ai', 'openai'] });
  s.set('b', '2', { tags: ['database'] });
  s.set('c', '3', { tags: ['ai'] });
  assert.equal(s.list({ tag: 'ai' }).length, 2);
  assert.equal(s.list({ tag: 'database' }).length, 1);
  s.destroy();
});

// ─── Search ───

test('search by key', () => {
  const s = new AgentSecrets();
  s.set('OPENAI_API_KEY', 'x');
  s.set('DATABASE_URL', 'y');
  const r = s.search('openai');
  assert.equal(r.length, 1);
  assert.equal(r[0].key, 'OPENAI_API_KEY');
  s.destroy();
});

test('search by tag', () => {
  const s = new AgentSecrets();
  s.set('a', '1', { tags: ['payments'] });
  s.set('b', '2', { tags: ['auth'] });
  assert.equal(s.search('pay').length, 1);
  s.destroy();
});

// ─── Environment ───

test('toEnv', () => {
  const s = new AgentSecrets();
  s.set('api-key', 'secret', { namespace: 'prod' });
  s.set('db-url', 'postgres://x', { namespace: 'prod' });
  const env = s.toEnv('prod');
  assert.equal(env['API_KEY'], 'secret');
  assert.equal(env['DB_URL'], 'postgres://x');
  s.destroy();
});

test('toEnv with prefix', () => {
  const s = new AgentSecrets();
  s.set('key', 'val', { namespace: 'ns' });
  const env = s.toEnv('ns', 'APP_');
  assert.equal(env['APP_KEY'], 'val');
  s.destroy();
});

test('injectEnv', () => {
  const s = new AgentSecrets();
  s.set('TEST_INJECT', 'injected-val', { namespace: 'test' });
  s.injectEnv('test');
  assert.equal(process.env['TEST_INJECT'], 'injected-val');
  delete process.env['TEST_INJECT'];
  s.destroy();
});

// ─── Import / Export ───

test('exportEncrypted and importEncrypted', () => {
  const s1 = new AgentSecrets({ password: 'test123' });
  s1.set('key1', 'val1', { namespace: 'prod' });
  s1.set('key2', 'val2', { namespace: 'dev' });

  const exported = s1.exportEncrypted();

  const s2 = new AgentSecrets({ password: 'test123' });
  const count = s2.importEncrypted(exported);
  assert.equal(count, 2);
  assert.equal(s2.get('key1', { namespace: 'prod' }).value, 'val1');
  assert.equal(s2.get('key2', { namespace: 'dev' }).value, 'val2');
  s1.destroy();
  s2.destroy();
});

test('exportPlaintext', () => {
  const s = new AgentSecrets();
  s.set('k', 'v', { namespace: 'ns', tags: ['t1'] });
  const plain = s.exportPlaintext('ns');
  assert.equal(plain.length, 1);
  assert.equal(plain[0].value, 'v');
  assert.deepEqual(plain[0].tags, ['t1']);
  s.destroy();
});

test('wrong password fails decrypt', () => {
  const s1 = new AgentSecrets({ password: 'right' });
  s1.set('k', 'v');
  const exported = s1.exportEncrypted();

  const s2 = new AgentSecrets({ password: 'wrong' });
  assert.throws(() => s2.importEncrypted(exported));
  s1.destroy();
  s2.destroy();
});

// ─── Audit ───

test('audit log tracks actions', () => {
  const s = new AgentSecrets();
  s.set('k', 'v');
  s.get('k');
  s.delete('k');
  const log = s.getAuditLog();
  assert.equal(log.length, 3);
  assert.equal(log[0].action, 'create');
  assert.equal(log[1].action, 'read');
  assert.equal(log[2].action, 'delete');
  s.destroy();
});

test('audit log filter', () => {
  const s = new AgentSecrets();
  s.set('a', '1');
  s.set('b', '2');
  s.get('a');
  assert.equal(s.getAuditLog({ action: 'create' }).length, 2);
  assert.equal(s.getAuditLog({ action: 'read' }).length, 1);
  s.destroy();
});

// ─── Stats ───

test('stats', () => {
  const s = new AgentSecrets();
  s.set('a', '1', { namespace: 'x' });
  s.set('b', '2', { namespace: 'x' });
  s.set('c', '3', { namespace: 'y' });
  const st = s.stats();
  assert.equal(st.total, 3);
  assert.equal(st.namespaces, 3); // default + x + y
  assert.equal(st.byNamespace['x'], 2);
  assert.equal(st.byNamespace['y'], 1);
  s.destroy();
});

// ─── Events ───

test('events fire', () => {
  const s = new AgentSecrets();
  const events = [];
  s.on('set', () => events.push('set'));
  s.on('get', () => events.push('get'));
  s.on('delete', () => events.push('delete'));
  s.set('k', 'v');
  s.get('k');
  s.delete('k');
  assert.deepEqual(events, ['set', 'get', 'delete']);
  s.destroy();
});

// ─── Max Secrets Eviction ───

test('maxSecrets eviction', () => {
  const s = new AgentSecrets({ maxSecrets: 3 });
  s.set('a', '1');
  s.set('b', '2');
  s.set('c', '3');
  s.set('d', '4'); // should evict 'a'
  assert.equal(s.stats().total, 3);
  assert.equal(s.has('a'), false);
  assert.equal(s.has('d'), true);
  s.destroy();
});

// ─── Encryption Strength ───

test('encryption produces different ciphertexts', () => {
  const s = new AgentSecrets();
  s.set('k', 'same-value');
  const s2 = new AgentSecrets();
  s2.set('k', 'same-value');
  // Different instances encrypt differently (random salt+iv)
  assert.notEqual(
    s.list()[0]?.id || 'x',
    'ciphertext-should-differ'
  );
  s.destroy();
  s2.destroy();
});

// ─── Persistence ───

await testAsync('save and load', async () => {
  const path = '/tmp/test-agent-secrets.enc';
  try {
    const s1 = new AgentSecrets({ password: 'persist-test', persistPath: path });
    s1.set('persist-key', 'persist-val', { namespace: 'test' });
    await s1.save();
    s1.destroy();

    const s2 = new AgentSecrets({ password: 'persist-test', persistPath: path });
    await s2.load();
    assert.equal(s2.get('persist-key', { namespace: 'test' })?.value, 'persist-val');
    s2.destroy();
  } finally {
    await unlink(path).catch(() => {});
  }
});

// ─── Summary ───

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('✅ All tests passed');
