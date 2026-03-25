#!/usr/bin/env node
/**
 * agent-signal CLI
 */

import { SignalEngine, signalMetrics, sma, ema, findPeaks, findValleys, detectAnomaliesZScore, detectChangePointsCUSUM, pearsonCorrelation, dominantFrequency, periodogram } from './index.mjs';

const [,, cmd, ...args] = process.argv;

function parseValues(str) { return str.split(',').map(Number).filter(v => !isNaN(v)); }
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1] || true;
      i++;
    }
  }
  return flags;
}

function print(obj) { console.log(JSON.stringify(obj, null, 2)); }

const commands = {
  metrics(values) {
    print(signalMetrics(parseValues(values)));
  },
  sma(values, period) {
    print(sma(parseValues(values), Number(period) || 5));
  },
  ema(values, period) {
    print(ema(parseValues(values), Number(period) || 5));
  },
  peaks(values, flags) {
    const f = parseFlags(flags);
    print(findPeaks(parseValues(values), { minProminence: Number(f.prominence) || 0, minDistance: Number(f.distance) || 1 }));
  },
  valleys(values, flags) {
    const f = parseFlags(flags);
    print(findValleys(parseValues(values), { minProminence: Number(f.prominence) || 0, minDistance: Number(f.distance) || 1 }));
  },
  anomalies(values, flags) {
    const f = parseFlags(flags);
    print(detectAnomaliesZScore(parseValues(values), Number(f.threshold) || 3, Number(f.window) || 20));
  },
  changepoints(values, flags) {
    const f = parseFlags(flags);
    print(detectChangePointsCUSUM(parseValues(values), { threshold: Number(f.threshold) || 4 }));
  },
  correlate(a, b) {
    print(pearsonCorrelation(parseValues(a), parseValues(b)));
  },
  spectrum(values) {
    const spec = periodogram(parseValues(values));
    print({ dominant: dominantFrequency(parseValues(values)), topBins: spec.sort((a, b) => b.power - a.power).slice(0, 10) });
  },
  demo() {
    console.log('🐋 agent-signal demo\n');
    const n = 200;
    const signal = Array.from({ length: n }, (_, i) =>
      10 * Math.sin(2 * Math.PI * 0.05 * i) + 0.05 * i + (Math.random() - 0.5) * 2
    );

    console.log('Signal: 200 points (sine + linear trend + noise)\n');

    console.log('📊 Metrics:');
    const m = signalMetrics(signal);
    console.log(`  mean=${m.mean.toFixed(2)} median=${m.median.toFixed(2)} stddev=${m.stddev.toFixed(2)}`);
    console.log(`  range=[${m.min.toFixed(2)}, ${m.max.toFixed(2)}] skewness=${m.skewness.toFixed(3)} kurtosis=${m.kurtosis.toFixed(3)}\n`);

    const smaR = sma(signal, 10);
    const emaR = ema(signal, 10);
    console.log(`📈 SMA(10) last: ${smaR[smaR.length - 1]?.toFixed(2)}`);
    console.log(`📈 EMA(10) last: ${emaR[emaR.length - 1]?.toFixed(2)}\n`);

    const peaks = findPeaks(signal, { minProminence: 3 });
    const valleys = findValleys(signal, { minProminence: 3 });
    console.log(`⛰️  Peaks: ${peaks.length} (indices: ${peaks.slice(0, 5).map(p => p.index).join(', ')}...)`);
    console.log(`🕳️  Valleys: ${valleys.length} (indices: ${valleys.slice(0, 5).map(p => p.index).join(', ')}...)\n`);

    const anom = detectAnomaliesZScore(signal, 3, 20);
    console.log(`🚨 Anomalies (z-score>3): ${anom.length}`);
    if (anom.length) anom.slice(0, 3).forEach(a => console.log(`   index=${a.index} value=${a.value.toFixed(2)} z=${a.zScore.toFixed(2)}`));
    console.log();

    const cp = detectChangePointsCUSUM(signal, { threshold: 3 });
    console.log(`🔄 Change points (CUSUM): ${cp.length}`);
    if (cp.length) cp.slice(0, 3).forEach(c => console.log(`   index=${c.index} direction=${c.direction}`));
    console.log();

    const freq = dominantFrequency(signal);
    console.log(`🎵 Dominant frequency: ${freq.frequency.toFixed(4)} (period=${freq.period.toFixed(1)})`);
    console.log(`   Power: ${freq.power.toFixed(2)}\n`);

    const corr = pearsonCorrelation(signal, signal.map(v => v * 2 + 1));
    console.log(`📐 Self-correlation (x vs 2x+1): r=${corr.r.toFixed(4)}\n`);

    console.log('✅ Demo complete!');
  },
  help() {
    console.log(`
agent-signal CLI

Commands:
  metrics <values>                    Signal statistics
  sma <values> [--period N]           Simple Moving Average
  ema <values> [--period N]           Exponential Moving Average
  peaks <values> [--prominence N] [--distance N]
  valleys <values> [--prominence N] [--distance N]
  anomalies <values> [--threshold N] [--window N]
  changepoints <values> [--threshold N]
  correlate <values1> <values2>       Pearson correlation
  spectrum <values>                   Frequency analysis
  demo                                Run demo

Values format: comma-separated numbers, e.g. "1,2,3,4,5"
  `,
  );
  },
};

if (!cmd || cmd === 'help') { commands.help(); process.exit(0); }
if (commands[cmd]) {
  commands[cmd](...args);
} else {
  console.error(`Unknown command: ${cmd}. Run "agent-signal help"`);
  process.exit(1);
}
