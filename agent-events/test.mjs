#!/usr/bin/env node
/**
 * agent-events test suite
 */
import { EventStore, ProjectionEngine, SagaEngine, EventUpcaster, ReadModel, AggregateRoot } from './index.mjs';
import { mkdirSync, rmSync, existsSync } from 'fs';

const TEST_DIR = '/tmp/agent-events-test-' + Date.now();
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function assertEqual(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

function section(name) { console.log(`\n📋 ${name}`); }

// Clean up
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });

// ── Event Store ──────────────────────────────────────────────────────
section('EventStore');

const store = new EventStore({ dir: TEST_DIR, persist: true });

const e1 = store.append('order-1', 'OrderCreated', { items: ['widget'], total: 100 });
assert(e1.id, 'append returns event with id');
assertEqual(e1.streamId, 'order-1', 'streamId set');
assertEqual(e1.type, 'OrderCreated', 'type set');
assertEqual(e1.version, 0, 'first version is 0');
assertEqual(e1.seq, 1, 'first seq is 1');

const e2 = store.append('order-1', 'OrderPaid', { amount: 100 });
assertEqual(e2.version, 1, 'second version is 1');
assertEqual(e2.seq, 2, 'second seq is 2');

const e3 = store.append('order-2', 'OrderCreated', { items: ['gadget'] });
assertEqual(e3.version, 0, 'different stream starts at 0');

const stream = store.getStream('order-1');
assertEqual(stream.length, 2, 'stream has 2 events');

const streamFrom1 = store.getStream('order-1', 1);
assertEqual(streamFrom1.length, 1, 'stream from v1 has 1 event');

const all = store.getAllEvents();
assertEqual(all.length, 3, 'all events: 3');

const byType = store.getByType('OrderCreated');
assertEqual(byType.length, 2, 'byType: 2 OrderCreated');

const byCorr = store.getByCorrelation('corr-1');
assertEqual(byCorr.length, 0, 'no events with correlation corr-1');

const e4 = store.append('order-1', 'OrderShipped', { tracking: 'ABC' }, { correlationId: 'corr-1' });
const byCorr2 = store.getByCorrelation('corr-1');
assertEqual(byCorr2.length, 1, 'correlation filter works');

const streams = store.listStreams();
assert(streams.includes('order-1') && streams.includes('order-2'), 'listStreams returns both');

// ── Subscriptions ────────────────────────────────────────────────────
section('Subscriptions');

let subEvents = [];
const subId = store.subscribe('OrderCreated', (e) => subEvents.push(e));
store.append('order-3', 'OrderCreated', { x: 1 });
assertEqual(subEvents.length, 1, 'subscription received event');
assertEqual(subEvents[0].payload.x, 1, 'subscription event has correct payload');

let wildcardEvents = [];
store.subscribe('*', (e) => wildcardEvents.push(e));
store.append('order-3', 'OrderCancelled', {});
assertEqual(wildcardEvents.length, 1, 'wildcard subscription works');

let patternEvents = [];
store.subscribe('Order.*', (e) => patternEvents.push(e));
store.append('order-3', 'Order.Refunded', {});
assertEqual(patternEvents.length, 1, 'pattern subscription works');

const unsub = store.unsubscribe(subId);
assert(unsub, 'unsubscribe returns true');

// ── Snapshots ────────────────────────────────────────────────────────
section('Snapshots');

store.saveSnapshot('agg-1', { count: 42 }, 5);
const snap = store.getSnapshot('agg-1');
assertEqual(snap.state.count, 42, 'snapshot state');
assertEqual(snap.version, 5, 'snapshot version');

const noSnap = store.getSnapshot('agg-missing');
assertEqual(noSnap, null, 'missing snapshot returns null');

// ── Aggregate State (reducer) ────────────────────────────────────────
section('Aggregate State');

const counterStore = new EventStore({ dir: TEST_DIR + '-counter', persist: false });
counterStore.append('counter', 'increment', { amount: 5 });
counterStore.append('counter', 'increment', { amount: 3 });
counterStore.append('counter', 'decrement', { amount: 2 });

const reducer = (state, event) => {
  if (event.type === 'increment') return { value: (state.value || 0) + event.payload.amount };
  if (event.type === 'decrement') return { value: (state.value || 0) - event.payload.amount };
  return state;
};

const state = counterStore.getAggregateState('counter', reducer, { value: 0 });
assertEqual(state.value, 6, 'aggregate state: 5 + 3 - 2 = 6');

// ── Projection Engine ────────────────────────────────────────────────
section('ProjectionEngine');

const projStore = new EventStore({ dir: TEST_DIR + '-proj', persist: false });
const proj = new ProjectionEngine(projStore, { persist: false });

proj.define('orderSummary', { totalRevenue: 0, orderCount: 0 }, {
  'OrderCreated': (state, e) => ({ ...state, orderCount: state.orderCount + 1 }),
  'OrderPaid': (state, e) => ({ ...state, totalRevenue: state.totalRevenue + e.payload.amount })
});

projStore.append('o1', 'OrderCreated', {});
projStore.append('o1', 'OrderPaid', { amount: 50 });
projStore.append('o2', 'OrderCreated', {});
projStore.append('o2', 'OrderPaid', { amount: 30 });

const summary = proj.getState('orderSummary');
assertEqual(summary.orderCount, 2, 'projection: 2 orders');
assertEqual(summary.totalRevenue, 80, 'projection: 80 revenue');

proj.reset('orderSummary');
assertEqual(proj.getState('orderSummary').orderCount, 0, 'projection reset works');

// ── Saga Engine ──────────────────────────────────────────────────────
section('SagaEngine');

const sagaStore = new EventStore({ dir: TEST_DIR + '-saga', persist: false });
const saga = new SagaEngine(sagaStore, { persist: false });

let sagaLog = [];

saga.define('orderFulfillment', {
  steps: [
    {
      id: 'validate',
      action: async (data) => { sagaLog.push('validate'); return { valid: true }; }
    },
    {
      id: 'charge',
      action: async (data, results) => { sagaLog.push('charge'); return { charged: true }; },
      compensate: async (data) => { sagaLog.push('refund'); }
    },
    {
      id: 'ship',
      action: async (data, results) => { sagaLog.push('ship'); return { shipped: true }; }
    }
  ]
});

const sagaInstance = await saga.start('orderFulfillment', { orderId: 'o1' });
assertEqual(sagaInstance.status, 'completed', 'saga completed');
assertEqual(sagaInstance.results.validate.valid, true, 'validate step result');
assertEqual(sagaInstance.results.charge.charged, true, 'charge step result');
assertEqual(sagaInstance.results.ship.shipped, true, 'ship step result');
assertEqual(sagaLog.join(','), 'validate,charge,ship', 'saga steps executed in order');

// Saga with failure + compensation
saga.define('failingSaga', {
  steps: [
    { id: 'step1', action: async () => 'ok', compensate: async () => sagaLog.push('comp1') },
    { id: 'step2', action: async () => { throw new Error('boom'); }, compensate: async () => sagaLog.push('comp2') }
  ]
});

sagaLog = [];
const failedSaga = await saga.start('failingSaga', {});
assertEqual(failedSaga.status, 'failed', 'saga failed on error');
assert(sagaLog.includes('comp1'), 'compensation ran for step1');

const sagaStats = saga.stats();
assertEqual(sagaStats.defined, 2, '2 sagas defined');
assertEqual(sagaStats.completed, 1, '1 completed');
assertEqual(sagaStats.failed, 1, '1 failed');

// ── Event Upcaster ───────────────────────────────────────────────────
section('EventUpcaster');

const upcaster = new EventUpcaster();
upcaster.register('UserCreated', 1, 2, (event) => {
  event.payload.fullName = `${event.payload.firstName} ${event.payload.lastName}`;
  delete event.payload.firstName;
  delete event.payload.lastName;
  return event;
});

const v1Event = {
  type: 'UserCreated',
  payload: { firstName: 'John', lastName: 'Doe' },
  meta: { schemaVersion: 1, targetVersion: 2 }
};

const v2Event = upcaster.upcast(v1Event);
assertEqual(v2Event.payload.fullName, 'John Doe', 'upcaster transforms payload');
assertEqual(v2Event.meta.schemaVersion, 2, 'schema version bumped');

// No-op for same version
const sameEvent = { type: 'X', payload: {}, meta: { schemaVersion: 3 } };
assertEqual(upcaster.upcast(sameEvent), sameEvent, 'no-op for current version');

// ── Read Model (CQRS) ───────────────────────────────────────────────
section('ReadModel');

const rmStore = new EventStore({ dir: TEST_DIR + '-rm', persist: false });
const rm = new ReadModel(rmStore, 'todos', {
  'TodoAdded': (s, e) => ({ ...s, items: [...(s.items || []), { text: e.payload.text, done: false }] }),
  'TodoDone': (s, e) => ({ ...s, items: (s.items || []).map((t, i) => i === e.payload.index ? { ...t, done: true } : t) })
}, { items: [] });

rmStore.append('todos', 'TodoAdded', { text: 'Buy milk' });
rmStore.append('todos', 'TodoAdded', { text: 'Write tests' });
rmStore.append('todos', 'TodoDone', { index: 0 });

const todos = rm.query(s => s.items);
assertEqual(todos.length, 2, 'read model: 2 items');
assertEqual(todos[0].done, true, 'first todo done');
assertEqual(todos[1].done, false, 'second todo not done');

// ── Aggregate Root ───────────────────────────────────────────────────
section('AggregateRoot');

const aggStore = new EventStore({ dir: TEST_DIR + '-agg', persist: false });
const agg = new AggregateRoot('bank-account', aggStore);

agg.apply('AccountOpened', { owner: 'Alice', balance: 100 });
agg.apply('MoneyDeposited', { amount: 50 });
agg.apply('MoneyWithdrawn', { amount: 30 });

const aggEvents = aggStore.getStream('bank-account');
assertEqual(aggEvents.length, 3, 'aggregate: 3 events');
assertEqual(agg.version, 3, 'aggregate version is 3');

// ── Persistence / Reload ─────────────────────────────────────────────
section('Persistence & Reload');

const store2 = new EventStore({ dir: TEST_DIR, persist: true });
const reloaded = store2.getStream('order-1');
assert(reloaded.length >= 3, `reloaded stream has events from disk (got ${reloaded.length})`);

const reloadedSnap = store2.getSnapshot('agg-1');
assertEqual(reloadedSnap?.state?.count, 42, 'reloaded snapshot works');

// ── Stats ────────────────────────────────────────────────────────────
section('Stats');

const stats = store2.stats();
assert(stats.streams > 0, 'stats has streams');
assert(stats.totalEvents > 0, 'stats has totalEvents');
assert(stats.snapshots > 0, 'stats has snapshots');

// ── Cleanup ──────────────────────────────────────────────────────────
section('Cleanup');

store.deleteStream('order-3');
const afterDelete = store.listStreams();
assert(!afterDelete.includes('order-3'), 'stream deleted');

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}`);
if (failed > 0) process.exit(1);

// Cleanup
try { rmSync(TEST_DIR, { recursive: true }); rmSync(TEST_DIR + '-counter', { recursive: true }); rmSync(TEST_DIR + '-proj', { recursive: true }); rmSync(TEST_DIR + '-saga', { recursive: true }); rmSync(TEST_DIR + '-rm', { recursive: true }); rmSync(TEST_DIR + '-agg', { recursive: true }); } catch {}
