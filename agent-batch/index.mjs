/**
 * agent-batch — Zero-dep batch processing engine for AI agents
 *
 * Features:
 * - Batch execution with configurable concurrency
 * - Per-item retry with exponential backoff
 * - Progress tracking (processed/succeeded/failed/skipped)
 * - Timeout per item + global timeout
 * - Error aggregation & partial result collection
 * - Before/after hooks per item
 * - Batch filtering (skip items matching predicate)
 * - Rate limiting (items/sec)
 * - Chunked processing (batch of batches)
 * - JSONL persistence of batch runs
 * - EventEmitter for real-time progress events
 * - Result aggregation (collect, filter, transform)
 */

import { EventEmitter } from 'node:events';
import { createWriteStream, appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const STATES = { PENDING: 'pending', RUNNING: 'running', PAUSED: 'paused', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' };

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Token bucket rate limiter
class TokenBucket {
  constructor(rate, burst = rate, startFull = true) {
    this.rate = rate;      // tokens per second
    this.burst = burst;    // max tokens
    this.tokens = startFull ? burst : 0;
    this.lastRefill = Date.now();
  }
  async acquire() {
    this.refill();
    while (this.tokens < 1) {
      await sleep(Math.ceil(1000 / this.rate));
      this.refill();
    }
    this.tokens -= 1;
  }
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
  }
}

class BatchRun extends EventEmitter {
  constructor(items, processor, opts = {}) {
    super();
    this.id = generateId();
    this.items = items;
    this.processor = processor;
    this.concurrency = opts.concurrency ?? 5;
    this.itemTimeout = opts.itemTimeout ?? 30000;
    this.globalTimeout = opts.globalTimeout ?? 0;
    this.retries = opts.retries ?? 0;
    this.retryDelay = opts.retryDelay ?? 1000;
    this.retryBackoff = opts.retryBackoff ?? 2;
    this.rateLimit = opts.rateLimit ?? 0; // items/sec, 0=unlimited
    this.chunkSize = opts.chunkSize ?? 0; // 0=single batch
    this.filter = opts.filter ?? null;    // skip predicate
    this.beforeEach = opts.beforeEach ?? null;
    this.afterEach = opts.afterEach ?? null;
    this.collectResults = opts.collectResults ?? true;
    this.state = STATES.PENDING;
    this.startedAt = null;
    this.completedAt = null;
    this.results = [];
    this.errors = [];
    this.itemStates = new Map(); // index -> {state, attempts, error, result, startedAt, completedAt}
    this.stats = { total: items.length, processed: 0, succeeded: 0, failed: 0, skipped: 0, retries: 0 };
    this.limiter = this.rateLimit > 0 ? new TokenBucket(this.rateLimit) : null;
    this._abort = false;
    this._pause = false;
    this._pausePromise = null;
    this._pauseResolve = null;
  }

  async run() {
    this.state = STATES.RUNNING;
    this.startedAt = Date.now();
    this.emit('start', { batchId: this.id, total: this.items.length });

    // Global timeout
    let timeoutId = null;
    if (this.globalTimeout > 0) {
      timeoutId = setTimeout(() => {
        this._abort = true;
        this.emit('timeout', { batchId: this.id, elapsed: Date.now() - this.startedAt });
      }, this.globalTimeout);
    }

    try {
      if (this.chunkSize > 0) {
        await this._runChunked();
      } else {
        await this._runParallel();
      }
    } catch (err) {
      this.errors.push({ index: -1, error: err.message, type: 'fatal' });
      this.emit('error', { batchId: this.id, error: err.message });
    }

    if (timeoutId) clearTimeout(timeoutId);

    this.state = this._abort ? STATES.CANCELLED : STATES.COMPLETED;
    this.completedAt = Date.now();
    const duration = this.completedAt - this.startedAt;

    const summary = {
      batchId: this.id,
      state: this.state,
      duration,
      ...this.stats,
      results: this.collectResults ? this.results : undefined,
      errors: this.errors
    };
    this.emit('complete', summary);
    return summary;
  }

  async _runParallel() {
    const items = this.items.map((item, idx) => ({ item, idx }));
    let cursor = 0;
    const workers = [];

    const work = async () => {
      while (cursor < items.length && !this._abort) {
        if (this._pause) {
          await this._pausePromise;
        }
        const { item, idx } = items[cursor++];
        if (this.filter && !this.filter(item, idx)) {
          this.stats.skipped++;
          this.itemStates.set(idx, { state: 'skipped' });
          this.emit('skip', { batchId: this.id, index: idx, item });
          continue;
        }
        if (this.limiter) await this.limiter.acquire();
        await this._processItem(item, idx);
      }
    };

    for (let i = 0; i < Math.min(this.concurrency, items.length); i++) {
      workers.push(work());
    }
    await Promise.all(workers);
  }

  async _runChunked() {
    const chunks = [];
    for (let i = 0; i < this.items.length; i += this.chunkSize) {
      chunks.push(this.items.slice(i, i + this.chunkSize));
    }
    for (let c = 0; c < chunks.length && !this._abort; c++) {
      this.emit('chunk-start', { batchId: this.id, chunk: c, total: chunks.length, size: chunks[c].length });
      const chunkItems = chunks[c].map((item, j) => ({ item, idx: c * this.chunkSize + j }));
      let cursor = 0;
      const workers = [];
      const work = async () => {
        while (cursor < chunkItems.length && !this._abort) {
          if (this._pause) await this._pausePromise;
          const { item, idx } = chunkItems[cursor++];
          if (this.filter && !this.filter(item, idx)) {
            this.stats.skipped++;
            this.itemStates.set(idx, { state: 'skipped' });
            continue;
          }
          if (this.limiter) await this.limiter.acquire();
          await this._processItem(item, idx);
        }
      };
      for (let w = 0; w < Math.min(this.concurrency, chunkItems.length); w++) {
        workers.push(work());
      }
      await Promise.all(workers);
      this.emit('chunk-complete', { batchId: this.id, chunk: c, total: chunks.length });
    }
  }

  async _processItem(item, idx) {
    let attempts = 0;
    const maxAttempts = this.retries + 1;
    let lastError = null;

    while (attempts < maxAttempts && !this._abort) {
      attempts++;
      this.itemStates.set(idx, { state: 'running', attempts, startedAt: Date.now() });
      this.emit('item-start', { batchId: this.id, index: idx, item, attempt: attempts });

      if (this.beforeEach) {
        try { await this.beforeEach(item, idx); } catch (e) { /* ignore hook errors */ }
      }

      try {
        let result;
        if (this.itemTimeout > 0) {
          result = await Promise.race([
            this.processor(item, idx),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Item timeout')), this.itemTimeout))
          ]);
        } else {
          result = await this.processor(item, idx);
        }

        this.stats.processed++;
        this.stats.succeeded++;
        if (this.collectResults) this.results.push({ index: idx, item, result });
        this.itemStates.set(idx, { state: 'succeeded', attempts, result, completedAt: Date.now() });

        if (this.afterEach) {
          try { await this.afterEach(item, idx, result); } catch (e) { /* ignore hook errors */ }
        }

        this.emit('item-complete', { batchId: this.id, index: idx, item, result, attempts });
        return;
      } catch (err) {
        lastError = err;
        if (attempts < maxAttempts) {
          this.stats.retries++;
          const delay = this.retryDelay * Math.pow(this.retryBackoff, attempts - 1);
          this.emit('item-retry', { batchId: this.id, index: idx, item, attempt: attempts, error: err.message, delay });
          await sleep(delay);
        }
      }
    }

    this.stats.processed++;
    this.stats.failed++;
    this.errors.push({ index: idx, item, error: lastError?.message, attempts });
    this.itemStates.set(idx, { state: 'failed', attempts, error: lastError?.message, completedAt: Date.now() });
    this.emit('item-fail', { batchId: this.id, index: idx, item, error: lastError?.message, attempts });
  }

  pause() {
    this._pause = true;
    this.state = STATES.PAUSED;
    this._pausePromise = new Promise(r => { this._pauseResolve = r; });
    this.emit('pause', { batchId: this.id });
  }

  resume() {
    this._pause = false;
    this.state = STATES.RUNNING;
    if (this._pauseResolve) this._pauseResolve();
    this.emit('resume', { batchId: this.id });
  }

  cancel() {
    this._abort = true;
    this.state = STATES.CANCELLED;
    if (this._pauseResolve) this._pauseResolve();
    this.emit('cancel', { batchId: this.id });
  }

  getProgress() {
    return {
      batchId: this.id,
      state: this.state,
      elapsed: this.startedAt ? Date.now() - this.startedAt : 0,
      ...this.stats,
      percent: this.stats.total > 0 ? Math.round((this.stats.processed / this.stats.total) * 100) : 0
    };
  }

  toJSON() {
    return {
      id: this.id, state: this.state,
      startedAt: this.startedAt, completedAt: this.completedAt,
      duration: this.completedAt ? this.completedAt - this.startedAt : null,
      stats: this.stats,
      options: {
        concurrency: this.concurrency, itemTimeout: this.itemTimeout,
        globalTimeout: this.globalTimeout, retries: this.retries,
        rateLimit: this.rateLimit, chunkSize: this.chunkSize
      }
    };
  }
}

class BatchProcessor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dataDir = opts.dataDir ?? './data';
    this.persistRuns = opts.persistRuns ?? true;
    this.runs = new Map();     // batchId -> BatchRun
    this.history = [];         // completed batch summaries
    if (this.persistRuns) this._ensureDir();
  }

  _ensureDir() {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  create(items, processor, opts = {}) {
    const run = new BatchRun(items, processor, opts);
    this.runs.set(run.id, run);

    // Forward events
    const events = ['start', 'complete', 'item-start', 'item-complete', 'item-fail', 'item-retry', 'skip', 'pause', 'resume', 'cancel', 'timeout', 'chunk-start', 'chunk-complete', 'error'];
    for (const ev of events) {
      run.on(ev, (data) => {
        this.emit(ev, data);
        this.emit('*', { event: ev, data });
      });
    }

    run.on('complete', (summary) => {
      this.history.push(summary);
      if (this.persistRuns) this._persistRun(summary);
    });

    return run;
  }

  async execute(items, processor, opts = {}) {
    const run = this.create(items, processor, opts);
    return run.run();
  }

  // Map-style: transform each item, collect results
  async map(items, fn, opts = {}) {
    return this.execute(items, fn, { collectResults: true, ...opts });
  }

  // Filter-style: keep items where predicate returns true
  async filter(items, predicate, opts = {}) {
    const result = await this.execute(items, async (item, idx) => {
      const pass = await predicate(item, idx);
      return { item, pass };
    }, { collectResults: true, ...opts });
    result.filtered = result.results.filter(r => r.result.pass).map(r => r.result.item);
    return result;
  }

  // Reduce-style: accumulate results
  async reduce(items, reducer, initial, opts = {}) {
    let accumulator = initial;
    let idx = 0;
    const result = await this.execute(items, async (item) => {
      const acc = await reducer(accumulator, item, idx);
      accumulator = acc;
      idx++;
      return acc;
    }, { concurrency: 1, ...opts });
    result.accumulator = accumulator;
    return result;
  }

  // Chunk items into sub-arrays
  chunk(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  // Retry a single async function
  async retry(fn, opts = {}) {
    const retries = opts.retries ?? 3;
    const delay = opts.delay ?? 1000;
    const backoff = opts.backoff ?? 2;
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn(i);
      } catch (err) {
        lastErr = err;
        if (i < retries) {
          await sleep(delay * Math.pow(backoff, i));
        }
      }
    }
    throw lastErr;
  }

  getRun(batchId) { return this.runs.get(batchId); }
  getRuns() { return [...this.runs.values()].map(r => r.toJSON()); }
  getHistory() { return this.history; }

  getStats() {
    const total = this.history.length;
    const totalItems = this.history.reduce((s, b) => s + (b.stats?.total || 0), 0);
    const totalSucceeded = this.history.reduce((s, b) => s + (b.stats?.succeeded || 0), 0);
    const totalFailed = this.history.reduce((s, b) => s + (b.stats?.failed || 0), 0);
    const avgDuration = total > 0 ? Math.round(this.history.reduce((s, b) => s + (b.duration || 0), 0) / total) : 0;
    return { totalBatches: total, totalItems, totalSucceeded, totalFailed, avgDurationMs: avgDuration, successRate: totalItems > 0 ? Math.round((totalSucceeded / totalItems) * 100) : 0 };
  }

  _persistRun(summary) {
    try {
      appendFileSync(join(this.dataDir, 'runs.jsonl'), JSON.stringify(summary) + '\n');
    } catch (e) { /* ignore */ }
  }

  loadHistory() {
    const file = join(this.dataDir, 'runs.jsonl');
    if (!existsSync(file)) return;
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const run = JSON.parse(line);
        this.history.push(run);
      } catch (e) { /* skip bad lines */ }
    }
  }
}

export { BatchProcessor, BatchRun, TokenBucket, STATES };
export default BatchProcessor;
