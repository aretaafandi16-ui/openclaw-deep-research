#!/usr/bin/env node
/**
 * agent-schedule — Zero-dep time-based scheduler for AI agents
 *
 * Cron expressions, timezone support, missed-run recovery,
 * deduplication, overlap prevention, event-driven hooks.
 */

import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Helpers ────────────────────────────────────────────────

function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [...b].map((v, i) =>
    [4, 6, 8, 10].includes(i) ? `-${v.toString(16).padStart(2, '0')}` : v.toString(16).padStart(2, '0')
  ).join('');
}

function now() { return Date.now(); }

function jsonPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

// ─── Cron Parser ────────────────────────────────────────────

const CRON_RANGES = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 6 }, // 0=Sunday
};

function parseCronField(field, range) {
  const values = new Set();
  for (const part of field.split(',')) {
    const [stepMatch] = part.match(/\/(\d+)$/) || [];
    const step = stepMatch ? parseInt(stepMatch.replace('/', '')) : 1;
    const base = part.replace(/\/\d+$/, '');

    let start, end;
    if (base === '*') { start = range.min; end = range.max; }
    else if (base.includes('-')) { [start, end] = base.split('-').map(Number); }
    else if (/^\d+$/.test(base)) { start = end = parseInt(base); }
    else continue;

    for (let v = start; v <= end && v <= range.max; v += step) {
      values.add(v);
    }
  }
  return values;
}

function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: "${expr}" — expected 5 fields`);
  return {
    minutes: parseCronField(parts[0], CRON_RANGES.minute),
    hours: parseCronField(parts[1], CRON_RANGES.hour),
    daysOfMonth: parseCronField(parts[2], CRON_RANGES.dayOfMonth),
    months: parseCronField(parts[3], CRON_RANGES.month),
    daysOfWeek: parseCronField(parts[4], CRON_RANGES.dayOfWeek),
  };
}

function matchesCronFull(parsed, date) {
  return parsed.minutes.has(date.getUTCMinutes())
    && parsed.hours.has(date.getUTCHours())
    && parsed.daysOfMonth.has(date.getUTCDate())
    && parsed.months.has(date.getUTCMonth() + 1)
    && parsed.daysOfWeek.has(date.getUTCDay());
}

// ─── Next Run Calculator ────────────────────────────────────

function nextCronRun(parsed, fromDate, tzOffsetMin = 0) {
  // Search forward up to 2 years
  const maxIterations = 365 * 2 * 24 * 60;
  let d = new Date(fromDate.getTime());
  d.setSeconds(0, 0);

  for (let i = 0; i < maxIterations; i++) {
    const utc = new Date(d.getTime() + tzOffsetMin * 60000);
    if (matchesCronFull(parsed, utc)) {
      return d.getTime();
    }
    d = new Date(d.getTime() + 60000); // +1 minute
  }
  return null;
}

// ─── Schedule Entry ─────────────────────────────────────────

class ScheduleEntry {
  constructor(opts) {
    this.id = opts.id || uuid();
    this.name = opts.name || `job-${this.id.slice(0, 8)}`;
    this.cron = opts.cron;
    this.parsed = parseCron(opts.cron);
    this.handler = opts.handler || null;
    this.handlerName = opts.handlerName || 'default';
    this.payload = opts.payload ?? {};
    this.timezone = opts.timezone || 'UTC';
    this.tzOffsetMin = opts.tzOffsetMin || 0;
    this.enabled = opts.enabled !== false;
    this.maxOverlap = opts.maxOverlap ?? 1;
    this.running = 0;
    this.timeout = opts.timeout ?? 60000;
    this.retry = opts.retry ?? 0;
    this.tags = opts.tags || [];
    this.createdAt = opts.createdAt || now();
    this.lastRun = opts.lastRun || null;
    this.nextRun = 0;
    this.stats = {
      totalRuns: 0,
      successes: 0,
      failures: 0,
      skips: 0,
      avgDurationMs: 0,
      lastError: null,
      lastSuccess: null,
    };
    this.computeNextRun();
  }

  computeNextRun(fromDate) {
    const from = fromDate || now();
    this.nextRun = nextCronRun(this.parsed, new Date(from), this.tzOffsetMin);
    return this.nextRun;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      cron: this.cron,
      handlerName: this.handlerName,
      payload: this.payload,
      timezone: this.timezone,
      enabled: this.enabled,
      maxOverlap: this.maxOverlap,
      timeout: this.timeout,
      retry: this.retry,
      tags: this.tags,
      createdAt: this.createdAt,
      lastRun: this.lastRun,
      nextRun: this.nextRun,
      stats: { ...this.stats },
    };
  }
}

// ─── Scheduler Core ─────────────────────────────────────────

class AgentSchedule extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.entries = new Map();
    this.handlers = new Map();
    this.handlers.set('default', async (entry) => {
      this.emit('job:default', entry.toJSON());
    });
    this.tickInterval = null;
    this.tickMs = opts.tickMs ?? 1000;
    this.persistenceDir = opts.persistenceDir || null;
    this.history = [];
    this.maxHistory = opts.maxHistory ?? 1000;
    this.runIdCounter = 0;

    if (this.persistenceDir) {
      if (!existsSync(this.persistenceDir)) mkdirSync(this.persistenceDir, { recursive: true });
      this.restore();
    }
  }

  // ── Handler Registration ──

  onJob(name, handler) {
    this.handlers.set(name, handler);
    return this;
  }

  // ── Job Management ──

  schedule(opts) {
    if (typeof opts === 'string') opts = { cron: opts };
    const entry = new ScheduleEntry(opts);
    if (entry.handler) this.handlers.set(entry.id, entry.handler);
    this.entries.set(entry.id, entry);
    this.emit('scheduled', entry.toJSON());
    this.persist();
    return entry.toJSON();
  }

  unschedule(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.handlers.delete(id);
    this.emit('unscheduled', entry.toJSON());
    this.persist();
    return true;
  }

  enable(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = true;
    entry.computeNextRun();
    this.emit('enabled', entry.toJSON());
    this.persist();
    return true;
  }

  disable(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = false;
    this.emit('disabled', entry.toJSON());
    this.persist();
    return true;
  }

  get(id) {
    return this.entries.get(id)?.toJSON() || null;
  }

  list(filter = {}) {
    let results = [...this.entries.values()];
    if (filter.enabled !== undefined) results = results.filter(e => e.enabled === filter.enabled);
    if (filter.tag) results = results.filter(e => e.tags.includes(filter.tag));
    if (filter.name) results = results.filter(e => e.name.includes(filter.name));
    return results.map(e => e.toJSON());
  }

  // ── Manual Trigger ──

  async trigger(id) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Job not found: ${id}`);
    return this.executeJob(entry, true);
  }

  // ── Tick Loop ──

  start() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this.tick(), this.tickMs);
    this.emit('started');
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.emit('stopped');
  }

  async tick() {
    const ts = now();
    for (const entry of this.entries.values()) {
      if (!entry.enabled) continue;
      if (entry.nextRun && ts >= entry.nextRun) {
        // Check overlap
        if (entry.running >= entry.maxOverlap) {
          entry.stats.skips++;
          this.emit('job:skipped', { id: entry.id, name: entry.name, reason: 'overlap' });
          entry.computeNextRun(entry.nextRun + 60000);
          continue;
        }
        await this.executeJob(entry);
        entry.computeNextRun(entry.nextRun + 60000);
      }
    }
  }

  async executeJob(entry, manual = false) {
    const runId = `run-${++this.runIdCounter}`;
    const startTime = now();
    entry.running++;
    entry.lastRun = startTime;
    entry.stats.totalRuns++;

    const ctx = {
      runId,
      entryId: entry.id,
      name: entry.name,
      cron: entry.cron,
      payload: { ...entry.payload },
      manual,
      startTime,
    };

    this.emit('job:start', ctx);

    const handler = this.handlers.get(entry.handlerName) || this.handlers.get('default');
    let attempts = 0;
    let lastError = null;
    const maxAttempts = 1 + (entry.retry || 0);

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await Promise.race([
          handler(ctx),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('Timeout')), entry.timeout)
          ),
        ]);
        const duration = now() - startTime;
        entry.running--;
        entry.stats.successes++;
        entry.stats.avgDurationMs = Math.round(
          (entry.stats.avgDurationMs * (entry.stats.successes - 1) + duration) / entry.stats.successes
        );
        entry.stats.lastSuccess = now();

        const record = { ...ctx, success: true, duration, attempts, result };
        this.recordHistory(record);
        this.emit('job:success', record);
        this.persist();
        return record;
      } catch (err) {
        lastError = err;
        if (attempts < maxAttempts) {
          const delay = Math.min(1000 * 2 ** (attempts - 1), 30000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    const duration = now() - startTime;
    entry.running--;
    entry.stats.failures++;
    entry.stats.lastError = lastError?.message || 'Unknown error';

    const record = { ...ctx, success: false, duration, attempts, error: entry.stats.lastError };
    this.recordHistory(record);
    this.emit('job:failure', record);
    this.persist();
    return record;
  }

  recordHistory(record) {
    this.history.push(record);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  // ── Missed Run Recovery ──

  recoverMissedRuns() {
    const ts = now();
    const recovered = [];
    for (const entry of this.entries.values()) {
      if (!entry.enabled) continue;
      if (entry.nextRun && entry.nextRun < ts - 60000) {
        recovered.push({ id: entry.id, name: entry.name, missedAt: entry.nextRun });
        this.emit('job:missed', { id: entry.id, name: entry.name, missedAt: entry.nextRun });
      }
      entry.computeNextRun();
    }
    this.persist();
    return recovered;
  }

  // ── Query ──

  getUpcoming(minutes = 60) {
    const ts = now();
    const cutoff = ts + minutes * 60000;
    return this.list()
      .filter(e => e.enabled && e.nextRun && e.nextRun <= cutoff)
      .sort((a, b) => a.nextRun - b.nextRun);
  }

  getHistory(filter = {}) {
    let results = [...this.history];
    if (filter.entryId) results = results.filter(r => r.entryId === filter.entryId);
    if (filter.success !== undefined) results = results.filter(r => r.success === filter.success);
    if (filter.since) results = results.filter(r => r.startTime >= filter.since);
    return results.slice(-(filter.limit || 50));
  }

  getStats() {
    const jobs = [...this.entries.values()];
    return {
      totalJobs: jobs.length,
      enabledJobs: jobs.filter(j => j.enabled).length,
      runningJobs: jobs.filter(j => j.running > 0).length,
      totalRuns: this.history.length,
      successes: this.history.filter(r => r.success).length,
      failures: this.history.filter(r => !r.success).length,
      historySize: this.history.length,
    };
  }

  // ── Persistence ──

  persist() {
    if (!this.persistenceDir) return;
    const data = {
      entries: [...this.entries.values()].map(e => ({
        ...e.toJSON(),
        handlerName: e.handlerName,
      })),
      history: this.history.slice(-200),
    };
    writeFileSync(join(this.persistenceDir, 'schedule.json'), JSON.stringify(data, null, 2));
    // Append to JSONL log
    const logLine = JSON.stringify({ ts: now(), event: 'persist', entries: data.entries.length }) + '\n';
    appendFileSync(join(this.persistenceDir, 'schedule.jsonl'), logLine);
  }

  restore() {
    if (!this.persistenceDir) return;
    const file = join(this.persistenceDir, 'schedule.json');
    if (!existsSync(file)) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.entries) {
        for (const e of data.entries) {
          const entry = new ScheduleEntry(e);
          this.entries.set(entry.id, entry);
        }
      }
      if (data.history) this.history = data.history;
    } catch { /* ignore corrupt state */ }
  }
}

export { AgentSchedule, ScheduleEntry, parseCron, nextCronRun, matchesCronFull };
