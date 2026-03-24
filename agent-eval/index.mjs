#!/usr/bin/env node
/**
 * agent-eval — Zero-dependency evaluation & benchmarking toolkit for AI agents
 *
 * Core features:
 * - Test case management (define, run, score)
 * - Scorer engine: exact, contains, regex, json_schema, similarity, custom
 * - Benchmark runner: run suites, collect metrics
 * - Leaderboard: compare models/configs
 * - A/B testing with statistical significance
 * - JSONL persistence, EventEmitter, HTML dashboard
 */

import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Scorer Engine ────────────────────────────────────────────────────────────

const Scorers = {
  /** Exact string match (case-insensitive by default) */
  exact(expected, actual, opts = {}) {
    const a = opts.caseSensitive ? actual : actual.toLowerCase();
    const b = opts.caseSensitive ? expected : expected.toLowerCase();
    return { score: a === b ? 1 : 0, pass: a === b, detail: a === b ? 'exact match' : `expected "${expected}", got "${actual}"` };
  },

  /** Output contains expected substring */
  contains(expected, actual, opts = {}) {
    const a = opts.caseSensitive ? actual : actual.toLowerCase();
    const b = opts.caseSensitive ? expected : expected.toLowerCase();
    const pass = a.includes(b);
    return { score: pass ? 1 : 0, pass, detail: pass ? `contains "${expected}"` : `"${expected}" not found` };
  },

  /** Regex match */
  regex(pattern, actual, opts = {}) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, opts.flags || 'i');
    const pass = re.test(actual);
    const match = actual.match(re);
    return { score: pass ? 1 : 0, pass, detail: pass ? `matched ${re}` : `no match for ${re}`, match: match?.[0] };
  },

  /** JSON schema validation (simplified) */
  jsonSchema(schema, actual) {
    try {
      const obj = JSON.parse(actual);
      const errors = _validateSchema(schema, obj, '');
      return { score: errors.length === 0 ? 1 : 0, pass: errors.length === 0, detail: errors.length === 0 ? 'valid JSON' : errors.join('; '), parsed: obj };
    } catch (e) {
      return { score: 0, pass: false, detail: `invalid JSON: ${e.message}` };
    }
  },

  /** Similarity scorer (Dice coefficient on bigrams) */
  similarity(expected, actual, opts = {}) {
    const threshold = opts.threshold || 0.7;
    const a = (opts.caseSensitive ? actual : actual.toLowerCase()).trim();
    const b = (opts.caseSensitive ? expected : expected.toLowerCase()).trim();
    if (a === b) return { score: 1, pass: true, detail: 'identical' };
    const bigrams = (s) => { const b = new Set(); for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2)); return b; };
    const bgA = bigrams(a), bgB = bigrams(b);
    let intersection = 0;
    for (const g of bgA) if (bgB.has(g)) intersection++;
    const dice = (2 * intersection) / (bgA.size + bgB.size || 1);
    return { score: Math.round(dice * 1000) / 1000, pass: dice >= threshold, detail: `similarity ${(dice * 100).toFixed(1)}% (threshold ${threshold * 100}%)` };
  },

  /** Numeric comparison */
  numeric(expected, actual, opts = {}) {
    const num = parseFloat(actual);
    if (isNaN(num)) return { score: 0, pass: false, detail: `"${actual}" is not a number` };
    const tolerance = opts.tolerance || 0.01;
    const pass = Math.abs(num - expected) <= tolerance * Math.abs(expected);
    return { score: pass ? 1 : 0, pass, detail: `${num} vs ${expected} (tolerance ${tolerance * 100}%)` };
  },

  /** Length check */
  length(expected, actual, opts = {}) {
    const len = actual.length;
    const op = opts.operator || 'eq';
    const ops = { eq: (a, b) => a === b, gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, between: (a, lo, hi) => a >= lo && a <= hi };
    let pass;
    if (op === 'between') pass = ops.between(len, expected[0], expected[1]);
    else if (op === 'eq') pass = ops.eq(len, expected);
    else if (op === 'gt') pass = ops.gt(len, expected);
    else if (op === 'gte') pass = ops.gte(len, expected);
    else if (op === 'lt') pass = ops.lt(len, expected);
    else if (op === 'lte') pass = ops.lte(len, expected);
    else pass = ops[op](len, expected);
    return { score: pass ? 1 : 0, pass, detail: `length ${len} ${op} ${JSON.stringify(expected)}` };
  },

  /** Not-empty check */
  notEmpty(_expected, actual) {
    const pass = Boolean(actual) && actual.trim().length > 0;
    return { score: pass ? 1 : 0, pass, detail: pass ? 'not empty' : 'empty output' };
  },

  /** Custom function scorer */
  custom(fn, expected, actual) {
    const result = fn(expected, actual);
    if (typeof result === 'boolean') return { score: result ? 1 : 0, pass: result, detail: result ? 'custom pass' : 'custom fail' };
    return result;
  }
};

function _validateSchema(schema, obj, path) {
  const errors = [];
  if (schema.type) {
    const actual = Array.isArray(obj) ? 'array' : typeof obj;
    if (actual !== schema.type) { errors.push(`${path || '/'}: expected type ${schema.type}, got ${actual}`); return errors; }
  }
  if (schema.required && typeof obj === 'object' && obj !== null) {
    for (const key of schema.required) {
      if (!(key in obj)) errors.push(`${path || '/'}: missing required field "${key}"`);
    }
  }
  if (schema.properties && typeof obj === 'object' && obj !== null) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in obj) errors.push(..._validateSchema(sub, obj[key], `${path}/${key}`));
    }
  }
  if (schema.enum && !schema.enum.includes(obj)) {
    errors.push(`${path || '/'}: "${obj}" not in [${schema.enum.join(', ')}]`);
  }
  if (schema.minimum !== undefined && typeof obj === 'number' && obj < schema.minimum) {
    errors.push(`${path || '/'}: ${obj} < minimum ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && typeof obj === 'number' && obj > schema.maximum) {
    errors.push(`${path || '/'}: ${obj} > maximum ${schema.maximum}`);
  }
  if (schema.items && Array.isArray(obj)) {
    obj.forEach((item, i) => errors.push(..._validateSchema(schema.items, item, `${path}[${i}]`)));
  }
  return errors;
}

// ─── Core Engine ──────────────────────────────────────────────────────────────

class EvalSuite extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'default';
    this.description = opts.description || '';
    this.cases = [];
    this.results = new Map();
    this.dataDir = opts.dataDir || join(__dirname, 'data');
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  /** Add a test case */
  add(tc) {
    const id = tc.id || `tc_${this.cases.length + 1}_${Date.now()}`;
    const testCase = {
      id,
      name: tc.name || id,
      description: tc.description || '',
      input: tc.input,
      expected: tc.expected,
      scorer: tc.scorer || 'contains',
      scorerOpts: tc.scorerOpts || {},
      tags: tc.tags || [],
      timeout: tc.timeout || 30000,
      retries: tc.retries || 0,
      metadata: tc.metadata || {},
      createdAt: new Date().toISOString()
    };
    this.cases.push(testCase);
    this.emit('case:added', testCase);
    return testCase;
  }

  /** Remove a test case */
  remove(id) {
    const idx = this.cases.findIndex(c => c.id === id);
    if (idx === -1) return false;
    const removed = this.cases.splice(idx, 1)[0];
    this.emit('case:removed', removed);
    return true;
  }

  /** Get test cases with optional filter */
  getCases(filter = {}) {
    let cases = [...this.cases];
    if (filter.tag) cases = cases.filter(c => c.tags.includes(filter.tag));
    if (filter.name) cases = cases.filter(c => c.name.includes(filter.name));
    return cases;
  }

  /** Score an actual output against expected */
  score(expected, actual, scorer, opts = {}) {
    if (typeof scorer === 'function') return Scorers.custom(scorer, expected, actual);
    const fn = Scorers[scorer];
    if (!fn) throw new Error(`Unknown scorer: ${scorer}. Available: ${Object.keys(Scorers).join(', ')}`);
    return fn(expected, actual, opts);
  }

  /** Run a single test case with an async executor function */
  async runCase(tc, executor) {
    const start = Date.now();
    let attempt = 0;
    let lastError = null;

    while (attempt <= tc.retries) {
      try {
        const actual = await Promise.race([
          executor(tc.input, { signal: new AbortController().signal, attempt }),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${tc.timeout}ms`)), tc.timeout))
        ]);

        const scorerResult = this.score(tc.expected, actual, tc.scorer, tc.scorerOpts);
        const result = {
          id: tc.id,
          name: tc.name,
          pass: scorerResult.pass,
          score: scorerResult.score,
          detail: scorerResult.detail,
          actual,
          expected: tc.expected,
          duration: Date.now() - start,
          attempts: attempt + 1,
          timestamp: new Date().toISOString(),
          tags: tc.tags,
          match: scorerResult.match,
          parsed: scorerResult.parsed
        };
        this.results.set(tc.id, result);
        this.emit('case:result', result);
        return result;
      } catch (err) {
        lastError = err;
        attempt++;
        if (attempt <= tc.retries) {
          this.emit('case:retry', { id: tc.id, attempt, error: err.message });
          await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
        }
      }
    }

    const result = {
      id: tc.id,
      name: tc.name,
      pass: false,
      score: 0,
      detail: `Error: ${lastError?.message || 'unknown'}`,
      actual: null,
      expected: tc.expected,
      duration: Date.now() - start,
      attempts: attempt,
      error: lastError?.message,
      timestamp: new Date().toISOString(),
      tags: tc.tags
    };
    this.results.set(tc.id, result);
    this.emit('case:result', result);
    return result;
  }

  /** Run all test cases */
  async run(executor, opts = {}) {
    const { parallel = false, concurrency = 4, filter = {} } = opts;
    const cases = this.getCases(filter);
    this.emit('run:start', { suite: this.name, total: cases.length });
    const startTime = Date.now();
    const results = [];

    if (parallel) {
      // Chunked parallel execution
      for (let i = 0; i < cases.length; i += concurrency) {
        const chunk = cases.slice(i, i + concurrency);
        const chunkResults = await Promise.all(chunk.map(tc => this.runCase(tc, executor)));
        results.push(...chunkResults);
      }
    } else {
      for (const tc of cases) {
        const result = await this.runCase(tc, executor);
        results.push(result);
      }
    }

    const duration = Date.now() - startTime;
    const summary = this._summarize(results, duration);
    this.emit('run:complete', summary);

    // Persist results
    const runId = `run_${Date.now()}`;
    this._persist(runId, results, summary);
    return { runId, results, summary };
  }

  _summarize(results, duration) {
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const errored = results.filter(r => r.error).length;
    const avgScore = results.reduce((s, r) => s + r.score, 0) / (results.length || 1);
    const avgDuration = results.reduce((s, r) => s + r.duration, 0) / (results.length || 1);
    const byTag = {};
    for (const r of results) {
      for (const tag of (r.tags || [])) {
        if (!byTag[tag]) byTag[tag] = { total: 0, passed: 0, avgScore: 0 };
        byTag[tag].total++;
        if (r.pass) byTag[tag].passed++;
        byTag[tag].avgScore += r.score;
      }
    }
    for (const tag of Object.keys(byTag)) {
      byTag[tag].avgScore = Math.round((byTag[tag].avgScore / byTag[tag].total) * 1000) / 1000;
    }
    return {
      suite: this.name,
      total: results.length,
      passed,
      failed,
      errored,
      passRate: Math.round((passed / (results.length || 1)) * 10000) / 100,
      avgScore: Math.round(avgScore * 1000) / 1000,
      avgDuration: Math.round(avgDuration),
      totalDuration: duration,
      byTag,
      timestamp: new Date().toISOString()
    };
  }

  _persist(runId, results, summary) {
    const file = join(this.dataDir, `${this.name}_results.jsonl`);
    const record = { runId, summary, resultCount: results.length, timestamp: new Date().toISOString() };
    appendFileSync(file, JSON.stringify(record) + '\n');
    const detailFile = join(this.dataDir, `${this.name}_${runId}.json`);
    writeFileSync(detailFile, JSON.stringify({ runId, results, summary }, null, 2));
  }

  /** Get historical run summaries */
  getHistory() {
    const file = join(this.dataDir, `${this.name}_results.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  /** Export suite as JSON */
  export() {
    return { name: this.name, description: this.description, cases: this.cases, exportedAt: new Date().toISOString() };
  }

  /** Import cases from JSON */
  import(data) {
    const cases = data.cases || data;
    for (const tc of cases) this.add(tc);
    return cases.length;
  }
}

// ─── Benchmark Runner ─────────────────────────────────────────────────────────

class BenchmarkRunner extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.suites = new Map();
    this.models = new Map();
    this.dataDir = opts.dataDir || join(__dirname, 'data');
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  /** Register an eval suite */
  addSuite(suite) {
    if (!(suite instanceof EvalSuite)) suite = new EvalSuite(suite);
    this.suites.set(suite.name, suite);
    return suite;
  }

  /** Register a model/executor */
  addModel(name, executor, meta = {}) {
    this.models.set(name, { name, executor, ...meta, addedAt: new Date().toISOString() });
    return this;
  }

  /** Run a suite against all models */
  async runAll(suiteName, opts = {}) {
    const suite = this.suites.get(suiteName);
    if (!suite) throw new Error(`Suite "${suiteName}" not found`);
    const results = {};

    for (const [name, model] of this.models) {
      this.emit('model:start', { model: name, suite: suiteName });
      const run = await suite.run(model.executor, opts);
      results[name] = { ...run, model: name };
      this.emit('model:complete', { model: name, suite: suiteName, summary: run.summary });
    }

    const comparison = this._compare(results);
    this.emit('benchmark:complete', { suite: suiteName, results, comparison });
    return { suite: suiteName, results, comparison };
  }

  /** Compare model results */
  _compare(results) {
    const ranked = Object.entries(results)
      .map(([model, r]) => ({
        model,
        passRate: r.summary.passRate,
        avgScore: r.summary.avgScore,
        avgDuration: r.summary.avgDuration,
        passed: r.summary.passed,
        total: r.summary.total,
        errored: r.summary.errored
      }))
      .sort((a, b) => b.avgScore - a.avgScore || a.avgDuration - b.avgDuration);

    return {
      ranked,
      best: ranked[0]?.model,
      fastest: ranked.reduce((f, r) => r.avgDuration < f.avgDuration ? r : f, ranked[0])?.model,
      mostReliable: ranked.reduce((f, r) => r.errored < f.errored ? r : f, ranked[0])?.model
    };
  }

  /** A/B test: compare two runs for statistical significance */
  abTest(resultsA, resultsB) {
    const scoresA = resultsA.results.map(r => r.score);
    const scoresB = resultsB.results.map(r => r.score);
    const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr => { const m = mean(arr); return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1 || 1); };
    const std = arr => Math.sqrt(variance(arr));

    const mA = mean(scoresA), mB = mean(scoresB);
    const sA = std(scoresA), sB = std(scoresB);
    const nA = scoresA.length, nB = scoresB.length;

    // Welch's t-test
    const se = Math.sqrt((sA ** 2 / nA) + (sB ** 2 / nB));
    const t = se === 0 ? 0 : (mA - mB) / se;
    // Approximate p-value (two-tailed) using normal distribution
    const p = 2 * (1 - _normalCDF(Math.abs(t)));

    return {
      modelA: resultsA.model || 'A',
      modelB: resultsB.model || 'B',
      meanA: Math.round(mA * 1000) / 1000,
      meanB: Math.round(mB * 1000) / 1000,
      diff: Math.round((mA - mB) * 1000) / 1000,
      tStatistic: Math.round(t * 1000) / 1000,
      pValue: Math.round(p * 10000) / 10000,
      significant: p < 0.05,
      confidence: p < 0.01 ? '99%' : p < 0.05 ? '95%' : 'not significant',
      winner: p < 0.05 ? (mA > mB ? resultsA.model : resultsB.model) : 'no clear winner',
      samplesA: nA,
      samplesB: nB
    };
  }
}

function _normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

// ─── Report Generator ────────────────────────────────────────────────────────

function generateReport(benchmarkResult) {
  const { suite, results, comparison } = benchmarkResult;
  const lines = [];
  lines.push(`# Benchmark Report: ${suite}`);
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  // Leaderboard
  lines.push(`## Leaderboard\n`);
  lines.push(`| Rank | Model | Pass Rate | Avg Score | Avg Latency | Passed | Total |`);
  lines.push(`|------|-------|-----------|-----------|-------------|--------|-------|`);
  comparison.ranked.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.model} | ${r.passRate}% | ${r.avgScore} | ${r.avgDuration}ms | ${r.passed} | ${r.total} |`);
  });

  lines.push(`\n**Best Overall:** ${comparison.best}`);
  lines.push(`**Fastest:** ${comparison.fastest}`);
  lines.push(`**Most Reliable:** ${comparison.mostReliable}\n`);

  // Per-model details
  for (const [model, run] of Object.entries(results)) {
    lines.push(`## ${model}\n`);
    lines.push(`- Pass Rate: ${run.summary.passRate}%`);
    lines.push(`- Avg Score: ${run.summary.avgScore}`);
    lines.push(`- Avg Duration: ${run.summary.avgDuration}ms\n`);

    const failures = run.results.filter(r => !r.pass);
    if (failures.length > 0) {
      lines.push(`### Failures\n`);
      for (const f of failures) {
        lines.push(`- **${f.name}**: ${f.detail}`);
        if (f.actual) lines.push(`  - Actual: \`${f.actual.slice(0, 200)}\``);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { EvalSuite, BenchmarkRunner, Scorers, generateReport };
export default EvalSuite;
