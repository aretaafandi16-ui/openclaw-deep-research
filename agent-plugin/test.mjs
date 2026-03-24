#!/usr/bin/env node
/**
 * agent-plugin test suite
 */

import { PluginManager, Plugin, PluginState, HookManager, SharedContext } from './index.mjs';
import { strict as assert } from 'assert';
import { mkdir, rm } from 'fs/promises';

const TEST_DIR = '/tmp/agent-plugin-test-' + Date.now();
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

console.log('🧪 agent-plugin test suite\n');

// ── SharedContext ────────────────────────────────────────────────
console.log('SharedContext:');

await test('set/get/has/delete', () => {
  const ctx = new SharedContext();
  ctx.set('foo', 'bar', 'test');
  assert.equal(ctx.get('foo'), 'bar');
  assert.ok(ctx.has('foo'));
  ctx.delete('foo', 'test');
  assert.ok(!ctx.has('foo'));
});

await test('keys and entries', () => {
  const ctx = new SharedContext();
  ctx.set('a', 1, 'p1');
  ctx.set('b', 2, 'p2');
  assert.deepEqual(ctx.keys().sort(), ['a', 'b']);
  assert.deepEqual(ctx.entries(), { a: 1, b: 2 });
});

await test('onChange events', () => {
  const ctx = new SharedContext();
  let called = false;
  ctx.onChange('key', () => { called = true; });
  ctx.set('key', 'val', 'p');
  assert.ok(called);
});

// ── HookManager ──────────────────────────────────────────────────
console.log('\nHookManager:');

await test('register and call hooks sequentially', async () => {
  const hooks = new HookManager();
  const log = [];
  hooks.register('test', (d) => { log.push('a'); return { ...d, a: true }; }, 'p1', 10);
  hooks.register('test', (d) => { log.push('b'); return { ...d, b: true }; }, 'p2', 20);
  const result = await hooks.call('test', { x: 1 });
  assert.deepEqual(log, ['a', 'b']);
  assert.ok(result.a && result.b);
});

await test('unregister plugin hooks', async () => {
  const hooks = new HookManager();
  hooks.register('test', () => 'a', 'p1');
  hooks.register('test', () => 'b', 'p2');
  hooks.unregister('test', 'p1');
  const list = hooks.list();
  assert.equal(list.test.length, 1);
  assert.equal(list.test[0].plugin, 'p2');
});

await test('unregisterAll', async () => {
  const hooks = new HookManager();
  hooks.register('h1', () => {}, 'p1');
  hooks.register('h2', () => {}, 'p1');
  hooks.register('h1', () => {}, 'p2');
  hooks.unregisterAll('p1');
  assert.ok(!hooks.list()['h1'] || !hooks.list()['h1'].some(h => h.plugin === 'p1'));
  assert.ok(!hooks.list()['h2'] || hooks.list()['h2'].length === 0);
});

await test('collect mode returns per-plugin results', async () => {
  const hooks = new HookManager();
  hooks.register('test', (d) => d * 2, 'p1');
  hooks.register('test', (d) => d + 1, 'p2');
  const results = await hooks.call('test', 5, { collect: true });
  assert.equal(results.length, 2);
  assert.equal(results[0].result, 10);
  assert.equal(results[1].result, 11);
});

// ── PluginManager ────────────────────────────────────────────────
console.log('\nPluginManager:');

await test('register plugin', () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  const p = mgr.register({ name: 'test', version: '1.0.0' }, () => ({}));
  assert.equal(p.name, 'test');
  assert.equal(p.state, PluginState.REGISTERED);
});

await test('register duplicate throws', () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'dup' }, () => ({}));
  assert.throws(() => mgr.register({ name: 'dup' }, () => ({})), /already registered/);
});

await test('missing dependency throws', () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  assert.throws(
    () => mgr.register({ name: 'child', dependencies: ['missing'] }, () => ({})),
    /depends on.*not registered/
  );
});

await test('load plugin', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'loader' }, () => ({ ping: () => 'pong' }));
  await mgr.load('loader');
  const p = mgr.get('loader');
  assert.equal(p.state, PluginState.LOADED);
  assert.ok(p.loadTime >= 0);
});

await test('enable plugin registers hooks', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({
    name: 'hooker',
    hooks: ['onEvent'],
    priority: 50
  }, () => ({
    onEvent(data) { return { ...data, hooked: true }; }
  }));
  await mgr.enable('hooker');
  const hooks = mgr.listHooks();
  assert.ok(hooks['onEvent']);
  assert.equal(hooks['onEvent'][0].plugin, 'hooker');
});

await test('disable plugin unregisters hooks', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'd1', hooks: ['x'] }, () => ({ x: () => {} }));
  await mgr.enable('d1');
  await mgr.disable('d1');
  const p = mgr.get('d1');
  assert.equal(p.state, PluginState.DISABLED);
  assert.ok(!mgr.listHooks()['x']);
});

await test('enable auto-loads dependency', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'base' }, () => ({ isBase: true }));
  mgr.register({ name: 'child', dependencies: ['base'] }, () => ({ isChild: true }));
  await mgr.enable('child');
  assert.equal(mgr.get('base').state, PluginState.ENABLED);
  assert.equal(mgr.get('child').state, PluginState.ENABLED);
});

await test('callPlugin method', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'calc' }, () => ({
    add: (a, b) => a + b,
    async double(n) { return n * 2; }
  }));
  await mgr.enable('calc');
  assert.equal(await mgr.callPlugin('calc', 'add', 3, 4), 7);
  assert.equal(await mgr.callPlugin('calc', 'double', 5), 10);
});

await test('callPlugin tracks stats', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 's' }, () => ({ ok: () => 'yes', fail: () => { throw new Error('boom'); } }));
  await mgr.enable('s');
  await mgr.callPlugin('s', 'ok');
  try { await mgr.callPlugin('s', 'fail'); } catch {}
  const p = mgr.get('s');
  assert.equal(p.stats.calls, 2);
  assert.equal(p.stats.errors, 1);
});

await test('callPlugin on disabled throws', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'off' }, () => ({}));
  await mgr.load('off');
  await assert.rejects(() => mgr.callPlugin('off', 'x'), /not enabled/);
});

await test('callHook with multiple plugins', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'a', hooks: ['process'], priority: 10 }, () => ({
    process(d) { return { ...d, a: true }; }
  }));
  mgr.register({ name: 'b', hooks: ['process'], priority: 20 }, () => ({
    process(d) { return { ...d, b: true }; }
  }));
  await mgr.enable('a');
  await mgr.enable('b');
  const result = await mgr.callHook('process', { x: 1 });
  assert.ok(result.a && result.b);
});

await test('hot reload', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  let counter = 0;
  mgr.register({ name: 'hot' }, () => ({ count: () => ++counter }));
  await mgr.enable('hot');
  assert.equal(await mgr.callPlugin('hot', 'count'), 1);
  await mgr.reload('hot');
  assert.equal(mgr.get('hot').state, PluginState.ENABLED);
  assert.equal(await mgr.callPlugin('hot', 'count'), 2);
});

await test('uninstall cleans up', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'temp', hooks: ['x'] }, () => ({ x: () => {} }));
  await mgr.enable('temp');
  await mgr.uninstall('temp');
  const p = mgr.get('temp');
  assert.equal(p.state, PluginState.UNINSTALLED);
  assert.equal(p.api, null);
});

await test('shared context cross-plugin', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'writer' }, (ctx) => ({
    write: (k, v) => { ctx.shared.set(k, v); }
  }));
  mgr.register({ name: 'reader' }, (ctx) => ({
    read: (k) => ctx.shared.get(k)
  }));
  await mgr.enable('writer');
  await mgr.enable('reader');
  await mgr.callPlugin('writer', 'write', 'greeting', 'hello');
  assert.equal(await mgr.callPlugin('reader', 'read', 'greeting'), 'hello');
});

await test('list filters', () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'a', tags: ['core'] }, () => ({}));
  mgr.register({ name: 'b', tags: ['util'], provides: ['x'] }, () => ({}));
  assert.equal(mgr.list({ tag: 'core' }).length, 1);
  assert.equal(mgr.list({ provides: 'x' }).length, 1);
});

await test('providers returns enabled providers', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'p1', provides: ['auth'] }, () => ({}));
  mgr.register({ name: 'p2', provides: ['auth'] }, () => ({}));
  await mgr.enable('p1');
  assert.equal(mgr.providers('auth').length, 1);
  await mgr.enable('p2');
  assert.equal(mgr.providers('auth').length, 2);
});

await test('depGraph and resolveLoadOrder', () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'a' }, () => ({}));
  mgr.register({ name: 'b', dependencies: ['a'] }, () => ({}));
  mgr.register({ name: 'c', dependencies: ['a', 'b'] }, () => ({}));
  const graph = mgr.depGraph();
  assert.deepEqual(graph.b.dependencies, ['a']);
  assert.ok(graph.a.dependents.includes('b'));
  const order = mgr.resolveLoadOrder();
  assert.ok(order.indexOf('a') < order.indexOf('b'));
  assert.ok(order.indexOf('b') < order.indexOf('c'));
});

await test('circular dependency throws', () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 'x' }, () => ({}));
  mgr.register({ name: 'y', dependencies: ['x'] }, () => ({}));
  // Manually create circular dep by manipulating
  mgr._plugins.get('x').dependencies.push('y');
  assert.throws(() => mgr.resolveLoadOrder(), /Circular dependency/);
});

await test('stats returns correct counts', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  mgr.register({ name: 's1', hooks: ['h1'] }, () => ({ h1: () => {} }));
  mgr.register({ name: 's2' }, () => ({}));
  await mgr.enable('s1');
  const stats = mgr.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.byState.enabled, 1);
  assert.equal(stats.byState.registered, 1);
  assert.equal(stats.hooks, 1);
});

await test('plugin lifecycle events', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  const events = [];
  mgr.on('registered', () => events.push('registered'));
  mgr.on('loaded', () => events.push('loaded'));
  mgr.on('enabled', () => events.push('enabled'));
  mgr.on('disabled', () => events.push('disabled'));
  mgr.on('uninstalled', () => events.push('uninstalled'));
  mgr.register({ name: 'ev' }, () => ({}));
  await mgr.enable('ev');
  await mgr.disable('ev');
  await mgr.uninstall('ev');
  assert.ok(events.includes('registered'));
  assert.ok(events.includes('enabled'));
  assert.ok(events.includes('disabled'));
  assert.ok(events.includes('uninstalled'));
});

await test('plugin enable/disable hooks called', async () => {
  const mgr = new PluginManager({ dataDir: TEST_DIR });
  let enabled = false, disabled = false;
  mgr.register({ name: 'lifecycle' }, () => ({
    async enable() { enabled = true; },
    async disable() { disabled = true; }
  }));
  await mgr.enable('lifecycle');
  assert.ok(enabled);
  await mgr.disable('lifecycle');
  assert.ok(disabled);
});

// ── Summary ──────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
