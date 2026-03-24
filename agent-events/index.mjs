#!/usr/bin/env node
/**
 * agent-events v1.0 — Zero-dep event sourcing & saga engine for AI agents
 * 
 * Features:
 * - Event store with append-only log, stream-based access
 * - Snapshots for fast aggregate rebuild
 * - Projections/materialized views from event streams
 * - Sagas (choreography + orchestration) for multi-step agent workflows
 * - Event versioning & upcasting
 * - Temporal queries (state at time T)
 * - CQRS read model support
 * - JSONL persistence
 * - EventEmitter for real-time reactions
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

// ── Helpers ──────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function now() { return Date.now(); }
function ensureDir(dir) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

// ── Event Store ──────────────────────────────────────────────────────
export class EventStore extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dir = opts.dir || '.agent-events';
    this.maxEvents = opts.maxEvents || 0; // 0 = unlimited
    this.streams = new Map(); // streamId -> [{event}]
    this.snapshots = new Map(); // aggregateId -> {version, state, ts}
    this.subscriptions = new Map(); // pattern -> [{handler, id}]
    this.globalSeq = 0;
    this._persist = opts.persist !== false;
    this._persistDir = join(this.dir, 'events');
    this._snapDir = join(this.dir, 'snapshots');
    if (this._persist) {
      ensureDir(this._persistDir);
      ensureDir(this._snapDir);
      this._load();
    }
  }

  // ── Append ──
  append(streamId, eventType, payload, meta = {}) {
    const stream = this._getStream(streamId);
    const version = stream.length;
    const event = {
      id: uid(),
      streamId,
      type: eventType,
      version,
      seq: ++this.globalSeq,
      timestamp: now(),
      payload: structuredClone(payload),
      meta: { correlationId: meta.correlationId || null, causationId: meta.causationId || null, actor: meta.actor || null, ...meta }
    };
    stream.push(event);
    if (this.maxEvents > 0 && stream.length > this.maxEvents) {
      stream.splice(0, stream.length - this.maxEvents);
    }
    if (this._persist) this._persistEvent(event);
    this._matchSubscriptions(event);
    this.emit('event', event);
    this.emit(`event:${eventType}`, event);
    this.emit(`stream:${streamId}`, event);
    return event;
  }

  // ── Read ──
  getStream(streamId, fromVersion = 0, toVersion = Infinity) {
    const stream = this._getStream(streamId);
    return stream.filter(e => e.version >= fromVersion && e.version <= toVersion);
  }

  getAllEvents(fromSeq = 0) {
    const all = [];
    for (const stream of this.streams.values()) {
      for (const e of stream) {
        if (e.seq >= fromSeq) all.push(e);
      }
    }
    return all.sort((a, b) => a.seq - b.seq);
  }

  getByType(eventType, fromSeq = 0) {
    return this.getAllEvents(fromSeq).filter(e => e.type === eventType);
  }

  getByCorrelation(correlationId) {
    return this.getAllEvents().filter(e => e.meta.correlationId === correlationId);
  }

  // ── Temporal Query ──
  getStateAt(streamId, timestamp) {
    const stream = this._getStream(streamId);
    return stream.filter(e => e.timestamp <= timestamp);
  }

  getAggregateState(aggregateId, reducer, initialState = {}) {
    // Check snapshot
    let state = initialState;
    let fromVersion = 0;
    const snap = this.snapshots.get(aggregateId);
    if (snap) {
      state = structuredClone(snap.state);
      fromVersion = snap.version + 1;
    }
    const events = this.getStream(aggregateId, fromVersion);
    for (const event of events) {
      state = reducer(state, event);
    }
    return state;
  }

  // ── Snapshots ──
  saveSnapshot(aggregateId, state, version) {
    const snap = { aggregateId, state: structuredClone(state), version, ts: now() };
    this.snapshots.set(aggregateId, snap);
    if (this._persist) {
      writeFileSync(join(this._snapDir, `${aggregateId}.json`), JSON.stringify(snap));
    }
    this.emit('snapshot', snap);
    return snap;
  }

  getSnapshot(aggregateId) {
    return this.snapshots.get(aggregateId) || null;
  }

  // ── Subscriptions (pattern matching) ──
  subscribe(pattern, handler) {
    const id = uid();
    if (!this.subscriptions.has(pattern)) this.subscriptions.set(pattern, []);
    this.subscriptions.get(pattern).push({ handler, id });
    return id;
  }

  unsubscribe(subscriptionId) {
    for (const [pattern, subs] of this.subscriptions) {
      const idx = subs.findIndex(s => s.id === subscriptionId);
      if (idx !== -1) { subs.splice(idx, 1); return true; }
    }
    return false;
  }

  _matchSubscriptions(event) {
    for (const [pattern, subs] of this.subscriptions) {
      if (this._matchPattern(pattern, event.type)) {
        for (const { handler } of subs) {
          try { handler(event); } catch (e) { this.emit('error', e); }
        }
      }
    }
  }

  _matchPattern(pattern, type) {
    if (pattern === '*') return true;
    if (pattern === type) return true;
    if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
    return false;
  }

  // ── Stream Management ──
  _getStream(streamId) {
    if (!this.streams.has(streamId)) this.streams.set(streamId, []);
    return this.streams.get(streamId);
  }

  listStreams() {
    return Array.from(this.streams.keys());
  }

  deleteStream(streamId) {
    this.streams.delete(streamId);
    if (this._persist) {
      // Clear persisted events for stream
      const file = join(this._persistDir, `${streamId}.jsonl`);
      if (existsSync(file)) {
        writeFileSync(file, '');
      }
    }
  }

  // ── Persistence ──
  _persistEvent(event) {
    const file = join(this._persistDir, `${event.streamId}.jsonl`);
    appendFileSync(file, JSON.stringify(event) + '\n');
  }

  _load() {
    if (!existsSync(this._persistDir)) return;
    for (const file of readdirSync(this._persistDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const streamId = file.replace('.jsonl', '');
      const content = readFileSync(join(this._persistDir, file), 'utf8').trim();
      if (!content) continue;
      const events = [];
      for (const line of content.split('\n')) {
        try {
          const e = JSON.parse(line);
          events.push(e);
          if (e.seq > this.globalSeq) this.globalSeq = e.seq;
        } catch {}
      }
      this.streams.set(streamId, events);
    }
    // Load snapshots
    if (existsSync(this._snapDir)) {
      for (const file of readdirSync(this._snapDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const snap = JSON.parse(readFileSync(join(this._snapDir, file), 'utf8'));
          this.snapshots.set(snap.aggregateId, snap);
        } catch {}
      }
    }
  }

  // ── Stats ──
  stats() {
    let total = 0;
    const byType = {};
    for (const stream of this.streams.values()) {
      total += stream.length;
      for (const e of stream) {
        byType[e.type] = (byType[e.type] || 0) + 1;
      }
    }
    return { streams: this.streams.size, totalEvents: total, snapshots: this.snapshots.size, subscriptions: [...this.subscriptions.values()].reduce((s, a) => s + a.length, 0), byType };
  }
}

// ── Projection Engine ────────────────────────────────────────────────
export class ProjectionEngine extends EventEmitter {
  constructor(eventStore, opts = {}) {
    super();
    this.store = eventStore;
    this.projections = new Map(); // name -> {handler, state, init, active}
    this.dir = opts.dir || join(eventStore.dir, 'projections');
    this._persist = opts.persist !== false;
    if (this._persist) ensureDir(this.dir);
  }

  define(name, initialState, handlers, opts = {}) {
    // handlers = { "eventType": (state, event) => newState }
    let state = structuredClone(initialState);
    // Load persisted state
    if (this._persist) {
      const file = join(this.dir, `${name}.json`);
      if (existsSync(file)) {
        try { state = JSON.parse(readFileSync(file, 'utf8')); } catch {}
      }
    }
    const projection = { name, state, handlers, initialState, active: true, processedSeq: opts.fromSeq || 0 };
    this.projections.set(name, projection);

    // Subscribe to store events
    this._subId = this.store.on('event', (event) => {
      if (!projection.active) return;
      if (event.seq <= projection.processedSeq) return;
      const handler = handlers[event.type] || handlers['*'];
      if (handler) {
        try {
          projection.state = handler(projection.state, event);
          projection.processedSeq = event.seq;
          if (this._persist) this._save(name);
          this.emit('update', { name, event, state: projection.state });
        } catch (e) {
          this.emit('error', { name, event, error: e });
        }
      }
    });
    return this;
  }

  getState(name) {
    const p = this.projections.get(name);
    return p ? p.state : null;
  }

  reset(name) {
    const p = this.projections.get(name);
    if (p) {
      p.state = structuredClone(p.initialState);
      p.processedSeq = 0;
      if (this._persist) this._save(name);
    }
  }

  list() {
    return Array.from(this.projections.entries()).map(([name, p]) => ({
      name, active: p.active, processedSeq: p.processedSeq
    }));
  }

  _save(name) {
    const p = this.projections.get(name);
    if (p) writeFileSync(join(this.dir, `${name}.json`), JSON.stringify(p.state));
  }
}

// ── Saga Engine ──────────────────────────────────────────────────────
export class SagaEngine extends EventEmitter {
  constructor(eventStore, opts = {}) {
    super();
    this.store = eventStore;
    this.sagas = new Map(); // name -> definition
    this.instances = new Map(); // sagaId -> state
    this.dir = opts.dir || join(eventStore.dir, 'sagas');
    this._persist = opts.persist !== false;
    if (this._persist) ensureDir(this.dir);
    this._loadInstances();
  }

  // Define a saga with steps
  define(name, definition) {
    // definition: { steps: [{id, action, compensate?, onSuccess?, onFailure?}], initialState, timeout? }
    this.sagas.set(name, { ...definition, name });
    return this;
  }

  // Start a saga instance
  async start(name, data = {}, opts = {}) {
    const sagaDef = this.sagas.get(name);
    if (!sagaDef) throw new Error(`Saga '${name}' not defined`);

    const sagaId = opts.sagaId || uid();
    const instance = {
      id: sagaId, sagaName: name, data: structuredClone(data),
      currentStep: 0, status: 'running', completedSteps: [],
      results: {}, errors: [], startedAt: now(), updatedAt: now()
    };
    this.instances.set(sagaId, instance);
    this._persistInstance(instance);
    this.emit('saga:start', instance);

    // Emit saga started event
    this.store.append(opts.streamId || `saga:${sagaId}`, 'saga.started', { sagaId, sagaName: name, data });

    await this._executeStep(instance, sagaDef);
    return instance;
  }

  async _executeStep(instance, sagaDef) {
    if (instance.currentStep >= sagaDef.steps.length) {
      instance.status = 'completed';
      instance.updatedAt = now();
      this._persistInstance(instance);
      this.emit('saga:complete', instance);
      this.store.append(`saga:${instance.id}`, 'saga.completed', { sagaId: instance.id, results: instance.results });
      return;
    }

    const step = sagaDef.steps[instance.currentStep];
    instance.updatedAt = now();

    try {
      this.emit('saga:step', { instance, step });
      this.store.append(`saga:${instance.id}`, 'saga.step.started', { sagaId: instance.id, stepId: step.id, stepIndex: instance.currentStep });

      // Execute step action
      const result = await step.action(instance.data, instance.results);
      instance.results[step.id] = result;
      instance.completedSteps.push({ id: step.id, status: 'success', result, ts: now() });

      this.store.append(`saga:${instance.id}`, 'saga.step.completed', { sagaId: instance.id, stepId: step.id, result });
      this._persistInstance(instance);

      // Next step
      instance.currentStep++;
      await this._executeStep(instance, sagaDef);
    } catch (error) {
      instance.errors.push({ stepId: step.id, error: error.message, ts: now() });
      this.store.append(`saga:${instance.id}`, 'saga.step.failed', { sagaId: instance.id, stepId: step.id, error: error.message });

      // Compensate completed steps (backward)
      if (step.compensate) {
        try { await step.compensate(instance.data, instance.results, error); } catch {}
      }
      for (let i = instance.completedSteps.length - 1; i >= 0; i--) {
        const cs = instance.completedSteps[i];
        const compStep = sagaDef.steps.find(s => s.id === cs.id);
        if (compStep?.compensate) {
          try { await compStep.compensate(instance.data, instance.results, error); } catch {}
          this.store.append(`saga:${instance.id}`, 'saga.step.compensated', { sagaId: instance.id, stepId: cs.id });
        }
      }

      instance.status = 'failed';
      instance.updatedAt = now();
      this._persistInstance(instance);
      this.emit('saga:failed', { instance, error });
      this.store.append(`saga:${instance.id}`, 'saga.failed', { sagaId: instance.id, error: error.message });
    }
  }

  getInstance(sagaId) { return this.instances.get(sagaId) || null; }

  listInstances(status) {
    const all = Array.from(this.instances.values());
    return status ? all.filter(i => i.status === status) : all;
  }

  _persistInstance(instance) {
    if (!this._persist) return;
    writeFileSync(join(this.dir, `${instance.id}.json`), JSON.stringify(instance, null, 2));
  }

  _loadInstances() {
    if (!this._persist || !existsSync(this.dir)) return;
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const inst = JSON.parse(readFileSync(join(this.dir, file), 'utf8'));
        this.instances.set(inst.id, inst);
      } catch {}
    }
  }

  stats() {
    const instances = Array.from(this.instances.values());
    return {
      defined: this.sagas.size,
      totalInstances: instances.length,
      running: instances.filter(i => i.status === 'running').length,
      completed: instances.filter(i => i.status === 'completed').length,
      failed: instances.filter(i => i.status === 'failed').length
    };
  }
}

// ── Event Upcaster (versioning) ─────────────────────────────────────
export class EventUpcaster {
  constructor() {
    this.upcasters = new Map(); // "type:v1->v2" -> fn
  }

  register(eventType, fromVersion, toVersion, fn) {
    const key = `${eventType}:v${fromVersion}->v${toVersion}`;
    this.upcasters.set(key, fn);
    return this;
  }

  upcast(event) {
    const schemaVersion = event.meta?.schemaVersion || 1;
    const targetVersion = event.meta?.targetVersion || schemaVersion;
    if (schemaVersion >= targetVersion) return event;

    let current = structuredClone(event);
    for (let v = schemaVersion; v < targetVersion; v++) {
      const key = `${event.type}:v${v}->v${v + 1}`;
      const fn = this.upcasters.get(key);
      if (!fn) throw new Error(`No upcaster for ${key}`);
      current = fn(current);
      current.meta = { ...current.meta, schemaVersion: v + 1 };
    }
    return current;
  }
}

// ── CQRS Read Model ─────────────────────────────────────────────────
export class ReadModel extends EventEmitter {
  constructor(eventStore, name, handlers, initialState = {}) {
    super();
    this.store = eventStore;
    this.name = name;
    this.state = structuredClone(initialState);
    this.handlers = handlers;
    this.processedSeq = 0;
    this.store.on('event', (event) => {
      if (event.seq <= this.processedSeq) return;
      const handler = handlers[event.type] || handlers['*'];
      if (handler) {
        this.state = handler(this.state, event);
        this.processedSeq = event.seq;
        this.emit('update', { event, state: this.state });
      }
    });
  }

  query(fn) { return fn(this.state); }
  getState() { return this.state; }
}

// ── Aggregate Root Pattern ───────────────────────────────────────────
export class AggregateRoot extends EventEmitter {
  constructor(id, eventStore) {
    super();
    this.id = id;
    this.store = eventStore;
    this.state = {};
    this.version = 0;
    this._pending = [];
  }

  // Apply event to state (in-memory only)
  apply(eventType, payload, meta = {}) {
    const event = this.store.append(this.id, eventType, payload, { ...meta, causationId: this._pending[this._pending.length - 1]?.id });
    this._pending.push(event);
    this._reduce(event);
    return event;
  }

  // Load from store
  load(reducer) {
    const events = this.store.getStream(this.id);
    for (const event of events) {
      this.state = reducer(this.state, event);
      this.version = event.version + 1;
    }
    return this;
  }

  // Save snapshot
  saveSnapshot() {
    this.store.saveSnapshot(this.id, this.state, this.version);
  }

  _reduce(event) {
    this.emit('event', event);
    this.version = event.version + 1;
  }
}

// ── Exports ──────────────────────────────────────────────────────────
export default { EventStore, ProjectionEngine, SagaEngine, EventUpcaster, ReadModel, AggregateRoot };
