/**
 * agent-tasks v1.0
 * Zero-dependency persistent task queue & scheduler for AI agents.
 *
 * Features:
 *  - Priority FIFO queue (critical/high/normal/low)
 *  - Delayed execution (runAt)
 *  - Task chains / dependencies (waitFor)
 *  - Retry with exponential backoff
 *  - Concurrency limits
 *  - Recurring tasks (cron-like every N ms)
 *  - Dead-letter queue on permanent failure
 *  - Webhook on completion (POST URL)
 *  - JSONL persistence + periodic snapshots
 *  - EventEmitter for real-time observation
 */

import { EventEmitter } from "events";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
let _seq = 0;
function uid() { return `${Date.now().toString(36)}-${(++_seq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }
function now() { return Date.now(); }

function readJSONL(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function appendJSONL(file, obj) {
  const dir = file.substring(0, file.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(file, JSON.stringify(obj) + "\n");
}

// ── Task States ──────────────────────────────────────────────────────────────
// pending → running → completed | failed → retrying → pending (or dead_letter)

const STATES = {
  PENDING: "pending",
  WAITING_DEPS: "waiting_deps",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  RETRYING: "retrying",
  DEAD_LETTER: "dead_letter",
  CANCELLED: "cancelled",
};

// ── TaskQueue Class ──────────────────────────────────────────────────────────

export class TaskQueue extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir      – directory for persistence files
   * @param {number} opts.concurrency  – max parallel running tasks (default 4)
   * @param {number} opts.pollMs       – scheduler poll interval (default 500)
   * @param {number} opts.snapshotEvery – persist full snapshot every N events (default 50)
   * @param {Function} opts.executor   – async (task) => result — the actual worker
   */
  constructor(opts = {}) {
    super();
    this.dataDir = opts.dataDir || "./agent-tasks-data";
    this.concurrency = opts.concurrency ?? 4;
    this.pollMs = opts.pollMs ?? 500;
    this.snapshotEvery = opts.snapshotEvery ?? 50;
    this.executor = opts.executor || (async (task) => ({ ok: true, task: task.id }));

    this.tasks = new Map();        // id → task
    this.queue = [];               // sorted by priority
    this.running = new Set();      // ids currently executing
    this.deadLetter = [];          // permanently failed tasks
    this.recurring = new Map();    // id → recurring config
    this.completed = 0;
    this.failed = 0;
    this.totalProcessed = 0;
    this._eventCount = 0;
    this._timer = null;

    // file paths
    this._logFile = join(this.dataDir, "tasks.jsonl");
    this._snapFile = join(this.dataDir, "snapshot.json");
    this._deadFile = join(this.dataDir, "dead-letter.jsonl");

    // ensure dir
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });

    // restore
    this._restore();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Enqueue a task.
   * @param {object} spec
   * @param {string} spec.type          – task type label
   * @param {object} spec.payload       – arbitrary data for executor
   * @param {string} [spec.priority]    – critical|high|normal|low (default normal)
   * @param {number} [spec.runAt]       – epoch ms: delay execution until
   * @param {string[]} [spec.waitFor]   – task ids that must complete first
   * @param {number} [spec.maxRetries]  – retry count (default 3)
   * @param {number} [spec.retryDelayMs] – base retry delay (default 1000)
   * @param {string} [spec.webhookUrl]  – POST result here on completion
   * @param {number} [spec.timeoutMs]   – kill if running longer than this
   * @param {object} [spec.recurring]   – { everyMs } for repeating tasks
   * @param {object} [spec.meta]        – user metadata
   * @returns {object} task
   */
  enqueue(spec) {
    const task = {
      id: uid(),
      type: spec.type || "generic",
      payload: spec.payload || {},
      priority: spec.priority || "normal",
      runAt: spec.runAt || now(),
      waitFor: spec.waitFor || [],
      maxRetries: spec.maxRetries ?? 3,
      retryDelayMs: spec.retryDelayMs ?? 1000,
      retries: 0,
      webhookUrl: spec.webhookUrl || null,
      timeoutMs: spec.timeoutMs || null,
      meta: spec.meta || {},
      status: STATES.PENDING,
      result: null,
      error: null,
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      lastRetryAt: null,
    };

    // handle dependencies
    if (task.waitFor.length > 0) {
      const unresolved = task.waitFor.filter(id => {
        const t = this.tasks.get(id);
        return !t || (t.status !== STATES.COMPLETED && t.status !== STATES.CANCELLED);
      });
      if (unresolved.length > 0) task.status = STATES.WAITING_DEPS;
    }

    this.tasks.set(task.id, task);

    // recurring config
    if (spec.recurring && spec.recurring.everyMs) {
      this.recurring.set(task.id, { everyMs: spec.recurring.everyMs, template: { ...spec } });
    }

    if (task.status === STATES.PENDING) this._insertQueue(task);
    this._log("enqueue", task);
    this._maybeSnapshot();

    this.emit("enqueue", task);
    return { ...task };
  }

  /** Cancel a pending/waiting task. */
  cancel(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status === STATES.RUNNING) throw new Error("Cannot cancel running task; use kill()");
    task.status = STATES.CANCELLED;
    task.completedAt = now();
    this.queue = this.queue.filter(t => t.id !== taskId);
    this._log("cancel", task);
    this.emit("cancel", task);
    return { ...task };
  }

  /** Kill a running task (best-effort). */
  async kill(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== STATES.RUNNING) return this.cancel(taskId);
    task.status = STATES.CANCELLED;
    task.completedAt = now();
    this.running.delete(taskId);
    this._log("kill", task);
    this.emit("kill", task);
    return { ...task };
  }

  /** Get task by id. */
  get(taskId) {
    const t = this.tasks.get(taskId);
    return t ? { ...t } : null;
  }

  /** List tasks with optional filters. */
  list(opts = {}) {
    let tasks = [...this.tasks.values()];
    if (opts.status) tasks = tasks.filter(t => t.status === opts.status);
    if (opts.type) tasks = tasks.filter(t => t.type === opts.type);
    if (opts.priority) tasks = tasks.filter(t => t.priority === opts.priority);
    if (opts.since) tasks = tasks.filter(t => t.createdAt >= opts.since);
    tasks.sort((a, b) => {
      const pd = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
      return pd !== 0 ? pd : a.createdAt - b.createdAt;
    });
    if (opts.limit) tasks = tasks.slice(0, opts.limit);
    return tasks.map(t => ({ ...t }));
  }

  /** Get queue stats. */
  stats() {
    const pending = [...this.tasks.values()].filter(t => t.status === STATES.PENDING).length;
    const waitingDeps = [...this.tasks.values()].filter(t => t.status === STATES.WAITING_DEPS).length;
    const retrying = [...this.tasks.values()].filter(t => t.status === STATES.RETRYING).length;
    return {
      pending,
      waitingDeps,
      running: this.running.size,
      retrying,
      completed: this.completed,
      failed: this.failed,
      deadLetter: this.deadLetter.length,
      totalProcessed: this.totalProcessed,
      recurring: this.recurring.size,
      queueDepth: this.queue.length,
      concurrency: this.concurrency,
      uptime: this._timer ? now() - this._startTime : 0,
    };
  }

  /** Get dead-letter queue. */
  getDeadLetter() { return [...this.deadLetter]; }

  /** Re-enqueue a dead-letter task (reset retries). */
  retryDeadLetter(taskId) {
    const idx = this.deadLetter.findIndex(t => t.id === taskId);
    if (idx === -1) throw new Error(`Dead-letter task ${taskId} not found`);
    const task = this.deadLetter.splice(idx, 1)[0];
    task.status = STATES.PENDING;
    task.retries = 0;
    task.error = null;
    task.lastRetryAt = now();
    this.tasks.set(task.id, task);
    this._insertQueue(task);
    this._log("retry_dead", task);
    this.emit("retry", task);
    return { ...task };
  }

  /** Clear completed/failed tasks older than maxAgeMs. */
  prune(maxAgeMs = 86400000) {
    const cutoff = now() - maxAgeMs;
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if ([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(task.status) && task.completedAt && task.completedAt < cutoff) {
        this.tasks.delete(id);
        removed++;
      }
    }
    this._maybeSnapshot(true);
    return removed;
  }

  /** Clear all completed tasks. */
  clearCompleted() {
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (task.status === STATES.COMPLETED) { this.tasks.delete(id); removed++; }
    }
    return removed;
  }

  // ── Scheduler ──────────────────────────────────────────────────────────────

  /** Start the scheduler loop. */
  start() {
    if (this._timer) return;
    this._startTime = now();
    this._timer = setInterval(() => this._tick(), this.pollMs);
    this.emit("start");
  }

  /** Stop the scheduler loop. */
  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._maybeSnapshot(true);
    this.emit("stop");
  }

  /** Run a single scheduler tick (useful for testing / manual mode). */
  async tick() { await this._tick(); }

  // ── Internal ───────────────────────────────────────────────────────────────

  async _tick() {
    // check dependency resolution
    for (const [id, task] of this.tasks) {
      if (task.status === STATES.WAITING_DEPS) {
        const allDone = task.waitFor.every(wid => {
          const wt = this.tasks.get(wid);
          return wt && (wt.status === STATES.COMPLETED || wt.status === STATES.CANCELLED);
        });
        if (allDone) {
          task.status = STATES.PENDING;
          task.runAt = now();
          this._insertQueue(task);
          this._log("deps_resolved", task);
          this.emit("deps_resolved", task);
        }
      }
    }

    // check retrying tasks
    for (const [id, task] of this.tasks) {
      if (task.status === STATES.RETRYING && task.lastRetryAt + this._backoffDelay(task) <= now()) {
        task.status = STATES.PENDING;
        this._insertQueue(task);
        this._log("retry_ready", task);
      }
    }

    // check recurring tasks
    for (const [id, config] of this.recurring) {
      const lastTask = this.tasks.get(id);
      if (!lastTask) continue;
      const lastCompleted = lastTask.completedAt || lastTask.createdAt;
      if (lastTask.status === STATES.COMPLETED && lastCompleted + config.everyMs <= now()) {
        // spawn new instance
        const spec = { ...config.template, runAt: now() };
        delete spec.recurring; // don't nest recurring
        const newTask = this.enqueue(spec);
        // update recurring mapping to new id
        this.recurring.delete(id);
        this.recurring.set(newTask.id, config);
      }
    }

    // execute pending tasks up to concurrency
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task || task.status !== STATES.PENDING) continue;
      if (task.runAt > now()) { this._insertQueue(task); continue; } // not yet
      this._execute(task);
    }
  }

  async _execute(task) {
    task.status = STATES.RUNNING;
    task.startedAt = now();
    this.running.add(task.id);
    this._log("start", task);
    this.emit("start", task);

    try {
      let result;
      if (task.timeoutMs) {
        result = await Promise.race([
          this.executor(task),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), task.timeoutMs)),
        ]);
      } else {
        result = await this.executor(task);
      }

      task.status = STATES.COMPLETED;
      task.result = result;
      task.completedAt = now();
      this.running.delete(task.id);
      this.completed++;
      this.totalProcessed++;
      this._log("complete", task);
      this.emit("complete", task);

      // webhook
      if (task.webhookUrl) this._fireWebhook(task);
    } catch (err) {
      this.running.delete(task.id);
      task.error = err.message || String(err);
      task.retries++;

      if (task.retries <= task.maxRetries) {
        task.status = STATES.RETRYING;
        task.lastRetryAt = now();
        this._log("retry", task);
        this.emit("retry", task);
      } else {
        task.status = STATES.DEAD_LETTER;
        task.completedAt = now();
        this.deadLetter.push({ ...task });
        this.failed++;
        this.totalProcessed++;
        this._log("dead_letter", task);
        appendJSONL(this._deadFile, task);
        this.emit("dead_letter", task);
      }
    }

    this._maybeSnapshot();
  }

  _backoffDelay(task) {
    return task.retryDelayMs * Math.pow(2, task.retries - 1);
  }

  _insertQueue(task) {
    const pri = PRIORITY_ORDER[task.priority] ?? 2;
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      const ipri = PRIORITY_ORDER[this.queue[i].priority] ?? 2;
      if (pri < ipri || (pri === ipri && task.runAt < this.queue[i].runAt)) {
        this.queue.splice(i, 0, task);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.queue.push(task);
  }

  async _fireWebhook(task) {
    try {
      await fetch(task.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "complete", task: { id: task.id, type: task.type, result: task.result } }),
      });
    } catch { /* best effort */ }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  _log(event, task) {
    appendJSONL(this._logFile, { event, taskId: task.id, status: task.status, ts: now() });
    this._eventCount++;
  }

  _maybeSnapshot(force = false) {
    if (!force && this._eventCount % this.snapshotEvery !== 0) return;
    const state = {
      tasks: Object.fromEntries(this.tasks),
      deadLetter: this.deadLetter,
      recurring: Object.fromEntries(this.recurring),
      completed: this.completed,
      failed: this.failed,
      totalProcessed: this.totalProcessed,
      ts: now(),
    };
    writeFileSync(this._snapFile, JSON.stringify(state));
  }

  _restore() {
    if (!existsSync(this._snapFile)) return;
    try {
      const state = JSON.parse(readFileSync(this._snapFile, "utf8"));
      if (state.tasks) {
        for (const [id, task] of Object.entries(state.tasks)) {
          this.tasks.set(id, task);
          if (task.status === STATES.PENDING || task.status === STATES.WAITING_DEPS) {
            this._insertQueue(task);
          }
        }
      }
      if (state.deadLetter) this.deadLetter = state.deadLetter;
      if (state.recurring) this.recurring = new Map(Object.entries(state.recurring));
      this.completed = state.completed || 0;
      this.failed = state.failed || 0;
      this.totalProcessed = state.totalProcessed || 0;

      // clear any tasks left in RUNNING state (they died with the process)
      for (const [id, task] of this.tasks) {
        if (task.status === STATES.RUNNING) {
          task.status = STATES.PENDING;
          this._insertQueue(task);
        }
      }
    } catch { /* corrupt snapshot, start fresh */ }
  }

  /** Export full state as JSON. */
  exportState() {
    return {
      tasks: [...this.tasks.values()],
      deadLetter: [...this.deadLetter],
      stats: this.stats(),
    };
  }
}

export { STATES };
export default TaskQueue;
