#!/usr/bin/env node
// agent-fsm test suite

import { FSM, FSMRegistry, ParallelFSM, presets } from './index.mjs';
import { strict as assert } from 'assert';
import { unlinkSync, existsSync } from 'fs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ─── Basic FSM ─────────────────────────────────────────────────────
console.log('\n🧪 agent-fsm tests\n');

test('create and start FSM', () => {
  const fsm = new FSM({ initial: 'idle' });
  fsm.addTransition({ from: 'idle', event: 'start', to: 'running' });
  fsm.start();
  assert.equal(fsm.state, 'idle');
  assert.equal(fsm.started, true);
});

test('basic transition', () => {
  const fsm = new FSM({ initial: 'idle' });
  fsm.addTransition({ from: 'idle', event: 'go', to: 'running' });
  fsm.start();
  const result = fsm.send('go');
  assert.equal(result.ok, true);
  assert.equal(fsm.state, 'running');
  assert.equal(fsm.transitionCount, 1);
});

test('reject transition from final state', () => {
  const fsm = new FSM({ initial: 'start', final: ['done'] });
  fsm.addTransition({ from: 'start', event: 'finish', to: 'done' });
  fsm.start();
  fsm.send('finish');
  assert.equal(fsm.done, true);
  const r = fsm.send('anything');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'final_state');
});

test('reject non-existent transition', () => {
  const fsm = new FSM({ initial: 'idle' });
  fsm.addTransition({ from: 'idle', event: 'go', to: 'running' });
  fsm.start();
  const r = fsm.send('nope');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_transition');
});

test('guard allows transition', () => {
  const fsm = new FSM({
    initial: 'locked',
    guards: { hasKey: () => true },
  });
  fsm.addTransition({ from: 'locked', event: 'unlock', to: 'unlocked', guard: 'hasKey' });
  fsm.start();
  const r = fsm.send('unlock');
  assert.equal(r.ok, true);
  assert.equal(fsm.state, 'unlocked');
});

test('guard denies transition', () => {
  const fsm = new FSM({
    initial: 'locked',
    guards: { hasKey: () => false },
  });
  fsm.addTransition({ from: 'locked', event: 'unlock', to: 'unlocked', guard: 'hasKey' });
  fsm.start();
  const r = fsm.send('unlock');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'guard_denied:hasKey');
  assert.equal(fsm.state, 'locked');
});

test('guard with context', () => {
  const fsm = new FSM({
    initial: 'waiting',
    context: { attempts: 0 },
    guards: { canRetry: (ctx) => ctx.context.attempts < 3 },
  });
  fsm.addTransition({ from: 'waiting', event: 'retry', to: 'processing', guard: 'canRetry' });
  fsm.start();
  assert.equal(fsm.can('retry'), true);
  fsm.set('attempts', 3);
  assert.equal(fsm.can('retry'), false);
});

test('onEnter hook', () => {
  let entered = false;
  const fsm = new FSM({ initial: 'idle' });
  fsm.addTransition({ from: 'idle', event: 'go', to: 'running' });
  fsm.onEnter('running', () => { entered = true; });
  fsm.start();
  fsm.send('go');
  assert.equal(entered, true);
});

test('onExit hook', () => {
  let exited = false;
  const fsm = new FSM({ initial: 'idle' });
  fsm.addTransition({ from: 'idle', event: 'go', to: 'running' });
  fsm.onExit('idle', () => { exited = true; });
  fsm.start();
  fsm.send('go');
  assert.equal(exited, true);
});

test('context get/set/update/merge', () => {
  const fsm = new FSM({ initial: 's', context: { x: 1 } });
  fsm.start();
  assert.equal(fsm.get('x'), 1);
  fsm.set('y', 2);
  assert.equal(fsm.get('y'), 2);
  fsm.update(ctx => { ctx.x = 10; });
  assert.equal(fsm.get('x'), 10);
  fsm.merge({ a: 1, b: 2 });
  assert.equal(fsm.get('a'), 1);
});

test('history tracking', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'next', to: 'b' });
  fsm.addTransition({ from: 'b', event: 'next', to: 'c' });
  fsm.start();
  fsm.send('next');
  fsm.send('next');
  const h = fsm.history;
  assert.equal(h.length, 2);
  assert.equal(h[0].from, 'a');
  assert.equal(h[0].to, 'b');
  assert.equal(h[1].from, 'b');
  assert.equal(h[1].to, 'c');
});

test('availableEvents', () => {
  const fsm = new FSM({ initial: 'idle' });
  fsm.addTransition({ from: 'idle', event: 'start', to: 'running' });
  fsm.addTransition({ from: 'idle', event: 'skip', to: 'done' });
  fsm.addTransition({ from: 'running', event: 'stop', to: 'idle' });
  fsm.start();
  const events = fsm.availableEvents();
  assert.ok(events.includes('start'));
  assert.ok(events.includes('skip'));
  assert.ok(!events.includes('stop'));
});

test('can() checks', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm.start();
  assert.equal(fsm.can('go'), true);
  assert.equal(fsm.can('nope'), false);
});

test('reset', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm.start();
  fsm.send('go');
  assert.equal(fsm.state, 'b');
  fsm.reset();
  assert.equal(fsm.state, 'a');
  assert.equal(fsm.transitionCount, 0);
  assert.equal(fsm.history.length, 0);
});

test('stop and restart', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm.start();
  fsm.stop();
  assert.equal(fsm.started, false);
  assert.throws(() => fsm.send('go'));
});

test('wildcard transitions', () => {
  const fsm = new FSM({ initial: 'any' });
  fsm.addTransition({ from: '*', event: 'reset', to: 'idle' });
  fsm.addTransition({ from: 'any', event: 'work', to: 'working' });
  fsm.start();
  fsm.send('work');
  assert.equal(fsm.state, 'working');
  fsm.send('reset');
  assert.equal(fsm.state, 'idle');
});

test('transition action', () => {
  let actionRan = false;
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b', action: () => { actionRan = true; } });
  fsm.start();
  fsm.send('go');
  assert.equal(actionRan, true);
});

test('getStates', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm.addTransition({ from: 'b', event: 'back', to: 'a' });
  fsm.addTransition({ from: 'b', event: 'finish', to: 'c' });
  const states = fsm.getStates();
  assert.ok(states.includes('a'));
  assert.ok(states.includes('b'));
  assert.ok(states.includes('c'));
});

test('toMermaid', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  const m = fsm.toMermaid();
  assert.ok(m.includes('stateDiagram-v2'));
  assert.ok(m.includes('a --> b'));
});

test('toDot', () => {
  const fsm = new FSM({ initial: 'a', final: ['b'] });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  const d = fsm.toDot();
  assert.ok(d.includes('digraph'));
  assert.ok(d.includes('"a" -> "b"'));
});

test('toJSON / snapshot', () => {
  const fsm = new FSM({ initial: 'a', context: { x: 1 } });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm.start();
  const j = fsm.toJSON();
  assert.equal(j.currentState, 'a');
  assert.equal(j.context.x, 1);
  const s = JSON.parse(fsm.snapshot());
  assert.equal(s.currentState, 'a');
});

test('persistence save/load', () => {
  const path = '/tmp/test-fsm-' + Date.now() + '.json';
  const fsm1 = new FSM({ initial: 'a', persistencePath: path });
  fsm1.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm1.start();
  fsm1.send('go');
  fsm1.save();

  const fsm2 = new FSM({ persistencePath: path });
  fsm2.addTransition({ from: 'a', event: 'go', to: 'b' });
  assert.equal(fsm2.state, 'b');
  assert.equal(fsm2.transitionCount, 1);
  unlinkSync(path);
});

test('stateTime', async () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.start();
  await new Promise(r => setTimeout(r, 50));
  assert.ok(fsm.stateTime >= 40);
});

test('events emitted', () => {
  const events = [];
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm.on('start', () => events.push('start'));
  fsm.on('transition', () => events.push('transition'));
  fsm.on('rejected', () => events.push('rejected'));
  fsm.start();
  fsm.send('go');
  fsm.send('nope');
  assert.ok(events.includes('start'));
  assert.ok(events.includes('transition'));
  assert.ok(events.includes('rejected'));
});

test('possibleTransitions', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm.addTransition({ from: 'a', event: 'skip', to: 'c' });
  fsm.addTransition({ from: '*', event: 'reset', to: 'a' });
  fsm.start();
  const pt = fsm.possibleTransitions();
  assert.equal(pt.length, 3);
});

// ─── Presets ────────────────────────────────────────────────────────
test('orderLifecycle preset', () => {
  const fsm = new FSM(presets.orderLifecycle);
  fsm.start();
  assert.equal(fsm.state, 'pending');
  fsm.send('confirm');
  assert.equal(fsm.state, 'confirmed');
  fsm.send('pay');
  assert.equal(fsm.state, 'paid');
  fsm.send('ship');
  assert.equal(fsm.state, 'shipped');
  fsm.send('deliver');
  assert.equal(fsm.state, 'delivered');
  assert.equal(fsm.done, true);
});

test('conversation preset', () => {
  const fsm = new FSM(presets.conversation);
  fsm.start();
  assert.equal(fsm.state, 'greeting');
  fsm.send('ask');
  assert.equal(fsm.state, 'collecting_info');
  fsm.send('provide');
  assert.equal(fsm.state, 'processing');
  fsm.send('complete');
  assert.equal(fsm.state, 'responding');
  fsm.send('satisfied');
  assert.equal(fsm.done, true);
});

test('taskLifecycle preset', () => {
  const fsm = new FSM(presets.taskLifecycle);
  fsm.start();
  fsm.send('assign');
  fsm.send('start');
  fsm.send('pause');
  assert.equal(fsm.state, 'paused');
  fsm.send('resume');
  assert.equal(fsm.state, 'in_progress');
  fsm.send('complete');
  fsm.send('approve');
  assert.equal(fsm.done, true);
});

test('connection preset with reconnection', () => {
  const fsm = new FSM(presets.connection);
  fsm.start();
  fsm.send('connect');
  fsm.send('success');
  assert.equal(fsm.state, 'connected');
  fsm.send('error');
  assert.equal(fsm.state, 'reconnecting');
  fsm.send('success');
  assert.equal(fsm.state, 'connected');
});

test('approval preset with escalation', () => {
  const fsm = new FSM(presets.approval);
  fsm.start();
  fsm.send('submit');
  fsm.send('escalate');
  assert.equal(fsm.state, 'escalated');
  fsm.send('approve');
  assert.equal(fsm.done, true);
});

// ─── Registry ──────────────────────────────────────────────────────
test('FSMRegistry create/get/list/remove', () => {
  const reg = new FSMRegistry();
  const fsm = reg.create({ initial: 'a', name: 'test' });
  assert.ok(fsm.id);
  assert.equal(reg.get(fsm.id), fsm);
  assert.equal(reg.list().length, 1);
  reg.remove(fsm.id);
  assert.equal(reg.list().length, 0);
});

test('FSMRegistry stats', () => {
  const reg = new FSMRegistry();
  const fsm1 = reg.create({ initial: 'a', final: ['done'] });
  fsm1.addTransition({ from: 'a', event: 'go', to: 'done' });
  fsm1.start();
  fsm1.send('go');
  const fsm2 = reg.create({ initial: 'x' });
  fsm2.addTransition({ from: 'x', event: 'go', to: 'y' });
  fsm2.start();
  const s = reg.stats();
  assert.equal(s.total, 2);
  assert.equal(s.done, 1);
  assert.equal(s.active, 1);
});

test('FSMRegistry broadcast', () => {
  const reg = new FSMRegistry();
  const fsm1 = reg.create({ initial: 'a' });
  fsm1.addTransition({ from: 'a', event: 'tick', to: 'b' });
  fsm1.start();
  const fsm2 = reg.create({ initial: 'x' });
  fsm2.addTransition({ from: 'x', event: 'tick', to: 'y' });
  fsm2.start();
  const results = reg.broadcast('tick');
  assert.equal(results.length, 2);
  assert.equal(fsm1.state, 'b');
  assert.equal(fsm2.state, 'y');
});

// ─── Parallel FSM ──────────────────────────────────────────────────
test('ParallelFSM start and send', () => {
  const p = new ParallelFSM([
    { name: 'fsm1', initial: 'a' },
    { name: 'fsm2', initial: 'x' },
  ]);
  p.machines[0].addTransition({ from: 'a', event: 'go', to: 'b' });
  p.machines[1].addTransition({ from: 'x', event: 'go', to: 'y' });
  p.start();
  const results = p.send('go');
  assert.equal(results.length, 2);
  assert.equal(p.states[0].state, 'b');
  assert.equal(p.states[1].state, 'y');
});

test('ParallelFSM done', () => {
  const p = new ParallelFSM([
    { name: 'fsm1', initial: 'a', final: ['done'] },
    { name: 'fsm2', initial: 'x', final: ['finished'] },
  ]);
  p.machines[0].addTransition({ from: 'a', event: 'end', to: 'done' });
  p.machines[1].addTransition({ from: 'x', event: 'end', to: 'finished' });
  p.start();
  p.send('end');
  assert.equal(p.done, true);
});

test('ParallelFSM toJSON', () => {
  const p = new ParallelFSM([
    { name: 'fsm1', initial: 'a' },
  ]);
  p.start();
  const j = p.toJSON();
  assert.equal(j.machines.length, 1);
  assert.equal(j.done, false);
});

// ─── Edge Cases ────────────────────────────────────────────────────
test('cannot start without initial state', () => {
  const fsm = new FSM({});
  assert.throws(() => fsm.start(), /No initial state/);
});

test('cannot start twice', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.start();
  assert.throws(() => fsm.start(), /already started/);
});

test('guard not found returns error', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b', guard: 'nonexistent' });
  fsm.start();
  const r = fsm.send('go');
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('guard_not_found'));
});

test('getTransitionTable', () => {
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b', description: 'Go forward' });
  fsm.addTransition({ from: 'b', event: 'back', to: 'a' });
  const t = fsm.getTransitionTable();
  assert.equal(t.length, 2);
  assert.equal(t[0].description, 'Go forward');
});

test('send with payload', () => {
  let receivedPayload = null;
  const fsm = new FSM({ initial: 'a' });
  fsm.addTransition({ from: 'a', event: 'go', to: 'b' });
  fsm.onEnter('b', (ctx) => { receivedPayload = ctx.event.payload; });
  fsm.start();
  fsm.send('go', { data: 42 });
  assert.equal(receivedPayload.data, 42);
});

// ─── Summary ───────────────────────────────────────────────────────
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
