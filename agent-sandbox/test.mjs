import { AgentSandbox } from './index.mjs';

let passed = 0, failed = 0;
function assert(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('agent-sandbox tests\n');

// ── Basic Execution ────────────────────────────────────────────────────────

const sb = new AgentSandbox();

// Simple expressions
const r1 = sb.run('1 + 2 + 3');
assert('basic arithmetic', r1.success && r1.value === 6);

// Variable assignment + return
const r2 = sb.run('const x = 42; x * 2');
assert('variable + return', r2.success && r2.value === 84);

// String operations
const r3 = sb.run('"hello".toUpperCase()');
assert('string ops', r3.success && r3.value === 'HELLO');

// Object creation
const r4 = sb.run('({ a: 1, b: "two" })');
assert('object creation', r4.success && r4.value.a === 1);

// ── Console Capture ────────────────────────────────────────────────────────

const r5 = sb.run('console.log("hello"); console.error("err"); 42');
assert('stdout capture', r5.stdout === 'hello');
assert('stderr capture', r5.stderr === 'err');
assert('return value', r5.value === 42);

// ── Error Handling ─────────────────────────────────────────────────────────

const r6 = sb.run('throw new Error("boom")');
assert('error capture', !r6.success && r6.error.message === 'boom');

const r7 = sb.run('undefinedVariable');
assert('reference error', !r7.success);

const r8 = sb.run('const x = {}; x.y.z');
assert('type error', !r8.success);

// ── Timeout ────────────────────────────────────────────────────────────────

const r9 = sb.run('while(true) {}', { timeout: 100 });
assert('timeout detection', !r9.success && r9.error.message.includes('timed out'));

// ── Context Injection ──────────────────────────────────────────────────────

const r10 = sb.run('name + " is " + age', { globals: { name: 'Laboon', age: 1 } });
assert('globals injection', r10.success && r10.value === 'Laboon is 1');

const r11 = sb.run('items.reduce((a, b) => a + b, 0)', { globals: { items: [1, 2, 3, 4] } });
assert('array in globals', r11.success && r11.value === 10);

// ── Function Execution ─────────────────────────────────────────────────────

const r12 = sb.runFunction((a, b) => a * b, [6, 7]);
assert('runFunction', r12.success && r12.value === 42);

const r13 = sb.runFunction((arr) => arr.filter(x => x > 2), [[1, 2, 3, 4, 5]]);
assert('runFunction with array', r13.success && JSON.stringify(r13.value) === '[3,4,5]');

// ── Expression Evaluation ──────────────────────────────────────────────────

const r14 = sb.runExpression('a + b', { a: 10, b: 20 });
assert('runExpression', r14.success && r14.value === 30);

const r15 = sb.runExpression('users.filter(u => u.active).length', { users: [{ active: true }, { active: false }, { active: true }] });
assert('runExpression complex', r15.success && r15.value === 2);

// ── Async Execution ────────────────────────────────────────────────────────

(async () => {
  const r16 = await sb.runAsync('Promise.resolve(42)');
  assert('async resolve', r16.success && r16.value === 42);

  const r17 = await sb.runAsync('Promise.reject(new Error("async boom"))');
  assert('async reject', !r17.success && r17.error.message === 'async boom');

  const r18 = await sb.runAsync('new Promise(r => setTimeout(() => r("delayed"), 50))');
  assert('async delayed', r18.success && r18.value === 'delayed');

  // ── Batch Execution ──────────────────────────────────────────────────────

  const batch = await sb.runBatch([
    '1 + 1',
    '2 + 2',
    '3 + 3',
    'throw new Error("fail")',
    '"hello"',
  ], { concurrency: 2 });

  assert('batch count', batch.length === 5);
  assert('batch[0]', batch[0].success && batch[0].value === 2);
  assert('batch[1]', batch[1].success && batch[1].value === 4);
  assert('batch[2]', batch[2].success && batch[2].value === 6);
  assert('batch[3]', !batch[3].success);
  assert('batch[4]', batch[4].success && batch[4].value === 'hello');

  // ── Snapshots ────────────────────────────────────────────────────────────

  sb.snapshot('setup', 'let counter = 0; function inc() { return ++counter; }');

  const r19 = sb.runInSnapshot('setup', 'inc()');
  assert('snapshot inc 1', r19.success && r19.value === 1);

  const r20 = sb.runInSnapshot('setup', 'inc()');
  assert('snapshot inc 2', r20.success && r20.value === 2);

  const r21 = sb.runInSnapshot('setup', 'counter');
  assert('snapshot state', r21.success && r21.value === 2);

  const snaps = sb.listSnapshots();
  assert('listSnapshots', snaps.length === 1 && snaps[0].name === 'setup');

  sb.deleteSnapshot('setup');
  assert('deleteSnapshot', sb.listSnapshots().length === 0);

  // ── Stats ────────────────────────────────────────────────────────────────

  const stats = sb.getStats();
  assert('stats.total > 0', stats.total > 0);
  assert('stats.success > 0', stats.success > 0);
  assert('stats.failed > 0', stats.failed > 0);
  assert('stats.avgDurationMs >= 0', stats.avgDurationMs >= 0);

  const history = sb.getHistory({ limit: 5 });
  assert('history limit', history.length <= 5);

  const successOnly = sb.getHistory({ success: true });
  assert('history filter success', successOnly.every(r => r.success));

  // ── Restricted Globals ───────────────────────────────────────────────────

  const r22 = sb.run('typeof process');
  assert('no process global', r22.success && r22.value === 'undefined');

  const r23 = sb.run('typeof require');
  assert('no require global', r23.success && r23.value === 'undefined');

  // ── Complex Scenarios ────────────────────────────────────────────────────

  const r24 = sb.run(`
    const data = [1, 2, 3, 4, 5];
    const doubled = data.map(x => x * 2);
    const filtered = doubled.filter(x => x > 4);
    ({ original: data.length, doubled, filtered, sum: filtered.reduce((a, b) => a + b, 0) })
  `);
  assert('complex pipeline', r24.success && r24.value.sum === 24);

  const r25 = sb.run(`
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    fibonacci(10)
  `);
  assert('recursive function', r25.success && r25.value === 55);

  // ── Mocks ────────────────────────────────────────────────────────────────

  const r26 = sb.run('myApi.fetch("/users")', {
    mocks: {
      myApi: { fetch: (url) => ({ url, data: [1, 2, 3] }) },
    },
  });
  assert('mock injection', r26.success && r26.value.data.length === 3);

  // ── Clear History ────────────────────────────────────────────────────────

  sb.clearHistory();
  assert('clear history', sb.getStats().total === 0 && sb.getHistory().length === 0);

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
})();
