// agent-diag test suite — 40 tests
import { AgentDiag, HealthCheck, AlertEngine, Status, Severity, presets } from './index.mjs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

let passed = 0, failed = 0;

async function run(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('agent-diag test suite\n');

// ── HealthCheck ──
await test('HealthCheck constructor', async () => {
  await run('validates name', () => assert.throws(() => new HealthCheck({}), /name/));
  await run('validates check fn', () => assert.throws(() => new HealthCheck({ name: 'x' }), /check/));
  await run('creates with defaults', () => {
    const c = new HealthCheck({ name: 'test', check: async () => ({ ok: true }) });
    assert.equal(c.name, 'test');
    assert.equal(c.category, 'custom');
    assert.equal(c.intervalMs, 30000);
    assert.equal(c.threshold, 3);
    assert.equal(c.status, Status.UNKNOWN);
  });
  await run('custom options', () => {
    const c = new HealthCheck({ name: 'x', category: 'http', check: () => {}, intervalMs: 10000, threshold: 5, tags: ['test'] });
    assert.equal(c.category, 'http');
    assert.equal(c.intervalMs, 10000);
    assert.equal(c.threshold, 5);
    assert.deepEqual(c.tags, ['test']);
  });
});

// ── AgentDiag register/unregister ──
await test('register & unregister', async () => {
  const diag = new AgentDiag();
  await run('register check', () => {
    diag.register({ name: 'mem', check: async () => ({ ok: true }) });
    assert.ok(diag.getCheck('mem'));
  });
  await run('reject duplicate', () => {
    assert.throws(() => diag.register({ name: 'mem', check: () => {} }), /already registered/);
  });
  await run('unregister', () => {
    assert.equal(diag.unregister('mem'), true);
    assert.equal(diag.getCheck('mem'), null);
  });
  await run('unregister nonexistent', () => assert.equal(diag.unregister('nope'), false));
  await run('list checks', () => {
    diag.register({ name: 'a', check: async () => ({ ok: true }) });
    diag.register({ name: 'b', check: async () => ({ ok: true }), category: 'http' });
    const list = diag.listChecks();
    assert.equal(list.length, 2);
  });
});

// ── Run checks ──
await test('run checks', async () => {
  const diag = new AgentDiag();
  diag.register({ name: 'ok', check: async () => ({ ok: true, message: 'all good' }) });
  diag.register({ name: 'fail', check: async () => ({ ok: false, message: 'broken' }) });
  diag.register({ name: 'error', check: async () => { throw new Error('boom'); } });

  await run('healthy check', async () => {
    const r = await diag.runCheck('ok');
    assert.equal(r.status, Status.HEALTHY);
    assert.equal(r.message, 'all good');
  });
  await run('unhealthy check', async () => {
    const r = await diag.runCheck('fail');
    assert.equal(r.status, Status.UNHEALTHY);
  });
  await run('error check', async () => {
    const r = await diag.runCheck('error');
    assert.equal(r.status, Status.UNHEALTHY);
    assert.equal(r.message, 'boom');
  });
  await run('unknown check', () => assert.rejects(() => diag.runCheck('nope'), /not found/));
  await run('runAll', async () => {
    const results = await diag.runAll();
    assert.equal(results.length, 3);
  });
  await run('runCategory', async () => {
    const diag2 = new AgentDiag();
    diag2.register({ name: 'a', category: 'http', check: async () => ({ ok: true }) });
    diag2.register({ name: 'b', category: 'system', check: async () => ({ ok: true }) });
    const results = await diag2.runCategory('http');
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'a');
  });
});

// ── Consecutive failures & severity ──
await test('consecutive failures', async () => {
  const d = new AgentDiag();
  d.register({ name: 'flaky', check: async () => ({ ok: false }), threshold: 2 });
  const r1 = await d.runCheck('flaky');
  assert.equal(r1.severity, Severity.WARNING);
  assert.equal(d.getCheck('flaky').consecutiveFailures, 1);
  const r2 = await d.runCheck('flaky');
  assert.equal(r2.severity, Severity.CRITICAL);
  assert.equal(d.getCheck('flaky').consecutiveFailures, 2);
});

// ── Timeout ──
await test('timeout', async () => {
  const diag = new AgentDiag();
  diag.register({ name: 'slow', check: () => new Promise(r => setTimeout(() => r({ ok: true }), 10000)), timeoutMs: 50 });
  const r = await diag.runCheck('slow');
  assert.equal(r.status, Status.UNHEALTHY);
  assert.ok(r.message.includes('Timeout'));
});

// ── Status ──
await test('overall status', async () => {
  const diag = new AgentDiag();
  diag.register({ name: 'a', check: async () => ({ ok: true }) });
  diag.register({ name: 'b', check: async () => ({ ok: false }) });
  await diag.runAll();
  const s = diag.getStatus();
  assert.equal(s.overall, Status.UNHEALTHY);
  assert.equal(s.totalChecks, 2);
  assert.ok(s.categories.custom);
});

// ── History ──
await test('history', async () => {
  const diag = new AgentDiag();
  diag.register({ name: 'h1', check: async () => ({ ok: true }) });
  diag.register({ name: 'h2', check: async () => ({ ok: false }) });
  await diag.runAll();
  const hist = diag.getHistory();
  assert.equal(hist.length, 2);
  assert.equal(diag.getHistory({ name: 'h1' }).length, 1);
  assert.equal(diag.getHistory({ status: Status.UNHEALTHY }).length, 1);
});

// ── Events ──
await test('events', async () => {
  const diag = new AgentDiag();
  let resultEvent = null, unhealthyEvent = null;
  diag.on('check:result', e => { resultEvent = e; });
  diag.on('check:unhealthy', e => { unhealthyEvent = e; });
  diag.register({ name: 'ev', check: async () => ({ ok: false }) });
  await diag.runCheck('ev');
  assert.ok(resultEvent);
  assert.equal(resultEvent.name, 'ev');
  assert.ok(unhealthyEvent);
});

// ── Start/Stop ──
await test('start/stop', async () => {
  const diag = new AgentDiag();
  let called = 0;
  diag.register({ name: 'periodic', check: async () => { called++; return { ok: true }; }, intervalMs: 50 });
  diag.start();
  assert.ok(diag.getStatus().running);
  await new Promise(r => setTimeout(r, 200));
  diag.stop();
  assert.ok(called >= 2);
});

// ── System diagnostics ──
await test('system diagnostics', () => {
  const diag = new AgentDiag();
  const sys = diag.collectSystem();
  assert.ok(sys.platform);
  assert.ok(sys.arch);
  assert.ok(sys.cpus.count > 0);
  assert.ok(sys.memory.total > 0);
  assert.ok(sys.process.pid > 0);
  assert.ok(sys.process.version);
});

// ── Presets ──
await test('presets', async () => {
  await run('memoryUsage', async () => {
    const c = presets.memoryUsage(99);
    const r = await c.checkFn();
    assert.equal(r.ok, true);
  });
  await run('memoryUsage fails at 0%', async () => {
    const c = presets.memoryUsage(0);
    const r = await c.checkFn();
    assert.equal(r.ok, false);
  });
  await run('diskUsage', async () => {
    const c = presets.diskUsage('/');
    const r = await c.checkFn();
    assert.equal(r.ok, true);
  });
  await run('funcCheck', async () => {
    const c = presets.funcCheck('test', async () => ({ ok: true, message: 'works' }));
    const r = await c.checkFn();
    assert.equal(r.ok, true);
  });
  await run('tcpPort unreachable', async () => {
    const c = presets.tcpPort('localhost', 1);
    const r = await c.checkFn();
    assert.equal(r.ok, false);
  });
  await run('processAlive self', async () => {
    const c = presets.processAlive(process.pid);
    const r = await c.checkFn();
    assert.equal(r.ok, true);
  });
  await run('httpEndpoint preset', () => {
    const c = presets.httpEndpoint('http://example.com', { timeoutMs: 100 });
    assert.equal(c.name, 'http:http://example.com');
  });
});

// ── AlertEngine ──
await test('AlertEngine', async () => {
  const alerts = new AlertEngine();
  let triggered = null;
  alerts.on('alert', a => { triggered = a; });

  await run('add rule', () => {
    alerts.addRule({ name: 'test', condition: ctx => ctx.value > 10, severity: Severity.WARNING, message: 'Too high', cooldownMs: 100 });
    assert.equal(alerts.toJSON().rules.length, 1);
  });
  await run('trigger alert', () => {
    alerts.evaluate({ value: 20 });
    assert.ok(triggered);
    assert.equal(triggered.name, 'test');
  });
  await run('active alerts', () => {
    assert.equal(alerts.getActive().length, 1);
  });
  await run('no trigger below threshold', () => {
    alerts.evaluate({ value: 5 });
    assert.equal(alerts.getActive().length, 0);
  });
  await run('cooldown', () => {
    alerts.evaluate({ value: 20 });
    alerts.evaluate({ value: 20 }); // should be throttled
    assert.equal(alerts.getHistory().length, 1);
  });
  await run('ack', () => {
    alerts.evaluate({ value: 20 });
    alerts.ack('test');
    assert.equal(alerts.getActive().length, 0);
  });
  await run('history', () => {
    alerts.addRule({ name: 'r2', condition: () => true, cooldownMs: 0, message: 'always' });
    alerts.evaluate({});
    assert.ok(alerts.getHistory().length >= 1);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
