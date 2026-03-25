# agent-signal 📡

Zero-dependency signal processing & time-series analysis engine for AI agents.

## Features

| Category | Operations |
|----------|-----------|
| **Rolling Stats** | SMA, EMA, WMA, rolling mean/variance/stddev/z-score with configurable window |
| **Filters** | Median, exponential smoothing, Butterworth low-pass, high-pass, band-pass |
| **Peak Detection** | Peak/valley detection with prominence scoring and min-distance filtering |
| **Anomaly Detection** | Z-score, IQR, moving threshold — configurable sensitivity |
| **Change Points** | CUSUM (cumulative sum) and Bayesian online change point detection |
| **Correlation** | Pearson, Spearman, cross-correlation with lag, auto-correlation |
| **Frequency** | Periodogram (DFT), dominant frequency/power, spectral analysis |
| **Interpolation** | Linear, cubic spline |
| **Decomposition** | Trend + seasonal + residual with strength metrics |
| **Pattern Matching** | Normalized subsequence search with MSE tolerance |
| **Resampling** | Downsample (mean/median/max/min/first/last), upsample (linear/repeat) |
| **Signal Metrics** | Mean, median, stddev, percentiles (P5/P25/P75/P95/P99), skewness, kurtosis, RMS, energy, zero crossings |

## Quick Start

```js
import { SignalEngine, signalMetrics, sma, findPeaks, detectAnomaliesZScore } from './index.mjs';

// Simple functions
const data = [1, 2, 3, 100, 5, 6, 7];
console.log(signalMetrics(data));
console.log(sma(data, 3));
console.log(findPeaks(data, { minProminence: 5 }));
console.log(detectAnomaliesZScore(data, 2, 5));

// Full engine
const engine = new SignalEngine();
engine.add('temperature', [22.1, 22.3, 22.5, 23.0, 35.2, 22.8, 22.4]);
engine.anomalies('temperature', 'zscore', { threshold: 2 });
engine.changePoints('temperature', 'cusum');
engine.peaks('temperature', { minProminence: 1 });
```

## CLI

```bash
# Demo
node cli.mjs demo

# Metrics
node cli.mjs metrics "1,2,3,4,5,100,6,7,8,9"

# SMA
node cli.mjs sma "1,2,3,4,5,6,7,8,9,10" --period 3

# Find peaks
node cli.mjs peaks "0,5,0,10,0,3,0" --prominence 4

# Anomaly detection
node cli.mjs anomalies "5,5,5,5,100,5,5" --threshold 2

# Change points
node cli.mjs changepoints "10,10,10,10,20,20,20,20" --threshold 3

# Correlation
node cli.mjs correlate "1,2,3,4,5" "2,4,6,8,10"

# Spectrum
node cli.mjs spectrum "<256 comma-separated values>"
```

## HTTP Server

```bash
node server.mjs
# Dashboard: http://localhost:3145
# API: http://localhost:3145/api/signals
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/signals` | Add signal data `{name, values}` |
| GET | `/api/signals` | List all signals |
| GET | `/api/metrics?name=X` | Signal statistics |
| GET | `/api/sma?name=X&period=N` | Simple Moving Average |
| GET | `/api/ema?name=X&period=N` | Exponential Moving Average |
| GET | `/api/peaks?name=X&prominence=N` | Peak detection |
| GET | `/api/anomalies?name=X&threshold=N` | Anomaly detection |
| GET | `/api/changepoints?name=X&threshold=N` | Change point detection |
| GET | `/api/spectrum?name=X` | Frequency spectrum |
| GET | `/api/stats` | Engine statistics |

## MCP Server

```bash
node mcp-server.mjs
# 12 tools: signal_add, signal_metrics, signal_sma, signal_ema, signal_peaks,
#           signal_anomalies, signal_changepoints, signal_correlate,
#           signal_spectrum, signal_decompose, signal_filter, signal_list
```

## Pipeline

Chain multiple processing steps:

```js
const result = engine.pipeline('raw_sensor', [
  { type: 'median', windowSize: 5 },  // Remove spikes
  { type: 'lowpass', cutoff: 0.1 },   // Smooth high-freq noise
  { type: 'sma', period: 10 },        // Final averaging
  { type: 'downsample', factor: 2 },  // Reduce resolution
]);
```

## Events

```js
engine.on('anomaly', ({ name, count, anomalies }) => {
  console.log(`${count} anomalies in ${name}`);
});

engine.on('changePoint', ({ name, count, points }) => {
  console.log(`${count} change points in ${name}`);
});
```

## License

MIT
