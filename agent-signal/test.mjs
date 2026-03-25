/**
 * agent-signal test suite
 */

import {
  SignalEngine, RollingStats,
  sma, ema, wma, medianFilter, exponentialSmooth,
  butterworthFilter, highPassFilter, bandPassFilter,
  findPeaks, findValleys,
  detectAnomaliesZScore, detectAnomaliesIQR, detectAnomaliesMovingThreshold,
  detectChangePointsCUSUM, detectChangePointsBayesian,
  pearsonCorrelation, spearmanCorrelation, crossCorrelation, autoCorrelation,
  periodogram, dominantFrequency,
  linearInterpolate, cubicSpline,
  decomposeTrend, findPattern,
  downsample, upsample,
  signalMetrics, mean, variance, stddev, percentile,
} from './index.mjs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// Helpers
const sine = (n = 100, freq = 0.1, amp = 1, noise = 0) =>
  Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * freq * i) + noise * (Math.random() - 0.5));
const ramp = (n = 100) => Array.from({ length: n }, (_, i) => i);
const constant = (n = 100, v = 5) => new Array(n).fill(v);

console.log('\n🧪 agent-signal tests\n');

// ── RollingStats ──
console.log('RollingStats:');
test('basic push and stats', () => {
  const rs = new RollingStats(5);
  [1, 2, 3, 4, 5].forEach(v => rs.push(v));
  const s = rs.current();
  assert(s.mean === 3, 'mean should be 3');
  assert(s.min === 1, 'min should be 1');
  assert(s.max === 5, 'max should be 5');
  assert(s.count === 5, 'count should be 5');
});

test('window eviction', () => {
  const rs = new RollingStats(3);
  [1, 2, 3, 4, 5].forEach(v => rs.push(v));
  const s = rs.current();
  assert(s.mean === 4, `mean should be 4, got ${s.mean}`);
  assert(s.count === 3, 'count should be 3');
});

test('zScore', () => {
  const rs = new RollingStats(10);
  for (let i = 0; i < 10; i++) rs.push(5);
  rs.push(500);
  const s = rs.current();
  assert(s.zScore > 2, `zScore should be elevated, got ${s.zScore}`);
});

// ── SMA / EMA / WMA ──
console.log('\nSMA/EMA/WMA:');
test('SMA', () => {
  const r = sma([1, 2, 3, 4, 5], 3);
  assert(r[0] === null, 'first two null');
  assert(r[2] === 2, 'SMA(1,2,3)=2');
  assert(r[4] === 4, 'SMA(3,4,5)=4');
});

test('EMA', () => {
  const r = ema([1, 2, 3, 4, 5], 3);
  assert(r[0] === null);
  assert(r[2] === 2, 'first EMA = SMA');
  assert(r[4] > r[3], 'EMA should follow trend');
});

test('WMA', () => {
  const r = wma([1, 2, 3, 4, 5], 3);
  assert(r[0] === null);
  assert(r[2] > 2, 'WMA weighted toward recent');
});

// ── Filters ──
console.log('\nFilters:');
test('median filter removes spike', () => {
  const signal = [1, 1, 1, 100, 1, 1, 1];
  const filtered = medianFilter(signal, 5);
  assert(filtered[3] === 1, 'spike should be removed');
});

test('exponential smooth', () => {
  const signal = [0, 0, 0, 10, 10, 10];
  const r = exponentialSmooth(signal, 0.5);
  assert(r[0] === 0, 'starts at 0');
  assert(r[r.length - 1] > 8, 'converges toward 10');
});

test('butterworth lowpass', () => {
  const signal = sine(100, 0.3, 1);
  const filtered = butterworthFilter(signal, 0.1);
  const origEnergy = signal.reduce((a, v) => a + v * v, 0);
  const filtEnergy = filtered.reduce((a, v) => a + v * v, 0);
  assert(filtEnergy < origEnergy, 'lowpass reduces energy');
});

test('highpass', () => {
  const signal = [...constant(50, 5), ...constant(50, 10)];
  const filtered = highPassFilter(signal, 0.1);
  assert(Math.abs(mean(filtered)) < 1, 'highpass removes DC');
});

test('bandpass', () => {
  const signal = sine(100, 0.1, 1);
  const filtered = bandPassFilter(signal, 0.05, 0.3);
  assert(filtered.length === signal.length, 'same length');
});

// ── Peak Detection ──
console.log('\nPeak Detection:');
test('find peaks in sine', () => {
  const signal = sine(200, 0.05, 10);
  const peaks = findPeaks(signal);
  assert(peaks.length >= 9, `should find ~10 peaks, found ${peaks.length}`);
});

test('find valleys', () => {
  const signal = sine(200, 0.05, 10);
  const valleys = findValleys(signal);
  assert(valleys.length >= 9, `should find ~10 valleys, found ${valleys.length}`);
});

test('prominence filter', () => {
  const signal = [0, 5, 0, 10, 0, 3, 0];
  const peaks = findPeaks(signal, { minProminence: 4 });
  assert(peaks.length >= 1, `should find prominent peak(s), found ${peaks.length}`);
  assert(peaks.some(p => p.value === 10), 'should include the 10');
});

test('min distance', () => {
  const signal = [0, 10, 0, 9, 0, 8, 0];
  const peaks = findPeaks(signal, { minDistance: 3 });
  assert(peaks.length <= 2, `should limit peaks by distance, got ${peaks.length}`);
});

// ── Anomaly Detection ──
console.log('\nAnomaly Detection:');
test('z-score anomalies', () => {
  const signal = [...constant(50, 5), 100, ...constant(49, 5)];
  const anomalies = detectAnomaliesZScore(signal, 3, 20);
  assert(anomalies.length >= 1, 'should detect the spike');
  assert(anomalies[0].index === 50, 'spike at index 50');
});

test('IQR anomalies', () => {
  const signal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  const anomalies = detectAnomaliesIQR(signal);
  assert(anomalies.length >= 1, 'should detect 100');
});

test('moving threshold', () => {
  const signal = [...Array(20)].map(() => 5 + Math.random() * 0.5);
  signal.push(50);
  signal.push(...[...Array(20)].map(() => 5 + Math.random() * 0.5));
  const anomalies = detectAnomaliesMovingThreshold(signal, 10, 3);
  assert(anomalies.length >= 1, 'should detect spike');
});

// ── Change Point Detection ──
console.log('\nChange Points:');
test('CUSUM detects level shift', () => {
  const signal = [...constant(50, 10), ...constant(50, 20)];
  const cp = detectChangePointsCUSUM(signal, { threshold: 3, drift: 0.5 });
  assert(cp.length >= 1, 'should detect level shift');
  assert(cp[0].index >= 48 && cp[0].index <= 55, `shift near index 50, got ${cp[0].index}`);
});

test('Bayesian change points', () => {
  const signal = [...constant(50, 10), ...constant(50, 20)];
  const cp = detectChangePointsBayesian(signal);
  assert(cp.length >= 1, 'should detect change');
});

// ── Correlation ──
console.log('\nCorrelation:');
test('pearson perfect positive', () => {
  const x = ramp(50);
  const { r } = pearsonCorrelation(x, x.map(v => v * 2 + 1));
  assert(r > 0.99, `should be ~1, got ${r}`);
});

test('pearson perfect negative', () => {
  const x = ramp(50);
  const { r } = pearsonCorrelation(x, x.map(v => -v));
  assert(r < -0.99, `should be ~-1, got ${r}`);
});

test('pearson uncorrelated', () => {
  const x = ramp(100);
  const y = sine(100, 0.5, 1);
  const { r } = pearsonCorrelation(x, y);
  assert(Math.abs(r) < 0.3, `should be near 0, got ${r}`);
});

test('spearman', () => {
  const x = [1, 2, 3, 4, 5];
  const { r } = spearmanCorrelation(x, x.map(v => v * v));
  assert(r > 0.99, 'monotonic should give r=1');
});

test('cross-correlation', () => {
  const x = sine(100, 0.1, 1);
  const cc = crossCorrelation(x, x, 10);
  const lag0 = cc.find(c => c.lag === 0);
  assert(lag0.correlation > 0.99, 'self xcorr at lag 0 should be 1');
});

test('auto-correlation', () => {
  const signal = sine(200, 0.05, 1);
  const ac = autoCorrelation(signal, 30);
  assert(ac[0].correlation > 0.99, 'autocorr at lag 0 = 1');
});

// ── Frequency Analysis ──
console.log('\nFrequency:');
test('periodogram finds dominant frequency', () => {
  const signal = sine(256, 10 / 256, 5);
  const freq = dominantFrequency(signal);
  assert(freq.period > 20 && freq.period < 30, `period should be ~25.6, got ${freq.period}`);
});

test('periodogram returns correct structure', () => {
  const spec = periodogram([1, 2, 3, 4, 5, 6, 7, 8]);
  assert(spec.length === 4, 'N/2 bins');
  assert('frequency' in spec[0] && 'power' in spec[0], 'correct structure');
});

// ── Interpolation ──
console.log('\nInterpolation:');
test('linear interpolation', () => {
  const signal = [0, 10];
  const r = linearInterpolate(signal, [0, 0.5, 1]);
  assert(r[0] === 0, 'start');
  assert(r[1] === 5, 'midpoint');
  assert(r[2] === 10, 'end');
});

test('cubic spline', () => {
  const signal = [0, 1, 4, 9, 16];
  const r = cubicSpline(signal);
  assert(r.length >= signal.length, 'upsampled');
});

// ── Trend Decomposition ──
console.log('\nTrend Decomposition:');
test('decompose linear trend + seasonal', () => {
  const signal = Array.from({ length: 48 }, (_, i) => i + Math.sin(i * Math.PI / 6));
  const d = decomposeTrend(signal, 12);
  assert(d.trend.length === signal.length, 'trend length');
  assert(d.seasonal.length === signal.length, 'seasonal length');
  assert(d.residual.length === signal.length, 'residual length');
});

// ── Pattern Matching ──
console.log('\nPattern Matching:');
test('find exact pattern', () => {
  const signal = [1, 2, 3, 0, 0, 1, 2, 3, 0, 0, 1, 2, 3];
  const matches = findPattern(signal, [1, 2, 3], 0.01);
  assert(matches.length >= 3, `should find 3+ matches, found ${matches.length}`);
});

test('find pattern with noise', () => {
  const signal = [1, 2, 3, 0, 0, 1.1, 1.9, 3.1, 0, 0];
  const matches = findPattern(signal, [1, 2, 3], 0.05);
  assert(matches.length >= 2, `should find 2 matches, found ${matches.length}`);
});

// ── Resampling ──
console.log('\nResampling:');
test('downsample mean', () => {
  const signal = [1, 2, 3, 4, 5, 6];
  const r = downsample(signal, 2, 'mean');
  assert(r.length === 3, 'half length');
  assert(r[0] === 1.5, 'mean of 1,2');
  assert(r[1] === 3.5, 'mean of 3,4');
});

test('upsample linear', () => {
  const signal = [0, 10];
  const r = upsample(signal, 2, 'linear');
  assert(r.length >= 3, 'upsampled length');
});

// ── Signal Metrics ──
console.log('\nSignal Metrics:');
test('basic metrics', () => {
  const m = signalMetrics([1, 2, 3, 4, 5]);
  assert(m.mean === 3, 'mean');
  assert(m.median === 3, 'median');
  assert(m.min === 1, 'min');
  assert(m.max === 5, 'max');
  assert(m.count === 5, 'count');
  assert(m.range === 4, 'range');
  assert(m.sum === 15, 'sum');
});

test('empty signal', () => {
  const m = signalMetrics([]);
  assert(m.count === 0, 'empty');
});

// ── SignalEngine ──
console.log('\nSignalEngine:');
test('add/get/list/clear', () => {
  const eng = new SignalEngine();
  eng.add('temp', [1, 2, 3]);
  assert(eng.get('temp').length === 3, 'has 3 values');
  assert(eng.list().includes('temp'), 'listed');
  eng.add('temp', [4, 5]);
  assert(eng.get('temp').length === 5, 'appended');
  eng.clear('temp');
  assert(!eng.has('temp'), 'cleared');
});

test('snapshot/restore', () => {
  const eng = new SignalEngine();
  eng.add('x', [1, 2, 3]);
  eng.snapshot('x');
  eng.add('x', [4, 5]);
  assert(eng.get('x').length === 5, 'after add');
  eng.restoreSnapshot('x');
  assert(eng.get('x').length === 3, 'restored');
});

test('pipeline', () => {
  const eng = new SignalEngine();
  eng.add('sig', sine(100, 0.1, 1, 0.5));
  const result = eng.pipeline('sig', [
    { type: 'median', windowSize: 5 },
    { type: 'sma', period: 5 },
  ]);
  assert(result.length > 0, 'pipeline produces output');
  const nonNull = result.filter(v => v !== null);
  assert(nonNull.length > 0, 'has non-null values');
});

test('analysis wrappers', () => {
  const eng = new SignalEngine();
  eng.add('s', sine(100, 0.05, 10));
  assert(eng.sma('s', 5).length === 100, 'sma');
  assert(eng.peaks('s').length > 0, 'peaks');
  assert(eng.valleys('s').length > 0, 'valleys');
  assert(eng.metrics('s').count === 100, 'metrics');
  assert(eng.spectrum('s').length > 0, 'spectrum');
});

test('cross-signal correlation', () => {
  const eng = new SignalEngine();
  const data = ramp(50);
  eng.add('a', data);
  eng.add('b', data.map(v => v * 2));
  const { r } = eng.correlate('a', 'b', 'pearson');
  assert(r > 0.99, `correlated signals, r=${r}`);
});

test('anomaly events', () => {
  const eng = new SignalEngine();
  let anomalyFired = false;
  eng.on('anomaly', () => anomalyFired = true);
  eng.add('x', [...constant(30, 5), 100, ...constant(29, 5)]);
  eng.anomalies('x', 'zscore', { threshold: 2 });
  assert(anomalyFired, 'anomaly event fired');
});

test('export/import', () => {
  const eng = new SignalEngine();
  eng.add('a', [1, 2, 3]);
  eng.add('b', [4, 5, 6]);
  const exported = eng.exportAll();
  const eng2 = new SignalEngine();
  eng2.importAll(exported);
  assert(eng2.get('a').length === 3, 'imported a');
  assert(eng2.get('b').length === 3, 'imported b');
});

test('maxHistory truncation', () => {
  const eng = new SignalEngine({ maxHistory: 10 });
  eng.add('x', Array.from({ length: 20 }, (_, i) => i));
  assert(eng.get('x').length === 10, 'truncated to maxHistory');
  assert(eng.get('x')[0] === 10, 'oldest removed');
});

// ── Summary ──
console.log(`\n${'─'.repeat(40)}`);
console.log(`✅ ${passed} passed, ❌ ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All tests passed! 🎉\n');
