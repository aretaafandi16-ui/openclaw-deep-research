/**
 * agent-signal v1.0.0
 * Zero-dep signal processing & time-series analysis engine for AI agents
 *
 * Features:
 * - Rolling statistics (SMA, EMA, WMA, rolling std/var/skew/kurtosis)
 * - Change point detection (CUSUM, Bayesian online)
 * - Correlation analysis (Pearson, Spearman, cross-correlation)
 * - Frequency analysis (periodogram, autocorrelation)
 * - Filtering (moving average, median, Butterworth-like, exponential smoothing)
 * - Peak/valley detection with prominence
 * - Online anomaly detection (z-score, IQR, moving threshold)
 * - Signal interpolation (linear, cubic spline, LOESS-like)
 * - Trend decomposition (trend + seasonal + residual)
 * - Pattern matching (subsequence search)
 * - Resampling (upsample, downsample, aggregation)
 * - JSONL persistence, EventEmitter
 */

import { EventEmitter } from 'events';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ── Helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

function stddev(arr) { return Math.sqrt(variance(arr)); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Rolling Statistics ────────────────────────────────────────────────────────

export class RollingStats {
  constructor(windowSize = 20) {
    this.windowSize = windowSize;
    this.buffer = [];
    this._sum = 0;
    this._sumSq = 0;
  }

  push(value) {
    this.buffer.push(value);
    this._sum += value;
    this._sumSq += value * value;
    if (this.buffer.length > this.windowSize) {
      const removed = this.buffer.shift();
      this._sum -= removed;
      this._sumSq -= removed * removed;
    }
    return this.current();
  }

  current() {
    const n = this.buffer.length;
    if (n === 0) return { mean: 0, variance: 0, stddev: 0, min: 0, max: 0, count: 0 };
    const m = this._sum / n;
    const v = n > 1 ? (this._sumSq - n * m * m) / (n - 1) : 0;
    return {
      mean: m,
      variance: Math.max(0, v),
      stddev: Math.sqrt(Math.max(0, v)),
      min: Math.min(...this.buffer),
      max: Math.max(...this.buffer),
      last: this.buffer[n - 1],
      count: n,
      zScore: n > 1 && v > 0 ? (this.buffer[n - 1] - m) / Math.sqrt(v) : 0,
    };
  }

  reset() { this.buffer = []; this._sum = 0; this._sumSq = 0; }
}

// ── SMA / EMA / WMA ──────────────────────────────────────────────────────────

export function sma(signal, period) {
  const result = [];
  for (let i = 0; i < signal.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += signal[j];
    result.push(sum / period);
  }
  return result;
}

export function ema(signal, period) {
  const result = [];
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < signal.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += signal[j];
      prev = sum / period;
    } else {
      prev = signal[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

export function wma(signal, period) {
  const result = [];
  const denom = (period * (period + 1)) / 2;
  for (let i = 0; i < signal.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += signal[i - period + 1 + j] * (j + 1);
    result.push(sum / denom);
  }
  return result;
}

// ── Filters ──────────────────────────────────────────────────────────────────

export function medianFilter(signal, windowSize = 5) {
  const half = Math.floor(windowSize / 2);
  const result = [];
  for (let i = 0; i < signal.length; i++) {
    const slice = [];
    for (let j = i - half; j <= i + half; j++) {
      slice.push(signal[clamp(j, 0, signal.length - 1)]);
    }
    slice.sort((a, b) => a - b);
    result.push(slice[Math.floor(slice.length / 2)]);
  }
  return result;
}

export function exponentialSmooth(signal, alpha = 0.3) {
  const result = [];
  let prev = signal[0];
  for (let i = 0; i < signal.length; i++) {
    prev = alpha * signal[i] + (1 - alpha) * prev;
    result.push(prev);
  }
  return result;
}

export function butterworthFilter(signal, cutoffRatio = 0.1, order = 2) {
  // Simple single-pole IIR low-pass approximation
  const rc = 1 / (2 * Math.PI * cutoffRatio);
  const dt = 1;
  const alpha = dt / (rc + dt);
  let filtered = [signal[0]];
  for (let i = 1; i < signal.length; i++) {
    filtered.push(filtered[i - 1] + alpha * (signal[i] - filtered[i - 1]));
  }
  // Apply multiple times for higher order
  for (let o = 1; o < order; o++) {
    const next = [filtered[0]];
    for (let i = 1; i < filtered.length; i++) {
      next.push(next[i - 1] + alpha * (filtered[i] - next[i - 1]));
    }
    filtered = next;
  }
  return filtered;
}

export function highPassFilter(signal, cutoffRatio = 0.1) {
  const low = butterworthFilter(signal, cutoffRatio, 1);
  return signal.map((v, i) => v - low[i]);
}

export function bandPassFilter(signal, lowCut = 0.05, highCut = 0.3) {
  const high = highPassFilter(signal, lowCut);
  return butterworthFilter(high, highCut, 1);
}

// ── Peak Detection ───────────────────────────────────────────────────────────

export function findPeaks(signal, options = {}) {
  const { minProminence = 0, minDistance = 1, threshold = 0 } = options;
  const peaks = [];

  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1] && signal[i] >= threshold) {
      // Calculate prominence
      let leftMin = signal[i], rightMin = signal[i];
      for (let j = i - 1; j >= 0; j--) {
        if (signal[j] < leftMin) leftMin = signal[j];
        if (signal[j] > signal[i]) break;
      }
      for (let j = i + 1; j < signal.length; j++) {
        if (signal[j] < rightMin) rightMin = signal[j];
        if (signal[j] > signal[i]) break;
      }
      const prominence = signal[i] - Math.max(leftMin, rightMin);

      if (prominence >= minProminence) {
        // Check min distance from last accepted peak
        if (peaks.length === 0 || i - peaks[peaks.length - 1].index >= minDistance) {
          peaks.push({ index: i, value: signal[i], prominence, type: 'peak' });
        } else if (prominence > peaks[peaks.length - 1].prominence) {
          peaks[peaks.length - 1] = { index: i, value: signal[i], prominence, type: 'peak' };
        }
      }
    }
  }
  return peaks;
}

export function findValleys(signal, options = {}) {
  const inverted = signal.map(v => -v);
  return findPeaks(inverted, options).map(p => ({
    index: p.index, value: signal[p.index], prominence: p.prominence, type: 'valley'
  }));
}

// ── Anomaly Detection ────────────────────────────────────────────────────────

export function detectAnomaliesZScore(signal, threshold = 3, windowSize = 20) {
  const anomalies = [];
  const rolling = new RollingStats(windowSize);
  for (let i = 0; i < signal.length; i++) {
    const stats = rolling.push(signal[i]);
    if (stats.count >= windowSize && Math.abs(stats.zScore) > threshold) {
      anomalies.push({
        index: i, value: signal[i], zScore: stats.zScore,
        expected: stats.mean, deviation: Math.abs(signal[i] - stats.mean),
      });
    }
  }
  return anomalies;
}

export function detectAnomaliesIQR(signal, multiplier = 1.5) {
  const sorted = [...signal].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  const lower = q1 - multiplier * iqr;
  const upper = q3 + multiplier * iqr;
  return signal.map((v, i) => ({
    index: i, value: v, isAnomaly: v < lower || v > upper, lower, upper,
  })).filter(a => a.isAnomaly);
}

export function detectAnomaliesMovingThreshold(signal, windowSize = 20, multiplier = 2) {
  const anomalies = [];
  for (let i = windowSize; i < signal.length; i++) {
    const window = signal.slice(i - windowSize, i);
    const m = mean(window);
    const s = stddev(window);
    if (s > 0 && Math.abs(signal[i] - m) > multiplier * s) {
      anomalies.push({
        index: i, value: signal[i], expected: m, threshold: multiplier * s,
        deviation: Math.abs(signal[i] - m),
      });
    }
  }
  return anomalies;
}

// ── Change Point Detection ───────────────────────────────────────────────────

export function detectChangePointsCUSUM(signal, options = {}) {
  const { threshold = 4, drift = 0.5, direction = 'both' } = options;
  const cp = [];
  let sHigh = 0, sLow = 0;

  for (let i = 1; i < signal.length; i++) {
    const diff = signal[i] - signal[i - 1];
    sHigh = Math.max(0, sHigh + diff - drift);
    sLow = Math.max(0, sLow - diff - drift);

    if (direction !== 'down' && sHigh > threshold) {
      cp.push({ index: i, value: signal[i], direction: 'up', score: sHigh });
      sHigh = 0;
    }
    if (direction !== 'up' && sLow > threshold) {
      cp.push({ index: i, value: signal[i], direction: 'down', score: sLow });
      sLow = 0;
    }
  }
  return cp;
}

export function detectChangePointsBayesian(signal, options = {}) {
  const { hazardRate = 200, threshold = 0.5 } = options;
  const cp = [];
  let runLength = 0;
  let prevMean = signal[0];
  let prevVar = 1;
  let n = 1;

  for (let i = 1; i < signal.length; i++) {
    const x = signal[i];
    const predictiveProb = gaussianPdf(x, prevMean, Math.sqrt(prevVar + 1));
    const hazardProb = 1 / hazardRate;
    const runLengthProb = predictiveProb * (1 - hazardProb);
    const changeProb = hazardProb;

    const totalProb = runLengthProb + changeProb;
    const pChange = changeProb / totalProb;

    if (pChange > threshold) {
      cp.push({ index: i, value: signal[i], probability: pChange });
      runLength = 0;
      prevMean = x;
      prevVar = 1;
      n = 1;
    } else {
      runLength++;
      n++;
      const delta = x - prevMean;
      prevMean += delta / n;
      prevVar = prevVar * (n - 1) / n + delta * (x - prevMean) / n;
    }
  }
  return cp;
}

function gaussianPdf(x, mean, sigma) {
  const exp = Math.exp(-0.5 * ((x - mean) / sigma) ** 2);
  return exp / (sigma * Math.sqrt(2 * Math.PI));
}

// ── Correlation ──────────────────────────────────────────────────────────────

export function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return { r: 0, n: x.length };
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return { r: denom === 0 ? 0 : num / denom, n };
}

export function spearmanCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return { rho: 0, n: x.length };
  const rank = arr => {
    const indexed = arr.map((v, i) => [v, i]);
    indexed.sort((a, b) => a[0] - b[0]);
    const ranks = new Array(arr.length);
    for (let i = 0; i < indexed.length; i++) ranks[indexed[i][1]] = i + 1;
    return ranks;
  };
  return { ...pearsonCorrelation(rank(x), rank(y)), type: 'spearman' };
}

export function crossCorrelation(x, y, maxLag = null) {
  const n = Math.min(x.length, y.length);
  const lag = maxLag ?? Math.floor(n / 4);
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { dx2 += (x[i] - mx) ** 2; dy2 += (y[i] - my) ** 2; }
  const denom = Math.sqrt(dx2 * dy2);

  const results = [];
  for (let l = -lag; l <= lag; l++) {
    let num = 0;
    for (let i = 0; i < n; i++) {
      const j = i + l;
      if (j >= 0 && j < n) num += (x[i] - mx) * (y[j] - my);
    }
    results.push({ lag: l, correlation: denom === 0 ? 0 : num / denom });
  }
  return results;
}

export function autoCorrelation(signal, maxLag = null) {
  const n = signal.length;
  const lag = maxLag ?? Math.floor(n / 4);
  const m = mean(signal);
  let denom = 0;
  for (let i = 0; i < n; i++) denom += (signal[i] - m) ** 2;

  const results = [];
  for (let l = 0; l <= lag; l++) {
    let num = 0;
    for (let i = 0; i < n - l; i++) num += (signal[i] - m) * (signal[i + l] - m);
    results.push({ lag: l, correlation: denom === 0 ? 0 : num / denom });
  }
  return results;
}

// ── Frequency Analysis ───────────────────────────────────────────────────────

export function periodogram(signal) {
  const n = signal.length;
  const m = mean(signal);
  const N = Math.pow(2, Math.ceil(Math.log2(n)));
  const padded = new Array(N).fill(0);
  for (let i = 0; i < n; i++) padded[i] = signal[i] - m;

  // DFT (naive O(N²) — zero-dep)
  const spectrum = [];
  for (let k = 0; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let t = 0; t < N; t++) {
      const angle = (2 * Math.PI * k * t) / N;
      re += padded[t] * Math.cos(angle);
      im -= padded[t] * Math.sin(angle);
    }
    const power = (re * re + im * im) / N;
    spectrum.push({ frequency: k / N, power, magnitude: Math.sqrt(re * re + im * im) / N, phase: Math.atan2(im, re) });
  }
  return spectrum;
}

export function dominantFrequency(signal) {
  const spec = periodogram(signal);
  let max = 0, maxIdx = 0;
  for (let i = 1; i < spec.length; i++) {
    if (spec[i].power > max) { max = spec[i].power; maxIdx = i; }
  }
  return { frequency: spec[maxIdx].frequency, period: spec[maxIdx].frequency > 0 ? 1 / spec[maxIdx].frequency : Infinity, power: max };
}

// ── Interpolation ────────────────────────────────────────────────────────────

export function linearInterpolate(signal, indices) {
  return indices.map(idx => {
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return signal[lo] ?? 0;
    const frac = idx - lo;
    return (signal[lo] ?? 0) * (1 - frac) + (signal[hi] ?? 0) * frac;
  });
}

export function cubicSpline(signal) {
  const n = signal.length;
  if (n < 3) return [...signal];

  // Natural cubic spline coefficients
  const h = new Array(n - 1).fill(0);
  const alpha = new Array(n).fill(0);
  const l = new Array(n).fill(0);
  const mu = new Array(n).fill(0);
  const z = new Array(n).fill(0);
  const c = new Array(n).fill(0);
  const b = new Array(n - 1).fill(0);
  const d = new Array(n - 1).fill(0);

  for (let i = 0; i < n - 1; i++) h[i] = 1;
  for (let i = 1; i < n - 1; i++) alpha[i] = (3 / h[i]) * (signal[i + 1] - signal[i]) - (3 / h[i - 1]) * (signal[i] - signal[i - 1]);

  l[0] = 1;
  for (let i = 1; i < n - 1; i++) { l[i] = 2 * (i + 1 - (i - 1)) - h[i - 1] * mu[i - 1]; mu[i] = h[i] / l[i]; z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i]; }
  l[n - 1] = 1;

  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (signal[j + 1] - signal[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }

  // Generate interpolated values at midpoints
  const result = [];
  for (let i = 0; i < n - 1; i++) {
    result.push(signal[i]);
    const mid = 0.5;
    result.push(signal[i] + b[i] * mid + c[i] * mid * mid + d[i] * mid * mid * mid);
  }
  result.push(signal[n - 1]);
  return result;
}

// ── Trend Decomposition ──────────────────────────────────────────────────────

export function decomposeTrend(signal, period = 12) {
  const n = signal.length;
  const trend = sma(signal, period);

  // Seasonal component: average of detrended values by position in period
  const seasonal = new Array(n).fill(0);
  const detrended = signal.map((v, i) => trend[i] !== null ? v - trend[i] : 0);
  const seasonAvgs = new Array(period).fill(0);
  const seasonCounts = new Array(period).fill(0);
  for (let i = 0; i < n; i++) {
    const pos = i % period;
    seasonAvgs[pos] += detrended[i];
    seasonCounts[pos]++;
  }
  for (let i = 0; i < period; i++) {
    seasonAvgs[i] = seasonCounts[i] > 0 ? seasonAvgs[i] / seasonCounts[i] : 0;
  }
  for (let i = 0; i < n; i++) seasonal[i] = seasonAvgs[i % period];

  // Residual
  const residual = signal.map((v, i) => trend[i] !== null ? v - trend[i] - seasonal[i] : 0);

  return { trend, seasonal, residual, strength: {
    trend: 1 - variance(residual) / variance(signal),
    seasonal: 1 - variance(residual) / variance(signal.map((v, i) => v - (trend[i] ?? 0))),
  }};
}

// ── Pattern Matching ─────────────────────────────────────────────────────────

export function findPattern(signal, pattern, tolerance = 0.1) {
  const matches = [];
  const pn = pattern.length;
  if (pn === 0 || signal.length < pn) return matches;

  // Normalize pattern
  const pMin = Math.min(...pattern), pMax = Math.max(...pattern);
  const pRange = pMax - pMin || 1;
  const normPattern = pattern.map(v => (v - pMin) / pRange);

  for (let i = 0; i <= signal.length - pn; i++) {
    const window = signal.slice(i, i + pn);
    const wMin = Math.min(...window), wMax = Math.max(...window);
    const wRange = wMax - wMin || 1;
    const normWindow = window.map(v => (v - wMin) / wRange);

    let mse = 0;
    for (let j = 0; j < pn; j++) mse += (normPattern[j] - normWindow[j]) ** 2;
    mse /= pn;

    if (mse <= tolerance) {
      matches.push({ index: i, mse, similarity: 1 - mse, end: i + pn - 1 });
    }
  }
  return matches;
}

// ── Resampling ───────────────────────────────────────────────────────────────

export function downsample(signal, factor, method = 'mean') {
  const result = [];
  for (let i = 0; i < signal.length; i += factor) {
    const chunk = signal.slice(i, i + factor);
    if (method === 'mean') result.push(mean(chunk));
    else if (method === 'median') { const s = [...chunk].sort((a, b) => a - b); result.push(s[Math.floor(s.length / 2)]); }
    else if (method === 'max') result.push(Math.max(...chunk));
    else if (method === 'min') result.push(Math.min(...chunk));
    else if (method === 'first') result.push(chunk[0]);
    else if (method === 'last') result.push(chunk[chunk.length - 1]);
  }
  return result;
}

export function upsample(signal, factor, method = 'linear') {
  if (method === 'linear') {
    const indices = [];
    for (let i = 0; i < signal.length - 1; i++) {
      indices.push(i);
      for (let j = 1; j < factor; j++) indices.push(i + j / factor);
    }
    indices.push(signal.length - 1);
    return linearInterpolate(signal, indices);
  }
  // repeat
  const result = [];
  for (const v of signal) for (let i = 0; i < factor; i++) result.push(v);
  return result;
}

// ── Signal Metrics ───────────────────────────────────────────────────────────

export function signalMetrics(signal) {
  if (!signal.length) return { count: 0 };
  const sorted = [...signal].sort((a, b) => a - b);
  const m = mean(signal);
  const v = variance(signal);
  const s = stddev(signal);
  const m3 = signal.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0) / signal.length;
  const m4 = signal.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0) / signal.length;

  return {
    count: signal.length,
    mean: m, median: percentile(sorted, 50), variance: v, stddev: s,
    min: sorted[0], max: sorted[sorted.length - 1],
    range: sorted[sorted.length - 1] - sorted[0],
    q1: percentile(sorted, 25), q3: percentile(sorted, 75),
    iqr: percentile(sorted, 75) - percentile(sorted, 25),
    p5: percentile(sorted, 5), p95: percentile(sorted, 95),
    p1: percentile(sorted, 1), p99: percentile(sorted, 99),
    skewness: isNaN(m3) ? 0 : m3,
    kurtosis: isNaN(m4) ? 0 : m4 - 3,
    sum: signal.reduce((a, b) => a + b, 0),
    rms: Math.sqrt(signal.reduce((a, b) => a + b * b, 0) / signal.length),
    energy: signal.reduce((a, b) => a + b * b, 0),
    zeroCrossings: signal.filter((v, i) => i > 0 && Math.sign(v) !== Math.sign(signal[i - 1])).length,
  };
}

// ── SignalEngine (main class) ────────────────────────────────────────────────

export class SignalEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxHistory = options.maxHistory ?? 10000;
    this.signals = new Map(); // name -> data[]
    this.snapshots = new Map();
    this.persistPath = options.persistPath || null;
    this.stats = { processed: 0, anomaliesDetected: 0, changePoints: 0 };
  }

  // ── Data management ──

  add(name, values) {
    if (!this.signals.has(name)) this.signals.set(name, []);
    const arr = this.signals.get(name);
    const pts = Array.isArray(values) ? values : [values];
    arr.push(...pts);
    if (arr.length > this.maxHistory) arr.splice(0, arr.length - this.maxHistory);
    this.stats.processed += pts.length;
    this.emit('data', { name, added: pts.length, total: arr.length });
    if (this.persistPath) this._persist('data', { name, values: pts });
    return arr.length;
  }

  get(name) { return this.signals.get(name) || []; }
  has(name) { return this.signals.has(name); }
  list() { return [...this.signals.keys()]; }
  clear(name) { if (name) this.signals.delete(name); else this.signals.clear(); }

  snapshot(name) { this.snapshots.set(name, [...(this.signals.get(name) || [])]); }
  restoreSnapshot(name) {
    const data = this.snapshots.get(name);
    if (data) { this.signals.set(name, [...data]); return true; }
    return false;
  }

  // ── Analysis wrappers ──

  sma(name, period) { return sma(this.get(name), period); }
  ema(name, period) { return ema(this.get(name), period); }
  wma(name, period) { return wma(this.get(name), period); }

  filter(name, type = 'median', options = {}) {
    const signal = this.get(name);
    if (type === 'median') return medianFilter(signal, options.windowSize);
    if (type === 'exponential') return exponentialSmooth(signal, options.alpha);
    if (type === 'lowpass') return butterworthFilter(signal, options.cutoff, options.order);
    if (type === 'highpass') return highPassFilter(signal, options.cutoff);
    if (type === 'bandpass') return bandPassFilter(signal, options.lowCut, options.highCut);
    throw new Error(`Unknown filter type: ${type}`);
  }

  peaks(name, options) { return findPeaks(this.get(name), options); }
  valleys(name, options) { return findValleys(this.get(name), options); }

  anomalies(name, method = 'zscore', options = {}) {
    const signal = this.get(name);
    let result;
    if (method === 'zscore') result = detectAnomaliesZScore(signal, options.threshold, options.windowSize);
    else if (method === 'iqr') result = detectAnomaliesIQR(signal, options.multiplier);
    else if (method === 'moving') result = detectAnomaliesMovingThreshold(signal, options.windowSize, options.multiplier);
    else throw new Error(`Unknown anomaly method: ${method}`);
    this.stats.anomaliesDetected += result.length;
    if (result.length) this.emit('anomaly', { name, method, count: result.length, anomalies: result });
    return result;
  }

  changePoints(name, method = 'cusum', options = {}) {
    const signal = this.get(name);
    let result;
    if (method === 'cusum') result = detectChangePointsCUSUM(signal, options);
    else if (method === 'bayesian') result = detectChangePointsBayesian(signal, options);
    else throw new Error(`Unknown change point method: ${method}`);
    this.stats.changePoints += result.length;
    if (result.length) this.emit('changePoint', { name, method, count: result.length, points: result });
    return result;
  }

  correlate(name1, name2, type = 'pearson') {
    const x = this.get(name1), y = this.get(name2);
    if (type === 'pearson') return pearsonCorrelation(x, y);
    if (type === 'spearman') return spearmanCorrelation(x, y);
    if (type === 'cross') return crossCorrelation(x, y);
    throw new Error(`Unknown correlation type: ${type}`);
  }

  autocorrelate(name, maxLag) { return autoCorrelation(this.get(name), maxLag); }

  spectrum(name) { return periodogram(this.get(name)); }
  dominantFreq(name) { return dominantFrequency(this.get(name)); }

  decompose(name, period) { return decomposeTrend(this.get(name), period); }

  findPattern(name, pattern, tolerance) { return findPattern(this.get(name), pattern, tolerance); }

  metrics(name) { return signalMetrics(this.get(name)); }

  downsample(name, factor, method) { return downsample(this.get(name), factor, method); }
  upsample(name, factor, method) { return upsample(this.get(name), factor, method); }

  // ── Pipeline ──

  pipeline(name, steps) {
    let data = [...this.get(name)];
    for (const step of steps) {
      if (step.type === 'sma') data = sma(data, step.period);
      else if (step.type === 'ema') data = ema(data, step.period);
      else if (step.type === 'median') data = medianFilter(data, step.windowSize);
      else if (step.type === 'exponential') data = exponentialSmooth(data, step.alpha);
      else if (step.type === 'lowpass') data = butterworthFilter(data, step.cutoff, step.order);
      else if (step.type === 'highpass') data = highPassFilter(data, step.cutoff);
      else if (step.type === 'downsample') data = downsample(data, step.factor, step.method);
      else if (step.type === 'upsample') data = upsample(data, step.factor, step.method);
      else throw new Error(`Unknown pipeline step: ${step.type}`);
    }
    return data;
  }

  // ── Persistence ──

  _persist(event, data) {
    if (!this.persistPath) return;
    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(this.persistPath, JSON.stringify({ ts: Date.now(), event, ...data }) + '\n');
  }

  exportAll() {
    const result = {};
    for (const [name, data] of this.signals) result[name] = [...data];
    return result;
  }

  importAll(data) {
    for (const [name, values] of Object.entries(data)) this.signals.set(name, [...values]);
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

export default SignalEngine;
export {
  percentile, mean, variance, stddev,
};
