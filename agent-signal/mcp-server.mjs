#!/usr/bin/env node
/**
 * agent-signal MCP Server
 * 12 tools via JSON-RPC stdio
 */

import { SignalEngine } from './index.mjs';

const engine = new SignalEngine();

const TOOLS = {
  signal_add: {
    description: 'Add data points to a named signal',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }, required: ['name', 'values'] },
    handler: ({ name, values }) => ({ added: engine.add(name, values), total: engine.get(name).length }),
  },
  signal_metrics: {
    description: 'Get statistical metrics for a signal (mean, median, stddev, percentiles, skewness, kurtosis)',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    handler: ({ name }) => engine.metrics(name),
  },
  signal_sma: {
    description: 'Simple Moving Average filter',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, period: { type: 'number', default: 20 } }, required: ['name'] },
    handler: ({ name, period = 20 }) => engine.sma(name, period),
  },
  signal_ema: {
    description: 'Exponential Moving Average filter',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, period: { type: 'number', default: 20 } }, required: ['name'] },
    handler: ({ name, period = 20 }) => engine.ema(name, period),
  },
  signal_peaks: {
    description: 'Find peaks with prominence and distance filtering',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, minProminence: { type: 'number' }, minDistance: { type: 'number' } }, required: ['name'] },
    handler: ({ name, ...opts }) => engine.peaks(name, opts),
  },
  signal_anomalies: {
    description: 'Detect anomalies (zscore/iqr/moving)',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, method: { type: 'string', enum: ['zscore', 'iqr', 'moving'], default: 'zscore' }, threshold: { type: 'number' }, windowSize: { type: 'number' } }, required: ['name'] },
    handler: ({ name, method = 'zscore', ...opts }) => engine.anomalies(name, method, opts),
  },
  signal_changepoints: {
    description: 'Detect change points (cusum/bayesian)',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, method: { type: 'string', enum: ['cusum', 'bayesian'], default: 'cusum' }, threshold: { type: 'number' } }, required: ['name'] },
    handler: ({ name, method = 'cusum', ...opts }) => engine.changePoints(name, method, opts),
  },
  signal_correlate: {
    description: 'Correlate two signals (pearson/spearman/cross)',
    inputSchema: { type: 'object', properties: { name1: { type: 'string' }, name2: { type: 'string' }, type: { type: 'string', enum: ['pearson', 'spearman', 'cross'], default: 'pearson' } }, required: ['name1', 'name2'] },
    handler: ({ name1, name2, type = 'pearson' }) => engine.correlate(name1, name2, type),
  },
  signal_spectrum: {
    description: 'Compute periodogram / frequency spectrum',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    handler: ({ name }) => { const spec = engine.spectrum(name); return { bins: spec.length, dominant: engine.dominantFreq(name), top5: spec.sort((a, b) => b.power - a.power).slice(0, 5) }; },
  },
  signal_decompose: {
    description: 'Decompose signal into trend + seasonal + residual',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, period: { type: 'number', default: 12 } }, required: ['name'] },
    handler: ({ name, period = 12 }) => { const d = engine.decompose(name, period); return { trendLen: d.trend.length, strength: d.strength, residualMean: d.residual.reduce((a, v) => a + Math.abs(v), 0) / d.residual.length }; },
  },
  signal_filter: {
    description: 'Apply filter (median/exponential/lowpass/highpass/bandpass)',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['median', 'exponential', 'lowpass', 'highpass', 'bandpass'] }, windowSize: { type: 'number' }, alpha: { type: 'number' }, cutoff: { type: 'number' } }, required: ['name', 'type'] },
    handler: ({ name, type, ...opts }) => engine.filter(name, type, opts),
  },
  signal_list: {
    description: 'List all signals and engine stats',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({ signals: engine.list(), stats: engine.stats }),
  },
};

// ── JSON-RPC stdio server ──

const BUFFER = [];
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  BUFFER.push(chunk);
  processBuffer();
});

function processBuffer() {
  const raw = BUFFER.join('');
  const lines = raw.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const req = JSON.parse(line);
      handleRequest(req);
    } catch { /* partial */ }
  }
  BUFFER.length = 0;
}

async function handleRequest(req) {
  const { id, method, params } = req;
  if (method === 'initialize') {
    return respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-signal', version: '1.0.0' } });
  }
  if (method === 'tools/list') {
    return respond(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === 'tools/call') {
    const tool = TOOLS[params.name];
    if (!tool) return respondError(id, -32601, `Unknown tool: ${params.name}`);
    try {
      const result = await tool.handler(params.arguments || {});
      return respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return respondError(id, -32000, e.message);
    }
  }
  respondError(id, -32601, `Unknown method: ${method}`);
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}
