/**
 * agent-state test suite
 */

import { StateMachine, Guards, createWorkflow, createGameLoop, getByPath, setByPath } from './index.mjs';
import { strict as assert } from 'assert';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';

const TMP = '/tmp/agent-state-test';
if (existsSync(TMP)) {
  // Clean up
  for (const f of ['test-persist.jsonl', 'test-replay.jsonl', 'test-snapshot.jsonl']) {
    const p = join(TMP, f);
    if (existsSync(p)) unlinkSync(p);
  }
}
mkdirSync(TMP, { recursive: true });

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

console.log('\n🧪 agent-state tests\n');

// ─── Basic state machine ────────────────────────────────────────
console.log('▸ Basic state machine');

await testAsync('create and start', async () => {
  const sm = new StateMachine({
    id: 'test-basic',
    initial: 'idle',
    states: {
      idle: { on: { START: { target: 'running' } } },
      running: { type: 'final' },
    },
  });
  await sm.start();
  assert.equal(sm.state, 'idle');
  assert.equal(sm.isRunning, true);
});

await testAsync('transition between states', async () => {
  const sm = new StateMachine({
    initial: 'off',
    states: {
      off: { on: { TOGGLE: { target: 'on' } } },
      on: { on: { TOGGLE: { target: 'off' } } },
    },
  });
  await sm.start();
  assert.equal(sm.state, 'off');
  const r = await sm.send('TOGGLE');
  assert.equal(r.changed, true);
  assert.equal(sm.state, 'on');
  await sm.send('TOGGLE');
  assert.equal(sm.state, 'off');
});

await testAsync('unhandled event', async () => {
  const sm = new StateMachine({
    initial: 'a',
    states: { a: {} },
  });
  await sm.start();
  const r = await sm.send('UNKNOWN');
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'no_transition');
});

await testAsync('final state stops machine', async () => {
  const sm = new StateMachine({
    initial: 'start',
    states: {
      start: { on: { GO: { target: 'end' } } },
      end: { type: 'final' },
    },
  });
  await sm.start();
  await sm.send('GO');
  assert.equal(sm.state, 'end');
  assert.equal(sm.isDone, true);
});

// ─── Guards ─────────────────────────────────────────────────────
console.log('\n▸ Guards');

await testAsync('guard blocks transition', async () => {
  const sm = new StateMachine({
    context: { count: 0 },
    initial: 'a',
    states: {
      a: {
        on: {
          GO: {
            target: 'b',
            guard: (ctx) => ctx.count > 5,
          },
        },
      },
      b: {},
    },
  });
  await sm.start();
  let r = await sm.send('GO');
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'guard_failed');
  sm.context.count = 10;
  r = await sm.send('GO');
  assert.equal(r.changed, true);
  assert.equal(sm.state, 'b');
});

await testAsync('multiple transitions with guards', async () => {
  const sm = new StateMachine({
    context: { level: 'low' },
    initial: 'waiting',
    states: {
      waiting: {
        on: {
          CHECK: [
            { target: 'critical', guard: (ctx) => ctx.level === 'high' },
            { target: 'warning', guard: (ctx) => ctx.level === 'medium' },
            { target: 'normal' },
          ],
        },
      },
      critical: {},
      warning: {},
      normal: {},
    },
  });
  await sm.start();
  await sm.send('CHECK');
  assert.equal(sm.state, 'normal');
  sm.context.level = 'high';
  sm.currentState = 'waiting';
  await sm.send('CHECK');
  assert.equal(sm.state, 'critical');
});

// ─── Guards helpers ─────────────────────────────────────────────
console.log('\n▸ Guard helpers');

test('Guards.and', () => {
  const g = Guards.and(Guards.gt('x', 5), Guards.lt('x', 10));
  assert.equal(g({ x: 7 }), true);
  assert.equal(g({ x: 3 }), false);
});

test('Guards.or', () => {
  const g = Guards.or(Guards.eq('status', 'a'), Guards.eq('status', 'b'));
  assert.equal(g({ status: 'b' }), true);
  assert.equal(g({ status: 'c' }), false);
});

test('Guards.not', () => {
  const g = Guards.not(Guards.eq('flag', true));
  assert.equal(g({ flag: false }), true);
  assert.equal(g({ flag: true }), false);
});

test('Guards.in', () => {
  const g = Guards.in('role', ['admin', 'owner']);
  assert.equal(g({ role: 'admin' }), true);
  assert.equal(g({ role: 'user' }), false);
});

test('Guards.exists', () => {
  const g = Guards.exists('user.name');
  assert.equal(g({ user: { name: 'x' } }), true);
  assert.equal(g({ user: {} }), false);
});

test('getByPath / setByPath', () => {
  const obj = { a: { b: { c: 42 } } };
  assert.equal(getByPath(obj, 'a.b.c'), 42);
  setByPath(obj, 'a.b.d', 99);
  assert.equal(obj.a.b.d, 99);
});

// ─── Actions ────────────────────────────────────────────────────
console.log('\n▸ Actions');

await testAsync('transition action modifies context', async () => {
  const sm = new StateMachine({
    context: { count: 0 },
    initial: 'a',
    states: {
      a: {
        on: {
          INC: {
            target: 'b',
            action: (ctx) => { ctx.count++; },
          },
        },
      },
      b: {},
    },
  });
  await sm.start();
  await sm.send('INC');
  assert.equal(sm.context.count, 1);
  assert.equal(sm.state, 'b');
});

await testAsync('onEntry / onExit', async () => {
  let entered = false;
  let exited = false;
  const sm = new StateMachine({
    initial: 'a',
    states: {
      a: {
        onExit: () => { exited = true; },
        on: { GO: { target: 'b' } },
      },
      b: {
        onEntry: () => { entered = true; },
      },
    },
  });
  await sm.start();
  await sm.send('GO');
  assert.equal(exited, true);
  assert.equal(entered, true);
});

// ─── Always (immediate) transitions ─────────────────────────────
console.log('\n▸ Always transitions');

await testAsync('immediate auto-transition', async () => {
  const sm = new StateMachine({
    context: { ready: true },
    initial: 'check',
    states: {
      check: {
        always: { target: 'go', guard: (ctx) => ctx.ready },
      },
      go: { type: 'final' },
    },
  });
  await sm.start();
  assert.equal(sm.state, 'go');
});

// ─── Timeouts ───────────────────────────────────────────────────
console.log('\n▸ Timeouts');

await testAsync('after timeout transitions', async () => {
  const sm = new StateMachine({
    initial: 'waiting',
    states: {
      waiting: {
        after: { 50: 'timeout_state' },
      },
      timeout_state: {},
    },
  });
  await sm.start();
  assert.equal(sm.state, 'waiting');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(sm.state, 'timeout_state');
});

// ─── can() / events ─────────────────────────────────────────────
console.log('\n▸ can() and events');

await testAsync('can() checks guard', async () => {
  const sm = new StateMachine({
    context: { unlocked: false },
    initial: 'locked',
    states: {
      locked: {
        on: {
          UNLOCK: { target: 'unlocked', guard: (ctx) => ctx.unlocked },
        },
      },
      unlocked: {},
    },
  });
  await sm.start();
  assert.equal(sm.can('UNLOCK'), false);
  sm.context.unlocked = true;
  assert.equal(sm.can('UNLOCK'), true);
});

test('events list', () => {
  const sm = new StateMachine({
    initial: 'a',
    states: {
      a: { on: { FOO: { target: 'b' }, BAR: { target: 'c' } } },
      b: {},
      c: {},
    },
  });
  sm.currentState = 'a';
  const evts = sm.events;
  assert.ok(evts.includes('FOO'));
  assert.ok(evts.includes('BAR'));
});

// ─── Workflow factory ───────────────────────────────────────────
console.log('\n▸ Workflow factory');

await testAsync('createWorkflow runs linear pipeline', async () => {
  let steps = [];
  const wf = createWorkflow('test-wf', [
    { name: 'fetch', action: (ctx) => { steps.push('fetch'); ctx.data = 'ok'; } },
    { name: 'process', action: (ctx) => { steps.push('process'); } },
    { name: 'save', action: (ctx) => { steps.push('save'); } },
  ]);
  await wf.start();
  assert.equal(wf.state, 'fetch');
  await wf.send('NEXT');
  assert.equal(wf.state, 'process');
  await wf.send('NEXT');
  assert.equal(wf.state, 'save');
  await wf.send('NEXT');
  assert.equal(wf.isDone, true);
  assert.deepEqual(steps, ['fetch', 'process', 'save']);
});

// ─── Game loop factory ──────────────────────────────────────────
console.log('\n▸ Game loop factory');

await testAsync('createGameLoop cycles phases', async () => {
  let phaseLog = [];
  const gl = createGameLoop('test-loop', [
    { name: 'day', onEnter: () => phaseLog.push('day') },
    { name: 'night', onEnter: () => phaseLog.push('night') },
  ]);
  await gl.start();
  assert.equal(gl.state, 'day');
  await gl.send('NEXT');
  assert.equal(gl.state, 'night');
  await gl.send('NEXT');
  assert.equal(gl.state, 'day');
  assert.deepEqual(phaseLog, ['day', 'night', 'day']);
});

// ─── JSON serialization ─────────────────────────────────────────
console.log('\n▸ Serialization');

test('toJSON returns state info', () => {
  const sm = new StateMachine({
    id: 'ser-test',
    initial: 'a',
    states: {
      a: { on: { GO: { target: 'b' } } },
      b: { type: 'final' },
    },
  });
  sm.currentState = 'a';
  const json = sm.toJSON();
  assert.equal(json.id, 'ser-test');
  assert.equal(json.currentState, 'a');
  assert.equal(json.states.length, 2);
});

await testAsync('snapshot / restore', async () => {
  const sm = new StateMachine({
    context: { x: 1 },
    initial: 'a',
    states: {
      a: { on: { GO: { target: 'b' } } },
      b: {},
    },
  });
  await sm.start();
  sm.context.x = 42;
  const snap = sm.snapshot();
  assert.equal(snap.currentState, 'a');
  assert.equal(snap.context.x, 42);

  const sm2 = new StateMachine({
    initial: 'a',
    states: {
      a: { on: { GO: { target: 'b' } } },
      b: {},
    },
  });
  sm2.restore(snap);
  assert.equal(sm2.state, 'a');
  assert.equal(sm2.context.x, 42);
});

// ─── Events ─────────────────────────────────────────────────────
console.log('\n▸ EventEmitter');

await testAsync('emits transition event', async () => {
  const sm = new StateMachine({
    initial: 'a',
    states: { a: { on: { GO: { target: 'b' } } }, b: {} },
  });
  let emitted = false;
  sm.on('transition', (e) => {
    if (e.from === 'a' && e.to === 'b') emitted = true;
  });
  await sm.start();
  await sm.send('GO');
  assert.equal(emitted, true);
});

await testAsync('emits done on final state', async () => {
  const sm = new StateMachine({
    initial: 'a',
    states: { a: { on: { END: { target: 'done' } } }, done: { type: 'final' } },
  });
  let doneEmitted = false;
  sm.on('done', () => { doneEmitted = true; });
  await sm.start();
  await sm.send('END');
  assert.equal(doneEmitted, true);
});

// ─── Stop ───────────────────────────────────────────────────────
console.log('\n▸ Stop');

await testAsync('stop halts transitions', async () => {
  const sm = new StateMachine({
    initial: 'a',
    states: { a: { on: { GO: { target: 'b' } } }, b: {} },
  });
  await sm.start();
  sm.stop();
  const r = await sm.send('GO');
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'not_running');
});

// ─── Summary ────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('✅ All tests passed!\n');
