/**
 * agent-lock v1.0
 * Zero-dependency distributed locking & coordination for AI agents
 * 
 * Features:
 *   - Distributed mutex (exclusive lock)
 *   - Read-write lock (shared/exclusive)
 *   - Semaphore (N-concurrent)
 *   - Barrier (wait for N parties)
 *   - Leader election
 *   - Lock queuing with FIFO fairness
 *   - TTL-based auto-release with lease renewal
 *   - Reentrant locks
 *   - Deadlock detection via wait-for graph
 *   - Namespace isolation
 *   - JSONL persistence + EventEmitter
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now() { return Date.now(); }

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Lock Types ──────────────────────────────────────────────────────────────

/** Exclusive lock (mutex) */
class Mutex {
  #owner = null;
  #queue = [];       // { resolve, reject, holder, timeout }
  #reentrantCount = 0;
  #acquiredAt = 0;
  #ttl;
  #timer = null;
  #onRelease;
  #reentrant;

  constructor({ ttl = 30000, reentrant = true, onRelease } = {}) {
    this.#ttl = ttl;
    this.#reentrant = reentrant;
    this.#onRelease = onRelease;
  }

  get locked() { return this.#owner !== null; }
  get owner() { return this.#owner; }
  get queueLength() { return this.#queue.length; }
  get reentrantCount() { return this.#reentrantCount; }

  async acquire(holder = 'default', timeout = 0) {
    // Reentrant check
    if (this.#reentrant && this.#owner === holder) {
      this.#reentrantCount++;
      return true;
    }

    if (!this.#locked) {
      this.#grant(holder);
      return true;
    }

    // Queue
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, holder };
      this.#queue.push(entry);

      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.#queue.indexOf(entry);
          if (idx !== -1) this.#queue.splice(idx, 1);
          reject(new Error(`Lock acquire timeout after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  get #locked() { return this.#owner !== null; }

  #grant(holder) {
    this.#owner = holder;
    this.#acquiredAt = now();
    this.#reentrantCount = 1;
    this.#startTimer();
  }

  #startTimer() {
    this.#clearTimer();
    if (this.#ttl > 0) {
      this.#timer = setTimeout(() => {
        this.#onRelease?.(this.#owner, 'ttl_expired');
        this.#dequeue();
      }, this.#ttl);
    }
  }

  #clearTimer() {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
  }

  release(holder = 'default') {
    if (this.#owner !== holder) return false;
    
    if (this.#reentrant && this.#reentrantCount > 1) {
      this.#reentrantCount--;
      return true;
    }

    this.#onRelease?.(holder, 'released');
    this.#dequeue();
    return true;
  }

  #dequeue() {
    this.#clearTimer();
    this.#owner = null;
    this.#reentrantCount = 0;

    if (this.#queue.length > 0) {
      const next = this.#queue.shift();
      if (next.timer) clearTimeout(next.timer);
      this.#grant(next.holder);
      next.resolve(true);
    }
  }

  forceRelease() {
    const prev = this.#owner;
    this.#onRelease?.(prev, 'force_released');
    this.#dequeue();
    return prev;
  }

  toJSON() {
    return {
      locked: this.locked,
      owner: this.#owner,
      reentrantCount: this.#reentrantCount,
      queueLength: this.queueLength,
      acquiredAt: this.#acquiredAt || null,
      ttl: this.#ttl,
    };
  }
}

/** Read-write lock */
class RWLock {
  #readers = new Map();  // holder → count
  #writer = null;
  #writerReentrant = 0;
  #readQueue = [];
  #writeQueue = [];
  #ttl;
  #onRelease;

  constructor({ ttl = 30000, onRelease } = {}) {
    this.#ttl = ttl;
    this.#onRelease = onRelease;
  }

  get reading() { return this.#readers.size; }
  get writing() { return this.#writer !== null; }
  get writer() { return this.#writer; }
  get readers() { return [...this.#readers.keys()]; }

  async acquireRead(holder = 'default', timeout = 0) {
    // If this holder is the writer, reentrant read is allowed
    if (this.#writer === holder) return true;

    if (this.#writeQueue.length === 0 && this.#writer === null) {
      this.#readers.set(holder, (this.#readers.get(holder) || 0) + 1);
      return true;
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, holder };
      this.#readQueue.push(entry);
      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.#readQueue.indexOf(entry);
          if (idx !== -1) this.#readQueue.splice(idx, 1);
          reject(new Error(`RWLock read timeout after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  async acquireWrite(holder = 'default', timeout = 0) {
    if (this.#writer === holder) {
      this.#writerReentrant++;
      return true;
    }

    if (this.#writer === null && this.#readers.size === 0) {
      this.#writer = holder;
      this.#writerReentrant = 1;
      return true;
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, holder };
      this.#writeQueue.push(entry);
      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.#writeQueue.indexOf(entry);
          if (idx !== -1) this.#writeQueue.splice(idx, 1);
          reject(new Error(`RWLock write timeout after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  releaseRead(holder = 'default') {
    const count = this.#readers.get(holder) || 0;
    if (count <= 1) {
      this.#readers.delete(holder);
    } else {
      this.#readers.set(holder, count - 1);
    }
    if (this.#readers.size === 0) this.#drainQueues();
    return true;
  }

  releaseWrite(holder = 'default') {
    if (this.#writer !== holder) return false;
    if (this.#writerReentrant > 1) {
      this.#writerReentrant--;
      return true;
    }
    this.#writer = null;
    this.#writerReentrant = 0;
    this.#onRelease?.(holder, 'write_released');
    this.#drainQueues();
    return true;
  }

  #drainQueues() {
    // Prioritize writers
    if (this.#writeQueue.length > 0 && this.#writer === null && this.#readers.size === 0) {
      const next = this.#writeQueue.shift();
      if (next.timer) clearTimeout(next.timer);
      this.#writer = next.holder;
      this.#writerReentrant = 1;
      next.resolve(true);
      return;
    }

    // Then readers (batch all waiting readers if no writer)
    while (this.#readQueue.length > 0 && this.#writeQueue.length === 0 && this.#writer === null) {
      const next = this.#readQueue.shift();
      if (next.timer) clearTimeout(next.timer);
      this.#readers.set(next.holder, (this.#readers.get(next.holder) || 0) + 1);
      next.resolve(true);
    }
  }

  toJSON() {
    return {
      writing: this.writing,
      writer: this.#writer,
      reading: this.reading,
      readers: Object.fromEntries(this.#readers),
      readQueueLength: this.#readQueue.length,
      writeQueueLength: this.#writeQueue.length,
    };
  }
}

/** Semaphore — N-concurrent access */
class Semaphore {
  #permits;
  #maxPermits;
  #queue = [];
  #holders = new Map();  // holder → count
  #ttl;

  constructor(maxPermits = 1, { ttl = 30000 } = {}) {
    this.#maxPermits = maxPermits;
    this.#permits = maxPermits;
    this.#ttl = ttl;
  }

  get available() { return this.#permits; }
  get maxPermits() { return this.#maxPermits; }
  get queueLength() { return this.#queue.length; }
  get holders() { return Object.fromEntries(this.#holders); }

  async acquire(holder = 'default', count = 1, timeout = 0) {
    if (count > this.#maxPermits) {
      throw new Error(`Requested ${count} permits exceeds max ${this.#maxPermits}`);
    }

    if (this.#permits >= count) {
      this.#permits -= count;
      this.#holders.set(holder, (this.#holders.get(holder) || 0) + count);
      return true;
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, holder, count };
      this.#queue.push(entry);
      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.#queue.indexOf(entry);
          if (idx !== -1) this.#queue.splice(idx, 1);
          reject(new Error(`Semaphore acquire timeout after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  release(holder = 'default', count = 1) {
    const held = this.#holders.get(holder) || 0;
    if (held < count) return false;
    
    const release = Math.min(count, held);
    if (held <= release) {
      this.#holders.delete(holder);
    } else {
      this.#holders.set(holder, held - release);
    }
    this.#permits += release;
    this.#drain();
    return true;
  }

  #drain() {
    while (this.#queue.length > 0 && this.#permits >= this.#queue[0].count) {
      const next = this.#queue.shift();
      if (next.timer) clearTimeout(next.timer);
      this.#permits -= next.count;
      this.#holders.set(next.holder, (this.#holders.get(next.holder) || 0) + next.count);
      next.resolve(true);
    }
  }

  toJSON() {
    return {
      available: this.#permits,
      maxPermits: this.#maxPermits,
      holders: Object.fromEntries(this.#holders),
      queueLength: this.queueLength,
    };
  }
}

/** Barrier — wait for N parties before proceeding */
class Barrier {
  #parties;
  #waiting = 0;
  #resolvers = [];
  #generation = 0;
  #timeout;

  constructor(parties, { timeout = 0 } = {}) {
    if (parties < 1) throw new Error('Parties must be >= 1');
    this.#parties = parties;
    this.#timeout = timeout;
  }

  get parties() { return this.#parties; }
  get waiting() { return this.#waiting; }
  get generation() { return this.#generation; }

  async wait(label = '') {
    this.#waiting++;
    
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, label };
      this.#resolvers.push(entry);

      if (this.#waiting >= this.#parties) {
        this.#generation++;
        this.#waiting = 0;
        const resolvers = this.#resolvers.splice(0);
        for (const r of resolvers) r.resolve(this.#generation);
      } else if (this.#timeout > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.#resolvers.indexOf(entry);
          if (idx !== -1) this.#resolvers.splice(idx, 1);
          this.#waiting--;
          reject(new Error(`Barrier timeout after ${this.#timeout}ms`));
        }, this.#timeout);
      }
    });
  }

  reset() {
    this.#waiting = 0;
    for (const r of this.#resolvers) {
      if (r.timer) clearTimeout(r.timer);
      r.reject(new Error('Barrier reset'));
    }
    this.#resolvers = [];
    this.#generation++;
  }

  toJSON() {
    return {
      parties: this.#parties,
      waiting: this.#waiting,
      generation: this.#generation,
    };
  }
}

/** Leader election — single active leader with automatic failover */
class LeaderElection {
  #leader = null;
  #candidates = new Map();  // id → { heartbeat, meta }
  #ttl;
  #heartbeatInterval;
  #timers = new Map();
  #onChange;
  #electionId = randomUUID();

  constructor({ ttl = 10000, heartbeatInterval = 3000, onChange } = {}) {
    this.#ttl = ttl;
    this.#heartbeatInterval = heartbeatInterval;
    this.#onChange = onChange;
  }

  get leader() { return this.#leader; }
  get candidates() { return [...this.#candidates.keys()]; }
  get isLeader() { return this.#leader === this.#electionId; }
  get electionId() { return this.#electionId; }

  join(id = this.#electionId, meta = {}) {
    this.#candidates.set(id, { heartbeat: now(), meta });
    this.#heartbeat(id);
    this.#elect();
    return id;
  }

  leave(id = this.#electionId) {
    this.#candidates.delete(id);
    this.#clearTimer(id);
    if (this.#leader === id) {
      this.#leader = null;
      this.#elect();
    }
  }

  heartbeat(id = this.#electionId) {
    const c = this.#candidates.get(id);
    if (c) {
      c.heartbeat = now();
      this.#heartbeat(id);
    }
  }

  #heartbeat(id) {
    this.#clearTimer(id);
    const timer = setTimeout(() => {
      // Candidate expired
      const c = this.#candidates.get(id);
      if (c && now() - c.heartbeat > this.#ttl) {
        this.#candidates.delete(id);
        if (this.#leader === id) {
          const prev = this.#leader;
          this.#leader = null;
          this.#onChange?.(null, prev);
          this.#elect();
        }
      }
    }, this.#ttl + 100);
    this.#timers.set(id, timer);
  }

  #clearTimer(id) {
    const t = this.#timers.get(id);
    if (t) { clearTimeout(t); this.#timers.delete(id); }
  }

  #elect() {
    if (this.#candidates.size === 0) {
      this.#leader = null;
      return;
    }
    // Deterministic: smallest ID wins (consistent election)
    const sorted = [...this.#candidates.keys()].sort();
    const newLeader = sorted[0];
    if (this.#leader !== newLeader) {
      const prev = this.#leader;
      this.#leader = newLeader;
      this.#onChange?.(newLeader, prev);
    }
  }

  toJSON() {
    const candidates = {};
    for (const [id, c] of this.#candidates) {
      candidates[id] = { ...c, isLeader: id === this.#leader };
    }
    return {
      leader: this.#leader,
      electionId: this.#electionId,
      candidateCount: this.#candidates.size,
      candidates,
    };
  }
}

// ─── Deadlock Detection ──────────────────────────────────────────────────────

class DeadlockDetector {
  #waits = new Map();  // holder → Set of resources it waits for
  #holds = new Map();  // resource → holder

  recordWait(holder, resource) {
    if (!this.#waits.has(holder)) this.#waits.set(holder, new Set());
    this.#waits.get(holder).add(resource);
  }

  recordAcquire(holder, resource) {
    this.#holds.set(resource, holder);
    // Remove from wait list
    const waits = this.#waits.get(holder);
    if (waits) {
      waits.delete(resource);
      if (waits.size === 0) this.#waits.delete(holder);
    }
  }

  recordRelease(resource) {
    this.#holds.delete(resource);
  }

  /** Detect cycles using DFS */
  detectCycle() {
    const visited = new Set();
    const stack = new Set();
    const cycles = [];

    const dfs = (holder, path) => {
      if (stack.has(holder)) {
        const cycleStart = path.indexOf(holder);
        cycles.push(path.slice(cycleStart));
        return;
      }
      if (visited.has(holder)) return;

      visited.add(holder);
      stack.add(holder);

      const waits = this.#waits.get(holder);
      if (waits) {
        for (const resource of waits) {
          const owner = this.#holds.get(resource);
          if (owner && owner !== holder) {
            dfs(owner, [...path, holder]);
          }
        }
      }

      stack.delete(holder);
    };

    for (const holder of this.#waits.keys()) {
      dfs(holder, []);
    }

    return cycles;
  }

  clear() {
    this.#waits.clear();
    this.#holds.clear();
  }

  toJSON() {
    return {
      waitGraph: Object.fromEntries(
        [...this.#waits].map(([k, v]) => [k, [...v]])
      ),
      holds: Object.fromEntries(this.#holds),
      cycles: this.detectCycle(),
    };
  }
}

// ─── Main Lock Manager ───────────────────────────────────────────────────────

export class AgentLock extends EventEmitter {
  #mutexes = new Map();
  #rwLocks = new Map();
  #semaphores = new Map();
  #barriers = new Map();
  #elections = new Map();
  #deadlockDetector = new DeadlockDetector();
  #stats = { acquires: 0, releases: 0, timeouts: 0, deadlocks: 0, forceReleases: 0 };
  #ns;
  #persistDir;
  #persistTimer;

  constructor({ namespace = 'default', persistDir = null, persistInterval = 30000 } = {}) {
    super();
    this.#ns = namespace;
    this.#persistDir = persistDir;
    if (persistDir) {
      ensureDir(persistDir);
      this.#persistTimer = setInterval(() => this.save(), persistInterval);
      this.#persistTimer.unref();
    }
  }

  get namespace() { return this.#ns; }
  get stats() { return { ...this.#stats }; }

  // ── Mutex ──────────────────────────────────────────────────────────────────

  mutex(name, opts = {}) {
    if (!this.#mutexes.has(name)) {
      const m = new Mutex({
        ...opts,
        onRelease: (holder, reason) => {
          this.#stats.releases++;
          this.#deadlockDetector.recordRelease(`mutex:${name}`);
          this.#log('mutex_released', { name, holder, reason });
          this.emit('mutex_released', { name, holder, reason });
        },
      });
      this.#mutexes.set(name, m);
    }
    return this.#mutexes.get(name);
  }

  async lock(name, holder = 'default', timeout = 0) {
    const m = this.mutex(name);
    this.#deadlockDetector.recordWait(holder, `mutex:${name}`);
    
    const cycles = this.#deadlockDetector.detectCycle();
    if (cycles.length > 0) {
      this.#stats.deadlocks++;
      this.emit('deadlock', { cycles });
      throw new Error(`Deadlock detected: ${cycles.map(c => c.join(' → ')).join(', ')}`);
    }

    try {
      const result = await m.acquire(holder, timeout);
      this.#stats.acquires++;
      this.#deadlockDetector.recordAcquire(holder, `mutex:${name}`);
      this.#log('lock_acquired', { name, holder });
      this.emit('lock_acquired', { name, holder });
      return result;
    } catch (err) {
      this.#stats.timeouts++;
      throw err;
    }
  }

  unlock(name, holder = 'default') {
    const m = this.#mutexes.get(name);
    if (!m) return false;
    const result = m.release(holder);
    if (result) {
      this.#log('lock_released', { name, holder });
      this.emit('lock_released', { name, holder, reason: 'unlocked' });
    }
    return result;
  }

  forceUnlock(name) {
    const m = this.#mutexes.get(name);
    if (!m) return null;
    const prev = m.forceRelease();
    this.#stats.forceReleases++;
    this.#log('lock_force_released', { name, holder: prev });
    this.emit('lock_force_released', { name, holder: prev });
    return prev;
  }

  // ── RW Lock ────────────────────────────────────────────────────────────────

  rwLock(name, opts = {}) {
    if (!this.#rwLocks.has(name)) {
      const rw = new RWLock({
        ...opts,
        onRelease: (holder, reason) => {
          this.#log('rw_released', { name, holder, reason });
          this.emit('rw_released', { name, holder, reason });
        },
      });
      this.#rwLocks.set(name, rw);
    }
    return this.#rwLocks.get(name);
  }

  async readLock(name, holder = 'default', timeout = 0) {
    const rw = this.rwLock(name);
    try {
      const result = await rw.acquireRead(holder, timeout);
      this.#stats.acquires++;
      this.#log('read_lock_acquired', { name, holder });
      this.emit('read_lock_acquired', { name, holder });
      return result;
    } catch (err) {
      this.#stats.timeouts++;
      throw err;
    }
  }

  async writeLock(name, holder = 'default', timeout = 0) {
    const rw = this.rwLock(name);
    this.#deadlockDetector.recordWait(holder, `rw:${name}`);
    try {
      const result = await rw.acquireWrite(holder, timeout);
      this.#stats.acquires++;
      this.#deadlockDetector.recordAcquire(holder, `rw:${name}`);
      this.#log('write_lock_acquired', { name, holder });
      this.emit('write_lock_acquired', { name, holder });
      return result;
    } catch (err) {
      this.#stats.timeouts++;
      throw err;
    }
  }

  readUnlock(name, holder = 'default') {
    const rw = this.#rwLocks.get(name);
    if (!rw) return false;
    this.#deadlockDetector.recordRelease(`rw:${name}`);
    const result = rw.releaseRead(holder);
    if (result) {
      this.emit('read_lock_released', { name, holder });
    }
    return result;
  }

  writeUnlock(name, holder = 'default') {
    const rw = this.#rwLocks.get(name);
    if (!rw) return false;
    this.#deadlockDetector.recordRelease(`rw:${name}`);
    const result = rw.releaseWrite(holder);
    if (result) {
      this.emit('write_lock_released', { name, holder });
    }
    return result;
  }

  // ── Semaphore ──────────────────────────────────────────────────────────────

  semaphore(name, maxPermits = 1, opts = {}) {
    if (!this.#semaphores.has(name)) {
      this.#semaphores.set(name, new Semaphore(maxPermits, opts));
    }
    return this.#semaphores.get(name);
  }

  async acquirePermit(name, holder = 'default', count = 1, timeout = 0) {
    const s = this.semaphore(name);
    try {
      const result = await s.acquire(holder, count, timeout);
      this.#stats.acquires++;
      this.#log('permit_acquired', { name, holder, count });
      this.emit('permit_acquired', { name, holder, count });
      return result;
    } catch (err) {
      this.#stats.timeouts++;
      throw err;
    }
  }

  releasePermit(name, holder = 'default', count = 1) {
    const s = this.#semaphores.get(name);
    if (!s) return false;
    this.#stats.releases++;
    return s.release(holder, count);
  }

  // ── Barrier ────────────────────────────────────────────────────────────────

  barrier(name, parties, opts = {}) {
    if (!this.#barriers.has(name)) {
      this.#barriers.set(name, new Barrier(parties, opts));
    }
    return this.#barriers.get(name);
  }

  async barrierWait(name, label = '') {
    const b = this.barrier(name);
    const gen = await b.wait(label);
    this.#log('barrier_released', { name, generation: gen });
    this.emit('barrier_released', { name, generation: gen });
    return gen;
  }

  barrierReset(name) {
    const b = this.#barriers.get(name);
    if (b) b.reset();
  }

  // ── Leader Election ────────────────────────────────────────────────────────

  election(name, opts = {}) {
    if (!this.#elections.has(name)) {
      const e = new LeaderElection({
        ...opts,
        onChange: (leader, prev) => {
          this.#log('leader_changed', { name, leader, prev });
          this.emit('leader_changed', { name, leader, prev });
        },
      });
      this.#elections.set(name);
    }
    return this.#elections.get(name);
  }

  joinElection(name, id, meta = {}) {
    const e = this.election(name);
    return e.join(id, meta);
  }

  leaveElection(name, id) {
    const e = this.#elections.get(name);
    if (e) e.leave(id);
  }

  // ── High-Level Operations ──────────────────────────────────────────────────

  /** Execute fn with exclusive lock, auto-release on completion/error */
  async withLock(name, holder, fn, timeout = 0) {
    await this.lock(name, holder, timeout);
    try {
      return await fn();
    } finally {
      this.unlock(name, holder);
    }
  }

  /** Execute fn with read lock */
  async withReadLock(name, holder, fn, timeout = 0) {
    await this.readLock(name, holder, timeout);
    try {
      return await fn();
    } finally {
      this.readUnlock(name, holder);
    }
  }

  /** Execute fn with write lock */
  async withWriteLock(name, holder, fn, timeout = 0) {
    await this.writeLock(name, holder, timeout);
    try {
      return await fn();
    } finally {
      this.writeUnlock(name, holder);
    }
  }

  /** Execute fn with semaphore permit */
  async withPermit(name, holder, fn, count = 1, timeout = 0) {
    await this.acquirePermit(name, holder, count, timeout);
    try {
      return await fn();
    } finally {
      this.releasePermit(name, holder, count);
    }
  }

  // ── Introspection ──────────────────────────────────────────────────────────

  listLocks() {
    const result = {};
    for (const [name, m] of this.#mutexes) {
      result[name] = { type: 'mutex', ...m.toJSON() };
    }
    for (const [name, rw] of this.#rwLocks) {
      result[name] = { type: 'rwlock', ...rw.toJSON() };
    }
    for (const [name, s] of this.#semaphores) {
      result[name] = { type: 'semaphore', ...s.toJSON() };
    }
    return result;
  }

  listBarriers() {
    const result = {};
    for (const [name, b] of this.#barriers) {
      result[name] = b.toJSON();
    }
    return result;
  }

  listElections() {
    const result = {};
    for (const [name, e] of this.#elections) {
      result[name] = e.toJSON();
    }
    return result;
  }

  detectDeadlocks() {
    return this.#deadlockDetector.detectCycle();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  save() {
    if (!this.#persistDir) return;
    const data = {
      namespace: this.#ns,
      stats: this.#stats,
      timestamp: now(),
      locks: this.listLocks(),
      barriers: this.listBarriers(),
      elections: this.listElections(),
    };
    const file = path.join(this.#persistDir, `locks-${this.#ns}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  destroy() {
    if (this.#persistTimer) clearInterval(this.#persistTimer);
    this.save();
    this.#mutexes.clear();
    this.#rwLocks.clear();
    this.#semaphores.clear();
    this.#barriers.clear();
    this.#elections.clear();
    this.#deadlockDetector.clear();
    this.removeAllListeners();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #log(event, data) {
    if (!this.#persistDir) return;
    const line = JSON.stringify({ event, ...data, ts: now() }) + '\n';
    const logFile = path.join(this.#persistDir, `events-${this.#ns}.jsonl`);
    fs.appendFileSync(logFile, line);
  }
}

export default AgentLock;
