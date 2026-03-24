#!/usr/bin/env node
// agent-fsm — Zero-dependency finite state machine engine for AI agents
// Features: typed transitions, guards, actions, hooks, history, parallel FSMs, persistence, events

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ─── Helpers ────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function now() { return Date.now(); }

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── State Machine Class ───────────────────────────────────────────
export class FSM extends EventEmitter {
  #config;
  #currentState;
  #context;
  #history;
  #transitions;
  #guards;
  #onEnter;
  #onExit;
  #onTransition;
  #initialState;
  #finalStates;
  #id;
  #name;
  #started;
  #transitionCount;
  #stateEnteredAt;
  #persistencePath;
  #autoPersist;

  constructor(config = {}) {
    super();
    this.#id = config.id || uid();
    this.#name = config.name || 'unnamed';
    this.#initialState = config.initial || config.initialState || null;
    this.#finalStates = new Set(config.finalStates || config.final || []);
    this.#context = structuredClone(config.context || {});
    this.#history = [];
    this.#transitions = new Map();
    this.#guards = new Map();
    this.#onEnter = new Map();
    this.#onExit = new Map();
    this.#onTransition = new Map();
    this.#currentState = null;
    this.#started = false;
    this.#transitionCount = 0;
    this.#stateEnteredAt = null;
    this.#persistencePath = config.persistencePath || null;
    this.#autoPersist = config.autoPersist || false;

    // Register transitions from config
    if (config.transitions) {
      for (const t of config.transitions) {
        this.addTransition(t);
      }
    }

    // Register guards from config
    if (config.guards) {
      for (const [key, fn] of Object.entries(config.guards)) {
        this.addGuard(key, fn);
      }
    }

    // Register hooks from config
    if (config.onEnter) {
      for (const [state, fn] of Object.entries(config.onEnter)) {
        this.onEnter(state, fn);
      }
    }
    if (config.onExit) {
      for (const [state, fn] of Object.entries(config.onExit)) {
        this.onExit(state, fn);
      }
    }

    // Load persisted state
    if (this.#persistencePath && existsSync(this.#persistencePath)) {
      this.#loadPersisted();
    }
  }

  // ── Identity ──
  get id() { return this.#id; }
  get name() { return this.#name; }
  get state() { return this.#currentState; }
  get context() { return this.#context; }
  get started() { return this.#started; }
  get done() { return this.#finalStates.has(this.#currentState); }
  get transitionCount() { return this.#transitionCount; }
  get history() { return [...this.#history]; }
  get stateTime() { return this.#stateEnteredAt ? now() - this.#stateEnteredAt : 0; }

  // ── Configuration ──
  addTransition(config) {
    const key = `${config.from}:${config.event}`;
    this.#transitions.set(key, {
      from: config.from,
      to: config.to,
      event: config.event,
      guard: config.guard || null,
      action: config.action || null,
      description: config.description || '',
    });
    return this;
  }

  addGuard(name, fn) {
    this.#guards.set(name, fn);
    return this;
  }

  onEnter(state, fn) {
    if (!this.#onEnter.has(state)) this.#onEnter.set(state, []);
    this.#onEnter.get(state).push(fn);
    return this;
  }

  onExit(state, fn) {
    if (!this.#onExit.has(state)) this.#onExit.set(state, []);
    this.#onExit.get(state).push(fn);
    return this;
  }

  onState(state, fn) {
    if (!this.#onTransition.has(state)) this.#onTransition.set(state, []);
    this.#onTransition.get(state).push(fn);
    return this;
  }

  // ── Lifecycle ──
  start(initialState) {
    const state = initialState || this.#initialState;
    if (!state) throw new Error('No initial state specified');
    if (this.#started) throw new Error('FSM already started');

    this.#currentState = state;
    this.#started = true;
    this.#stateEnteredAt = now();
    this.#runEnterHooks(state, null, { type: '__start__' });
    this.emit('start', { state });
    this.#maybePersist();
    return this;
  }

  stop() {
    if (!this.#started) return this;
    const prev = this.#currentState;
    this.#started = false;
    this.emit('stop', { state: prev });
    return this;
  }

  reset(newState) {
    const state = newState || this.#initialState;
    this.#currentState = state;
    this.#started = true;
    this.#history = [];
    this.#transitionCount = 0;
    this.#stateEnteredAt = now();
    this.#runEnterHooks(state, null, { type: '__reset__' });
    this.emit('reset', { state });
    this.#maybePersist();
    return this;
  }

  // ── Transitions ──
  send(event, payload = {}) {
    if (!this.#started) throw new Error('FSM not started');
    if (this.#finalStates.has(this.#currentState)) {
      this.emit('rejected', { event, state: this.#currentState, reason: 'final_state' });
      return { ok: false, reason: 'final_state', state: this.#currentState };
    }

    const key = `${this.#currentState}:${event}`;
    const wildcardKey = `*:${event}`;
    const transition = this.#transitions.get(key) || this.#transitions.get(wildcardKey);

    if (!transition) {
      this.emit('rejected', { event, state: this.#currentState, reason: 'no_transition' });
      return { ok: false, reason: 'no_transition', state: this.#currentState };
    }

    // Check guard
    if (transition.guard) {
      const guardFn = this.#guards.get(transition.guard);
      if (!guardFn) {
        this.emit('rejected', { event, state: this.#currentState, reason: `guard_not_found:${transition.guard}` });
        return { ok: false, reason: `guard_not_found:${transition.guard}`, state: this.#currentState };
      }
      const ctx = { event, from: this.#currentState, to: transition.to, context: this.#context, payload };
      if (!guardFn(ctx)) {
        this.emit('guarded', { event, state: this.#currentState, guard: transition.guard });
        return { ok: false, reason: `guard_denied:${transition.guard}`, state: this.#currentState, guard: transition.guard };
      }
    }

    const from = this.#currentState;
    const to = transition.to;

    // Run exit hooks
    this.#runExitHooks(from, to, { type: event, payload });

    // Run transition action
    if (transition.action) {
      const actionCtx = { event, from, to, context: this.#context, payload };
      const actionFn = typeof transition.action === 'function' ? transition.action : this.#guards.get(transition.action);
      if (actionFn) actionFn(actionCtx);
    }

    // Record history
    const entry = {
      from,
      to,
      event,
      timestamp: now(),
      duration: this.stateTime,
      payload,
    };
    this.#history.push(entry);

    // Transition
    this.#currentState = to;
    this.#transitionCount++;
    this.#stateEnteredAt = now();

    // Run enter hooks
    this.#runEnterHooks(to, from, { type: event, payload });

    this.emit('transition', entry);
    this.#maybePersist();

    if (this.#finalStates.has(to)) {
      this.emit('done', { state: to, context: this.#context });
    }

    return { ok: true, from, to, event, entry };
  }

  // ── Context ──
  set(key, value) {
    this.#context[key] = value;
    this.emit('context', { key, value });
    return this;
  }

  get(key) {
    return this.#context[key];
  }

  update(fn) {
    fn(this.#context);
    this.emit('context_update', { context: this.#context });
    return this;
  }

  merge(obj) {
    Object.assign(this.#context, obj);
    return this;
  }

  // ── Queries ──
  can(event) {
    if (!this.#started) return false;
    const key = `${this.#currentState}:${event}`;
    const wildcardKey = `*:${event}`;
    const t = this.#transitions.get(key) || this.#transitions.get(wildcardKey);
    if (!t) return false;
    if (t.guard) {
      const guardFn = this.#guards.get(t.guard);
      if (!guardFn) return false;
      return guardFn({ event, from: this.#currentState, to: t.to, context: this.#context });
    }
    return true;
  }

  availableEvents() {
    if (!this.#started) return [];
    const events = new Set();
    for (const [key, t] of this.#transitions) {
      const [from, event] = key.split(':');
      if (from === this.#currentState || from === '*') {
        if (!t.guard || this.can(event)) events.add(event);
      }
    }
    return [...events];
  }

  possibleTransitions() {
    const result = [];
    for (const [key, t] of this.#transitions) {
      const [from, event] = key.split(':');
      if (from === this.#currentState || from === '*') {
        result.push({ from: from === '*' ? '*' : this.#currentState, event, to: t.to, guard: t.guard });
      }
    }
    return result;
  }

  getStates() {
    const states = new Set();
    for (const [, t] of this.#transitions) {
      if (t.from !== '*') states.add(t.from);
      states.add(t.to);
    }
    return [...states];
  }

  getTransitionTable() {
    const table = [];
    for (const [, t] of this.#transitions) {
      table.push({ from: t.from, event: t.event, to: t.to, guard: t.guard, action: t.action ? 'yes' : '', description: t.description });
    }
    return table;
  }

  // ── Visualization ──
  toMermaid() {
    const lines = ['stateDiagram-v2'];
    const states = new Set();
    for (const [, t] of this.#transitions) {
      if (t.from !== '*') states.add(t.from);
      states.add(t.to);
      const fromLabel = t.from === '*' ? '[*]' : t.from;
      const toLabel = this.#finalStates.has(t.to) ? t.to : t.to;
      const guardLabel = t.guard ? ` [${t.guard}]` : '';
      lines.push(`    ${fromLabel} --> ${t.to}: ${t.event}${guardLabel}`);
    }
    if (this.#initialState) {
      lines.push(`    [*] --> ${this.#initialState}`);
    }
    for (const s of this.#finalStates) {
      lines.push(`    ${s} --> [*]`);
    }
    return lines.join('\n');
  }

  toDot() {
    const lines = ['digraph FSM {', '  rankdir=LR;', '  node [shape=circle];'];
    if (this.#finalStates.size > 0) {
      lines.push('  node [shape=doublecircle]; ' + [...this.#finalStates].join('; ') + ';');
    }
    lines.push('  node [shape=circle];');
    if (this.#initialState) {
      lines.push(`  __start__ [label="" shape=point];`);
      lines.push(`  __start__ -> "${this.#initialState}";`);
    }
    for (const [, t] of this.#transitions) {
      const label = t.guard ? `${t.event}\\n[${t.guard}]` : t.event;
      lines.push(`  "${t.from}" -> "${t.to}" [label="${label}"];`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  // ── Serialization ──
  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      currentState: this.#currentState,
      context: { ...this.#context },
      started: this.#started,
      transitionCount: this.#transitionCount,
      history: this.#history.slice(-100),
      stateTime: this.stateTime,
    };
  }

  snapshot() {
    return JSON.stringify(this.toJSON());
  }

  // ── Persistence ──
  save(path) {
    const p = path || this.#persistencePath;
    if (!p) throw new Error('No persistence path');
    ensureDir(p);
    writeFileSync(p, JSON.stringify(this.toJSON(), null, 2));
    return this;
  }

  #maybePersist() {
    if (this.#autoPersist && this.#persistencePath) {
      this.save();
    }
  }

  #loadPersisted() {
    try {
      const data = JSON.parse(readFileSync(this.#persistencePath, 'utf8'));
      if (data.currentState) {
        this.#currentState = data.currentState;
        this.#context = data.context || {};
        this.#started = data.started || false;
        this.#transitionCount = data.transitionCount || 0;
        this.#history = data.history || [];
        this.#stateEnteredAt = now();
      }
    } catch { /* ignore corrupt files */ }
  }

  // ── Internal ──
  #runEnterHooks(state, from, event) {
    const hooks = this.#onEnter.get(state) || [];
    const ctx = { state, from, event, context: this.#context };
    for (const fn of hooks) fn(ctx);
    const stateHooks = this.#onTransition.get(state) || [];
    for (const fn of stateHooks) fn({ ...ctx, type: 'enter' });
  }

  #runExitHooks(state, to, event) {
    const hooks = this.#onExit.get(state) || [];
    const ctx = { state, to, event, context: this.#context };
    for (const fn of hooks) fn(ctx);
  }
}

// ─── FSM Registry (multi-FSM manager) ──────────────────────────────
export class FSMRegistry extends EventEmitter {
  #machines = new Map();

  create(config) {
    const fsm = new FSM(config);
    this.#machines.set(fsm.id, fsm);
    fsm.on('transition', (e) => this.emit('transition', { fsmId: fsm.id, ...e }));
    fsm.on('done', (e) => this.emit('done', { fsmId: fsm.id, ...e }));
    return fsm;
  }

  get(id) { return this.#machines.get(id); }

  remove(id) {
    const fsm = this.#machines.get(id);
    if (fsm) { fsm.stop(); this.#machines.delete(id); }
    return !!fsm;
  }

  list() {
    return [...this.#machines.values()].map(f => ({
      id: f.id, name: f.name, state: f.state, done: f.done,
      transitions: f.transitionCount,
    }));
  }

  stats() {
    const all = [...this.#machines.values()];
    return {
      total: all.length,
      active: all.filter(f => f.started && !f.done).length,
      done: all.filter(f => f.done).length,
      totalTransitions: all.reduce((s, f) => s + f.transitionCount, 0),
    };
  }

  broadcast(event, payload) {
    const results = [];
    for (const [, fsm] of this.#machines) {
      if (fsm.started && !fsm.done) {
        results.push({ id: fsm.id, result: fsm.send(event, payload) });
      }
    }
    return results;
  }

  toJSON() { return this.list(); }
}

// ─── Parallel FSM ──────────────────────────────────────────────────
export class ParallelFSM extends EventEmitter {
  #machines = [];
  #syncEvents = new Map();

  constructor(configs = []) {
    super();
    for (const c of configs) {
      const fsm = new FSM(c);
      fsm.on('transition', (e) => this.emit('transition', { fsmId: fsm.id, ...e }));
      this.#machines.push(fsm);
    }
  }

  get machines() { return [...this.#machines]; }
  get states() { return this.#machines.map(f => ({ id: f.id, name: f.name, state: f.state })); }
  get done() { return this.#machines.every(f => f.done); }

  start() {
    for (const fsm of this.#machines) {
      if (!fsm.started) fsm.start();
    }
    this.emit('start', this.states);
    return this;
  }

  send(event, payload) {
    const results = [];
    for (const fsm of this.#machines) {
      if (fsm.started && !fsm.done && fsm.can(event)) {
        results.push({ id: fsm.id, result: fsm.send(event, payload) });
      }
    }
    this.emit('broadcast', { event, results });
    return results;
  }

  // Sync: require all machines to reach a specific set of states
  sync(label, statesMap) {
    this.#syncEvents.set(label, statesMap);
    return this;
  }

  checkSync(label) {
    const statesMap = this.#syncEvents.get(label);
    if (!statesMap) return false;
    for (const [fsmId, expectedState] of Object.entries(statesMap)) {
      const fsm = this.#machines.find(f => f.id === fsmId || f.name === fsmId);
      if (!fsm || fsm.state !== expectedState) return false;
    }
    this.emit('sync', { label, states: statesMap });
    return true;
  }

  toJSON() {
    return {
      machines: this.#machines.map(f => f.toJSON()),
      done: this.done,
    };
  }
}

// ─── Presets ────────────────────────────────────────────────────────
export const presets = {
  orderLifecycle: {
    name: 'Order Lifecycle',
    initial: 'pending',
    finalStates: ['delivered', 'cancelled', 'refunded'],
    transitions: [
      { from: 'pending', event: 'confirm', to: 'confirmed', description: 'Order confirmed' },
      { from: 'confirmed', event: 'pay', to: 'paid', description: 'Payment received' },
      { from: 'confirmed', event: 'cancel', to: 'cancelled', description: 'Cancelled before payment' },
      { from: 'paid', event: 'ship', to: 'shipped', description: 'Order shipped' },
      { from: 'paid', event: 'refund', to: 'refunded', description: 'Refund issued' },
      { from: 'shipped', event: 'deliver', to: 'delivered', description: 'Order delivered' },
      { from: 'shipped', event: 'return', to: 'refunded', description: 'Returned and refunded' },
    ],
  },
  conversation: {
    name: 'Conversation Flow',
    initial: 'greeting',
    finalStates: ['ended'],
    transitions: [
      { from: 'greeting', event: 'ask', to: 'collecting_info', description: 'User asks question' },
      { from: 'greeting', event: 'end', to: 'ended', description: 'User says goodbye' },
      { from: 'collecting_info', event: 'provide', to: 'processing', description: 'Info provided' },
      { from: 'collecting_info', event: 'clarify', to: 'clarifying', description: 'Need clarification' },
      { from: 'collecting_info', event: 'end', to: 'ended', description: 'User leaves' },
      { from: 'clarifying', event: 'provide', to: 'processing', description: 'Clarification given' },
      { from: 'clarifying', event: 'end', to: 'ended', description: 'User leaves' },
      { from: 'processing', event: 'complete', to: 'responding', description: 'Processing done' },
      { from: 'processing', event: 'error', to: 'error', description: 'Processing error' },
      { from: 'responding', event: 'followup', to: 'collecting_info', description: 'Follow-up question' },
      { from: 'responding', event: 'satisfied', to: 'ended', description: 'User satisfied' },
      { from: 'responding', event: 'retry', to: 'processing', description: 'Retry processing' },
      { from: 'error', event: 'retry', to: 'processing', description: 'Retry after error' },
      { from: 'error', event: 'end', to: 'ended', description: 'Give up' },
    ],
  },
  taskLifecycle: {
    name: 'Task Lifecycle',
    initial: 'created',
    finalStates: ['completed', 'failed'],
    transitions: [
      { from: 'created', event: 'assign', to: 'assigned', description: 'Task assigned' },
      { from: 'assigned', event: 'start', to: 'in_progress', description: 'Work started' },
      { from: 'assigned', event: 'unassign', to: 'created', description: 'Unassigned' },
      { from: 'in_progress', event: 'pause', to: 'paused', description: 'Work paused' },
      { from: 'in_progress', event: 'complete', to: 'review', description: 'Work completed, pending review' },
      { from: 'in_progress', event: 'fail', to: 'failed', description: 'Task failed' },
      { from: 'paused', event: 'resume', to: 'in_progress', description: 'Work resumed' },
      { from: 'paused', event: 'cancel', to: 'cancelled', description: 'Task cancelled' },
      { from: 'review', event: 'approve', to: 'completed', description: 'Approved' },
      { from: 'review', event: 'reject', to: 'in_progress', description: 'Rejected, back to work' },
      { from: 'cancelled', event: 'reopen', to: 'created', description: 'Reopen cancelled task' },
      { from: 'failed', event: 'retry', to: 'created', description: 'Retry failed task' },
    ],
  },
  connection: {
    name: 'Connection Lifecycle',
    initial: 'disconnected',
    finalStates: [],
    transitions: [
      { from: 'disconnected', event: 'connect', to: 'connecting' },
      { from: 'connecting', event: 'success', to: 'connected' },
      { from: 'connecting', event: 'timeout', to: 'reconnecting' },
      { from: 'connecting', event: 'error', to: 'failed' },
      { from: 'connected', event: 'disconnect', to: 'disconnected' },
      { from: 'connected', event: 'error', to: 'reconnecting' },
      { from: 'connected', event: 'idle', to: 'idle' },
      { from: 'idle', event: 'activity', to: 'connected' },
      { from: 'idle', event: 'timeout', to: 'disconnected' },
      { from: 'reconnecting', event: 'success', to: 'connected' },
      { from: 'reconnecting', event: 'fail', to: 'reconnecting' },
      { from: 'reconnecting', event: 'max_retries', to: 'failed' },
      { from: 'failed', event: 'retry', to: 'connecting' },
      { from: 'failed', event: 'reset', to: 'disconnected' },
    ],
  },
  approval: {
    name: 'Approval Workflow',
    initial: 'draft',
    finalStates: ['approved', 'rejected'],
    transitions: [
      { from: 'draft', event: 'submit', to: 'pending_review' },
      { from: 'pending_review', event: 'approve', to: 'approved' },
      { from: 'pending_review', event: 'reject', to: 'rejected' },
      { from: 'pending_review', event: 'request_changes', to: 'changes_requested' },
      { from: 'pending_review', event: 'escalate', to: 'escalated' },
      { from: 'changes_requested', event: 'resubmit', to: 'pending_review' },
      { from: 'changes_requested', event: 'abandon', to: 'rejected' },
      { from: 'escalated', event: 'approve', to: 'approved' },
      { from: 'escalated', event: 'reject', to: 'rejected' },
    ],
  },
};

// ─── Exports ────────────────────────────────────────────────────────
export default { FSM, FSMRegistry, ParallelFSM, presets };
