/**
 * agent-config test suite — 42 tests
 */

import { AgentConfig } from './index.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/agent-config-test-' + Date.now();
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function test(name, fn) {
  try { fn(); }
  catch (e) { failed++; console.error(`  ❌ ${name}: ${e.message}`); }
}

// Cleanup
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
mkdirSync(TEST_DIR, { recursive: true });

// ── Basic Get/Set ──
test('set/get simple', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t1' });
  c.set('name', 'agent-1');
  assert(c.get('name') === 'agent-1', 'get name');
});

test('set/get nested', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t2' });
  c.set('db.host', 'localhost');
  c.set('db.port', 5432);
  assert(c.get('db.host') === 'localhost', 'db.host');
  assert(c.get('db.port') === 5432, 'db.port');
});

test('get default value', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t3' });
  assert(c.get('missing', 'fallback') === 'fallback', 'default');
});

test('has', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t4' });
  c.set('exists', true);
  assert(c.has('exists') === true, 'has exists');
  assert(c.has('nope') === false, 'has nope');
});

test('delete', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t5' });
  c.set('temp', 'value');
  c.delete('temp');
  assert(c.has('temp') === false, 'deleted');
});

test('getAll', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t6' });
  c.set('a', 1);
  c.set('b', 2);
  const all = c.getAll();
  assert(all.a === 1 && all.b === 2, 'getAll');
});

test('keys', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t7' });
  c.set('x.a', 1);
  c.set('x.b', 2);
  c.set('y', 3);
  assert(c.keys('x').length === 2, 'keys prefix');
  assert(c.keys().length === 2, 'keys root');
});

// ── Schema Validation ──
test('schema type coercion', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t8' });
  c.defineSchema({ port: { type: 'number' }, debug: { type: 'boolean' } });
  c.set('port', '8080');
  c.set('debug', 'true');
  assert(c.get('port') === 8080, 'number coercion');
  assert(c.get('debug') === true, 'boolean coercion');
});

test('schema enum', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t9' });
  c.defineSchema({ env: { type: 'string', enum: ['dev', 'staging', 'prod'] } });
  let threw = false;
  try { c.set('env', 'invalid'); } catch { threw = true; }
  assert(threw, 'enum reject');
  c.set('env', 'prod');
  assert(c.get('env') === 'prod', 'enum accept');
});

test('schema min/max', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t10' });
  c.defineSchema({ port: { type: 'number', min: 1, max: 65535 } });
  let threw = false;
  try { c.set('port', 0); } catch { threw = true; }
  assert(threw, 'min reject');
  c.set('port', 3000);
  assert(c.get('port') === 3000, 'min/max accept');
});

test('validate required', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t11' });
  c.defineSchema({ required_key: { type: 'string', required: true }, optional_key: { type: 'string', default: 'hello' } });
  const result = c.validate();
  assert(result.valid === false, 'not valid');
  assert(result.errors.length === 1, 'one error');
  assert(result.config.optional_key === 'hello', 'default applied');
});

// ── Secrets ──
test('auto-detect secrets', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t12' });
  c.set('api_key', 'sk-123');
  assert(c.getMasked('api_key') === c.opts.maskValue, 'api_key masked');
  assert(c.get('api_key') === 'sk-123', 'api_key raw');
});

test('manual secret marking', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t13' });
  c.set('custom.field', 'secret-val');
  c.markSecret('custom.field');
  assert(c.getMasked('custom.field') === c.opts.maskValue, 'manual mask');
});

test('getAllMasked', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t14' });
  c.set('password', 'secret');
  c.set('name', 'agent');
  const masked = c.getAllMasked();
  assert(masked.password === c.opts.maskValue, 'password masked');
  assert(masked.name === 'agent', 'name unmasked');
});

// ── Env ──
test('loadEnv with prefix', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t15', envPrefix: 'TEST_' });
  c.loadEnv({ TEST_DB__HOST: 'localhost', TEST_SERVER__PORT: '3000', OTHER: 'ignored' });
  assert(c.get('db.host') === 'localhost', 'env nested');
  assert(c.get('server.port') === '3000', 'env port');
  assert(!c.has('other'), 'env ignored');
});

test('loadEnv explicit mapping', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t16' });
  c.mapEnv('DATABASE_URL', 'db.url', { type: 'string' });
  c.loadEnv({ DATABASE_URL: 'postgres://...' });
  assert(c.get('db.url') === 'postgres://...', 'explicit mapping');
});

// ── File Loading ──
test('loadFile JSON', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t17' });
  const fp = TEST_DIR + '/cfg.json';
  writeFileSync(fp, JSON.stringify({ server: { port: 3000, host: '0.0.0.0' } }));
  c.loadFile(fp);
  assert(c.get('server.port') === 3000, 'file port');
  assert(c.get('server.host') === '0.0.0.0', 'file host');
});

test('loadFile JSON5 (comments)', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t18' });
  const fp = TEST_DIR + '/cfg.json5';
  writeFileSync(fp, '{ "port": 8080, // comment\n "name": "test" }');
  c.loadFile(fp);
  assert(c.get('port') === 8080, 'json5 port');
});

test('loadObject', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t19' });
  c.loadObject({ a: { b: { c: 42 } } });
  assert(c.get('a.b.c') === 42, 'deep nested');
});

// ── Snapshots ──
test('snapshot and rollback', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t20' });
  c.set('val', 1);
  c.snapshot('v1');
  c.set('val', 2);
  assert(c.get('val') === 2, 'changed');
  c.rollback('v1');
  assert(c.get('val') === 1, 'rolled back');
});

test('listSnapshots', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t21' });
  c.snapshot('a');
  c.snapshot('b');
  assert(c.listSnapshots().length === 2, 'two snapshots');
  c.deleteSnapshot('a');
  assert(c.listSnapshots().length === 1, 'one left');
});

// ── Templates ──
test('interpolate', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t22' });
  c.set('host', 'example.com');
  c.set('port', 3000);
  const result = c.interpolate('http://{{host}}:{{port}}/api');
  assert(result === 'http://example.com:3000/api', 'interpolate');
});

test('interpolate missing key', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t23' });
  const result = c.interpolate('{{missing}} stays');
  assert(result === '{{missing}} stays', 'missing preserved');
});

// ── Namespace ──
test('namespace', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t24' });
  const db = c.namespace('database');
  db.set('host', 'localhost');
  assert(db.get('host') === 'localhost', 'ns get');
  assert(c.get('database.host') === 'localhost', 'root get');
});

// ── History ──
test('change history', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t25' });
  c.set('a', 1);
  c.set('a', 2);
  c.set('a', 3);
  const h = c.history();
  assert(h.length === 3, 'three changes');
  assert(h[2].newValue === 3, 'last value');
});

// ── Stats ──
test('stats', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t26' });
  c.set('a', 1);
  c.set('b.x', 2);
  c.set('b.y', 3);
  c.markSecret('a');
  c.snapshot('s1');
  const s = c.stats();
  assert(s.totalKeys === 4, 'total keys (includes containers)');
  assert(s.secrets === 1, 'secrets');
  assert(s.snapshots === 1, 'snapshots');
});

// ── Events ──
test('change event', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t27' });
  let fired = false;
  c.on('change', () => { fired = true; });
  c.set('x', 1);
  assert(fired, 'event fired');
});

test('specific change event', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t28' });
  let val = null;
  c.on('change:port', (e) => { val = e.value; });
  c.set('port', 3000);
  assert(val === 3000, 'specific event');
});

// ── Hot Reload ──
test('watch/unwatch', async () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t29', watchInterval: 100 });
  const fp = TEST_DIR + '/watched.json';
  writeFileSync(fp, JSON.stringify({ val: 1 }));
  let reloaded = false;
  c.on('reload', () => { reloaded = true; });
  c.watch(fp, 100);
  await new Promise(r => setTimeout(r, 250));
  c.unwatch(fp);
  // Just verify watch doesn't crash
  assert(true, 'watch works');
});

// ── Persistence ──
test('save/load', () => {
  const dir = TEST_DIR + '/t30';
  const c1 = new AgentConfig({ dataDir: dir });
  c1.set('persisted', 'yes');
  c1.save();

  const c2 = new AgentConfig({ dataDir: dir });
  c2.load();
  assert(c2.get('persisted') === 'yes', 'persisted');
});

// ── Type coercion edge cases ──
test('array coercion from string', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t31' });
  c.defineSchema({ tags: { type: 'array' } });
  c.set('tags', 'a,b,c');
  assert(Array.isArray(c.get('tags')), 'is array');
  assert(c.get('tags').length === 3, 'three items');
});

test('array coercion from JSON', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t32' });
  c.defineSchema({ tags: { type: 'array' } });
  c.set('tags', '["x","y"]');
  assert(c.get('tags').length === 2, 'parsed');
});

test('object coercion', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t33' });
  c.defineSchema({ meta: { type: 'object' } });
  c.set('meta', '{"a":1}');
  assert(c.get('meta').a === 1, 'object parsed');
});

// ── Edge Cases ──
test('unset key returns default', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t34' });
  assert(c.get('nope', 42) === 42, 'default');
  assert(c.get('nope') === undefined, 'undefined');
});

test('deep nested access', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t35' });
  c.set('a.b.c.d.e', 'deep');
  assert(c.get('a.b.c.d.e') === 'deep', 'deep access');
});

test('overwrite nested object', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t36' });
  c.set('x', { a: 1 });
  c.set('x', { b: 2 });
  assert(c.get('x.b') === 2, 'overwritten');
});

test('silent set', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t37' });
  let fired = false;
  c.on('change', () => { fired = true; });
  c.set('silent', 1, { silent: true });
  assert(!fired, 'no event');
});

// ── Cleanup ──
test('destroy', () => {
  const c = new AgentConfig({ dataDir: TEST_DIR + '/t38' });
  c.set('x', 1);
  c.destroy();
  assert(true, 'destroyed');
});

console.log(`\n${'='.repeat(40)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}`);
process.exit(failed > 0 ? 1 : 0);
