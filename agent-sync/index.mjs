/**
 * agent-sync — Zero-dependency distributed data sync & replication engine
 *
 * Features:
 * - CRDT data types: LWW-Register, G-Counter, PN-Counter, OR-Set, LWW-Map
 * - Delta-based sync (only transmit changes since last sync)
 * - 5 conflict resolution strategies (lww, fww, custom, merge, manual)
 * - Peer-to-peer replication with vector clocks
 * - Sync log with full audit trail
 * - Namespace isolation for multi-tenant sync
 * - JSONL persistence + periodic snapshots
 * - EventEmitter for real-time sync events
 * - Snapshot/restore for state transfer
 */

import { EventEmitter } from 'events';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ─── Utility helpers ───────────────────────────────────────────────────────

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function now() { return Date.now(); }

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const out = {};
  for (const k in obj) out[k] = deepClone(obj[k]);
  return out;
}

// ─── Vector Clock ──────────────────────────────────────────────────────────

class VectorClock {
  constructor(peerId = 'local') {
    this.peerId = peerId;
    this.clock = {};
  }

  tick() {
    this.clock[this.peerId] = (this.clock[this.peerId] || 0) + 1;
    return { ...this.clock };
  }

  merge(other) {
    const keys = new Set([...Object.keys(this.clock), ...Object.keys(other)]);
    for (const k of keys) {
      this.clock[k] = Math.max(this.clock[k] || 0, other[k] || 0);
    }
    return { ...this.clock };
  }

  compare(a, b) {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let aGreater = false, bGreater = false;
    for (const k of allKeys) {
      const av = a[k] || 0, bv = b[k] || 0;
      if (av > bv) aGreater = true;
      if (bv > av) bGreater = true;
    }
    if (aGreater && !bGreater) return 1;
    if (bGreater && !aGreater) return -1;
    if (aGreater && bGreater) return 0; // concurrent
    return 2; // equal
  }

  toJSON() { return { ...this.clock }; }

  static fromJSON(obj) {
    const vc = new VectorClock();
    vc.clock = { ...obj };
    return vc;
  }
}

// ─── CRDT: LWW-Register (Last-Write-Wins) ─────────────────────────────────

class LWWRegister {
  constructor(peerId = 'local') {
    this.value = null;
    this.timestamp = 0;
    this.peerId = peerId;
    this.sourcePeer = peerId;
  }

  set(val, ts) {
    const t = ts || now();
    if (t >= this.timestamp) {
      this.value = val;
      this.timestamp = t;
      this.sourcePeer = this.peerId;
    }
    return this;
  }

  get() { return this.value; }

  merge(other) {
    if (other.timestamp > this.timestamp ||
        (other.timestamp === this.timestamp && other.sourcePeer > this.sourcePeer)) {
      this.value = other.value;
      this.timestamp = other.timestamp;
      this.sourcePeer = other.sourcePeer;
    }
    return this;
  }

  toJSON() {
    return { type: 'lww-register', value: this.value, timestamp: this.timestamp, peer: this.sourcePeer };
  }

  static fromJSON(json, peerId) {
    const reg = new LWWRegister(peerId || json.peer);
    reg.value = json.value;
    reg.timestamp = json.timestamp;
    reg.sourcePeer = json.peer;
    return reg;
  }
}

// ─── CRDT: G-Counter (Grow-only) ──────────────────────────────────────────

class GCounter {
  constructor(peerId = 'local') {
    this.peerId = peerId;
    this.counts = {};
  }

  increment(amount = 1) {
    this.counts[this.peerId] = (this.counts[this.peerId] || 0) + amount;
    return this;
  }

  value() {
    let total = 0;
    for (const k in this.counts) total += this.counts[k];
    return total;
  }

  merge(other) {
    const keys = new Set([...Object.keys(this.counts), ...Object.keys(other.counts)]);
    for (const k of keys) {
      this.counts[k] = Math.max(this.counts[k] || 0, other.counts[k] || 0);
    }
    return this;
  }

  toJSON() {
    return { type: 'g-counter', counts: { ...this.counts } };
  }

  static fromJSON(json, peerId) {
    const c = new GCounter(peerId || 'local');
    c.counts = { ...json.counts };
    return c;
  }
}

// ─── CRDT: PN-Counter (Positive-Negative) ─────────────────────────────────

class PNCounter {
  constructor(peerId = 'local') {
    this.positive = new GCounter(peerId);
    this.negative = new GCounter(peerId);
  }

  increment(amount = 1) {
    if (amount >= 0) this.positive.increment(amount);
    else this.negative.increment(-amount);
    return this;
  }

  decrement(amount = 1) {
    this.negative.increment(amount);
    return this;
  }

  value() {
    return this.positive.value() - this.negative.value();
  }

  merge(other) {
    this.positive.merge(other.positive);
    this.negative.merge(other.negative);
    return this;
  }

  toJSON() {
    return { type: 'pn-counter', positive: this.positive.toJSON(), negative: this.negative.toJSON() };
  }

  static fromJSON(json, peerId) {
    const c = new PNCounter(peerId || 'local');
    c.positive = GCounter.fromJSON(json.positive, peerId);
    c.negative = GCounter.fromJSON(json.negative, peerId);
    return c;
  }
}

// ─── CRDT: OR-Set (Observed-Remove) ───────────────────────────────────────

class ORSet {
  constructor(peerId = 'local') {
    this.peerId = peerId;
    this.elements = new Map(); // value -> Set<tag>
    this.tombstones = new Map(); // value -> Set<tag>
  }

  add(value) {
    const tag = uid();
    if (!this.elements.has(value)) this.elements.set(value, new Set());
    this.elements.get(value).add(tag);
    return { value, tag };
  }

  remove(value) {
    if (!this.elements.has(value)) return false;
    const tags = this.elements.get(value);
    if (!this.tombstones.has(value)) this.tombstones.set(value, new Set());
    for (const t of tags) this.tombstones.get(value).add(t);
    return true;
  }

  has(value) {
    if (!this.elements.has(value)) return false;
    const live = this.elements.get(value);
    const dead = this.tombstones.get(value) || new Set();
    for (const t of live) { if (!dead.has(t)) return true; }
    return false;
  }

  values() {
    const result = [];
    for (const [val] of this.elements) {
      if (this.has(val)) result.push(val);
    }
    return result;
  }

  size() { return this.values().length; }

  merge(other) {
    for (const [val, tags] of other.elements) {
      if (!this.elements.has(val)) this.elements.set(val, new Set());
      for (const t of tags) this.elements.get(val).add(t);
    }
    for (const [val, tags] of other.tombstones) {
      if (!this.tombstones.has(val)) this.tombstones.set(val, new Set());
      for (const t of tags) this.tombstones.get(val).add(t);
    }
    return this;
  }

  toJSON() {
    const elems = {};
    for (const [v, tags] of this.elements) elems[v] = [...tags];
    const tombs = {};
    for (const [v, tags] of this.tombstones) tombs[v] = [...tags];
    return { type: 'or-set', elements: elems, tombstones: tombs };
  }

  static fromJSON(json) {
    const s = new ORSet();
    for (const [v, tags] of Object.entries(json.elements)) s.elements.set(v, new Set(tags));
    for (const [v, tags] of Object.entries(json.tombstones)) s.tombstones.set(v, new Set(tags));
    return s;
  }
}

// ─── CRDT: LWW-Map ────────────────────────────────────────────────────────

class LWWMap {
  constructor(peerId = 'local') {
    this.peerId = peerId;
    this.entries = new Map(); // key -> { value, timestamp, peer }
  }

  set(key, value, ts) {
    const t = ts || now();
    const existing = this.entries.get(key);
    if (!existing || t > existing.timestamp ||
        (t === existing.timestamp && this.peerId > existing.peer)) {
      this.entries.set(key, { value, timestamp: t, peer: this.peerId });
    }
    return this;
  }

  get(key) {
    const e = this.entries.get(key);
    return e ? e.value : undefined;
  }

  has(key) { return this.entries.has(key); }

  delete(key) {
    this.set(key, undefined, now());
    return this;
  }

  keys() {
    const result = [];
    for (const [k, v] of this.entries) {
      if (v.value !== undefined) result.push(k);
    }
    return result;
  }

  values() {
    const result = [];
    for (const [, v] of this.entries) {
      if (v.value !== undefined) result.push(v.value);
    }
    return result;
  }

  entriesObj() {
    const out = {};
    for (const [k, v] of this.entries) {
      if (v.value !== undefined) out[k] = v.value;
    }
    return out;
  }

  size() { return this.keys().length; }

  merge(other) {
    for (const [key, entry] of other.entries) {
      const existing = this.entries.get(key);
      if (!existing || entry.timestamp > existing.timestamp ||
          (entry.timestamp === existing.timestamp && entry.peer > existing.peer)) {
        this.entries.set(key, { ...entry });
      }
    }
    return this;
  }

  toJSON() {
    const entries = {};
    for (const [k, v] of this.entries) entries[k] = { ...v };
    return { type: 'lww-map', entries };
  }

  static fromJSON(json, peerId) {
    const m = new LWWMap(peerId || 'local');
    for (const [k, v] of Object.entries(json.entries)) m.entries.set(k, { ...v });
    return m;
  }
}

// ─── Conflict Resolution Strategies ────────────────────────────────────────

const strategies = {
  lww: (local, remote) => {
    if (remote.timestamp > local.timestamp) return remote;
    if (local.timestamp > remote.timestamp) return local;
    return remote.peer > local.peer ? remote : local;
  },
  fww: (local, remote) => {
    if (local.timestamp < remote.timestamp) return local;
    return remote.timestamp < local.timestamp ? remote : local;
  },
  merge: (local, remote) => {
    if (typeof local.value === 'object' && typeof remote.value === 'object' &&
        !Array.isArray(local.value) && !Array.isArray(remote.value)) {
      return { ...local, value: { ...remote.value, ...local.value } };
    }
    return strategies.lww(local, remote);
  },
  custom: null, // set via options
  manual: (local, remote) => {
    return { _conflict: true, local, remote, resolved: false };
  }
};

// ─── Sync Log Entry ───────────────────────────────────────────────────────

class SyncLogEntry {
  constructor(op, key, value, peer, clock, ts) {
    this.id = uid();
    this.op = op; // set, delete, merge, sync
    this.key = key;
    this.value = value;
    this.peer = peer;
    this.clock = clock;
    this.timestamp = ts || now();
  }

  toJSON() {
    return {
      id: this.id, op: this.op, key: this.key, value: this.value,
      peer: this.peer, clock: this.clock, timestamp: this.timestamp
    };
  }
}

// ─── AgentSync Engine ─────────────────────────────────────────────────────

class AgentSync extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.peerId = opts.peerId || 'peer-' + uid();
    this.namespace = opts.namespace || 'default';
    this.strategy = opts.strategy || 'lww';
    this.customResolver = opts.customResolver || null;
    this.persistPath = opts.persistPath || null;
    this.snapshotInterval = opts.snapshotInterval || 100;
    this.maxLogEntries = opts.maxLogEntries || 10000;

    this.clock = new VectorClock(this.peerId);
    this.store = new Map(); // key -> { type, crdt, meta }
    this.log = []; // sync log entries
    this.peers = new Map(); // peerId -> { lastSync, clock }
    this.pendingDeltas = new Map(); // peerId -> delta[]
    this.conflicts = []; // unresolved conflicts
    this._opCount = 0;
    this._stats = { sets: 0, deletes: 0, merges: 0, syncs: 0, conflicts: 0 };

    if (this.persistPath && existsSync(this.persistPath)) {
      this._load();
    }
  }

  // ── Core operations ───────────────────────────────────────────────────

  set(key, value, opts = {}) {
    const type = opts.type || 'lww';
    const ts = opts.timestamp || now();
    const clock = this.clock.tick();

    let entry = this.store.get(key);
    if (!entry || entry.type !== type) {
      entry = { type, crdt: this._createCRDT(type), meta: { created: ts, namespace: opts.namespace || this.namespace } };
      this.store.set(key, entry);
    }

    switch (type) {
      case 'lww':
        entry.crdt.set(value, ts);
        break;
      case 'g-counter':
        entry.crdt.increment(opts.increment || 1);
        break;
      case 'pn-counter':
        if (opts.decrement) entry.crdt.decrement(opts.decrement);
        else entry.crdt.increment(opts.increment || 1);
        break;
      case 'or-set':
        entry.crdt.add(value);
        break;
      case 'lww-map':
        entry.crdt.set(opts.mapKey || '_value', value, ts);
        break;
    }

    entry.meta.updated = ts;
    entry.meta.clock = clock;

    this._log('set', key, value, clock, ts);
    this._stats.sets++;
    this._opCount++;
    this._maybePersist();

    this.emit('change', { op: 'set', key, value, type, timestamp: ts });
    this.emit('set', { key, value, type, timestamp: ts });
    return this;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    return this._getValue(entry);
  }

  getEntry(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      type: entry.type,
      value: this._getValue(entry),
      meta: deepClone(entry.meta),
      crdt: entry.crdt.toJSON()
    };
  }

  has(key) { return this.store.has(key); }

  delete(key) {
    if (!this.store.has(key)) return false;
    const clock = this.clock.tick();
    this.store.delete(key);
    this._log('delete', key, null, clock);
    this._stats.deletes++;
    this._opCount++;
    this._maybePersist();
    this.emit('change', { op: 'delete', key });
    this.emit('delete', { key });
    return true;
  }

  keys(ns) {
    const result = [];
    for (const [k, e] of this.store) {
      if (!ns || e.meta.namespace === ns) result.push(k);
    }
    return result;
  }

  entries(ns) {
    const result = {};
    for (const [k, e] of this.store) {
      if (!ns || e.meta.namespace === ns) result[k] = this._getValue(e);
    }
    return result;
  }

  size(ns) {
    if (!ns) return this.store.size;
    let count = 0;
    for (const [, e] of this.store) {
      if (e.meta.namespace === ns) count++;
    }
    return count;
  }

  increment(key, amount = 1) {
    return this.set(key, null, { type: 'g-counter', increment: amount });
  }

  decrement(key, amount = 1) {
    return this.set(key, null, { type: 'pn-counter', decrement: amount });
  }

  addToSet(key, value) {
    return this.set(key, value, { type: 'or-set' });
  }

  removeFromSet(key, value) {
    const entry = this.store.get(key);
    if (entry && entry.type === 'or-set') {
      entry.crdt.remove(value);
      this._log('set', key, value, this.clock.tick());
      this._maybePersist();
      this.emit('change', { op: 'set-remove', key, value });
    }
    return this;
  }

  setInMap(key, mapKey, value) {
    return this.set(key, value, { type: 'lww-map', mapKey });
  }

  getFromMap(key, mapKey) {
    const entry = this.store.get(key);
    if (entry && entry.type === 'lww-map') return entry.crdt.get(mapKey);
    return undefined;
  }

  // ── Sync & Replication ────────────────────────────────────────────────

  createSnapshot() {
    const data = {};
    for (const [key, entry] of this.store) {
      data[key] = { type: entry.type, crdt: entry.crdt.toJSON(), meta: deepClone(entry.meta) };
    }
    return {
      peerId: this.peerId,
      namespace: this.namespace,
      clock: this.clock.toJSON(),
      data,
      timestamp: now()
    };
  }

  loadSnapshot(snapshot) {
    if (snapshot.peerId !== this.peerId) {
      // Merge remote snapshot
      for (const [key, remoteEntry] of Object.entries(snapshot.data)) {
        const localEntry = this.store.get(key);
        if (!localEntry) {
          const crdt = this._deserializeCRDT(remoteEntry.type, remoteEntry.crdt);
          this.store.set(key, { type: remoteEntry.type, crdt, meta: remoteEntry.meta });
        } else if (localEntry.type === remoteEntry.type) {
          const remoteCRDT = this._deserializeCRDT(remoteEntry.type, remoteEntry.crdt);
          localEntry.crdt.merge(remoteCRDT);
        }
      }
      this.clock.merge(snapshot.clock);
      this._stats.merges++;
      this._maybePersist();
      this.emit('snapshot-loaded', { from: snapshot.peerId, keys: Object.keys(snapshot.data).length });
    }
    return this;
  }

  getDelta(peerId) {
    const peer = this.peers.get(peerId);
    const since = peer ? peer.lastSync : 0;
    const deltas = [];

    for (const entry of this.log) {
      if (entry.timestamp > since) {
        deltas.push(entry.toJSON());
      }
    }

    return {
      from: this.peerId,
      to: peerId,
      since,
      clock: this.clock.toJSON(),
      deltas,
      timestamp: now()
    };
  }

  applyDelta(delta) {
    let applied = 0;
    for (const d of delta.deltas) {
      if (d.op === 'set') {
        const existing = this.store.get(d.key);
        if (!existing) {
          // New key from remote — create with appropriate type
          const type = (d.value !== null && typeof d.value === 'number') ? 'lww' : 'lww';
          const crdt = this._createCRDT('lww');
          crdt.set(d.value, d.timestamp);
          this.store.set(d.key, { type: 'lww', crdt, meta: { created: d.timestamp, namespace: this.namespace, updated: d.timestamp } });
        } else if (existing.type === 'lww') {
          const remote = new LWWRegister(d.peer || this.peerId);
          remote.set(d.value, d.timestamp);
          existing.crdt.merge(remote);
        } else if (existing.type === 'g-counter') {
          existing.crdt.merge(GCounter.fromJSON({ counts: { [d.peer]: d.value || 0 } }));
        } else if (existing.type === 'pn-counter') {
          existing.crdt.merge(PNCounter.fromJSON({ positive: { counts: {} }, negative: { counts: {} } }));
        }
      } else if (d.op === 'delete') {
        this.store.delete(d.key);
      }
      applied++;
    }

    this.clock.merge(delta.clock);
    this.peers.set(delta.from, { lastSync: delta.timestamp, clock: delta.clock });
    this._stats.syncs++;
    this._stats.merges += applied;
    this._maybePersist();

    this.emit('delta-applied', { from: delta.from, entries: applied });
    this.emit('sync', { from: delta.from, entries: applied });
    return { applied };
  }

  sync(remoteSnapshot) {
    // Full bidirectional merge
    const conflicts = [];

    for (const [key, remoteData] of Object.entries(remoteSnapshot.data || {})) {
      const localEntry = this.store.get(key);
      if (!localEntry) {
        // New from remote
        const crdt = this._deserializeCRDT(remoteData.type, remoteData.crdt);
        this.store.set(key, { type: remoteData.type, crdt, meta: remoteData.meta });
      } else if (localEntry.type === remoteData.type) {
        // Same type — merge CRDTs
        const remoteCRDT = this._deserializeCRDT(remoteData.type, remoteData.crdt);
        localEntry.crdt.merge(remoteCRDT);
      } else {
        // Type conflict — resolve by strategy
        conflicts.push({ key, local: localEntry, remote: remoteData });
        this._stats.conflicts++;
      }
    }

    if (remoteSnapshot.clock) this.clock.merge(remoteSnapshot.clock);
    if (remoteSnapshot.peerId) {
      this.peers.set(remoteSnapshot.peerId, { lastSync: now(), clock: remoteSnapshot.clock });
    }

    this._log('sync', '*', null, this.clock.tick());
    this._stats.syncs++;
    this._maybePersist();

    if (conflicts.length > 0) {
      this.conflicts.push(...conflicts);
      this.emit('conflicts', conflicts);
    }

    this.emit('synced', { from: remoteSnapshot.peerId, conflicts: conflicts.length });
    return { synced: true, conflicts: conflicts.length };
  }

  resolveConflict(key, resolution) {
    const idx = this.conflicts.findIndex(c => c.key === key);
    if (idx === -1) return false;
    const conflict = this.conflicts.splice(idx, 1)[0];

    if (resolution === 'keep-local') return true;
    if (resolution === 'keep-remote') {
      const crdt = this._deserializeCRDT(conflict.remote.type, conflict.remote.crdt);
      this.store.set(key, { type: conflict.remote.type, crdt, meta: conflict.remote.meta });
    }
    this.emit('conflict-resolved', { key, resolution });
    return true;
  }

  // ── Peer Management ───────────────────────────────────────────────────

  registerPeer(peerId, clock) {
    this.peers.set(peerId, { lastSync: 0, clock: clock || {} });
    this.emit('peer-registered', { peerId });
    return this;
  }

  unregisterPeer(peerId) {
    this.peers.delete(peerId);
    this.pendingDeltas.delete(peerId);
    this.emit('peer-unregistered', { peerId });
    return this;
  }

  listPeers() {
    const result = [];
    for (const [id, info] of this.peers) {
      result.push({ peerId: id, lastSync: info.lastSync, clock: info.clock });
    }
    return result;
  }

  // ── Query ─────────────────────────────────────────────────────────────

  stats() {
    return {
      peerId: this.peerId,
      namespace: this.namespace,
      keys: this.store.size,
      peers: this.peers.size,
      logEntries: this.log.length,
      conflicts: this.conflicts.length,
      clock: this.clock.toJSON(),
      ...this._stats
    };
  }

  getLog(since, limit) {
    let entries = this.log;
    if (since) entries = entries.filter(e => e.timestamp > since);
    if (limit) entries = entries.slice(-limit);
    return entries.map(e => e.toJSON());
  }

  getConflicts() {
    return this.conflicts.map(c => ({
      key: c.key,
      localType: c.local.type,
      localValue: this._getValue(c.local),
      remoteType: c.remote.type,
      remoteValue: c.remote.crdt ? c.remote.crdt.value : c.remote.value
    }));
  }

  clear() {
    this.store.clear();
    this.log = [];
    this.conflicts = [];
    this._stats = { sets: 0, deletes: 0, merges: 0, syncs: 0, conflicts: 0 };
    this.clock = new VectorClock(this.peerId);
    this._maybePersist();
    this.emit('clear');
    return this;
  }

  toJSON() {
    const data = {};
    for (const [k, e] of this.store) data[k] = { type: e.type, crdt: e.crdt.toJSON(), meta: e.meta };
    return {
      peerId: this.peerId,
      namespace: this.namespace,
      clock: this.clock.toJSON(),
      data,
      peers: this.listPeers(),
      stats: this.stats()
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────

  _createCRDT(type) {
    switch (type) {
      case 'lww': return new LWWRegister(this.peerId);
      case 'g-counter': return new GCounter(this.peerId);
      case 'pn-counter': return new PNCounter(this.peerId);
      case 'or-set': return new ORSet(this.peerId);
      case 'lww-map': return new LWWMap(this.peerId);
      default: throw new Error(`Unknown CRDT type: ${type}`);
    }
  }

  _deserializeCRDT(type, json) {
    switch (type) {
      case 'lww': return LWWRegister.fromJSON(json, this.peerId);
      case 'g-counter': return GCounter.fromJSON(json, this.peerId);
      case 'pn-counter': return PNCounter.fromJSON(json, this.peerId);
      case 'or-set': return ORSet.fromJSON(json);
      case 'lww-map': return LWWMap.fromJSON(json, this.peerId);
      default: throw new Error(`Unknown CRDT type: ${type}`);
    }
  }

  _getValue(entry) {
    switch (entry.type) {
      case 'lww': return entry.crdt.get();
      case 'g-counter': return entry.crdt.value();
      case 'pn-counter': return entry.crdt.value();
      case 'or-set': return entry.crdt.values();
      case 'lww-map': return entry.crdt.entriesObj();
      default: return null;
    }
  }

  _log(op, key, value, clock, ts) {
    const entry = new SyncLogEntry(op, key, value, this.peerId, clock ? { ...clock } : {}, ts);
    this.log.push(entry);
    if (this.log.length > this.maxLogEntries) {
      this.log = this.log.slice(-Math.floor(this.maxLogEntries * 0.8));
    }
  }

  _maybePersist() {
    if (!this.persistPath) return;
    this._opCount++;
    if (this._opCount % this.snapshotInterval === 0) {
      this._save();
    }
  }

  _save() {
    if (!this.persistPath) return;
    ensureDir(this.persistPath);
    const snap = this.createSnapshot();
    writeFileSync(this.persistPath, JSON.stringify(snap, null, 2));

    // Also append to JSONL log
    const logPath = this.persistPath.replace(/\.json$/, '') + '.log.jsonl';
    for (let i = Math.max(0, this.log.length - this.snapshotInterval); i < this.log.length; i++) {
      appendFileSync(logPath, JSON.stringify(this.log[i].toJSON()) + '\n');
    }
  }

  _load() {
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8'));
      this.clock = VectorClock.fromJSON(raw.clock || {});
      for (const [key, data] of Object.entries(raw.data || {})) {
        const crdt = this._deserializeCRDT(data.type, data.crdt);
        this.store.set(key, { type: data.type, crdt, meta: data.meta });
      }
      if (raw.peers) {
        for (const p of raw.peers) this.peers.set(p.peerId, { lastSync: p.lastSync, clock: p.clock });
      }
    } catch { /* ignore corrupt files */ }
  }

  save() { this._save(); }
}

// ─── Exports ───────────────────────────────────────────────────────────────

export {
  AgentSync,
  VectorClock,
  LWWRegister,
  GCounter,
  PNCounter,
  ORSet,
  LWWMap,
  SyncLogEntry,
  strategies
};
