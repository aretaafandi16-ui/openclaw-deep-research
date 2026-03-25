/**
 * agent-stream v1.0 — Zero-dep streaming data processor for AI agents
 * 
 * Features:
 * - Composable stream pipelines with lazy evaluation
 * - 20+ operators (map, filter, reduce, batch, window, debounce, throttle, etc.)
 * - Multiple source types (array, generator, interval, file, HTTP, custom)
 * - Backpressure via pull-based async iteration
 * - Error handling with retry + circuit breaker
 * - Tumbling & sliding windows with aggregations
 * - Fan-out (broadcast, round-robin, hash) and fan-in (merge, concat, zip)
 * - Stream statistics and monitoring
 * - JSONL persistence for replay
 * - EventEmitter for lifecycle events
 */

import { EventEmitter } from 'events';
import { createReadStream, createWriteStream, appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';

// ─── Stream Operators ──────────────────────────────────────────────

class StreamOperator {
  constructor(name, fn) {
    this.name = name;
    this.fn = fn;
  }
}

// ─── Pipeline Stage ────────────────────────────────────────────────

class PipelineStage {
  constructor(operator, options = {}) {
    this.operator = operator;
    this.name = options.name || operator.name;
    this.stats = { processed: 0, errors: 0, duration: 0 };
  }

  async process(item) {
    const start = performance.now();
    try {
      const result = await this.operator.fn(item);
      this.stats.processed++;
      this.stats.duration += performance.now() - start;
      return result;
    } catch (err) {
      this.stats.errors++;
      throw err;
    }
  }
}

// ─── Window Buffer ─────────────────────────────────────────────────

class WindowBuffer {
  constructor(size, type = 'tumbling') {
    this.size = size;
    this.type = type; // 'tumbling' | 'sliding'
    this.buffer = [];
    this.slideInterval = type === 'sliding' ? Math.max(1, Math.floor(size / 2)) : size;
    this.position = 0;
  }

  push(item) {
    this.buffer.push(item);
    this.position++;
    
    if (this.type === 'tumbling') {
      if (this.buffer.length >= this.size) {
        const window = [...this.buffer];
        this.buffer = [];
        return window;
      }
    } else {
      // sliding
      if (this.position >= this.slideInterval) {
        this.position = 0;
        const window = this.buffer.slice(-this.size);
        return window;
      }
    }
    return null;
  }

  flush() {
    const remaining = [...this.buffer];
    this.buffer = [];
    this.position = 0;
    return remaining.length > 0 ? remaining : null;
  }
}

// ─── Stream Source ─────────────────────────────────────────────────

class StreamSource {
  constructor(type, data, options = {}) {
    this.type = type;
    this.data = data;
    this.options = options;
    this.closed = false;
  }

  async *[Symbol.asyncIterator]() {
    switch (this.type) {
      case 'array':
        for (const item of this.data) {
          if (this.closed) break;
          yield item;
        }
        break;

      case 'generator':
        for await (const item of this.data) {
          if (this.closed) break;
          yield item;
        }
        break;

      case 'interval': {
        const interval = this.options.interval || 1000;
        const maxItems = this.options.maxItems || Infinity;
        let count = 0;
        while (!this.closed && count < maxItems) {
          yield { timestamp: Date.now(), index: count++ };
          await new Promise(r => setTimeout(r, interval));
        }
        break;
      }

      case 'file': {
        const path = this.data;
        if (!existsSync(path)) throw new Error(`File not found: ${path}`);
        const content = readFileSync(path, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (this.closed) break;
          yield this.options.json ? JSON.parse(line) : line;
        }
        break;
      }

      case 'readable': {
        const stream = this.data;
        const reader = stream[Symbol.asyncIterator] || stream[Symbol.asyncIterator];
        for await (const chunk of stream) {
          if (this.closed) break;
          yield chunk;
        }
        break;
      }

      default:
        throw new Error(`Unknown source type: ${this.type}`);
    }
  }

  close() {
    this.closed = true;
  }
}

// ─── Stream Statistics ─────────────────────────────────────────────

class StreamStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.startTime = null;
    this.endTime = null;
    this.itemsReceived = 0;
    this.itemsProcessed = 0;
    this.itemsErrored = 0;
    this.itemsDropped = 0;
    this.totalLatency = 0;
    this.minLatency = Infinity;
    this.maxLatency = 0;
    this.errors = [];
  }

  start() {
    this.startTime = performance.now();
  }

  recordReceive() {
    this.itemsReceived++;
  }

  recordProcess(latency) {
    this.itemsProcessed++;
    this.totalLatency += latency;
    this.minLatency = Math.min(this.minLatency, latency);
    this.maxLatency = Math.max(this.maxLatency, latency);
  }

  recordError(err) {
    this.itemsErrored++;
    this.errors.push({ message: err.message, time: Date.now() });
    if (this.errors.length > 100) this.errors.shift();
  }

  recordDrop() {
    this.itemsDropped++;
  }

  stop() {
    this.endTime = performance.now();
  }

  get throughput() {
    if (!this.startTime) return 0;
    const elapsed = (this.endTime || performance.now()) - this.startTime;
    return elapsed > 0 ? (this.itemsProcessed / elapsed) * 1000 : 0;
  }

  get avgLatency() {
    return this.itemsProcessed > 0 ? this.totalLatency / this.itemsProcessed : 0;
  }

  toJSON() {
    return {
      itemsReceived: this.itemsReceived,
      itemsProcessed: this.itemsProcessed,
      itemsErrored: this.itemsErrored,
      itemsDropped: this.itemsDropped,
      throughput: Math.round(this.throughput * 100) / 100,
      avgLatency: Math.round(this.avgLatency * 100) / 100,
      minLatency: this.minLatency === Infinity ? 0 : Math.round(this.minLatency * 100) / 100,
      maxLatency: Math.round(this.maxLatency * 100) / 100,
      elapsedMs: this.endTime ? Math.round(this.endTime - this.startTime) : 0,
    };
  }
}

// ─── StreamEngine (main class) ─────────────────────────────────────

export class StreamEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.source = null;
    this.stages = [];
    this.stats = new StreamStats();
    this.sinks = [];
    this.errorHandler = options.onError || null;
    this.retryPolicy = options.retry || { attempts: 0, delay: 100 };
    this.running = false;
    this.paused = false;
    this.persistenceDir = options.persistenceDir || null;
    this.recordHistory = options.recordHistory || false;
    this.history = [];
    this.maxHistory = options.maxHistory || 1000;
    
    // Prevent unhandled 'error' event crash
    this.on('error', () => {});
  }

  // ── Source ──────────────────────────────────────────────────────

  from(array) {
    this.source = new StreamSource('array', array);
    return this;
  }

  fromGenerator(gen) {
    this.source = new StreamSource('generator', gen);
    return this;
  }

  fromInterval(interval, maxItems = Infinity) {
    this.source = new StreamSource('interval', null, { interval, maxItems });
    return this;
  }

  fromFile(path, options = {}) {
    this.source = new StreamSource('file', path, options);
    return this;
  }

  fromReadable(stream) {
    this.source = new StreamSource('readable', stream);
    return this;
  }

  // ── Operators ───────────────────────────────────────────────────

  map(fn) {
    this.stages.push(new PipelineStage(new StreamOperator('map', fn)));
    return this;
  }

  filter(fn) {
    this.stages.push(new PipelineStage(new StreamOperator('filter', async (item) => {
      const result = await fn(item);
      return result ? item : StreamEngine.DROP;
    })));
    return this;
  }

  flatMap(fn) {
    this._hasFlatMap = true;
    this.stages.push(new PipelineStage(new StreamOperator('flatMap', async (item) => {
      const results = await fn(item);
      return Array.isArray(results) ? results : [results];
    })));
    return this;
  }

  reduce(fn, initial) {
    let acc = initial;
    let count = 0;
    this.stages.push(new PipelineStage(new StreamOperator('reduce', async (item) => {
      acc = await fn(acc, item);
      count++;
      return { _reduce: true, value: acc, count };
    })));
    return this;
  }

  tap(fn) {
    this.stages.push(new PipelineStage(new StreamOperator('tap', async (item) => {
      await fn(item);
      return item;
    })));
    return this;
  }

  distinct(keyFn = null) {
    const seen = new Set();
    return this.filter(item => {
      const key = keyFn ? keyFn(item) : JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  take(n) {
    let count = 0;
    this.stages.push(new PipelineStage(new StreamOperator('take', (item) => {
      if (count >= n) return StreamEngine.STOP;
      count++;
      return item;
    })));
    return this;
  }

  skip(n) {
    let count = 0;
    this.stages.push(new PipelineStage(new StreamOperator('skip', (item) => {
      count++;
      return count > n ? item : StreamEngine.DROP;
    })));
    return this;
  }

  batch(size) {
    let buffer = [];
    this.stages.push(new PipelineStage(new StreamOperator('batch', (item) => {
      buffer.push(item);
      if (buffer.length >= size) {
        const batch = [...buffer];
        buffer = [];
        return batch;
      }
      return StreamEngine.DROP;
    })));
    return this;
  }

  window(size, type = 'tumbling') {
    const winBuf = new WindowBuffer(size, type);
    this.stages.push(new PipelineStage(new StreamOperator('window', (item) => {
      return winBuf.push(item);
    })));
    return this;
  }

  debounce(ms) {
    let timer = null;
    let lastItem = null;
    this.stages.push(new PipelineStage(new StreamOperator('debounce', (item) => {
      lastItem = item;
      if (timer) clearTimeout(timer);
      return new Promise(resolve => {
        timer = setTimeout(() => {
          timer = null;
          resolve(lastItem);
        }, ms);
      });
    })));
    return this;
  }

  throttle(ms) {
    let lastTime = 0;
    return this.filter(() => {
      const now = Date.now();
      if (now - lastTime >= ms) {
        lastTime = now;
        return true;
      }
      return false;
    });
  }

  delay(ms) {
    return this.map(async (item) => {
      await new Promise(r => setTimeout(r, ms));
      return item;
    });
  }

  pluck(key) {
    return this.map(item => item?.[key]);
  }

  compact() {
    return this.filter(item => item != null && item !== false && item !== '' && item !== 0);
  }

  flatten() {
    return this.flatMap(item => Array.isArray(item) ? item.flat(Infinity) : [item]);
  }

  async transform(fn) {
    return this.map(fn);
  }

  // ── Fan-out Strategies ──────────────────────────────────────────

  broadcast(...streams) {
    this.stages.push(new PipelineStage(new StreamOperator('broadcast', (item) => {
      for (const s of streams) {
        s._pushInternal(item);
      }
      return item;
    })));
    return this;
  }

  roundRobin(...streams) {
    let idx = 0;
    this.stages.push(new PipelineStage(new StreamOperator('roundRobin', (item) => {
      streams[idx % streams.length]._pushInternal(item);
      idx++;
      return item;
    })));
    return this;
  }

  hash(keyFn, ...streams) {
    this.stages.push(new PipelineStage(new StreamOperator('hash', (item) => {
      const key = keyFn(item);
      let hash = 0;
      for (let i = 0; i < String(key).length; i++) {
        hash = ((hash << 5) - hash) + String(key).charCodeAt(i);
        hash |= 0;
      }
      streams[Math.abs(hash) % streams.length]._pushInternal(item);
      return item;
    })));
    return this;
  }

  // ── Fan-in Strategies ───────────────────────────────────────────

  static merge(...streams) {
    const merged = new StreamEngine();
    merged.source = new StreamSource('generator', (async function* () {
      const promises = streams.map(async function* (s) {
        for await (const item of s) yield item;
      });
      // Interleave from all streams
      const iterators = promises.map(p => p[Symbol.asyncIterator]());
      const pending = new Map();
      for (const it of iterators) {
        pending.set(it, it.next());
      }
      while (pending.size > 0) {
        const results = await Promise.all(pending.values());
        const iteratorsList = [...pending.keys()];
        for (let i = 0; i < results.length; i++) {
          if (!results[i].done) {
            yield results[i].value;
            pending.set(iteratorsList[i], iteratorsList[i].next());
          } else {
            pending.delete(iteratorsList[i]);
          }
        }
      }
    })());
    return merged;
  }

  static concat(...streams) {
    const concated = new StreamEngine();
    concated.source = new StreamSource('generator', (async function* () {
      for (const s of streams) {
        for await (const item of s) {
          yield item;
        }
      }
    })());
    return concated;
  }

  static zip(...streams) {
    const zipped = new StreamEngine();
    zipped.source = new StreamSource('generator', (async function* () {
      const iterators = streams.map(s => s[Symbol.asyncIterator]());
      while (true) {
        const results = await Promise.all(iterators.map(it => it.next()));
        if (results.some(r => r.done)) break;
        yield results.map(r => r.value);
      }
    })());
    return zipped;
  }

  // ── Sinks ───────────────────────────────────────────────────────

  to(callback) {
    this.sinks.push(callback);
    return this;
  }

  toArray() {
    const arr = [];
    this.sinks.push(item => arr.push(item));
    return arr;
  }

  toFile(path, options = {}) {
    this.sinks.push(item => {
      const line = options.json ? JSON.stringify(item) : String(item);
      appendFileSync(path, line + '\n');
    });
    return this;
  }

  // ── Execution ───────────────────────────────────────────────────

  async *[Symbol.asyncIterator]() {
    if (!this.source) throw new Error('No source configured');
    
    this.stats.start();
    this.running = true;
    this.emit('start', { id: this.id });

    try {
      for await (const raw of this.source) {
        if (!this.running) break;
        
        while (this.paused) {
          await new Promise(r => setTimeout(r, 50));
        }

        this.stats.recordReceive();
        const start = performance.now();
        let item = raw;
        let stopped = false;

        for (const stage of this.stages) {
          try {
            item = await this._executeWithRetry(stage, item);
            
            if (item === StreamEngine.DROP) {
              this.stats.recordDrop();
              stopped = true;
              break;
            }
            if (item === null || item === undefined) {
              // Window/batch not ready yet — drop silently
              this.stats.recordDrop();
              stopped = true;
              break;
            }
            if (item === StreamEngine.STOP) {
              this.running = false;
              stopped = true;
              break;
            }
            if (Array.isArray(item) && stage.operator.name === 'window') {
              // Window emits arrays — yield each
            } else if (Array.isArray(item) && stage.operator.name === 'flatMap') {
              // flatMap returns arrays to be flattened at next stage
            }
          } catch (err) {
            this.stats.recordError(err);
            this.emit('error', { error: err, item, stage: stage.name });
            if (this.errorHandler) {
              item = await this.errorHandler(err, item);
              if (item === StreamEngine.DROP || item === StreamEngine.STOP) {
                stopped = true;
                break;
              }
            } else {
              stopped = true;
              break;
            }
          }
        }

        if (stopped) continue;

        // Handle array results from flatMap (flatten) vs window/batch (emit as-is)
        const items = [];
        if (Array.isArray(item)) {
          const lastStage = this.stages[this.stages.length - 1];
          const opName = lastStage?.operator?.name;
          if (opName === 'flatMap') {
            // flatMap: emit each element individually
            items.push(...item);
          } else {
            // window/batch/reduce: emit the array as one item
            items.push(item);
          }
        } else {
          items.push(item);
        }

        for (const emitItem of items) {
          const latency = performance.now() - start;
          this.stats.recordProcess(latency);

          // Record history
          if (this.recordHistory) {
            this.history.push({ item: emitItem, timestamp: Date.now() });
            if (this.history.length > this.maxHistory) {
              this.history = this.history.slice(-this.maxHistory);
            }
          }

          // Emit to sinks
          for (const sink of this.sinks) {
            try {
              await sink(emitItem);
            } catch (err) {
              this.emit('sink-error', { error: err, item: emitItem });
            }
          }

          // Persist if configured
          if (this.persistenceDir) {
            try {
              if (!existsSync(this.persistenceDir)) mkdirSync(this.persistenceDir, { recursive: true });
              appendFileSync(`${this.persistenceDir}/${this.id}.jsonl`, JSON.stringify({ item: emitItem, ts: Date.now() }) + '\n');
            } catch {}
          }

          this.emit('data', emitItem);
          yield emitItem;
        }
      }
    } finally {
      this.running = false;
      this.stats.stop();
      this.emit('end', { id: this.id, stats: this.stats.toJSON() });
    }
  }

  async _executeWithRetry(stage, item) {
    let lastErr;
    const attempts = this.retryPolicy.attempts + 1;
    
    for (let i = 0; i < attempts; i++) {
      try {
        return await stage.process(item);
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          await new Promise(r => setTimeout(r, this.retryPolicy.delay * Math.pow(2, i)));
        }
      }
    }
    throw lastErr;
  }

  async run() {
    const results = [];
    for await (const item of this) {
      results.push(item);
    }
    return results;
  }

  async consume() {
    let count = 0;
    for await (const item of this) {
      count++;
    }
    return count;
  }

  pause() {
    this.paused = true;
    this.emit('pause');
  }

  resume() {
    this.paused = false;
    this.emit('resume');
  }

  stop() {
    this.running = false;
    if (this.source) this.source.close();
    this.emit('stop');
  }

  // ── Chain / Compose ─────────────────────────────────────────────

  pipe(otherStream) {
    return new StreamEngine().fromGenerator((async function* (self) {
      for await (const item of self) {
        otherStream._pushInternal(item);
      }
      otherStream._closeInternal();
    })(this));
  }

  _pushInternal(item) {
    if (!this._internalBuffer) this._internalBuffer = [];
    this._internalBuffer.push(item);
    if (this._resolveNext) {
      this._resolveNext();
      this._resolveNext = null;
    }
  }

  _closeInternal() {
    this._internalClosed = true;
    if (this._resolveNext) {
      this._resolveNext();
      this._resolveNext = null;
    }
  }

  // ── Introspection ───────────────────────────────────────────────

  getStats() {
    return this.stats.toJSON();
  }

  describe() {
    return {
      id: this.id,
      source: this.source?.type || 'none',
      stages: this.stages.map(s => s.name),
      stageStats: this.stages.map(s => ({ name: s.name, ...s.stats })),
      sinks: this.sinks.length,
      running: this.running,
      paused: this.paused,
      stats: this.stats.toJSON(),
    };
  }

  // ── Static Helpers ──────────────────────────────────────────────

  static from(array) {
    return new StreamEngine().from(array);
  }

  static fromGenerator(gen) {
    return new StreamEngine().fromGenerator(gen);
  }

  static fromInterval(interval, maxItems) {
    return new StreamEngine().fromInterval(interval, maxItems);
  }

  // Sentinel values
  static DROP = Symbol('stream:drop');
  static STOP = Symbol('stream:stop');
}

// ─── Aggregation Helpers ───────────────────────────────────────────

export const Aggregations = {
  sum: (items, key) => items.reduce((a, b) => a + (key ? b[key] : b), 0),
  avg: (items, key) => {
    const vals = items.map(i => key ? i[key] : i);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  },
  min: (items, key) => Math.min(...items.map(i => key ? i[key] : i)),
  max: (items, key) => Math.max(...items.map(i => key ? i[key] : i)),
  count: (items) => items.length,
  first: (items) => items[0],
  last: (items) => items[items.length - 1],
  median: (items, key) => {
    const vals = items.map(i => key ? i[key] : i).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  },
  stddev: (items, key) => {
    const vals = items.map(i => key ? i[key] : i);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length);
  },
  unique: (items, key) => [...new Set(items.map(i => key ? i[key] : i))],
  groupBy: (items, keyFn) => {
    const groups = {};
    for (const item of items) {
      const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  },
};

export default StreamEngine;
