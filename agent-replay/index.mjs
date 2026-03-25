/**
 * agent-replay v1.0 — Zero-dep deterministic replay & debugging engine
 * 
 * Content-addressed snapshots, step-through debugging, branching,
 * assertion verification, and execution diffing for AI agents.
 */

import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Helpers ────────────────────────────────────────────────────────

function sha256(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const clone = {};
  for (const [k, v] of Object.entries(obj)) clone[k] = deepClone(v);
  return clone;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  if (!keysA.every((k, i) => k === keysB[i])) return false;
  return keysA.every(k => deepEqual(a[k], b[k]));
}

function stateDiff(oldState, newState, path = '') {
  const diffs = [];
  if (oldState === newState) return diffs;
  if (typeof oldState !== typeof newState || oldState === null || newState === null) {
    return [{ path: path || '$', type: 'changed', from: oldState, to: newState }];
  }
  if (typeof oldState !== 'object') {
    if (oldState !== newState) diffs.push({ path: path || '$', type: 'changed', from: oldState, to: newState });
    return diffs;
  }
  const allKeys = new Set([...Object.keys(oldState || {}), ...Object.keys(newState || {})]);
  for (const key of allKeys) {
    const p = path ? `${path}.${key}` : key;
    if (!(key in oldState)) {
      diffs.push({ path: p, type: 'added', to: newState[key] });
    } else if (!(key in newState)) {
      diffs.push({ path: p, type: 'removed', from: oldState[key] });
    } else {
      diffs.push(...stateDiff(oldState[key], newState[key], p));
    }
  }
  return diffs;
}

// ─── Snapshot Store ─────────────────────────────────────────────────

class SnapshotStore {
  constructor() {
    this.snapshots = new Map();
    this.accessCount = new Map();
  }

  put(state) {
    const hash = sha256(state);
    if (!this.snapshots.has(hash)) {
      this.snapshots.set(hash, deepClone(state));
      this.accessCount.set(hash, 0);
    }
    this.accessCount.set(hash, this.accessCount.get(hash) + 1);
    return hash;
  }

  get(hash) {
    const state = this.snapshots.get(hash);
    if (state) this.accessCount.set(hash, this.accessCount.get(hash) + 1);
    return state ? deepClone(state) : undefined;
  }

  has(hash) { return this.snapshots.has(hash); }

  get size() { return this.snapshots.size; }

  stats() {
    return { totalSnapshots: this.size, totalAccesses: [...this.accessCount.values()].reduce((a, b) => a + b, 0) };
  }
}

// ─── ReplaySession ──────────────────────────────────────────────────

class ReplaySession extends EventEmitter {
  constructor(id, opts = {}) {
    super();
    this.id = id;
    this.createdAt = Date.now();
    this.steps = [];
    this.snapshots = new SnapshotStore();
    this.metadata = opts.metadata || {};
    this.tags = opts.tags || [];
    this.branches = new Map();
    this.annotations = [];
    this.currentStep = -1;
    this.isRecording = true;
  }

  // Record a step
  record(type, data = {}) {
    if (!this.isRecording) throw new Error('Session is not recording');
    const state = data.state !== undefined ? deepClone(data.state) : null;
    const stateHash = state !== null ? this.snapshots.put(state) : null;

    const step = {
      index: this.steps.length,
      id: randomUUID(),
      type,
      timestamp: Date.now(),
      input: data.input !== undefined ? deepClone(data.input) : null,
      output: data.output !== undefined ? deepClone(data.output) : null,
      stateHash,
      durationMs: data.durationMs || null,
      error: data.error || null,
      metadata: data.metadata || {},
      tags: data.tags || []
    };

    // Compute diff from previous state
    if (stateHash && this.steps.length > 0) {
      const prev = [...this.steps].reverse().find(s => s.stateHash);
      if (prev) {
        const prevState = this.snapshots.get(prev.stateHash);
        if (prevState) step.diff = stateDiff(prevState, state);
      }
    }

    this.steps.push(step);
    this.currentStep = this.steps.length - 1;
    this.emit('step:recorded', step);
    return step;
  }

  // Stop recording
  stop() {
    this.isRecording = false;
    this.emit('stopped', { steps: this.steps.length });
  }

  // ── Step-Through Debugging ─────────────────────────────────────

  getStep(index) {
    if (index < 0 || index >= this.steps.length) return null;
    return this.steps[index];
  }

  getState(index) {
    const step = this.getStep(index);
    if (!step || !step.stateHash) return null;
    return this.snapshots.get(step.stateHash);
  }

  first() { this.currentStep = 0; return this.getStep(0); }
  last() { this.currentStep = this.steps.length - 1; return this.getStep(this.currentStep); }
  next() { if (this.currentStep < this.steps.length - 1) this.currentStep++; return this.getStep(this.currentStep); }
  prev() { if (this.currentStep > 0) this.currentStep--; return this.getStep(this.currentStep); }
  jump(index) { this.currentStep = index; return this.getStep(index); }

  current() { return this.getStep(this.currentStep); }

  // ── Search & Filter ───────────────────────────────────────────

  filterByType(type) { return this.steps.filter(s => s.type === type); }
  filterByTag(tag) { return this.steps.filter(s => s.tags.includes(tag)); }
  filterByTime(start, end) { return this.steps.filter(s => s.timestamp >= start && s.timestamp <= end); }
  filterErrors() { return this.steps.filter(s => s.error); }

  searchSteps(query) {
    const q = typeof query === 'string' ? new RegExp(query, 'i') : query;
    return this.steps.filter(s => {
      const str = JSON.stringify({ input: s.input, output: s.output, type: s.type, metadata: s.metadata });
      return q.test(str);
    });
  }

  // ── Branching ─────────────────────────────────────────────────

  branch(name, fromStep = this.currentStep) {
    const branch = new ReplayBranch(name, this, fromStep);
    this.branches.set(name, branch);
    this.emit('branch:created', { name, fromStep });
    return branch;
  }

  getBranch(name) { return this.branches.get(name); }
  listBranches() { return [...this.branches.entries()].map(([name, b]) => ({ name, steps: b.steps.length, fromStep: b.fromStep })); }

  // ── Assertions ────────────────────────────────────────────────

  assertState(index, expected, msg = '') {
    const actual = this.getState(index);
    const pass = deepEqual(actual, expected);
    const result = { pass, index, expected, actual, message: msg || (pass ? 'State matches' : 'State mismatch') };
    this.emit('assertion', result);
    return result;
  }

  assertOutput(index, expected, msg = '') {
    const step = this.getStep(index);
    if (!step) return { pass: false, index, message: 'Step not found' };
    const pass = deepEqual(step.output, expected);
    const result = { pass, index, expected, actual: step.output, message: msg || (pass ? 'Output matches' : 'Output mismatch') };
    this.emit('assertion', result);
    return result;
  }

  assertTypeSequence(types) {
    const actual = this.steps.map(s => s.type);
    const pass = deepEqual(actual, types);
    return { pass, expected: types, actual, message: pass ? 'Type sequence matches' : 'Type sequence mismatch' };
  }

  assertNoErrors() {
    const errors = this.filterErrors();
    return { pass: errors.length === 0, errors, message: errors.length === 0 ? 'No errors' : `${errors.length} errors found` };
  }

  assertDuration(index, maxMs) {
    const step = this.getStep(index);
    if (!step) return { pass: false, index, message: 'Step not found' };
    const pass = step.durationMs !== null && step.durationMs <= maxMs;
    return { pass, durationMs: step.durationMs, maxMs, message: pass ? 'Duration OK' : `Exceeded ${maxMs}ms` };
  }

  // Run all assertions (list of {type, ...args})
  runAssertions(assertions) {
    return assertions.map(a => {
      switch (a.type) {
        case 'state': return this.assertState(a.index, a.expected, a.message);
        case 'output': return this.assertOutput(a.index, a.expected, a.message);
        case 'sequence': return this.assertTypeSequence(a.expected);
        case 'noErrors': return this.assertNoErrors();
        case 'duration': return this.assertDuration(a.index, a.maxMs);
        default: return { pass: false, message: `Unknown assertion type: ${a.type}` };
      }
    });
  }

  // ── Annotations ───────────────────────────────────────────────

  annotate(stepIndex, text, tags = []) {
    const annotation = { id: randomUUID(), stepIndex, text, tags, createdAt: Date.now() };
    this.annotations.push(annotation);
    this.emit('annotation:added', annotation);
    return annotation;
  }

  getAnnotations(stepIndex) {
    return stepIndex !== undefined ? this.annotations.filter(a => a.stepIndex === stepIndex) : this.annotations;
  }

  // ── Timeline ──────────────────────────────────────────────────

  timeline() {
    return this.steps.map(s => ({
      index: s.index,
      type: s.type,
      timestamp: s.timestamp,
      durationMs: s.durationMs,
      hasError: !!s.error,
      tags: s.tags,
      diffCount: (s.diff || []).length
    }));
  }

  // ── Statistics ────────────────────────────────────────────────

  stats() {
    const durations = this.steps.filter(s => s.durationMs !== null).map(s => s.durationMs);
    const errors = this.filterErrors();
    const typeCount = {};
    this.steps.forEach(s => { typeCount[s.type] = (typeCount[s.type] || 0) + 1; });

    return {
      id: this.id,
      totalSteps: this.steps.length,
      totalSnapshots: this.snapshots.size,
      branches: this.branches.size,
      annotations: this.annotations.length,
      errors: errors.length,
      typeBreakdown: typeCount,
      duration: {
        total: durations.reduce((a, b) => a + b, 0),
        avg: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
        min: durations.length ? Math.min(...durations) : 0,
        max: durations.length ? Math.max(...durations) : 0
      },
      timeRange: {
        start: this.steps[0]?.timestamp || null,
        end: this.steps[this.steps.length - 1]?.timestamp || null
      }
    };
  }

  // ── Export ────────────────────────────────────────────────────

  toJSON() {
    return {
      id: this.id,
      createdAt: this.createdAt,
      metadata: this.metadata,
      tags: this.tags,
      steps: this.steps,
      branches: [...this.branches.entries()].map(([name, b]) => ({ name, fromStep: b.fromStep, steps: b.steps })),
      annotations: this.annotations,
      stats: this.stats()
    };
  }

  toMarkdown() {
    const lines = [`# Replay Session: ${this.id}`, '', `**Created:** ${new Date(this.createdAt).toISOString()}`, `**Steps:** ${this.steps.length}`, ''];
    lines.push('## Steps', '');
    this.steps.forEach(s => {
      const err = s.error ? ` ❌ ${s.error}` : '';
      const dur = s.durationMs !== null ? ` (${s.durationMs}ms)` : '';
      lines.push(`### Step ${s.index}: ${s.type}${dur}${err}`);
      if (s.input !== null) lines.push(`**Input:** \`${JSON.stringify(s.input)}\``);
      if (s.output !== null) lines.push(`**Output:** \`${JSON.stringify(s.output)}\``);
      if (s.diff?.length) {
        lines.push(`**Changes (${s.diff.length}):**`);
        s.diff.forEach(d => lines.push(`- \`${d.path}\`: ${d.type} ${d.from !== undefined ? `\`${JSON.stringify(d.from)}\` → ` : ''}${d.to !== undefined ? `\`${JSON.stringify(d.to)}\`` : ''}`));
      }
      lines.push('');
    });
    if (this.annotations.length) {
      lines.push('## Annotations', '');
      this.annotations.forEach(a => lines.push(`- **Step ${a.stepIndex}:** ${a.text}`));
    }
    return lines.join('\n');
  }
}

// ─── ReplayBranch ───────────────────────────────────────────────────

class ReplayBranch {
  constructor(name, parent, fromStep) {
    this.name = name;
    this.parent = parent;
    this.fromStep = fromStep;
    this.steps = [];
    this.snapshots = parent.snapshots;
  }

  record(type, data = {}) {
    const state = data.state !== undefined ? deepClone(data.state) : null;
    const stateHash = state !== null ? this.snapshots.put(state) : null;
    const step = {
      index: this.fromStep + 1 + this.steps.length,
      type, timestamp: Date.now(),
      input: data.input !== undefined ? deepClone(data.input) : null,
      output: data.output !== undefined ? deepClone(data.output) : null,
      stateHash,
      durationMs: data.durationMs || null,
      error: data.error || null,
      branch: this.name
    };
    this.steps.push(step);
    return step;
  }

  getState(index) {
    const step = this.steps[index];
    return step?.stateHash ? this.snapshots.get(step.stateHash) : null;
  }
}

// ─── ReplayEngine (main) ───────────────────────────────────────────

export class ReplayEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.sessions = new Map();
    this.persistPath = opts.persistPath || null;
  }

  createSession(id, opts = {}) {
    const sessionId = id || randomUUID();
    const session = new ReplaySession(sessionId, opts);
    session.on('step:recorded', step => this.emit('step:recorded', { session: sessionId, step }));
    session.on('assertion', result => this.emit('assertion', { session: sessionId, result }));
    session.on('branch:created', info => this.emit('branch:created', { session: sessionId, ...info }));
    this.sessions.set(sessionId, session);
    this.emit('session:created', { id: sessionId });
    return session;
  }

  getSession(id) { return this.sessions.get(id); }
  listSessions() { return [...this.sessions.values()].map(s => ({ id: s.id, steps: s.steps.length, recording: s.isRecording, createdAt: s.createdAt })); }
  deleteSession(id) { const s = this.sessions.get(id); if (s) { s.stop(); this.sessions.delete(id); this.emit('session:deleted', { id }); return true; } return false; }

  // Replay a session from scratch with a function
  async replay(sessionId, fn, opts = {}) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    
    const speed = opts.speed || 1;
    const results = [];
    let lastTimestamp = null;

    for (const step of session.steps) {
      if (lastTimestamp && speed > 0) {
        const delay = (step.timestamp - lastTimestamp) / speed;
        if (delay > 0 && opts.realtime) await new Promise(r => setTimeout(r, delay));
      }

      try {
        const result = await fn(step, step.index);
        results.push({ index: step.index, result, error: null });
      } catch (err) {
        results.push({ index: step.index, result: null, error: err.message });
        if (!opts.continueOnError) break;
      }
      lastTimestamp = step.timestamp;
    }

    return results;
  }

  // Compare two sessions
  diff(sessionIdA, sessionIdB) {
    const a = this.getSession(sessionIdA);
    const b = this.getSession(sessionIdB);
    if (!a || !b) throw new Error('Session not found');

    const maxLen = Math.max(a.steps.length, b.steps.length);
    const diffs = [];
    for (let i = 0; i < maxLen; i++) {
      const sa = a.steps[i];
      const sb = b.steps[i];
      if (!sa) { diffs.push({ index: i, type: 'only_in_B', step: sb }); continue; }
      if (!sb) { diffs.push({ index: i, type: 'only_in_A', step: sa }); continue; }
      if (sa.type !== sb.type) { diffs.push({ index: i, type: 'type_mismatch', a: sa.type, b: sb.type }); continue; }
      if (!deepEqual(sa.input, sb.input)) { diffs.push({ index: i, type: 'input_mismatch', a: sa.input, b: sb.input }); continue; }
      if (!deepEqual(sa.output, sb.output)) { diffs.push({ index: i, type: 'output_mismatch', a: sa.output, b: sb.output }); continue; }
    }

    const similarity = maxLen === 0 ? 1 : 1 - diffs.length / maxLen;
    return { sessionA: sessionIdA, sessionB: sessionIdB, totalSteps: maxLen, diffs, similarity: Math.round(similarity * 100) / 100 };
  }

  // Merge sessions
  merge(sessionIdA, sessionIdB, strategy = 'timestamp') {
    const a = this.getSession(sessionIdA);
    const b = this.getSession(sessionIdB);
    if (!a || !b) throw new Error('Session not found');

    const merged = this.createSession(null, { metadata: { mergedFrom: [sessionIdA, sessionIdB] } });
    let steps;
    if (strategy === 'timestamp') {
      steps = [...a.steps.map(s => ({ ...s, source: sessionIdA })), ...b.steps.map(s => ({ ...s, source: sessionIdB }))];
      steps.sort((x, y) => x.timestamp - y.timestamp);
    } else {
      steps = [...a.steps.map(s => ({ ...s, source: sessionIdA })), ...b.steps.map(s => ({ ...s, source: sessionIdB }))];
    }

    steps.forEach(s => merged.record(s.type, { input: s.input, output: s.output, state: null, durationMs: s.durationMs, error: s.error, metadata: { ...s.metadata, source: s.source } }));
    merged.stop();
    return merged;
  }

  // Global stats
  stats() {
    const sessions = [...this.sessions.values()];
    return {
      totalSessions: sessions.length,
      totalSteps: sessions.reduce((a, s) => a + s.steps.length, 0),
      totalSnapshots: sessions.reduce((a, s) => a + s.snapshots.size, 0),
      recording: sessions.filter(s => s.isRecording).length
    };
  }

  // Persistence
  save(sessionId) {
    if (!this.persistPath) throw new Error('No persistPath configured');
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = `${this.persistPath}/${sessionId}.json`;
    writeFileSync(path, JSON.stringify(session.toJSON(), null, 2));
    return path;
  }

  load(sessionId) {
    if (!this.persistPath) throw new Error('No persistPath configured');
    const path = `${this.persistPath}/${sessionId}.json`;
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const session = this.createSession(data.id, { metadata: data.metadata, tags: data.tags });
    data.steps.forEach(s => {
      const state = s.stateHash ? null : null; // snapshots loaded separately
      session.steps.push(s);
    });
    session.annotations = data.annotations || [];
    session.createdAt = data.createdAt;
    return session;
  }

  appendToLog(sessionId) {
    if (!this.persistPath) throw new Error('No persistPath configured');
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = `${this.persistPath}/events.jsonl`;
    session.steps.forEach(s => {
      appendFileSync(path, JSON.stringify({ sessionId, ...s }) + '\n');
    });
    return path;
  }
}

export { ReplaySession, ReplayBranch, SnapshotStore, sha256, deepClone, deepEqual, stateDiff };
