#!/usr/bin/env node
// agent-metrics — Zero-dependency metrics collection for AI agents
// Counters, Gauges, Histograms, Timers, Percentiles, Prometheus export

import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Percentile calculator ───────────────────────────────────────────
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// ─── Metric types ─────────────────────────────────────────────────────
class Counter {
  constructor(name, tags = {}) { this.name = name; this.tags = tags; this._value = 0; }
  inc(n = 1) { this._value += n; return this._value; }
  dec(n = 1) { this._value -= n; return this._value; }
  reset() { this._value = 0; }
  get value() { return this._value; }
  toJSON() { return { type: 'counter', name: this.name, tags: this.tags, value: this._value }; }
}

class Gauge {
  constructor(name, tags = {}) { this.name = name; this.tags = tags; this._value = 0; }
  set(v) { this._value = v; }
  inc(n = 1) { this._value += n; }
  dec(n = 1) { this._value -= n; }
  get value() { return this._value; }
  toJSON() { return { type: 'gauge', name: this.name, tags: this.tags, value: this._value }; }
}

class Histogram {
  constructor(name, tags = {}, opts = {}) {
    this.name = name; this.tags = tags;
    this._values = [];
    this._maxSize = opts.maxSize || 10000;
    this._buckets = opts.buckets || [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  }
  observe(v) {
    this._values.push(v);
    if (this._values.length > this._maxSize) this._values = this._values.slice(-this._maxSize);
  }
  get count() { return this._values.length; }
  get sum() { return this._values.reduce((a, b) => a + b, 0); }
  get min() { return this._values.length ? Math.min(...this._values) : 0; }
  get max() { return this._values.length ? Math.max(...this._values) : 0; }
  stats() {
    const sorted = [...this._values].sort((a, b) => a - b);
    return {
      count: sorted.length, sum: this.sum, min: this.min, max: this.max,
      mean: mean(sorted), stddev: stddev(sorted),
      p50: percentile(sorted, 50), p90: percentile(sorted, 90),
      p95: percentile(sorted, 95), p99: percentile(sorted, 99),
    };
  }
  buckets() {
    const sorted = [...this._values].sort((a, b) => a - b);
    return this._buckets.map(b => ({
      le: b, count: sorted.filter(v => v <= b).length
    }));
  }
  toJSON() { return { type: 'histogram', name: this.name, tags: this.tags, ...this.stats() }; }
}

class Timer {
  constructor(name, tags = {}) {
    this.name = name; this.tags = tags;
    this._histogram = new Histogram(name + '_duration_ms', tags);
    this._counter = new Counter(name + '_total', tags);
  }
  start() {
    const t0 = performance.now();
    return { stop: () => { const dt = performance.now() - t0; this._histogram.observe(dt); this._counter.inc(); return dt; } };
  }
  record(ms) { this._histogram.observe(ms); this._counter.inc(); }
  get count() { return this._counter.value; }
  stats() { return this._histogram.stats(); }
  toJSON() { return { type: 'timer', name: this.name, tags: this.tags, count: this.count, ...this.stats() }; }
}

// ─── Sliding Window Counter (for rates) ──────────────────────────────
class SlidingWindowCounter {
  constructor(windowMs = 60000, buckets = 60) {
    this.windowMs = windowMs;
    this.bucketMs = windowMs / buckets;
    this.buckets = new Array(buckets).fill(0);
    this._last = Date.now();
  }
  _advance() {
    const now = Date.now(), gap = now - this._last;
    if (gap >= this.windowMs) { this.buckets.fill(0); this._last = now; return; }
    const shift = Math.floor(gap / this.bucketMs);
    if (shift > 0) {
      for (let i = 0; i < this.buckets.length; i++)
        this.buckets[i] = i + shift < this.buckets.length ? this.buckets[i + shift] : 0;
      this._last += shift * this.bucketMs;
    }
  }
  inc(n = 1) { this._advance(); this.buckets[this.buckets.length - 1] += n; }
  get value() { this._advance(); return this.buckets.reduce((a, b) => a + b, 0); }
  rate() { return this.value / (this.windowMs / 1000); } // per second
}

// ─── Tag key helper ──────────────────────────────────────────────────
function tagKey(tags) {
  return Object.keys(tags).sort().map(k => `${k}=${tags[k]}`).join(',');
}

// ─── Main MetricsStore ───────────────────────────────────────────────
export class MetricsStore extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._metrics = new Map();   // name → metric
    this._persistDir = opts.persistDir || null;
    this._persistInterval = opts.persistInterval || 30000;
    this._rates = new Map();     // name → SlidingWindowCounter
    this._rateWindowMs = opts.rateWindowMs || 60000;
    this._timer = null;
    if (this._persistDir) {
      mkdirSync(this._persistDir, { recursive: true });
      this._restore();
      this._timer = setInterval(() => this._persist(), this._persistInterval);
      if (this._timer.unref) this._timer.unref();
    }
  }

  // ── Counter ──
  counter(name, tags = {}) {
    const key = `${name}{${tagKey(tags)}}`;
    if (!this._metrics.has(key)) {
      const m = new Counter(name, tags);
      this._metrics.set(key, m);
      this.emit('metric:created', m.toJSON());
    }
    return this._metrics.get(key);
  }

  // ── Gauge ──
  gauge(name, tags = {}) {
    const key = `${name}{${tagKey(tags)}}`;
    if (!this._metrics.has(key)) {
      const m = new Gauge(name, tags);
      this._metrics.set(key, m);
      this.emit('metric:created', m.toJSON());
    }
    return this._metrics.get(key);
  }

  // ── Histogram ──
  histogram(name, tags = {}, opts = {}) {
    const key = `${name}{${tagKey(tags)}}`;
    if (!this._metrics.has(key)) {
      const m = new Histogram(name, tags, opts);
      this._metrics.set(key, m);
      this.emit('metric:created', m.toJSON());
    }
    return this._metrics.get(key);
  }

  // ── Timer ──
  timer(name, tags = {}) {
    const key = `${name}{${tagKey(tags)}}`;
    if (!this._metrics.has(key)) {
      const m = new Timer(name, tags);
      this._metrics.set(key, m);
      this.emit('metric:created', m.toJSON());
    }
    return this._metrics.get(key);
  }

  // ── Rate counter ──
  rate(name, tags = {}) {
    const key = `${name}{${tagKey(tags)}}`;
    if (!this._rates.has(key)) this._rates.set(key, new SlidingWindowCounter(this._rateWindowMs));
    return this._rates.get(key);
  }

  // ── Query ──
  get(name) { return this._metrics.get(name) || null; }
  has(name) { return this._metrics.has(name); }
  list() { return [...this._metrics.values()].map(m => m.toJSON()); }

  snapshot() {
    const metrics = {};
    for (const [key, m] of this._metrics) metrics[key] = m.toJSON();
    for (const [key, r] of this._rates) metrics[key + ':rate'] = { type: 'rate', key, value: r.value, rate_per_sec: r.rate() };
    return metrics;
  }

  // ── Prometheus text export ──
  prometheus() {
    const lines = [];
    for (const [key, m] of this._metrics) {
      const tagsStr = Object.entries(m.tags).map(([k, v]) => `${k}="${v}"`).join(',');
      const suffix = tagsStr ? `{${tagsStr}}` : '';
      if (m instanceof Counter) {
        lines.push(`# TYPE ${m.name} counter`);
        lines.push(`${m.name}${suffix} ${m._value}`);
      } else if (m instanceof Gauge) {
        lines.push(`# TYPE ${m.name} gauge`);
        lines.push(`${m.name}${suffix} ${m._value}`);
      } else if (m instanceof Histogram) {
        lines.push(`# TYPE ${m.name} histogram`);
        for (const b of m.buckets()) lines.push(`${m.name}_bucket{le="${b.le}"${tagsStr ? ',' + tagsStr : ''}} ${b.count}`);
        lines.push(`${m.name}_bucket{le="+Inf"${tagsStr ? ',' + tagsStr : ''}} ${m.count}`);
        lines.push(`${m.name}_sum${suffix} ${m.sum}`);
        lines.push(`${m.name}_count${suffix} ${m.count}`);
      } else if (m instanceof Timer) {
        lines.push(`# TYPE ${m.name}_duration_ms summary`);
        const s = m.stats();
        for (const p of ['p50', 'p90', 'p95', 'p99'])
          lines.push(`${m.name}_duration_ms{quantile="${p.slice(1) / 100}"${tagsStr ? ',' + tagsStr : ''}} ${s[p]}`);
        lines.push(`${m.name}_duration_ms_sum${suffix} ${s.sum}`);
        lines.push(`${m.name}_duration_ms_count${suffix} ${s.count}`);
      }
    }
    for (const [key, r] of this._rates) {
      lines.push(`# TYPE ${key}_rate gauge`);
      lines.push(`${key}_rate ${r.rate()}`);
    }
    return lines.join('\n') + '\n';
  }

  // ── Persistence ──
  _persistPath() { return join(this._persistDir, 'metrics.json'); }
  _persist() {
    if (!this._persistDir) return;
    try { writeFileSync(this._persistPath(), JSON.stringify(this.snapshot(), null, 2)); } catch {}
  }
  _restore() {
    if (!this._persistDir) return;
    const p = this._persistPath();
    if (!existsSync(p)) return;
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      for (const [key, val] of Object.entries(data)) {
        if (val.type === 'counter') { const c = this.counter(val.name, val.tags || {}); c._value = val.value || 0; }
        else if (val.type === 'gauge') { const g = this.gauge(val.name, val.tags || {}); g._value = val.value || 0; }
        else if (val.type === 'histogram') { /* histograms don't restore values */ }
      }
    } catch {}
  }

  // ── Auto-timer helper ──
  async time(name, fn, tags = {}) {
    const t = this.timer(name, tags);
    const r = t.start();
    try { const result = await fn(); r.stop(); return result; }
    catch (e) { r.stop(); this.counter(name + '_errors', tags).inc(); throw e; }
  }

  // ── Reset ──
  clear() { this._metrics.clear(); this._rates.clear(); this.emit('cleared'); }
  close() { if (this._timer) clearInterval(this._timer); this._persist(); }
}

export { Counter, Gauge, Histogram, Timer, SlidingWindowCounter, percentile, mean, stddev };
export default MetricsStore;
