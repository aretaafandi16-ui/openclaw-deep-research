// agent-retry/index.mjs — Zero-dependency resilience toolkit for AI agents
// Circuit breaker, exponential backoff, bulkhead, timeout, health checks

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';

// ─── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jitter(base, factor = 0.25) {
  return base + (Math.random() * 2 - 1) * base * factor;
}

function now() { return Date.now(); }

function uid() { return randomBytes(6).toString('hex'); }

// ─── Exponential Backoff ──────────────────────────────────────────────────────

export class ExponentialBackoff {
  constructor(opts = {}) {
    this.initialMs = opts.initialMs ?? 200;
    this.maxMs = opts.maxMs ?? 30000;
    this.multiplier = opts.multiplier ?? 2;
    this.jitterFactor = opts.jitterFactor ?? 0.25;
    this.maxRetries = opts.maxRetries ?? 10;
    this._attempt = 0;
  }

  get attempt() { return this._attempt; }
  get exhausted() { return this._attempt >= this.maxRetries; }

  nextDelay() {
    if (this.exhausted) return null;
    const raw = Math.min(
      this.initialMs * Math.pow(this.multiplier, this._attempt),
      this.maxMs
    );
    this._attempt++;
    return Math.round(jitter(raw, this.jitterFactor));
  }

  reset() { this._attempt = 0; }

  async *delays() {
    while (!this.exhausted) {
      const d = this.nextDelay();
      if (d === null) return;
      yield d;
    }
  }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const CB_STATE = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

export class CircuitBreaker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name ?? 'default';
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30000;
    this.halfOpenMaxAttempts = opts.halfOpenMaxAttempts ?? 1;
    this.isFailure = opts.isFailure ?? ((err) => true); // eslint-disable-line

    this._state = CB_STATE.CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._lastFailureTime = 0;
    this._halfOpenAttempts = 0;
    this._totalCalls = 0;
    this._totalFailures = 0;
    this._totalSuccesses = 0;
    this._rejectedCalls = 0;
    this._stateChanges = 0;
  }

  get state() { return this._state; }
  get failures() { return this._failures; }
  get stats() {
    return {
      name: this.name,
      state: this._state,
      failures: this._failures,
      totalCalls: this._totalCalls,
      totalFailures: this._totalFailures,
      totalSuccesses: this._totalSuccesses,
      rejectedCalls: this._rejectedCalls,
      stateChanges: this._stateChanges,
      failureRate: this._totalCalls > 0 ? (this._totalFailures / this._totalCalls * 100).toFixed(2) + '%' : '0%',
    };
  }

  _transition(newState) {
    if (this._state === newState) return;
    const old = this._state;
    this._state = newState;
    this._stateChanges++;
    this.emit('stateChange', { from: old, to: newState, name: this.name });
    this.emit(newState, { name: this.name });
  }

  canExecute() {
    if (this._state === CB_STATE.CLOSED) return true;
    if (this._state === CB_STATE.OPEN) {
      if (now() - this._lastFailureTime >= this.resetTimeoutMs) {
        this._transition(CB_STATE.HALF_OPEN);
        this._halfOpenAttempts = 0;
        return true;
      }
      return false;
    }
    // HALF_OPEN
    return this._halfOpenAttempts < this.halfOpenMaxAttempts;
  }

  recordSuccess() {
    this._totalCalls++;
    this._totalSuccesses++;
    this._successes++;
    if (this._state === CB_STATE.HALF_OPEN) {
      this._failures = 0;
      this._transition(CB_STATE.CLOSED);
    }
    this._failures = Math.max(0, this._failures - 1);
    this.emit('success', { name: this.name, state: this._state });
  }

  recordFailure(err) {
    this._totalCalls++;
    this._totalFailures++;
    this._failures++;
    this._lastFailureTime = now();
    if (this._state === CB_STATE.HALF_OPEN) {
      this._transition(CB_STATE.OPEN);
    } else if (this._failures >= this.failureThreshold) {
      this._transition(CB_STATE.OPEN);
    }
    this.emit('failure', { name: this.name, state: this._state, failures: this._failures, error: err?.message });
  }

  async execute(fn) {
    if (!this.canExecute()) {
      this._rejectedCalls++;
      const err = new Error(`Circuit breaker [${this.name}] is OPEN`);
      err.code = 'CIRCUIT_OPEN';
      this.emit('rejected', { name: this.name });
      throw err;
    }
    if (this._state === CB_STATE.HALF_OPEN) {
      this._halfOpenAttempts++;
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      if (this.isFailure(err)) {
        this.recordFailure(err);
      }
      throw err;
    }
  }

  forceOpen() { this._transition(CB_STATE.OPEN); this._lastFailureTime = now(); }
  forceClose() { this._transition(CB_STATE.CLOSED); this._failures = 0; }
  reset() {
    this._state = CB_STATE.CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._halfOpenAttempts = 0;
    this._lastFailureTime = 0;
  }
}

// ─── Bulkhead ─────────────────────────────────────────────────────────────────

export class Bulkhead extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name ?? 'default';
    this.maxConcurrent = opts.maxConcurrent ?? 10;
    this.maxQueued = opts.maxQueued ?? 100;
    this.timeoutMs = opts.timeoutMs ?? 30000;

    this._active = 0;
    this._queued = 0;
    this._queue = [];
    this._totalExecuted = 0;
    this._totalRejected = 0;
    this._totalTimedOut = 0;
    this._peakActive = 0;
  }

  get active() { return this._active; }
  get queued() { return this._queued; }
  get available() { return this.maxConcurrent - this._active; }

  get stats() {
    return {
      name: this.name,
      active: this._active,
      queued: this._queued,
      available: this.available,
      maxConcurrent: this.maxConcurrent,
      maxQueued: this.maxQueued,
      totalExecuted: this._totalExecuted,
      totalRejected: this._totalRejected,
      totalTimedOut: this._totalTimedOut,
      peakActive: this._peakActive,
    };
  }

  async execute(fn, priority = 0) {
    if (this._active < this.maxConcurrent) {
      return this._run(fn);
    }
    if (this._queued >= this.maxQueued) {
      this._totalRejected++;
      const err = new Error(`Bulkhead [${this.name}] queue full (${this.maxQueued})`);
      err.code = 'BULKHEAD_FULL';
      this.emit('rejected', { name: this.name });
      throw err;
    }
    return new Promise((resolve, reject) => {
      const entry = { fn, priority, resolve, reject, enqueuedAt: now() };
      // Insert by priority (higher first)
      let i = this._queue.length;
      while (i > 0 && this._queue[i - 1].priority < priority) i--;
      this._queue.splice(i, 0, entry);
      this._queued = this._queue.length;
      this.emit('queued', { name: this.name, queued: this._queued, priority });

      // Queue timeout
      const timer = setTimeout(() => {
        const idx = this._queue.indexOf(entry);
        if (idx !== -1) {
          this._queue.splice(idx, 1);
          this._queued = this._queue.length;
          this._totalTimedOut++;
          const err = new Error(`Bulkhead [${this.name}] queue timeout`);
          err.code = 'BULKHEAD_TIMEOUT';
          reject(err);
        }
      }, this.timeoutMs);
      entry.timer = timer;
    });
  }

  async _run(fn) {
    this._active++;
    if (this._active > this._peakActive) this._peakActive = this._active;
    this.emit('active', { name: this.name, active: this._active });
    try {
      return await fn();
    } finally {
      this._active--;
      this._totalExecuted++;
      this._dequeue();
    }
  }

  _dequeue() {
    if (this._queue.length > 0 && this._active < this.maxConcurrent) {
      const entry = this._queue.shift();
      this._queued = this._queue.length;
      clearTimeout(entry.timer);
      this._run(entry.fn).then(entry.resolve).catch(entry.reject);
    }
  }
}

// ─── Timeout Wrapper ──────────────────────────────────────────────────────────

export async function withTimeout(fn, timeoutMs, message) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message ?? `Operation timed out after ${timeoutMs}ms`);
      err.code = 'TIMEOUT';
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Retry with Backoff ───────────────────────────────────────────────────────

export async function retry(fn, opts = {}) {
  const backoff = new ExponentialBackoff(opts);
  const onRetry = opts.onRetry;
  const isRetryable = opts.isRetryable ?? (() => true);
  let lastErr;

  for await (const delay of backoff.delays()) {
    try {
      return await (opts.timeoutMs ? withTimeout(fn, opts.timeoutMs) : fn());
    } catch (err) {
      lastErr = err;
      if (backoff.exhausted || !isRetryable(err)) throw err;
      if (onRetry) onRetry({ attempt: backoff.attempt, delay, error: err.message });
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ─── RetryOrchestrator (combines retry + circuit breaker + bulkhead + timeout) ─

export class RetryOrchestrator extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name ?? 'default';
    this.backoff = new ExponentialBackoff(opts.backoff);
    this.circuitBreaker = opts.circuitBreaker
      ? (opts.circuitBreaker instanceof CircuitBreaker ? opts.circuitBreaker : new CircuitBreaker({ ...opts.circuitBreaker, name: this.name }))
      : null;
    this.bulkhead = opts.bulkhead
      ? (opts.bulkhead instanceof Bulkhead ? opts.bulkhead : new Bulkhead({ ...opts.bulkhead, name: this.name }))
      : null;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.isRetryable = opts.isRetryable ?? (() => true);
    this.fallback = opts.fallback ?? null;
    this.onRetry = opts.onRetry ?? null;

    // Proxy events from sub-components
    if (this.circuitBreaker) {
      this.circuitBreaker.on('stateChange', (e) => this.emit('circuitStateChange', e));
      this.circuitBreaker.on('rejected', (e) => this.emit('rejected', e));
    }
    if (this.bulkhead) {
      this.bulkhead.on('rejected', (e) => this.emit('rejected', e));
    }
  }

  get stats() {
    return {
      name: this.name,
      circuitBreaker: this.circuitBreaker?.stats ?? null,
      bulkhead: this.bulkhead?.stats ?? null,
      timeoutMs: this.timeoutMs,
    };
  }

  async execute(fn) {
    const wrappedFn = async () => {
      if (this.bulkhead) {
        return this.bulkhead.execute(() => {
          if (this.circuitBreaker) {
            return this.circuitBreaker.execute(() => withTimeout(fn, this.timeoutMs));
          }
          return withTimeout(fn, this.timeoutMs);
        });
      }
      if (this.circuitBreaker) {
        return this.circuitBreaker.execute(() => withTimeout(fn, this.timeoutMs));
      }
      return withTimeout(fn, this.timeoutMs);
    };

    this.backoff.reset();
    let lastErr;

    for await (const delay of this.backoff.delays()) {
      try {
        return await wrappedFn();
      } catch (err) {
        lastErr = err;
        if (err.code === 'CIRCUIT_OPEN' || err.code === 'BULKHEAD_FULL') {
          // Non-retryable infrastructure errors
          if (this.fallback) return this.fallback(err);
          throw err;
        }
        if (this.backoff.exhausted || !this.isRetryable(err)) {
          if (this.fallback) return this.fallback(err);
          throw err;
        }
        if (this.onRetry) this.onRetry({ attempt: this.backoff.attempt, delay, error: err.message, name: this.name });
        this.emit('retry', { attempt: this.backoff.attempt, delay, error: err.message, name: this.name });
        await sleep(delay);
      }
    }
    if (this.fallback) return this.fallback(lastErr);
    throw lastErr;
  }
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export class HealthChecker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.checks = new Map();
    this.intervalMs = opts.intervalMs ?? 30000;
    this._timer = null;
  }

  register(name, fn, opts = {}) {
    this.checks.set(name, {
      fn,
      critical: opts.critical ?? false,
      timeoutMs: opts.timeoutMs ?? 5000,
      lastResult: null,
      lastRun: 0,
      consecutiveFailures: 0,
    });
    return this;
  }

  unregister(name) { this.checks.delete(name); return this; }

  async runCheck(name) {
    const check = this.checks.get(name);
    if (!check) throw new Error(`Unknown check: ${name}`);
    const start = now();
    try {
      const result = await withTimeout(() => check.fn(), check.timeoutMs);
      check.lastResult = { ok: true, latencyMs: now() - start, result, ts: now() };
      check.consecutiveFailures = 0;
      check.lastRun = now();
    } catch (err) {
      check.consecutiveFailures++;
      check.lastResult = { ok: false, latencyMs: now() - start, error: err.message, ts: now() };
      check.lastRun = now();
      this.emit('checkFailed', { name, critical: check.critical, error: err.message, consecutiveFailures: check.consecutiveFailures });
    }
    return check.lastResult;
  }

  async runAll() {
    const results = {};
    for (const [name] of this.checks) {
      results[name] = await this.runCheck(name);
    }
    return results;
  }

  get status() {
    const checks = {};
    let healthy = true;
    for (const [name, check] of this.checks) {
      checks[name] = {
        ok: check.lastResult?.ok ?? null,
        critical: check.critical,
        latencyMs: check.lastResult?.latencyMs ?? null,
        consecutiveFailures: check.consecutiveFailures,
        lastRun: check.lastRun,
      };
      if (check.critical && !check.lastResult?.ok) healthy = false;
    }
    return { healthy, checks };
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.runAll().catch(() => {}), this.intervalMs);
    this._timer.unref?.();
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    return this;
  }
}

// ─── RetryRegistry ────────────────────────────────────────────────────────────

export class RetryRegistry {
  constructor() {
    this._orchestrators = new Map();
    this._breakers = new Map();
    this._bulkheads = new Map();
  }

  orchestrator(name, opts = {}) {
    if (!this._orchestrators.has(name)) {
      this._orchestrators.set(name, new RetryOrchestrator({ ...opts, name }));
    }
    return this._orchestrators.get(name);
  }

  circuitBreaker(name, opts = {}) {
    if (!this._breakers.has(name)) {
      this._breakers.set(name, new CircuitBreaker({ ...opts, name }));
    }
    return this._breakers.get(name);
  }

  bulkhead(name, opts = {}) {
    if (!this._bulkheads.has(name)) {
      this._bulkheads.set(name, new Bulkhead({ ...opts, name }));
    }
    return this._bulkheads.get(name);
  }

  remove(name) {
    this._orchestrators.delete(name);
    this._breakers.delete(name);
    this._bulkheads.delete(name);
  }

  get allStats() {
    return {
      orchestrators: [...this._orchestrators.values()].map(o => o.stats),
      circuitBreakers: [...this._breakers.values()].map(b => b.stats),
      bulkheads: [...this._bulkheads.values()].map(b => b.stats),
    };
  }
}
