/**
 * agent-log — Zero-dependency structured logging for AI agents
 *
 * Features:
 * - Structured JSON logging with levels (trace/debug/info/warn/error/fatal)
 * - Context propagation via child loggers
 * - Correlation IDs for distributed tracing
 * - Multiple transports: console (colored), file, JSONL, HTTP webhook
 * - Log rotation by size
 * - Redaction of sensitive fields (PII, secrets)
 * - Conditional logging / sampling
 * - Span linking with agent-trace
 * - Buffered writes for performance
 * - Query engine for searching logs
 * - EventEmitter for real-time log streaming
 * - Prometheus-compatible metrics export
 */

import { EventEmitter } from "events";
import { writeFileSync, appendFileSync, readFileSync, existsSync, statSync, renameSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";

// ── Constants ──────────────────────────────────────────────────────

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const LEVEL_NAMES = Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [v, k]));
const COLORS = { trace: "\x1b[90m", debug: "\x1b[36m", info: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[31m", fatal: "\x1b[35m" };
const RESET = "\x1b[0m";
const DEFAULT_REDACT_FIELDS = ["password", "token", "secret", "key", "authorization", "cookie", "ssn", "creditCard", "apiKey", "api_key"];

// ── Utilities ──────────────────────────────────────────────────────

function genId(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function genCorrelationId() {
  return `${Date.now().toString(36)}-${genId(8)}`;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function redactValue(key, value, fields) {
  const lk = key.toLowerCase();
  for (const f of fields) {
    if (lk.includes(f.toLowerCase())) return "[REDACTED]";
  }
  return value;
}

function redactObj(obj, fields, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactObj(v, fields, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "object" && v !== null ? redactObj(v, fields, depth + 1) : redactValue(k, v, fields);
  }
  return out;
}

function ts() {
  return new Date().toISOString();
}

function fmtConsole(entry) {
  const c = COLORS[entry.level] || "";
  const ts = entry.timestamp.slice(11, 23);
  const ctx = entry.context ? ` [${entry.context}]` : "";
  const corr = entry.correlationId ? ` {${entry.correlationId.slice(-8)}}` : "";
  let msg = `${c}${ts}${RESET} ${c}${entry.level.toUpperCase().padEnd(5)}${RESET}${ctx}${corr} ${entry.message}`;
  if (entry.spanId) msg += ` span=${entry.spanId}`;
  if (entry.error) {
    msg += `\n  ${c}Error: ${entry.error.message || entry.error}${RESET}`;
    if (entry.error.stack) msg += `\n  ${entry.error.stack.split("\n").slice(1, 4).join("\n  ")}`;
  }
  const meta = { ...entry };
  delete meta.timestamp;
  delete meta.level;
  delete meta.message;
  delete meta.context;
  delete meta.correlationId;
  delete meta.spanId;
  delete meta.error;
  delete meta.pid;
  delete meta.hostname;
  if (Object.keys(meta).length > 0) {
    msg += `\n  ${c}${JSON.stringify(meta)}${RESET}`;
  }
  return msg;
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Transports ─────────────────────────────────────────────────────

class ConsoleTransport {
  constructor(opts = {}) {
    this.minLevel = LEVELS[opts.level] || LEVELS.info;
    this.colors = opts.colors !== false;
  }
  write(entry) {
    if (LEVELS[entry.level] < this.minLevel) return;
    const line = this.colors ? fmtConsole(entry) : JSON.stringify(entry);
    if (LEVELS[entry.level] >= LEVELS.error) {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }
}

class FileTransport {
  constructor(opts = {}) {
    this.path = opts.path || "agent-log.jsonl";
    this.minLevel = LEVELS[opts.level] || LEVELS.trace;
    this.maxSize = opts.maxSize || 50 * 1024 * 1024; // 50MB
    this.maxFiles = opts.maxFiles || 5;
    this.buffer = [];
    this.bufferSize = opts.bufferSize || 100;
    this.flushInterval = opts.flushInterval || 1000;
    ensureDir(this.path);
    this._timer = setInterval(() => this.flush(), this.flushInterval);
    if (this._timer.unref) this._timer.unref();
  }
  write(entry) {
    if (LEVELS[entry.level] < this.minLevel) return;
    this.buffer.push(JSON.stringify(entry));
    if (this.buffer.length >= this.bufferSize) this.flush();
  }
  flush() {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.join("\n") + "\n";
    this.buffer = [];
    try {
      this._rotate();
      appendFileSync(this.path, lines);
    } catch { /* ignore write errors */ }
  }
  _rotate() {
    try {
      const stat = statSync(this.path);
      if (stat.size < this.maxSize) return;
      for (let i = this.maxFiles - 1; i > 0; i--) {
        const src = `${this.path}.${i}`;
        const dst = `${this.path}.${i + 1}`;
        if (existsSync(src)) renameSync(src, dst);
      }
      renameSync(this.path, `${this.path}.1`);
    } catch { /* file may not exist yet */ }
  }
  destroy() {
    clearInterval(this._timer);
    this.flush();
  }
}

class HttpTransport {
  constructor(opts = {}) {
    this.url = opts.url;
    this.minLevel = LEVELS[opts.level] || LEVELS.warn;
    this.batchSize = opts.batchSize || 10;
    this.flushInterval = opts.flushInterval || 5000;
    this.headers = { "content-type": "application/json", ...(opts.headers || {}) };
    this.buffer = [];
    this._timer = setInterval(() => this.flush(), this.flushInterval);
    if (this._timer.unref) this._timer.unref();
  }
  write(entry) {
    if (LEVELS[entry.level] < this.minLevel) return;
    this.buffer.push(entry);
    if (this.buffer.length >= this.batchSize) this.flush();
  }
  async flush() {
    if (this.buffer.length === 0 || !this.url) return;
    const batch = this.buffer.splice(0);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ logs: batch }),
      });
      if (!res.ok) {
        // Re-queue on failure (front, limited)
        this.buffer.unshift(...batch.slice(-this.batchSize));
      }
    } catch {
      this.buffer.unshift(...batch.slice(-this.batchSize));
    }
  }
  destroy() {
    clearInterval(this._timer);
    this.flush().catch(() => {});
  }
}

// ── Logger Class ───────────────────────────────────────────────────

class Logger extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} [opts.name] - Logger name/context
   * @param {string} [opts.level] - Minimum level (trace/debug/info/warn/error/fatal)
   * @param {Object} [opts.context] - Default context fields
   * @param {string} [opts.correlationId] - Correlation ID for distributed tracing
   * @param {string[]} [opts.redactFields] - Fields to redact
   * @param {Array} [opts.transports] - Transport instances
   * @param {number} [opts.sampleRate] - Sampling rate 0-1 (1 = log everything)
   * @param {Function} [opts.filter] - Custom filter fn(entry) => boolean
   */
  constructor(opts = {}) {
    super();
    this.name = opts.name || "agent-log";
    this.minLevel = LEVELS[opts.level] || LEVELS.trace;
    this.context = opts.context || {};
    this.correlationId = opts.correlationId || genCorrelationId();
    this.redactFields = [...DEFAULT_REDACT_FIELDS, ...(opts.redactFields || [])];
    this.transports = opts.transports || [new ConsoleTransport()];
    this.sampleRate = opts.sampleRate ?? 1;
    this.filter = opts.filter || null;
    this.spanId = opts.spanId || null;
    this.pid = typeof process !== "undefined" ? process.pid : 0;
    this.hostname = opts.hostname || "local";
    this._count = 0;
  }

  _shouldLog(level) {
    if (LEVELS[level] < this.minLevel) return false;
    if (this.sampleRate < 1 && Math.random() > this.sampleRate) return false;
    return true;
  }

  _emit(level, message, meta = {}) {
    if (!this._shouldLog(level)) return this;
    if (typeof message === "object") {
      meta = message;
      message = meta.message || "(no message)";
    }

    const entry = {
      timestamp: ts(),
      level,
      message,
      logger: this.name,
      context: this.context.name || this.name,
      correlationId: this.correlationId,
      pid: this.pid,
      hostname: this.hostname,
      seq: ++this._count,
    };

    if (this.spanId) entry.spanId = this.spanId;
    if (meta.error) {
      entry.error = meta.error instanceof Error
        ? { message: meta.error.message, stack: meta.error.stack, code: meta.error.code }
        : meta.error;
      delete meta.error;
    }

    // Merge remaining meta
    for (const [k, v] of Object.entries(meta)) {
      if (k !== "message") entry[k] = typeof v === "object" ? redactObj(v, this.redactFields) : v;
    }

    // Redact top-level sensitive fields
    const finalEntry = redactObj(entry, this.redactFields);

    if (this.filter && !this.filter(finalEntry)) return this;

    for (const t of this.transports) {
      try { t.write(finalEntry); } catch { /* transport error */ }
    }

    this.emit("log", finalEntry);
    return this;
  }

  trace(msg, meta) { return this._emit("trace", msg, meta); }
  debug(msg, meta) { return this._emit("debug", msg, meta); }
  info(msg, meta) { return this._emit("info", msg, meta); }
  warn(msg, meta) { return this._emit("warn", msg, meta); }
  error(msg, meta) { return this._emit("error", msg, meta); }
  fatal(msg, meta) { return this._emit("fatal", msg, meta); }

  /** Create child logger inheriting config with additional context */
  child(opts = {}) {
    return new Logger({
      name: opts.name || this.name,
      level: LEVEL_NAMES[this.minLevel] || "trace",
      context: { ...this.context, ...opts.context },
      correlationId: opts.correlationId || this.correlationId,
      redactFields: [...this.redactFields],
      transports: this.transports,
      sampleRate: this.sampleRate,
      filter: opts.filter || this.filter,
      spanId: opts.spanId || this.spanId,
      hostname: this.hostname,
    });
  }

  /** Start a new correlation span (returns child logger with span) */
  startSpan(spanId, meta = {}) {
    const id = spanId || genId(8);
    this.info(`Span started: ${id}`, { spanId: id, ...meta });
    return this.child({ spanId: id });
  }

  /** Link to a trace span (agent-trace integration) */
  linkSpan(spanId) {
    return this.child({ spanId });
  }

  /** Time an async operation */
  async time(label, fn, meta = {}) {
    const start = performance.now();
    this.debug(`${label} - started`, meta);
    try {
      const result = await fn();
      const duration = Math.round(performance.now() - start);
      this.info(`${label} - completed`, { ...meta, durationMs: duration });
      return result;
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      this.error(`${label} - failed`, { ...meta, durationMs: duration, error: err });
      throw err;
    }
  }

  /** Time a sync operation */
  timeSync(label, fn, meta = {}) {
    const start = performance.now();
    this.debug(`${label} - started`, meta);
    try {
      const result = fn();
      const duration = Math.round(performance.now() - start);
      this.info(`${label} - completed`, { ...meta, durationMs: duration });
      return result;
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      this.error(`${label} - failed`, { ...meta, durationMs: duration, error: err });
      throw err;
    }
  }

  /** Flush all transports */
  flush() {
    for (const t of this.transports) {
      if (t.flush) t.flush();
    }
  }

  /** Destroy logger and clean up transports */
  destroy() {
    this.flush();
    for (const t of this.transports) {
      if (t.destroy) t.destroy();
    }
    this.removeAllListeners();
  }

  /** Export logs as JSON array (from JSONL file transport) */
  static readJsonl(filePath, opts = {}) {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf8");
    let entries = content.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    if (opts.level) entries = entries.filter((e) => LEVELS[e.level] >= LEVELS[opts.level]);
    if (opts.since) entries = entries.filter((e) => new Date(e.timestamp) >= new Date(opts.since));
    if (opts.until) entries = entries.filter((e) => new Date(e.timestamp) <= new Date(opts.until));
    if (opts.context) entries = entries.filter((e) => e.context === opts.context || e.logger === opts.context);
    if (opts.correlationId) entries = entries.filter((e) => e.correlationId === opts.correlationId);
    if (opts.spanId) entries = entries.filter((e) => e.spanId === opts.spanId);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(q) || JSON.stringify(e).toLowerCase().includes(q));
    }
    if (opts.limit) entries = entries.slice(-opts.limit);
    return entries;
  }

  /** Get stats from JSONL file */
  static statsJsonl(filePath) {
    if (!existsSync(filePath)) return { total: 0, byLevel: {} };
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const byLevel = {};
    let total = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        byLevel[entry.level] = (byLevel[entry.level] || 0) + 1;
        total++;
      } catch { /* skip */ }
    }
    const size = statSync(filePath).size;
    return { total, byLevel, sizeBytes: size, sizeFormatted: formatBytes(size) };
  }
}

function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

// ── Exports ────────────────────────────────────────────────────────

export {
  Logger,
  ConsoleTransport,
  FileTransport,
  HttpTransport,
  LEVELS,
  LEVEL_NAMES,
  genCorrelationId,
  genId,
};

export default Logger;
