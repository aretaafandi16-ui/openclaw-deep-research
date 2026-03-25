/**
 * agent-dispatch — Smart event dispatcher & message router for AI agents
 * 
 * Features:
 * - Content-based routing rules with pattern matching (regex, glob, exact, custom)
 * - Routing strategies: first-match, all-match, best-match, weighted, round-robin
 * - Message classification & tagging
 * - Priority message queues (CRITICAL/HIGH/NORMAL/LOW)
 * - Fan-out (1→N) and fan-in (N→1) patterns
 * - Message transformation pipelines (per-route)
 * - Filter engine (field match, regex, type, custom predicates)
 * - Dead letter queue with retry
 * - Per-route rate limiting
 * - Middleware hooks (before/after/error)
 * - JSONL persistence + snapshots
 * - EventEmitter for real-time monitoring
 */

import { EventEmitter } from 'events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ─── Priority Queue ───────────────────────────────────────────────

class PriorityQueue {
  constructor() {
    this._buckets = { critical: [], high: [], normal: [], low: [] };
    this._size = 0;
  }

  push(item, priority = 'normal') {
    const p = ['critical', 'high', 'normal', 'low'].includes(priority) ? priority : 'normal';
    this._buckets[p].push(item);
    this._size++;
  }

  pop() {
    for (const p of ['critical', 'high', 'normal', 'low']) {
      if (this._buckets[p].length > 0) {
        this._size--;
        return this._buckets[p].shift();
      }
    }
    return null;
  }

  peek() {
    for (const p of ['critical', 'high', 'normal', 'low']) {
      if (this._buckets[p].length > 0) return this._buckets[p][0];
    }
    return null;
  }

  get size() { return this._size; }
  get empty() { return this._size === 0; }
  clear() { this._buckets = { critical: [], high: [], normal: [], low: [] }; this._size = 0; }
  sizes() {
    return {
      critical: this._buckets.critical.length,
      high: this._buckets.high.length,
      normal: this._buckets.normal.length,
      low: this._buckets.low.length,
    };
  }
}

// ─── Sliding Window Rate Limiter ──────────────────────────────────

class RateLimiter {
  constructor(maxPerWindow = 100, windowMs = 60000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this._hits = [];
  }

  tryConsume(n = 1) {
    const now = Date.now();
    this._hits = this._hits.filter(t => now - t < this.windowMs);
    if (this._hits.length + n > this.maxPerWindow) return false;
    for (let i = 0; i < n; i++) this._hits.push(now);
    return true;
  }

  get remaining() {
    const now = Date.now();
    this._hits = this._hits.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxPerWindow - this._hits.length);
  }
}

// ─── Filter Engine ────────────────────────────────────────────────

function matchFilter(msg, filter) {
  if (!filter) return true;

  if (typeof filter === 'function') return filter(msg);

  if (filter.$and) return filter.$and.every(f => matchFilter(msg, f));
  if (filter.$or) return filter.$or.some(f => matchFilter(msg, f));
  if (filter.$not) return !matchFilter(msg, filter.$not);

  for (const [key, condition] of Object.entries(filter)) {
    if (key.startsWith('$')) continue;
    const val = getNestedValue(msg, key);
    if (!evaluateCondition(val, condition)) return false;
  }
  return true;
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o && o[k] !== undefined ? o[k] : undefined, obj);
}

function evaluateCondition(val, condition) {
  if (condition === null || condition === undefined) return val === null || val === undefined;
  if (typeof condition !== 'object' || condition instanceof RegExp) {
    if (condition instanceof RegExp) return condition.test(String(val ?? ''));
    return val === condition;
  }
  if (condition.$eq !== undefined) return val === condition.$eq;
  if (condition.$ne !== undefined) return val !== condition.$ne;
  if (condition.$gt !== undefined) return val > condition.$gt;
  if (condition.$gte !== undefined) return val >= condition.$gte;
  if (condition.$lt !== undefined) return val < condition.$lt;
  if (condition.$lte !== undefined) return val <= condition.$lte;
  if (condition.$in) return condition.$in.includes(val);
  if (condition.$nin) return !condition.$nin.includes(val);
  if (condition.$exists !== undefined) return condition.$exists ? val !== undefined : val === undefined;
  if (condition.$contains) return String(val ?? '').includes(condition.$contains);
  if (condition.$regex) return new RegExp(condition.$regex, condition.$flags || '').test(String(val ?? ''));
  if (condition.$type) return typeof val === condition.$type;
  if (condition.$custom) return condition.$custom(val);
  if (condition.$between) return val >= condition.$between[0] && val <= condition.$between[1];
  return true;
}

// ─── Route Pattern Matching ───────────────────────────────────────

function matchPattern(msg, pattern) {
  if (!pattern) return true;
  if (typeof pattern === 'function') return pattern(msg);

  if (typeof pattern === 'object' && !pattern.type) {
    return matchFilter(msg, pattern);
  }

  const { type = 'exact', field = 'type', value, values } = pattern;
  const fieldValue = getNestedValue(msg, field);
  const fv = String(fieldValue ?? '');

  switch (type) {
    case 'exact': return fv === value;
    case 'contains': return fv.includes(value);
    case 'prefix': return fv.startsWith(value);
    case 'suffix': return fv.endsWith(value);
    case 'regex': return new RegExp(value, pattern.flags || '').test(fv);
    case 'glob': {
      const rx = new RegExp('^' + value.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return rx.test(fv);
    }
    case 'in': return (values || []).includes(fieldValue);
    case 'range': return fieldValue >= (pattern.min ?? -Infinity) && fieldValue <= (pattern.max ?? Infinity);
    case 'custom': return value(msg);
    default: return false;
  }
}

// ─── Transform Pipeline ───────────────────────────────────────────

function applyTransform(msg, transforms) {
  if (!transforms || transforms.length === 0) return msg;
  let result = JSON.parse(JSON.stringify(msg));
  for (const t of transforms) {
    if (typeof t === 'function') { result = t(result); continue; }
    const { op, field, target, value } = t;
    switch (op) {
      case 'set': {
        let v = value;
        if (v === undefined && t.template) v = interpolate(t.template, result);
        if (v === undefined && target) v = getNestedValue(result, target);
        setNestedValue(result, field, v);
        break;
      }
      case 'delete': deleteNestedValue(result, field); break;
      case 'rename': setNestedValue(result, value, getNestedValue(result, field)); deleteNestedValue(result, field); break;
      case 'copy': setNestedValue(result, target, getNestedValue(result, field)); break;
      case 'default': if (getNestedValue(result, field) === undefined) setNestedValue(result, field, value); break;
      case 'lowercase': setNestedValue(result, field, String(getNestedValue(result, field) ?? '').toLowerCase()); break;
      case 'uppercase': setNestedValue(result, field, String(getNestedValue(result, field) ?? '').toUpperCase()); break;
      case 'trim': setNestedValue(result, field, String(getNestedValue(result, field) ?? '').trim()); break;
      case 'prefix': setNestedValue(result, field, value + String(getNestedValue(result, field) ?? '')); break;
      case 'suffix': setNestedValue(result, field, String(getNestedValue(result, field) ?? '') + value); break;
      case 'template': setNestedValue(result, field, interpolate(value, result)); break;
      case 'map': {
        const arr = getNestedValue(result, field);
        if (Array.isArray(arr)) setNestedValue(result, field, arr.map(value));
        break;
      }
      case 'filter_arr': {
        const arr = getNestedValue(result, field);
        if (Array.isArray(arr)) setNestedValue(result, field, arr.filter(value));
        break;
      }
      case 'flatten': {
        const arr = getNestedValue(result, field);
        if (Array.isArray(arr)) setNestedValue(result, field, arr.flat());
        break;
      }
    }
  }
  return result;
}

function interpolate(template, data) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const v = getNestedValue(data, path.trim());
    return v !== undefined ? String(v) : '';
  });
}

function setNestedValue(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = val;
}

function deleteNestedValue(obj, path) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]]) return;
    o = o[parts[i]];
  }
  delete o[parts[parts.length - 1]];
}

// ─── Route Definition ─────────────────────────────────────────────

class Route {
  constructor(config) {
    this.id = config.id || `route_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.name = config.name || this.id;
    this.pattern = config.pattern || null;
    this.handler = config.handler || null;
    this.priority = config.priority || 'normal';
    this.weight = config.weight ?? 1;
    this.transforms = config.transforms || [];
    this.filters = config.filters || [];
    this.rateLimit = config.rateLimit || null;
    this.retry = config.retry || { maxAttempts: 3, backoffMs: 1000 };
    this.tags = config.tags || [];
    this.enabled = config.enabled !== false;
    this.stats = { matched: 0, delivered: 0, failed: 0, lastMatched: null, lastDelivered: null };
  }
}

// ─── DispatchResult ───────────────────────────────────────────────

function makeResult(msg, route, success, error) {
  return {
    messageId: msg._id,
    routeId: route?.id,
    routeName: route?.name,
    success,
    error: error?.message || error || null,
    timestamp: Date.now(),
  };
}

// ─── Main Dispatcher ──────────────────────────────────────────────

export class Dispatcher extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = opts.id || 'default';
    this.routes = new Map();
    this.queue = new PriorityQueue();
    this.dlq = []; // dead letter queue
    this._routeOrder = [];
    this._strategy = opts.strategy || 'first-match'; // first-match, all-match, best-match, weighted, round-robin
    this._rrIndex = 0;
    this._history = []; // recent dispatch results
    this._maxHistory = opts.maxHistory || 1000;
    this._processing = false;
    this._maxDLQ = opts.maxDLQ || 500;
    this._msgCounter = 0;
    this._middleware = { before: [], after: [], error: [] };

    // Per-route rate limiters
    this._rateLimiters = new Map();

    // Persistence
    this._persistDir = opts.persistDir || null;
    if (this._persistDir && !existsSync(this._persistDir)) {
      mkdirSync(this._persistDir, { recursive: true });
    }
    this._autoPersist = opts.autoPersist ?? false;
    this._persistTimer = null;
    if (this._autoPersist && this._persistDir) {
      this._persistTimer = setInterval(() => this.save(), 30000);
      this._persistTimer.unref();
    }

    // Fan-in tracking
    this._fanInBuffers = new Map();

    // Stats
    this.stats = {
      received: 0,
      dispatched: 0,
      matched: 0,
      failed: 0,
      dlq: 0,
      dropped: 0,
      startedAt: Date.now(),
    };
  }

  // ── Middleware ───────────────────────────────────────────────────

  use(phase, fn) {
    if (!this._middleware[phase]) throw new Error(`Unknown middleware phase: ${phase}`);
    this._middleware[phase].push(fn);
    return this;
  }

  async _runMiddleware(phase, msg, ctx) {
    for (const fn of this._middleware[phase]) {
      const result = await fn(msg, ctx);
      if (result === false) return false; // halt
      if (result && typeof result === 'object' && result.message) Object.assign(msg, result.message);
    }
    return true;
  }

  // ── Route Management ────────────────────────────────────────────

  addRoute(config) {
    const route = config instanceof Route ? config : new Route(config);
    this.routes.set(route.id, route);
    this._routeOrder.push(route.id);
    if (route.rateLimit) {
      this._rateLimiters.set(route.id, new RateLimiter(route.rateLimit.max, route.rateLimit.windowMs));
    }
    this.emit('route:added', route);
    return route;
  }

  removeRoute(id) {
    const route = this.routes.get(id);
    if (!route) return false;
    this.routes.delete(id);
    this._routeOrder = this._routeOrder.filter(rid => rid !== id);
    this._rateLimiters.delete(id);
    this.emit('route:removed', route);
    return true;
  }

  enableRoute(id) {
    const route = this.routes.get(id);
    if (!route) return false;
    route.enabled = true;
    this.emit('route:enabled', route);
    return true;
  }

  disableRoute(id) {
    const route = this.routes.get(id);
    if (!route) return false;
    route.enabled = false;
    this.emit('route:disabled', route);
    return true;
  }

  getRoute(id) { return this.routes.get(id) || null; }
  listRoutes() { return [...this.routes.values()]; }

  // ── Message Submission ──────────────────────────────────────────

  async submit(message, opts = {}) {
    const msg = {
      ...message,
      _id: message._id || `msg_${++this._msgCounter}_${Date.now()}`,
      _submittedAt: Date.now(),
      _priority: opts.priority || 'normal',
      _tags: opts.tags || message._tags || [],
      _metadata: opts.metadata || {},
    };

    this.stats.received++;
    this.emit('message:received', msg);

    if (opts.enqueue) {
      this.queue.push(msg, msg._priority);
      this.emit('message:queued', msg);
      return { queued: true, messageId: msg._id, queueSize: this.queue.size };
    }

    return this._dispatch(msg);
  }

  async enqueue(message, priority = 'normal') {
    return this.submit(message, { enqueue: true, priority });
  }

  async processQueue(batchSize = 10) {
    let processed = 0;
    while (!this.queue.empty && processed < batchSize) {
      const msg = this.queue.pop();
      if (msg) {
        await this._dispatch(msg);
        processed++;
      }
    }
    return processed;
  }

  // ── Core Dispatch ───────────────────────────────────────────────

  async _dispatch(msg) {
    // Before middleware
    const proceed = await this._runMiddleware('before', msg, { phase: 'before' });
    if (proceed === false) {
      this.stats.dropped++;
      this.emit('message:dropped', msg, 'middleware');
      return { dropped: true, reason: 'middleware' };
    }

    const matching = this._findMatches(msg);
    if (matching.length === 0) {
      this.stats.dropped++;
      this.emit('message:unmatched', msg);
      this._addToDLQ(msg, 'no_matching_route');
      return { unmatched: true, messageId: msg._id };
    }

    this.stats.matched++;
    const selected = this._selectRoutes(matching);
    const results = [];

    for (const route of selected) {
      // Check rate limit
      const limiter = this._rateLimiters.get(route.id);
      if (limiter && !limiter.tryConsume()) {
        this.emit('route:rate_limited', route, msg);
        results.push(makeResult(msg, route, false, 'rate_limited'));
        continue;
      }

      // Apply transforms
      let transformed = msg;
      try {
        transformed = applyTransform(msg, route.transforms);
      } catch (e) {
        this.emit('transform:error', route, msg, e);
        results.push(makeResult(msg, route, false, e));
        continue;
      }

      // Apply filters
      let passedFilters = true;
      for (const filter of route.filters) {
        if (!matchFilter(transformed, filter)) {
          passedFilters = false;
          break;
        }
      }
      if (!passedFilters) {
        this.emit('message:filtered', route, transformed);
        results.push(makeResult(transformed, route, false, 'filtered'));
        continue;
      }

      // Deliver with retry
      const result = await this._deliver(route, transformed);
      results.push(result);
    }

    // After middleware
    await this._runMiddleware('after', msg, { phase: 'after', results });

    this._addToHistory(results);
    return results.length === 1 ? results[0] : results;
  }

  async _deliver(route, msg, attempt = 1) {
    if (!route.handler) {
      route.stats.matched++;
      route.stats.delivered++;
      route.stats.lastMatched = Date.now();
      route.stats.lastDelivered = Date.now();
      this.stats.dispatched++;
      this.emit('message:delivered', route, msg);
      return makeResult(msg, route, true);
    }

    try {
      await route.handler(msg, { route: route.id, attempt });
      route.stats.matched++;
      route.stats.delivered++;
      route.stats.lastMatched = Date.now();
      route.stats.lastDelivered = Date.now();
      this.stats.dispatched++;
      this.emit('message:delivered', route, msg);
      return makeResult(msg, route, true);
    } catch (e) {
      route.stats.failed++;
      this.emit('delivery:error', route, msg, e, attempt);

      if (attempt < (route.retry?.maxAttempts || 3)) {
        const backoff = (route.retry?.backoffMs || 1000) * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, backoff));
        return this._deliver(route, msg, attempt + 1);
      }

      this.stats.failed++;
      this._addToDLQ(msg, `delivery_failed:${route.id}`, e.message);
      await this._runMiddleware('error', msg, { phase: 'error', route: route.id, error: e });
      this.emit('message:failed', route, msg, e);
      return makeResult(msg, route, false, e);
    }
  }

  // ── Route Matching & Selection ──────────────────────────────────

  _findMatches(msg) {
    const matches = [];
    for (const rid of this._routeOrder) {
      const route = this.routes.get(rid);
      if (!route || !route.enabled) continue;
      try {
        if (matchPattern(msg, route.pattern)) {
          matches.push(route);
          route.stats.lastMatched = Date.now();
        }
      } catch { /* pattern error, skip */ }
    }
    return matches;
  }

  _selectRoutes(matching) {
    switch (this._strategy) {
      case 'first-match': return matching.slice(0, 1);
      case 'all-match': return matching;
      case 'best-match': return [this._bestMatch(matching)];
      case 'weighted': return this._weightedSelect(matching);
      case 'round-robin': {
        const route = matching[this._rrIndex % matching.length];
        this._rrIndex++;
        return [route];
      }
      default: return matching.slice(0, 1);
    }
  }

  _bestMatch(routes) {
    // Score by specificity of pattern + weight
    let best = routes[0];
    let bestScore = -1;
    for (const r of routes) {
      let score = r.weight;
      if (r.pattern?.type === 'exact') score += 10;
      else if (r.pattern?.type === 'regex') score += 5;
      else if (r.pattern?.type === 'custom') score += 3;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  _weightedSelect(routes) {
    const total = routes.reduce((s, r) => s + r.weight, 0);
    let rand = Math.random() * total;
    for (const r of routes) {
      rand -= r.weight;
      if (rand <= 0) return [r];
    }
    return [routes[routes.length - 1]];
  }

  // ── Fan-out / Fan-in ────────────────────────────────────────────

  async fanOut(message, routeIds, opts = {}) {
    const results = [];
    const parallel = opts.parallel !== false;

    const dispatches = routeIds.map(async (rid) => {
      const route = this.routes.get(rid);
      if (!route) return makeResult(message, { id: rid, name: rid }, false, 'route_not_found');
      const msg = { ...message, _id: message._id || `msg_${++this._msgCounter}_${Date.now()}`, _submittedAt: Date.now() };
      const transformed = applyTransform(msg, route.transforms);
      return this._deliver(route, transformed);
    });

    if (parallel) {
      return Promise.all(dispatches);
    } else {
      for (const d of dispatches) results.push(await d);
      return results;
    }
  }

  fanIn(groupId, message, requiredCount, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this._fanInBuffers.has(groupId)) {
        this._fanInBuffers.set(groupId, { messages: [], resolve: null, timer: null });
      }
      const buf = this._fanInBuffers.get(groupId);
      buf.messages.push(message);

      if (buf.messages.length >= requiredCount) {
        clearTimeout(buf.timer);
        const msgs = buf.messages.splice(0, requiredCount);
        this._fanInBuffers.delete(groupId);
        resolve(msgs);
        return;
      }

      if (!buf.timer) {
        buf.timer = setTimeout(() => {
          const msgs = buf.messages.splice(0);
          this._fanInBuffers.delete(groupId);
          if (msgs.length > 0) resolve(msgs);
          else reject(new Error(`fan_in_timeout:${groupId}`));
        }, timeoutMs);
        buf.timer.unref();
      }
    });
  }

  // ── Dead Letter Queue ───────────────────────────────────────────

  _addToDLQ(msg, reason, error) {
    const entry = {
      messageId: msg._id,
      message: msg,
      reason,
      error: error || null,
      timestamp: Date.now(),
      retries: 0,
    };
    this.dlq.push(entry);
    this.stats.dlq++;
    if (this.dlq.length > this._maxDLQ) this.dlq.shift();
    this.emit('dlq:add', entry);
  }

  async retryDLQ(maxItems = 10) {
    const toRetry = this.dlq.splice(0, maxItems);
    const results = [];
    for (const entry of toRetry) {
      entry.retries++;
      const result = await this._dispatch(entry.message);
      results.push({ ...entry, result });
    }
    return results;
  }

  getDLQ() { return [...this.dlq]; }
  clearDLQ() { const n = this.dlq.length; this.dlq = []; this.stats.dlq = 0; return n; }

  // ── History ─────────────────────────────────────────────────────

  _addToHistory(results) {
    for (const r of (Array.isArray(results) ? results : [results])) {
      this._history.push(r);
    }
    while (this._history.length > this._maxHistory) this._history.shift();
  }

  getHistory(opts = {}) {
    let h = [...this._history];
    if (opts.routeId) h = h.filter(r => r.routeId === opts.routeId);
    if (opts.success !== undefined) h = h.filter(r => r.success === opts.success);
    if (opts.since) h = h.filter(r => r.timestamp >= opts.since);
    if (opts.limit) h = h.slice(-opts.limit);
    return h;
  }

  // ── Persistence ─────────────────────────────────────────────────

  save() {
    if (!this._persistDir) return;
    const state = {
      id: this.id,
      strategy: this._strategy,
      stats: this.stats,
      routes: [...this.routes.values()].map(r => ({
        id: r.id, name: r.name, pattern: r.pattern, priority: r.priority,
        weight: r.weight, tags: r.tags, enabled: r.enabled, stats: r.stats,
        filters: r.filters, rateLimit: r.rateLimit, retry: r.retry,
      })),
      dlq: this.dlq.map(e => ({ messageId: e.messageId, reason: e.reason, error: e.error, timestamp: e.timestamp })),
      msgCounter: this._msgCounter,
    };
    writeFileSync(join(this._persistDir, 'dispatch-snapshot.json'), JSON.stringify(state, null, 2));
  }

  load() {
    if (!this._persistDir) return;
    const file = join(this._persistDir, 'dispatch-snapshot.json');
    if (!existsSync(file)) return;
    try {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      this._msgCounter = state.msgCounter || 0;
      this._strategy = state.strategy || this._strategy;
      // Note: handlers can't be restored from JSON — they must be re-added
    } catch { /* ignore */ }
  }

  // ── Info ────────────────────────────────────────────────────────

  getInfo() {
    return {
      id: this.id,
      strategy: this._strategy,
      routes: this.routes.size,
      enabledRoutes: [...this.routes.values()].filter(r => r.enabled).length,
      queueSize: this.queue.size,
      queueSizes: this.queue.sizes(),
      dlqSize: this.dlq.length,
      historySize: this._history.length,
      stats: this.stats,
      middleware: {
        before: this._middleware.before.length,
        after: this._middleware.after.length,
        error: this._middleware.error.length,
      },
    };
  }

  destroy() {
    if (this._persistTimer) clearInterval(this._persistTimer);
    this.removeAllListeners();
  }
}

// ─── Classifier (standalone utility) ──────────────────────────────

export class Classifier extends EventEmitter {
  constructor(rules = []) {
    super();
    this.rules = rules; // [{ name, pattern, tags }]
  }

  addRule(rule) { this.rules.push(rule); return this; }
  removeRule(name) { this.rules = this.rules.filter(r => r.name !== name); return this; }

  classify(msg) {
    const matched = [];
    for (const rule of this.rules) {
      if (matchPattern(msg, rule.pattern)) {
        matched.push(rule.name);
        if (rule.tags) {
          msg._tags = [...new Set([...(msg._tags || []), ...rule.tags])];
        }
      }
    }
    msg._classified = matched;
    this.emit('classified', msg, matched);
    return { message: msg, classes: matched };
  }
}

// ─── Exports ──────────────────────────────────────────────────────

export { matchFilter, matchPattern, applyTransform, PriorityQueue, RateLimiter };
export default Dispatcher;
