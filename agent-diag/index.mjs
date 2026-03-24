// agent-diag — Zero-dependency diagnostic & health monitoring for AI agents
// No external deps. Pure Node.js (v18+).

import { EventEmitter } from 'node:events';
import { cpus, freemem, totalmem, loadavg, uptime, platform, arch } from 'node:os';
import { stat, readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

// ─── Health Check States ──────────────────────────────────────────────────
export const Status = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown',
});

// ─── Severity Levels ──────────────────────────────────────────────────────
export const Severity = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
});

// ─── HealthCheck ──────────────────────────────────────────────────────────
export class HealthCheck {
  constructor({ name, category = 'custom', check, intervalMs = 30000, timeoutMs = 5000,
    threshold = 3, tags = [], metadata = {} } = {}) {
    if (!name) throw new Error('HealthCheck requires a name');
    if (typeof check !== 'function') throw new Error('HealthCheck requires a check function');
    this.name = name;
    this.category = category;
    this.checkFn = check;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.threshold = threshold;
    this.tags = tags;
    this.metadata = metadata;
    this.consecutiveFailures = 0;
    this.status = Status.UNKNOWN;
    this.lastResult = null;
    this.lastRun = null;
    this.history = [];
    this._timer = null;
  }
}

// ─── DiagnosticResult ─────────────────────────────────────────────────────
class DiagnosticResult {
  constructor({ name, category, status, message, details = null, durationMs = 0,
    timestamp = Date.now(), severity = Severity.INFO }) {
    Object.assign(this, { name, category, status, message, details, durationMs, timestamp, severity });
  }
  toJSON() {
    return { ...this, timestamp: this.timestamp };
  }
}

// ─── AgentDiag (main engine) ──────────────────────────────────────────────
export class AgentDiag extends EventEmitter {
  #checks = new Map();
  #history = [];
  #maxHistory = 5000;
  #running = false;

  constructor(opts = {}) {
    super();
    this.#maxHistory = opts.maxHistory ?? 5000;
  }

  // ── Register checks ──
  register(config) {
    const check = config instanceof HealthCheck ? config : new HealthCheck(config);
    if (this.#checks.has(check.name)) throw new Error(`Check '${check.name}' already registered`);
    this.#checks.set(check.name, check);
    this.emit('check:registered', { name: check.name, category: check.category });
    return this;
  }

  unregister(name) {
    const check = this.#checks.get(name);
    if (!check) return false;
    if (check._timer) clearInterval(check._timer);
    this.#checks.delete(name);
    this.emit('check:unregistered', { name });
    return true;
  }

  // ── Run a single check ──
  async runCheck(name) {
    const check = this.#checks.get(name);
    if (!check) throw new Error(`Check '${name}' not found`);
    const start = Date.now();
    let result;
    try {
      const output = await Promise.race([
        check.checkFn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout after ${check.timeoutMs}ms`)), check.timeoutMs)),
      ]);
      const ok = output && (output.ok !== false);
      if (ok) {
        check.consecutiveFailures = 0;
      } else {
        check.consecutiveFailures++;
      }
      result = new DiagnosticResult({
        name: check.name,
        category: check.category,
        status: ok ? Status.HEALTHY : Status.UNHEALTHY,
        message: ok ? (output.message || 'OK') : (output.message || 'Check failed'),
        details: output.details || null,
        durationMs: Date.now() - start,
        severity: ok ? Severity.INFO : (check.consecutiveFailures >= check.threshold ? Severity.CRITICAL : Severity.WARNING),
      });
    } catch (err) {
      check.consecutiveFailures++;
      result = new DiagnosticResult({
        name: check.name,
        category: check.category,
        status: Status.UNHEALTHY,
        message: err.message,
        durationMs: Date.now() - start,
        severity: check.consecutiveFailures >= check.threshold ? Severity.CRITICAL : Severity.WARNING,
      });
    }
    check.status = result.status;
    check.lastResult = result;
    check.lastRun = Date.now();
    check.history.push(result.toJSON());
    if (check.history.length > 200) check.history.splice(0, check.history.length - 200);
    this.#history.push(result.toJSON());
    if (this.#history.length > this.#maxHistory) this.#history.splice(0, this.#history.length - this.#maxHistory);
    this.emit('check:result', result.toJSON());
    if (result.status === Status.UNHEALTHY) this.emit('check:unhealthy', result.toJSON());
    if (result.severity === Severity.CRITICAL) this.emit('check:critical', result.toJSON());
    return result.toJSON();
  }

  // ── Run all checks ──
  async runAll() {
    const results = [];
    for (const [name] of this.#checks) {
      results.push(await this.runCheck(name));
    }
    return results;
  }

  // ── Run by category ──
  async runCategory(category) {
    const results = [];
    for (const [name, check] of this.#checks) {
      if (check.category === category) results.push(await this.runCheck(name));
    }
    return results;
  }

  // ── Start periodic checks ──
  start() {
    if (this.#running) return this;
    this.#running = true;
    for (const [, check] of this.#checks) {
      check._timer = setInterval(() => this.runCheck(check.name).catch(() => {}), check.intervalMs);
    }
    this.emit('started');
    return this;
  }

  stop() {
    this.#running = false;
    for (const [, check] of this.#checks) {
      if (check._timer) { clearInterval(check._timer); check._timer = null; }
    }
    this.emit('stopped');
    return this;
  }

  // ── Overall status ──
  getStatus() {
    const checks = [...this.#checks.values()];
    const all = checks.map(c => c.status);
    let overall = Status.HEALTHY;
    if (all.some(s => s === Status.UNHEALTHY)) overall = Status.UNHEALTHY;
    else if (all.some(s => s === Status.DEGRADED)) overall = Status.DEGRADED;
    else if (all.some(s => s === Status.UNKNOWN)) overall = Status.UNKNOWN;
    const categories = {};
    for (const c of checks) {
      if (!categories[c.category]) categories[c.category] = [];
      categories[c.category].push({ name: c.name, status: c.status, lastRun: c.lastRun, message: c.lastResult?.message });
    }
    return { overall, running: this.#running, totalChecks: checks.length, categories, timestamp: Date.now() };
  }

  getCheck(name) { return this.#checks.get(name) || null; }
  listChecks() { return [...this.#checks.values()].map(c => ({ name: c.name, category: c.category, status: c.status, intervalMs: c.intervalMs, tags: c.tags })); }
  getHistory({ name, category, status, since, limit = 100 } = {}) {
    let h = this.#history;
    if (name) h = h.filter(r => r.name === name);
    if (category) h = h.filter(r => r.category === category);
    if (status) h = h.filter(r => r.status === status);
    if (since) h = h.filter(r => r.timestamp >= since);
    return h.slice(-limit);
  }

  // ── System diagnostics ──
  collectSystem() {
    const mem = { total: totalmem(), free: freemem(), used: totalmem() - freemem(), percent: ((totalmem() - freemem()) / totalmem() * 100).toFixed(1) };
    const cpuLoad = loadavg();
    const cpuInfo = cpus();
    const proc = { pid: process.pid, uptime: process.uptime(), memoryUsage: process.memoryUsage(), version: process.version };
    return {
      platform: platform(),
      arch: arch(),
      uptime: uptime(),
      cpus: { count: cpuInfo.length, model: cpuInfo[0]?.model, load1: cpuLoad[0], load5: cpuLoad[1], load15: cpuLoad[2] },
      memory: mem,
      process: proc,
      timestamp: Date.now(),
    };
  }

  toJSON() {
    return { ...this.getStatus(), checks: this.listChecks(), recentHistory: this.getHistory({ limit: 50 }) };
  }
}

// ─── Preset checks ────────────────────────────────────────────────────────
export const presets = {
  httpEndpoint(url, opts = {}) {
    return new HealthCheck({
      name: opts.name || `http:${url}`,
      category: 'http',
      tags: opts.tags || ['http', 'external'],
      intervalMs: opts.intervalMs ?? 30000,
      timeoutMs: opts.timeoutMs ?? 5000,
      threshold: opts.threshold ?? 3,
      check: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
        try {
          const res = await fetch(url, { signal: controller.signal, method: opts.method || 'GET', headers: opts.headers || {} });
          clearTimeout(timer);
          const ok = res.status >= 200 && res.status < 400;
          return { ok, message: `HTTP ${res.status}`, details: { status: res.status, url } };
        } catch (e) {
          clearTimeout(timer);
          return { ok: false, message: e.message, details: { url } };
        }
      },
    });
  },
  tcpPort(host, port, opts = {}) {
    return new HealthCheck({
      name: opts.name || `tcp:${host}:${port}`,
      category: 'dependency',
      tags: opts.tags || ['tcp', 'network'],
      intervalMs: opts.intervalMs ?? 30000,
      timeoutMs: opts.timeoutMs ?? 3000,
      check: () => new Promise(resolve => {
        const socket = createConnection({ host, port }, () => {
          socket.destroy();
          resolve({ ok: true, message: `${host}:${port} reachable` });
        });
        socket.on('error', () => { socket.destroy(); resolve({ ok: false, message: `${host}:${port} unreachable` }); });
        socket.setTimeout(opts.timeoutMs ?? 3000, () => { socket.destroy(); resolve({ ok: false, message: `${host}:${port} timeout` }); });
      }),
    });
  },
  diskUsage(path = '/', opts = {}) {
    return new HealthCheck({
      name: opts.name || `disk:${path}`,
      category: 'system',
      tags: opts.tags || ['disk', 'system'],
      intervalMs: opts.intervalMs ?? 60000,
      check: async () => {
        try {
          await stat(path);
          return { ok: true, message: `Disk accessible: ${path}`, details: { path } };
        } catch (e) {
          return { ok: false, message: `Disk check failed: ${e.message}`, details: { path, error: e.code } };
        }
      },
    });
  },
  memoryUsage(thresholdPercent = 90, opts = {}) {
    return new HealthCheck({
      name: opts.name || 'memory:usage',
      category: 'system',
      tags: opts.tags || ['memory', 'system'],
      intervalMs: opts.intervalMs ?? 15000,
      check: () => {
        const pct = (totalmem() - freemem()) / totalmem() * 100;
        return { ok: pct < thresholdPercent, message: `Memory: ${pct.toFixed(1)}% used`, details: { percent: pct, free: freemem(), total: totalmem() } };
      },
    });
  },
  processAlive(pid, opts = {}) {
    return new HealthCheck({
      name: opts.name || `process:${pid}`,
      category: 'process',
      tags: opts.tags || ['process'],
      intervalMs: opts.intervalMs ?? 10000,
      check: () => {
        try {
          process.kill(pid, 0);
          return { ok: true, message: `Process ${pid} alive` };
        } catch (e) {
          return { ok: false, message: `Process ${pid} not found`, details: { error: e.code } };
        }
      },
    });
  },
  funcCheck(name, fn, opts = {}) {
    return new HealthCheck({
      name, category: opts.category || 'custom', check: fn,
      intervalMs: opts.intervalMs ?? 30000, tags: opts.tags || [],
      timeoutMs: opts.timeoutMs ?? 5000, threshold: opts.threshold ?? 3,
    });
  },
};

// ─── Alert Engine ─────────────────────────────────────────────────────────
export class AlertEngine extends EventEmitter {
  #rules = new Map();
  #active = new Map();
  #history = [];
  #maxHistory = 2000;

  addRule(rule) {
    if (!rule.name) throw new Error('Alert rule requires name');
    this.#rules.set(rule.name, {
      name: rule.name,
      condition: rule.condition,
      severity: rule.severity || Severity.WARNING,
      cooldownMs: rule.cooldownMs ?? 60000,
      message: rule.message || 'Alert triggered',
      action: rule.action || null,
      lastTriggered: 0,
      ...rule,
    });
    return this;
  }

  evaluate(context) {
    const triggered = [];
    for (const [, rule] of this.#rules) {
      try {
        if (rule.condition(context)) {
          const now = Date.now();
          if (now - rule.lastTriggered < rule.cooldownMs) continue;
          rule.lastTriggered = now;
          const alert = { name: rule.name, severity: rule.severity, message: rule.message, context, timestamp: now };
          this.#active.set(rule.name, alert);
          this.#history.push(alert);
          if (this.#history.length > this.#maxHistory) this.#history.splice(0, this.#history.length - this.#maxHistory);
          triggered.push(alert);
          this.emit('alert', alert);
          if (rule.action) { try { rule.action(alert); } catch {} }
        } else {
          this.#active.delete(rule.name);
        }
      } catch {}
    }
    return triggered;
  }

  getActive() { return [...this.#active.values()]; }
  getHistory(limit = 100) { return this.#history.slice(-limit); }
  ack(name) { this.#active.delete(name); }
  toJSON() { return { active: this.getActive(), rules: [...this.#rules.values()].map(r => ({ name: r.name, severity: r.severity, cooldownMs: r.cooldownMs })), totalHistory: this.#history.length }; }
}

export default AgentDiag;
