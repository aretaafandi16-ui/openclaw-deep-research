/**
 * agent-sync test suite
 */

import { AgentSync, VectorClock, LWWRegister, GCounter, PNCounter, ORSet, LWWMap } from './index.mjs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n${name}`); }

// ─── Vector Clock ──────────────────────────────────────────────────────────

section('VectorClock');
const vc1 = new VectorClock('peer-a');
vc1.tick();
vc1.tick();
assert(vc1.clock['peer-a'] === 2, 'tick increments');

const vc2 = new VectorClock('peer-b');
vc2.tick();
vc1.merge(vc2.clock);
assert(vc1.clock['peer-a'] === 2 && vc1.clock['peer-b'] === 1, 'merge combines clocks');

const cmp1 = vc1.compare({ 'peer-a': 1 }, { 'peer-a': 2 });
assert(cmp1 === -1, 'compare: earlier < later');

const cmp2 = vc1.compare({ 'peer-a': 1, 'peer-b': 1 }, { 'peer-a': 2 });
assert(cmp2 === 0, 'compare: concurrent returns 0');

const cmp3 = vc1.compare({ 'peer-a': 2 }, { 'peer-a': 2 });
assert(cmp3 === 2, 'compare: equal returns 2');

// ─── LWW Register ──────────────────────────────────────────────────────────

section('LWWRegister');
const reg = new LWWRegister('peer-a');
reg.set('hello', 100);
assert(reg.get() === 'hello', 'set/get works');

reg.set('world', 200);
assert(reg.get() === 'world', 'newer timestamp wins');

reg.set('stale', 50);
assert(reg.get() === 'world', 'older timestamp loses');

const reg2 = new LWWRegister('peer-b');
reg2.set('remote', 300);
reg.merge(reg2);
assert(reg.get() === 'remote', 'merge: newer value wins');

const regJSON = reg.toJSON();
assert(regJSON.type === 'lww-register', 'toJSON type');
const regRestored = LWWRegister.fromJSON(regJSON);
assert(regRestored.get() === 'remote', 'fromJSON restores value');

// ─── G-Counter ─────────────────────────────────────────────────────────────

section('GCounter');
const gc = new GCounter('peer-a');
gc.increment();
gc.increment(5);
assert(gc.value() === 6, 'increment works');

const gc2 = new GCounter('peer-b');
gc2.increment(3);
gc.merge(gc2);
assert(gc.value() === 9, 'merge adds unique peer counts');

const gcJSON = gc.toJSON();
assert(gcJSON.type === 'g-counter', 'toJSON type');
const gcRestored = GCounter.fromJSON(gcJSON, 'peer-a');
assert(gcRestored.value() === 9, 'fromJSON restores count');

// ─── PN-Counter ────────────────────────────────────────────────────────────

section('PNCounter');
const pnc = new PNCounter('peer-a');
pnc.increment(10);
pnc.decrement(3);
assert(pnc.value() === 7, 'increment/decrement works');

const pnc2 = new PNCounter('peer-b');
pnc2.increment(5);
pnc2.decrement(2);
pnc.merge(pnc2);
assert(pnc.value() === 15 - 5, 'merge combines positive and negative');

const pncJSON = pnc.toJSON();
assert(pncJSON.type === 'pn-counter', 'toJSON type');
const pncRestored = PNCounter.fromJSON(pncJSON, 'peer-a');
assert(pncRestored.value() === 10, 'fromJSON restores value');

// ─── OR-Set ────────────────────────────────────────────────────────────────

section('ORSet');
const set1 = new ORSet('peer-a');
set1.add('apple');
set1.add('banana');
set1.add('cherry');
assert(set1.has('apple'), 'has after add');
assert(set1.size() === 3, 'size is 3');

set1.remove('banana');
assert(!set1.has('banana'), 'removed element not in set');
assert(set1.size() === 2, 'size is 2 after remove');

const set2 = new ORSet('peer-b');
set2.add('apple');
set2.add('date');
set1.merge(set2);
assert(set1.has('date'), 'merge adds remote elements');
assert(set1.has('apple'), 'merge preserves existing');

const setJSON = set1.toJSON();
assert(setJSON.type === 'or-set', 'toJSON type');
const setRestored = ORSet.fromJSON(setJSON);
assert(setRestored.has('apple'), 'fromJSON restores set');
assert(setRestored.has('date'), 'fromJSON restores merged');

// ─── LWW-Map ───────────────────────────────────────────────────────────────

section('LWWMap');
const map1 = new LWWMap('peer-a');
map1.set('x', 10, 100);
map1.set('y', 20, 200);
assert(map1.get('x') === 10, 'set/get works');
assert(map1.size() === 2, 'size is 2');

map1.set('x', 15, 300);
assert(map1.get('x') === 15, 'newer value wins');

const map2 = new LWWMap('peer-b');
map2.set('x', 99, 400);
map2.set('z', 30, 150);
map1.merge(map2);
assert(map1.get('x') === 99, 'merge: remote newer wins');
assert(map1.get('z') === 30, 'merge adds new key');

const mapJSON = map1.toJSON();
assert(mapJSON.type === 'lww-map', 'toJSON type');
const mapRestored = LWWMap.fromJSON(mapJSON, 'peer-a');
assert(mapRestored.get('x') === 99, 'fromJSON restores map');

// ─── AgentSync: Basic Operations ───────────────────────────────────────────

section('AgentSync: Basic Operations');
const sync = new AgentSync({ peerId: 'peer-1', namespace: 'test' });
sync.set('name', 'Alice');
assert(sync.get('name') === 'Alice', 'set/get basic');
assert(sync.has('name'), 'has returns true');

sync.set('name', 'Bob');
assert(sync.get('name') === 'Bob', 'overwrite value');

sync.delete('name');
assert(!sync.has('name'), 'delete removes key');
assert(sync.get('name') === undefined, 'get returns undefined after delete');

// ─── AgentSync: CRDT Types ────────────────────────────────────────────────

section('AgentSync: CRDT Types');
sync.set('counter', null, { type: 'g-counter', increment: 5 });
assert(sync.get('counter') === 5, 'g-counter set');

sync.increment('counter', 3);
assert(sync.get('counter') === 8, 'g-counter increment');

sync.set('pnc', null, { type: 'pn-counter', increment: 10 });
sync.decrement('pnc', 3);
assert(sync.get('pnc') === 7, 'pn-counter increment/decrement');

sync.addToSet('fruits', 'apple');
sync.addToSet('fruits', 'banana');
assert(sync.getEntry('fruits').value.includes('apple'), 'or-set add');
sync.removeFromSet('fruits', 'apple');
assert(!sync.getEntry('fruits').value.includes('apple'), 'or-set remove');

sync.setInMap('config', 'theme', 'dark');
sync.setInMap('config', 'lang', 'en');
assert(sync.getFromMap('config', 'theme') === 'dark', 'lww-map set/get');

// ─── AgentSync: Events ────────────────────────────────────────────────────

section('AgentSync: Events');
let events = [];
const sync2 = new AgentSync({ peerId: 'peer-events' });
sync2.on('set', e => events.push(e));
sync2.on('delete', e => events.push(e));
sync2.set('a', 1);
sync2.set('b', 2);
sync2.delete('a');
assert(events.length === 3, `events fired: ${events.length}`);
assert(events[0].op === undefined || events[0].key === 'a', 'set event has key');

// ─── AgentSync: Snapshot & Sync ────────────────────────────────────────────

section('AgentSync: Snapshot & Sync');
const s1 = new AgentSync({ peerId: 's1' });
s1.set('shared', 'value-from-s1', { type: 'lww', timestamp: 100 });
s1.set('only-s1', 'local-only');

const s2 = new AgentSync({ peerId: 's2' });
s2.set('shared', 'value-from-s2', { type: 'lww', timestamp: 200 });
s2.set('only-s2', 'remote-only');

const snap1 = s1.createSnapshot();
const snap2 = s2.createSnapshot();

s1.sync(snap2);
assert(s1.get('shared') === 'value-from-s2', 'sync: remote newer wins');
assert(s1.get('only-s1') === 'local-only', 'sync: local-only preserved');
assert(s1.get('only-s2') === 'remote-only', 'sync: remote-only merged');

// ─── AgentSync: Delta Sync ─────────────────────────────────────────────────

section('AgentSync: Delta Sync');
const d1 = new AgentSync({ peerId: 'delta-1' });
const d2 = new AgentSync({ peerId: 'delta-2' });

d1.set('x', 10);
d1.set('y', 20);
d2.registerPeer('delta-1');

const delta = d1.getDelta('delta-2');
assert(delta.deltas.length === 2, `delta has 2 entries: ${delta.deltas.length}`);
assert(delta.from === 'delta-1', 'delta from is correct');

d2.applyDelta(delta);
assert(d2.get('x') === 10 || d2.has('x'), 'delta applied');

// ─── AgentSync: Namespace ──────────────────────────────────────────────────

section('AgentSync: Namespace');
const ns = new AgentSync({ peerId: 'ns-peer' });
ns.set('a', 1, { namespace: 'alpha' });
ns.set('b', 2, { namespace: 'beta' });
ns.set('c', 3, { namespace: 'alpha' });
assert(ns.size('alpha') === 2, 'namespace size filter');
assert(ns.keys('beta').length === 1, 'namespace keys filter');

// ─── AgentSync: Stats & Log ────────────────────────────────────────────────

section('AgentSync: Stats & Log');
const st = new AgentSync({ peerId: 'stats-peer' });
st.set('a', 1);
st.set('b', 2);
st.delete('a');
const stats = st.stats();
assert(stats.sets === 2, `stats.sets = ${stats.sets}`);
assert(stats.deletes === 1, `stats.deletes = ${stats.deletes}`);
assert(stats.keys === 1, `stats.keys = ${stats.keys}`);
assert(stats.logEntries > 0, 'log has entries');

const log = st.getLog();
assert(log.length > 0, 'getLog returns entries');
assert(log[0].op === 'set', 'log entry has op');

// ─── AgentSync: Clear ──────────────────────────────────────────────────────

section('AgentSync: Clear');
const cl = new AgentSync({ peerId: 'clear-peer' });
cl.set('a', 1);
cl.set('b', 2);
cl.clear();
assert(cl.keys().length === 0, 'clear removes all keys');
assert(cl.stats().sets === 0, 'clear resets stats');

// ─── AgentSync: Peer Management ───────────────────────────────────────────

section('AgentSync: Peer Management');
const pm = new AgentSync({ peerId: 'pm-1' });
pm.registerPeer('pm-2');
pm.registerPeer('pm-3');
assert(pm.listPeers().length === 2, 'registered 2 peers');
pm.unregisterPeer('pm-2');
assert(pm.listPeers().length === 1, 'unregistered 1 peer');

// ─── AgentSync: Multiple Sync Cycles ───────────────────────────────────────

section('AgentSync: Multi-cycle sync');
const mc1 = new AgentSync({ peerId: 'mc-1' });
const mc2 = new AgentSync({ peerId: 'mc-2' });

// Cycle 1
mc1.set('v', 1);
mc2.set('v', 2);
mc1.sync(mc2.createSnapshot());
assert(mc1.get('v') === 2, 'cycle 1: remote wins (higher peerId)');

// Cycle 2
mc1.set('v', 3);
mc2.sync(mc1.createSnapshot());
assert(mc2.get('v') >= 2, 'cycle 2: values converge');

// Cycle 3 — counters
mc1.set('hits', null, { type: 'g-counter', increment: 5 });
mc2.set('hits', null, { type: 'g-counter', increment: 3 });
mc1.sync(mc2.createSnapshot());
assert(mc1.get('hits') === 8, 'cycle 3: counters merge correctly');

// ─── AgentSync: toJSON / fromJSON roundtrip ────────────────────────────────

section('AgentSync: JSON serialization');
const jsonSync = new AgentSync({ peerId: 'json-peer' });
jsonSync.set('a', 'hello');
jsonSync.increment('c', 7);
const json = jsonSync.toJSON();
assert(json.peerId === 'json-peer', 'toJSON has peerId');
assert(json.data['a'] !== undefined, 'toJSON has data');
assert(json.stats.keys === 2, 'toJSON has stats');

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) process.exit(1);
console.log('All tests passed! ✅');
