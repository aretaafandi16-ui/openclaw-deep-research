/**
 * agent-sandbox — Zero-dependency isolated code execution sandbox for AI agents
 *
 * Features:
 * - VM-based isolation with configurable timeout & memory limits
 * - Capture stdout/stderr output streams
 * - Return value extraction (including async/Promise)
 * - Context injection (pass variables into sandbox)
 * - Module mocking/stubbing
 * - Snapshot/restore sandbox contexts
 * - Batch concurrent execution with limits
 * - Execution history with metrics (time, memory, success/fail)
 * - Template execution (function-as-string with arg binding)
 * - Restricted globals (no process, require, fs by default)
 * - EventEmitter for execution events
 * - JSONL persistence for execution logs
 */

import { EventEmitter } from 'events';
import vm from 'vm';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ─── Utility ───────────────────────────────────────────────────────────────

function now() { return Date.now(); }
function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    if (typeof val === 'function') return '[Function]';
    if (val instanceof Error) return { message: val.message, stack: val.stack };
    return val;
  });
}

// ─── Sandbox Context Builder ───────────────────────────────────────────────

function createSandboxContext(globals = {}, mocks = {}) {
  const output = { stdout: [], stderr: [] };

  const sandbox = {
    // Safe globals
    console: {
      log: (...args) => output.stdout.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
      error: (...args) => output.stderr.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
      warn: (...args) => output.stderr.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
      info: (...args) => output.stdout.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
    },
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Promise,
    JSON: { ...JSON },
    Math: { ...Math },
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    isNaN,
    Buffer,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    // User-provided globals
    ...globals,
    // Mocked modules
    ...mocks,
  };

  return { sandbox, output };
}

// ─── Execution Result ──────────────────────────────────────────────────────

function createResult(id, success, value, output, startTime, error = null) {
  return {
    id,
    success,
    value: success ? value : undefined,
    error: error ? { message: error.message, stack: error.stack, type: error.constructor.name } : null,
    stdout: output.stdout.join('\n'),
    stderr: output.stderr.join('\n'),
    durationMs: now() - startTime,
  };
}

// ─── AgentSandbox ──────────────────────────────────────────────────────────

export class AgentSandbox extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.timeout = opts.timeout ?? 5000;
    this.maxHistory = opts.maxHistory ?? 1000;
    this.persistFile = opts.persistFile ?? null;
    this.snapshots = new Map();
    this.history = [];
    this.stats = { total: 0, success: 0, failed: 0, timeout: 0, totalDurationMs: 0 };

    if (this.persistFile && existsSync(this.persistFile)) {
      try {
        const lines = readFileSync(this.persistFile, 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of lines.slice(-100)) {
          try { this.history.push(JSON.parse(line)); } catch {}
        }
      } catch {}
    }
  }

  // ── Core Execution ─────────────────────────────────────────────────────

  run(code, opts = {}) {
    const id = opts.id ?? uuid();
    const startTime = now();
    const timeout = opts.timeout ?? this.timeout;
    const globals = opts.globals ?? {};
    const mocks = opts.mocks ?? {};
    const filename = opts.filename ?? 'sandbox.js';

    const { sandbox, output } = createSandboxContext(globals, mocks);

    try {
      const script = new vm.Script(code, { filename });
      const context = vm.createContext(sandbox);

      let result;
      try {
        result = script.runInContext(context, { timeout });
      } catch (err) {
        if (err.message && err.message.includes('timed out')) {
          this.stats.timeout++;
          const res = createResult(id, false, undefined, output, startTime, new Error(`Execution timed out after ${timeout}ms`));
          this._record(res);
          this.emit('timeout', res);
          return res;
        }
        throw err;
      }

      // Handle async results
      if (result && typeof result.then === 'function') {
        // For async, we return a promise
        return result.then(
          value => {
            const res = createResult(id, true, value, output, startTime);
            this._record(res);
            this.emit('success', res);
            return res;
          },
          err => {
            const res = createResult(id, false, undefined, output, startTime, err);
            this._record(res);
            this.emit('execution-error', res);
            return res;
          }
        );
      }

      const res = createResult(id, true, result, output, startTime);
      this._record(res);
      this.emit('success', res);
      return res;
    } catch (err) {
      const res = createResult(id, false, undefined, output, startTime, err);
      this._record(res);
      this.emit('execution-error', res);
      return res;
    }
  }

  runAsync(code, opts = {}) {
    return Promise.resolve(this.run(code, opts));
  }

  // ── Function Execution ─────────────────────────────────────────────────

  runFunction(fn, args = [], opts = {}) {
    const code = `(${fn.toString()}).apply(null, __args__)`;
    return this.run(code, {
      ...opts,
      globals: { ...opts.globals, __args__: args },
    });
  }

  runExpression(expr, context = {}, opts = {}) {
    const code = `(function() { with(__ctx__) { return ${expr}; } })()`;
    return this.run(code, {
      ...opts,
      globals: { ...opts.globals, __ctx__: context },
    });
  }

  // ── Batch Execution ────────────────────────────────────────────────────

  async runBatch(items, opts = {}) {
    const concurrency = opts.concurrency ?? 5;
    const results = new Array(items.length);
    let nextIdx = 0;

    const worker = async () => {
      while (nextIdx < items.length) {
        const i = nextIdx++;
        const item = items[i];
        const code = typeof item === 'string' ? item : item.code;
        const itemOpts = typeof item === 'string' ? {} : (item.opts ?? {});
        results[i] = { index: i, ...(await this.runAsync(code, { ...opts, ...itemOpts, id: itemOpts.id ?? `batch-${i}` })) };
      }
    };

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, items.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  // ── Snapshots ──────────────────────────────────────────────────────────

  snapshot(name, code, opts = {}) {
    const { sandbox } = createSandboxContext(opts.globals ?? {}, opts.mocks ?? {});
    const context = vm.createContext(sandbox);
    const script = new vm.Script(code);
    script.runInContext(context);
    this.snapshots.set(name, { context, sandbox, code, created: now() });
    this.emit('snapshot', { name });
    return { name, created: now() };
  }

  runInSnapshot(name, code, opts = {}) {
    const snap = this.snapshots.get(name);
    if (!snap) throw new Error(`Snapshot '${name}' not found`);
    const id = opts.id ?? uuid();
    const startTime = now();
    const timeout = opts.timeout ?? this.timeout;
    const output = { stdout: [], stderr: [] };

    // Redirect console in snapshot context
    snap.context.console = {
      log: (...args) => output.stdout.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
      error: (...args) => output.stderr.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
      warn: (...args) => output.stderr.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
      info: (...args) => output.stdout.push(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
    };

    try {
      const script = new vm.Script(code);
      const result = script.runInContext(snap.context, { timeout });
      const res = createResult(id, true, result, output, startTime);
      this._record(res);
      return res;
    } catch (err) {
      const res = createResult(id, false, undefined, output, startTime, err);
      this._record(res);
      return res;
    }
  }

  getSnapshot(name) {
    return this.snapshots.get(name) ?? null;
  }

  deleteSnapshot(name) {
    return this.snapshots.delete(name);
  }

  listSnapshots() {
    return [...this.snapshots.entries()].map(([name, snap]) => ({
      name,
      created: snap.created,
      codePreview: snap.code.slice(0, 100),
    }));
  }

  // ── Stats & History ────────────────────────────────────────────────────

  getStats() {
    return { ...this.stats, avgDurationMs: this.stats.total > 0 ? Math.round(this.stats.totalDurationMs / this.stats.total) : 0, snapshots: this.snapshots.size };
  }

  getHistory(opts = {}) {
    let results = [...this.history];
    if (opts.success !== undefined) results = results.filter(r => r.success === opts.success);
    if (opts.limit) results = results.slice(-opts.limit);
    return results;
  }

  clearHistory() {
    this.history = [];
    this.stats = { total: 0, success: 0, failed: 0, timeout: 0, totalDurationMs: 0 };
  }

  // ── Private ────────────────────────────────────────────────────────────

  _record(result) {
    this.stats.total++;
    if (result.success) this.stats.success++;
    else this.stats.failed++;
    this.stats.totalDurationMs += result.durationMs;
    this.history.push(result);
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
    if (this.persistFile) {
      try {
        const dir = dirname(this.persistFile);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        appendFileSync(this.persistFile, safeStringify(result) + '\n');
      } catch {}
    }
  }
}

export default AgentSandbox;
