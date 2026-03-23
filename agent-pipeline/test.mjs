/**
 * agent-pipeline test suite
 */

import { Pipeline, Status, pipeline, PipelineError, StepTimeoutError } from './index.mjs';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function test(name, fn) {
  console.log(`\n🧪 ${name}`);
  try {
    await fn();
  } catch (err) {
    failed++;
    console.log(`  ❌ Exception: ${err.message}`);
  }
}

// ── Tests ──

await test('Basic task execution', async () => {
  const p = pipeline('test-basic')
    .add('step1', async (ctx) => ({ value: 42 }))
    .add('step2', async (ctx) => ({ doubled: ctx.value * 2 }));

  const result = await p.run();
  assert(result.status === Status.SUCCESS, 'Pipeline succeeded');
  assert(result.steps.length === 2, 'Two steps executed');
  assert(result.steps[0].output.value === 42, 'First step returned 42');
});

await test('Context transforms', async () => {
  const p = pipeline('test-transform')
    .transform('init', (ctx) => ({ ...ctx, count: 0 }))
    .add('increment', async (ctx) => ({ count: ctx.count + 1 }), {
      transform: (output) => ({ count: output.count }),
    });

  const result = await p.run();
  assert(result.context.count === 1, 'Context was transformed');
});

await test('Conditional branching', async () => {
  const p = pipeline('test-condition')
    .set('setup', { value: 10 })
    .condition('check',
      (ctx) => ctx.value > 5,
      pipeline('high').log('high-branch', 'High value'),
      pipeline('low').log('low-branch', 'Low value')
    );

  const result = await p.run();
  assert(result.status === Status.SUCCESS, 'Conditional pipeline succeeded');
  assert(result.steps.length === 2, 'Two steps (set, condition)');
});

await test('Parallel execution', async () => {
  const start = Date.now();
  const p = pipeline('test-parallel')
    .parallel('concurrent', [
      { name: 'a', type: 'task', handler: async () => { await new Promise(r => setTimeout(r, 50)); return 'a'; }, opts: {} },
      { name: 'b', type: 'task', handler: async () => { await new Promise(r => setTimeout(r, 50)); return 'b'; }, opts: {} },
      { name: 'c', type: 'task', handler: async () => { await new Promise(r => setTimeout(r, 50)); return 'c'; }, opts: {} },
    ]);

  const result = await p.run();
  const duration = Date.now() - start;
  assert(result.status === Status.SUCCESS, 'Parallel pipeline succeeded');
  assert(duration < 150, `Parallel ran in ${duration}ms (should be ~50ms, not 150ms)`);
  assert(Array.isArray(result.steps[0].output), 'Parallel output is array');
});

await test('Retry with backoff', async () => {
  let attempts = 0;
  const p = pipeline('test-retry')
    .add('flaky', async () => {
      attempts++;
      if (attempts < 3) throw new Error('Flaky failure');
      return { success: true };
    }, { retry: { maxAttempts: 3, backoffMs: 10 } });

  const result = await p.run();
  assert(result.status === Status.SUCCESS, 'Retry pipeline succeeded');
  assert(attempts === 3, `Exactly 3 attempts (was ${attempts})`);
});

await test('Step timeout', async () => {
  const p = pipeline('test-timeout')
    .add('slow', async () => {
      await new Promise(r => setTimeout(r, 5000));
    }, { timeoutMs: 50 });

  const result = await p.run();
  assert(result.status === Status.FAILED, 'Timed out pipeline marked as failed');
  assert(result.steps[0].status === Status.TIMEOUT, 'Step marked as timeout');
});

await test('Error handler (fallback)', async () => {
  const p = pipeline('test-fallback')
    .add('failing', async () => { throw new Error('Boom'); }, {
      onError: (err, ctx) => ({ fallback: true, originalError: err.message }),
    });

  const result = await p.run();
  assert(result.status === Status.SUCCESS, 'Fallback succeeded');
  assert(result.steps[0].output.fallback === true, 'Fallback output used');
});

await test('Skip condition', async () => {
  const p = pipeline('test-skip')
    .set('setup', { skip: true })
    .add('skipped', async () => 'should-not-run', {
      skipIf: (ctx) => ctx.skip === true,
    })
    .add('runs', async () => 'did-run');

  const result = await p.run();
  assert(result.steps[1].status === Status.SKIPPED, 'Step was skipped');
  assert(result.steps[2].status === Status.SUCCESS, 'Next step ran');
});

await test('Delay step', async () => {
  const start = Date.now();
  const p = pipeline('test-delay')
    .delay('wait', 100);

  const result = await p.run();
  assert(Date.now() - start >= 90, 'Delay waited at least 90ms');
  assert(result.status === Status.SUCCESS, 'Delay pipeline succeeded');
});

await test('Assert step', async () => {
  const p = pipeline('test-assert')
    .set('setup', { value: 42 })
    .assert('check', (ctx) => ctx.value === 42, 'Value must be 42');

  const result = await p.run();
  assert(result.status === Status.SUCCESS, 'Assert passed');
});

await test('Assert failure', async () => {
  const p = pipeline('test-assert-fail')
    .assert('check', () => false, 'This should fail');

  const result = await p.run();
  assert(result.status === Status.FAILED, 'Assert failure caught');
});

await test('Middleware hooks', async () => {
  const calls = [];
  const p = pipeline('test-middleware')
    .before((ctx) => calls.push('before'))
    .after((result) => calls.push('after'))
    .finally(() => calls.push('finally'))
    .log('step', 'test');

  await p.run();
  assert(calls.join(',') === 'before,after,finally', 'Middleware called in order');
});

await test('Pipeline composition', async () => {
  const sub1 = pipeline('sub1').add('a', async () => 'a');
  const sub2 = pipeline('sub2').add('b', async () => 'b');
  const composed = Pipeline.compose('main', [sub1, sub2]);

  const result = await composed.run();
  assert(result.status === Status.SUCCESS, 'Composed pipeline succeeded');
  assert(result.steps.length === 2, 'Two sub-pipelines executed');
});

await test('Step dependencies', async () => {
  const p = pipeline('test-deps')
    .add('first', async () => ({ data: 'hello' }))
    .add('second', async (ctx) => {
      const dep = ctx._stepResults?.first;
      return { got: dep?.output?.data };
    }, { dependsOn: ['first'] });

  const result = await p.run();
  assert(result.status === Status.SUCCESS, 'Dependencies satisfied');
});

await test('Nested pipeline', async () => {
  const inner = pipeline('inner')
    .add('inner-step', async () => ({ inner: true }));

  const outer = pipeline('outer')
    .pipeline('run-inner', inner)
    .add('after-inner', async () => ({ outer: true }));

  const result = await outer.run();
  assert(result.status === Status.SUCCESS, 'Nested pipeline succeeded');
});

await test('JSON serialization', async () => {
  const p = pipeline('test-json')
    .delay('wait', 100)
    .log('msg', 'hello');

  const json = p.toJSON();
  assert(json.name === 'test-json', 'JSON has correct name');
  assert(json.steps.length === 2, 'JSON has 2 steps');
  assert(json.steps[1].type === 'log', 'Step type preserved');
});

await test('Global timeout', async () => {
  const p = pipeline('test-global-timeout', { globalTimeoutMs: 100 })
    .delay('wait1', 50)
    .delay('wait2', 80);  // Remaining budget ~50ms, this step needs 80ms → timeout

  const result = await p.run();
  assert(result.status === Status.FAILED, 'Global timeout triggered');
});

await test('Event emissions', async () => {
  const events = [];
  const p = pipeline('test-events')
    .log('step1', 'hello')
    .add('step2', async () => 'done');

  p.on('step', (r) => events.push(`step:${r.name}:${r.status}`));
  p.on('done', () => events.push('done'));
  p.on('log', () => events.push('log'));

  await p.run();
  assert(events.includes('done'), 'done event emitted');
  assert(events.includes('log'), 'log event emitted');
});

await test('Multiple contexts', async () => {
  const p = pipeline('test-ctx')
    .add('check', async (ctx) => ({ user: ctx.user }));

  const result = await p.run({ user: 'alice', role: 'admin' });
  assert(result.context.user === 'alice', 'Initial context preserved');
  assert(result.context.role === 'admin', 'Extra context kept');
});

// ── Summary ──
console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${failed === 0 ? '✅ All tests passed!' : '❌ Some tests failed'}`);
process.exit(failed > 0 ? 1 : 0);
