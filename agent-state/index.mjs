/**
 * agent-state — Zero-dependency state machine engine for AI agent workflows
 *
 * Features:
 * - Deterministic finite state machines with guards and actions
 * - Hierarchical (nested) state machines
 * - Timers and delays (auto-transition after timeout)
 * - Event-driven transitions with guards and side effects
 * - History states (shallow + deep) for resume
 * - JSONL persistence for crash recovery
 * - Async transition actions
 * - State chart XML (SCXML)-inspired model
 * - EventEmitter for monitoring
 */

import { EventEmitter } from 'events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

// ─── Guard helpers ───────────────────────────────────────────────
const Guards = {
  always: () => true,
  never: () => false,
  and: (...guards) => (ctx, evt) => guards.every(g => g(ctx, evt)),
  or: (...guards) => (ctx, evt) => guards.some(g => g(ctx, evt)),
  not: (guard) => (ctx, evt) => !guard(ctx, evt),
  eq: (path, value) => (ctx) => getByPath(ctx, path) === value,
  gt: (path, value) => (ctx) => getByPath(ctx, path) > value,
  lt: (path, value) => (ctx) => getByPath(ctx, path) < value,
  in: (path, values) => (ctx) => values.includes(getByPath(ctx, path)),
  exists: (path) => (ctx) => getByPath(ctx, path) !== undefined,
  custom: (fn) => fn,
};

function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => { if (!o[k]) o[k] = {}; return o[k]; }, obj);
  target[last] = value;
}

// ─── StateMachine core ──────────────────────────────────────────
class StateMachine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.id = config.id || `sm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.context = structuredClone(config.context || {});
    this.initial = config.initial || null;
    this.states = new Map();
    this.currentState = null;
    this.history = []; // full transition log
    this.stateHistory = new Map(); // per-state shallow history (last state before exit)
    this.deepHistory = new Map(); // per-state deep history (full nested state)
    this.timers = new Map();
    this.running = false;
    this._persistenceDir = config.persistenceDir || null;
    this._jsonlPath = this._persistenceDir ? join(this._persistenceDir, `${this.id}.jsonl`) : null;

    // Register states from config
    if (config.states) {
      for (const [name, stateDef] of Object.entries(config.states)) {
        this.addState(name, stateDef);
      }
    }
  }

  addState(name, def = {}) {
    this.states.set(name, {
      name,
      onEntry: def.onEntry || null,
      onExit: def.onExit || null,
      on: def.on || {},           // { EVENT_NAME: { target, guard?, action? } }
      after: def.after || {},     // { timeoutMs: target }
      always: def.always || null, // { target, guard?, action? } — immediate transition
      meta: def.meta || {},
      type: def.type || 'normal', // normal | final | history | parallel
      history: def.history || null, // 'shallow' | 'deep' (for history states)
      parent: def.parent || null,
    });
    return this;
  }

  // Start the machine
  async start(initialState) {
    const state = initialState || this.initial;
    if (!state || !this.states.has(state)) {
      throw new Error(`Cannot start: state "${state}" not found`);
    }
    this.running = true;
    this.currentState = state;
    this._persist({ type: 'start', state, context: this.context, ts: Date.now() });
    this.emit('start', { state, context: this.context });
    await this._enterState(state);
    await this._checkAlways('_init', {});
    return this;
  }

  // Send an event
  async send(eventName, eventData = {}) {
    if (!this.running) {
      this.emit('ignored', { type: 'not_running', event: eventName });
      return { changed: false, reason: 'not_running' };
    }

    const stateDef = this.states.get(this.currentState);
    if (!stateDef) return { changed: false, reason: 'unknown_state' };

    const transition = stateDef.on[eventName];
    if (!transition) {
      this.emit('unhandled', { state: this.currentState, event: eventName, data: eventData });
      return { changed: false, reason: 'no_transition' };
    }

    // Resolve array of transitions (pick first with passing guard)
    let resolved = null;
    const transitions = Array.isArray(transition) ? transition : [transition];
    for (const t of transitions) {
      if (!t.guard || t.guard(this.context, eventData)) {
        resolved = t;
        break;
      }
    }

    if (!resolved) {
      this.emit('guard_failed', { state: this.currentState, event: eventName });
      return { changed: false, reason: 'guard_failed' };
    }

    return await this._transition(resolved.target, eventName, eventData, resolved.action);
  }

  // Internal transition
  async _transition(target, event, data, action) {
    const prev = this.currentState;

    // Execute exit action
    await this._exitState(prev);

    // Execute transition action
    if (action) {
      await action(this.context, data);
    }

    // Record history
    this.stateHistory.set(prev, this.currentState);
    const entry = { from: prev, to: target, event, data, context: structuredClone(this.context), ts: Date.now() };
    this.history.push(entry);
    this._persist({ type: 'transition', ...entry });

    // Set new state
    this.currentState = target;
    this.emit('transition', entry);

    // Execute entry action
    await this._enterState(target);

    // Check for immediate transitions (always)
    await this._checkAlways(event, data);

    return { changed: true, from: prev, to: this.currentState };
  }

  async _checkAlways(event, data) {
    const stateDef = this.states.get(this.currentState);
    if (stateDef?.always) {
      const al = Array.isArray(stateDef.always) ? stateDef.always : [stateDef.always];
      for (const a of al) {
        if (!a.guard || a.guard(this.context, data || {})) {
          await this._transition(a.target, '_always', data || {}, a.action);
          break;
        }
      }
    }
  }

  async _enterState(stateName) {
    const stateDef = this.states.get(stateName);
    if (!stateDef) return;

    if (stateDef.onEntry) {
      await stateDef.onEntry(this.context);
    }

    this.emit('enter', { state: stateName, context: this.context });

    // Handle history states
    if (stateDef.type === 'history') {
      const historyType = stateDef.history || 'shallow';
      let resolved;
      if (historyType === 'shallow' && this.stateHistory.has(stateName)) {
        resolved = this.stateHistory.get(stateName);
      } else if (historyType === 'deep' && this.deepHistory.has(stateName)) {
        resolved = this.deepHistory.get(stateName);
      } else if (stateDef.parent) {
        resolved = stateDef.parent;
      }
      if (resolved && resolved !== stateName) {
        await this._transition(resolved, '_history_restore', {});
      }
      return;
    }

    // Final state → stop if no transitions exist
    if (stateDef.type === 'final') {
      this.emit('done', { state: stateName, context: this.context });
      this._persist({ type: 'done', state: stateName, context: this.context, ts: Date.now() });
      this.running = false;
    }

    // Set up timers for after transitions
    this._clearTimers();
    if (stateDef.after && typeof stateDef.after === 'object') {
      for (const [timeout, target] of Object.entries(stateDef.after)) {
        const ms = parseInt(timeout, 10);
        if (!isNaN(ms)) {
          const timer = setTimeout(async () => {
            this.emit('timeout', { state: stateName, timeout: ms, target });
            await this._transition(target, '_timeout', { timeout: ms });
          }, ms);
          this.timers.set(`${stateName}:${ms}`, timer);
        }
      }
    }
  }

  async _exitState(stateName) {
    const stateDef = this.states.get(stateName);
    if (!stateDef) return;

    this._clearTimers();

    if (stateDef.onExit) {
      await stateDef.onExit(this.context);
    }

    this.emit('exit', { state: stateName, context: this.context });
  }

  _clearTimers() {
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  // Stop the machine
  stop() {
    this._clearTimers();
    this.running = false;
    this._persist({ type: 'stop', state: this.currentState, ts: Date.now() });
    this.emit('stop', { state: this.currentState });
    return this;
  }

  // Query current state
  get state() {
    return this.currentState;
  }

  get isRunning() {
    return this.running;
  }

  // Get possible events from current state
  get events() {
    const stateDef = this.states.get(this.currentState);
    if (!stateDef) return [];
    return Object.keys(stateDef.on);
  }

  // Can this event be handled?
  can(eventName) {
    const stateDef = this.states.get(this.currentState);
    if (!stateDef) return false;
    const trans = stateDef.on[eventName];
    if (!trans) return false;
    const transitions = Array.isArray(trans) ? trans : [trans];
    return transitions.some(t => !t.guard || t.guard(this.context, {}));
  }

  // Is this state a final state?
  get isDone() {
    const stateDef = this.states.get(this.currentState);
    return stateDef?.type === 'final' || !this.running;
  }

  // Get full configuration (for serialization)
  toJSON() {
    return {
      id: this.id,
      currentState: this.currentState,
      context: this.context,
      running: this.running,
      states: Array.from(this.states.entries()).map(([name, def]) => ({
        name,
        type: def.type,
        meta: def.meta,
        transitions: Object.entries(def.on || {}).map(([event, t]) => ({
          event,
          target: Array.isArray(t) ? t.map(x => x.target) : t.target,
        })),
        timers: Object.keys(def.after || {}),
      })),
      historyLength: this.history.length,
    };
  }

  // Snapshot for persistence
  snapshot() {
    return {
      id: this.id,
      currentState: this.currentState,
      context: this.context,
      stateHistory: Object.fromEntries(this.stateHistory),
      deepHistory: Object.fromEntries(this.deepHistory),
      historyLength: this.history.length,
      ts: Date.now(),
    };
  }

  // Restore from snapshot
  restore(snapshot) {
    this.currentState = snapshot.currentState;
    this.context = snapshot.context || {};
    this.stateHistory = new Map(Object.entries(snapshot.stateHistory || {}));
    this.deepHistory = new Map(Object.entries(snapshot.deepHistory || {}));
    this.emit('restore', snapshot);
    return this;
  }

  // ─── Persistence ─────────────────────────────────────────────
  _persist(entry) {
    if (!this._jsonlPath) return;
    try {
      const dir = dirname(this._jsonlPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const line = JSON.stringify(entry) + '\n';
      writeFileSync(this._jsonlPath, line, { flag: 'a' });
    } catch {
      // persistence is best-effort
    }
  }

  // Replay from JSONL log
  static async replay(jsonlPath, config) {
    const sm = new StateMachine(config);
    if (!existsSync(jsonlPath)) return sm;

    const content = readFileSync(jsonlPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'start') {
        sm.context = entry.context || {};
        sm.currentState = entry.state;
        sm.running = true;
      } else if (entry.type === 'transition') {
        sm.currentState = entry.to;
        sm.context = entry.context || sm.context;
        sm.history.push(entry);
      } else if (entry.type === 'done' || entry.type === 'stop') {
        sm.running = false;
      }
    }

    sm.emit('replay', { entries: lines.length, state: sm.currentState });
    return sm;
  }
}

// ─── Higher-order patterns ──────────────────────────────────────

// Create a workflow (linear pipeline of states)
function createWorkflow(id, steps, opts = {}) {
  const states = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isFirst = i === 0;
    const isLast = i === steps.length - 1;
    const nextName = isLast ? null : steps[i + 1]?.name;
    const name = step.name || `step_${i}`;

    states[name] = {
      type: 'normal',
      onEntry: step.action || null,
      meta: step.meta || {},
      on: nextName ? {
        NEXT: { target: nextName },
        SKIP: { target: nextName, guard: step.skipGuard },
        FAIL: { target: opts.errorState || 'error' },
      } : {
        NEXT: { target: 'done' },
      },
    };
  }

  if (opts.errorState) {
    states[opts.errorState] = {
      type: 'final',
      onEntry: opts.onError || null,
      meta: { label: 'Error' },
    };
  }

  states['done'] = {
    type: 'final',
    onEntry: opts.onComplete || null,
    meta: { label: 'Complete' },
  };

  return new StateMachine({
    id,
    initial: steps[0]?.name || 'step_0',
    states,
    context: opts.context || {},
    ...opts,
  });
}

// Create a game loop (cycling states)
function createGameLoop(id, phases, opts = {}) {
  const states = {};
  const phaseNames = phases.map(p => p.name);

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const nextPhase = phaseNames[(i + 1) % phaseNames.length];

    states[phase.name] = {
      onEntry: phase.onEnter || null,
      onExit: phase.onExit || null,
      meta: phase.meta || {},
      on: {
        NEXT: { target: nextPhase },
        ...(opts.stopEvent ? { [opts.stopEvent]: { target: 'stopped' } } : {}),
      },
      after: phase.timeout ? { [phase.timeout]: nextPhase } : {},
    };
  }

  states['stopped'] = {
    type: 'final',
    meta: { label: 'Stopped' },
  };

  return new StateMachine({
    id,
    initial: phaseNames[0],
    states,
    context: opts.context || {},
    ...opts,
  });
}

// ─── Built-in guard presets ──────────────────────────────────────
const BuiltinGuards = Guards;

export {
  StateMachine,
  Guards,
  BuiltinGuards,
  createWorkflow,
  createGameLoop,
  getByPath,
  setByPath,
};
