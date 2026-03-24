/**
 * agent-rate — Zero-dependency rate limiting toolkit for AI agents
 *
 * Strategies: fixed_window, sliding_window_log, sliding_window_counter,
 *             token_bucket, leaky_bucket
 *
 * Features: per-key limits, named limiters, middleware, JSONL persistence,
 *           EventEmitter, stats, burst allowance
 */

import { EventEmitter } from 'events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { createInterface } from 'readline';

// ─── Rate Limiting Strategies ───────────────────────────────────────────────

class FixedWindow {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.windows = new Map(); // key -> { count, resetAt }
  }

  check(key) {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    const remaining = this.limit - w.count;
    const allowed = remaining > 0;
    if (allowed) w.count++;
    return {
      allowed,
      remaining: Math.max(0, remaining - (allowed ? 1 : 0)),
      limit: this.limit,
      resetAt: w.resetAt,
      retryAfter: allowed ? 0 : w.resetAt - now,
      strategy: 'fixed_window'
    };
  }

  reset(key) {
    if (key) this.windows.delete(key);
    else this.windows.clear();
  }

  getState() {
    return Object.fromEntries(this.windows);
  }

  getStats() {
    return { type: 'fixed_window', limit: this.limit, windowMs: this.windowMs, activeKeys: this.windows.size };
  }
}

class SlidingWindowLog {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.logs = new Map(); // key -> [timestamps]
  }

  check(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let log = this.logs.get(key);
    if (!log) {
      log = [];
      this.logs.set(key, log);
    }
    // Prune old entries
    while (log.length > 0 && log[0] < cutoff) log.shift();
    const remaining = this.limit - log.length;
    const allowed = remaining > 0;
    if (allowed) log.push(now);
    const oldestInWindow = log.length > 0 ? log[0] : now;
    const resetAt = oldestInWindow + this.windowMs;
    return {
      allowed,
      remaining: Math.max(0, remaining - (allowed ? 1 : 0)),
      limit: this.limit,
      resetAt,
      retryAfter: allowed ? 0 : Math.max(0, resetAt - now),
      strategy: 'sliding_window_log'
    };
  }

  reset(key) {
    if (key) this.logs.delete(key);
    else this.logs.clear();
  }

  getState() {
    const result = {};
    for (const [k, v] of this.logs) result[k] = { count: v.length, oldest: v[0] || null };
    return result;
  }

  getStats() {
    return { type: 'sliding_window_log', limit: this.limit, windowMs: this.windowMs, activeKeys: this.logs.size };
  }
}

class SlidingWindowCounter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.counters = new Map(); // key -> { prev, curr, prevStart }
  }

  check(key) {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    let c = this.counters.get(key);
    if (!c) {
      c = { prev: 0, curr: 0, prevStart: windowStart - this.windowMs };
      this.counters.set(key, c);
    }
    // Rotate if needed
    if (windowStart > c.prevStart + this.windowMs) {
      c.prev = c.curr;
      c.curr = 0;
      c.prevStart = windowStart - this.windowMs;
    } else if (windowStart > c.prevStart) {
      c.prev = c.curr;
      c.curr = 0;
      c.prevStart = windowStart;
    }
    // Weighted count: portion of prev window still in sliding window
    const elapsed = now - windowStart;
    const weight = 1 - (elapsed / this.windowMs);
    const estimatedCount = c.prev * weight + c.curr;
    const remaining = this.limit - estimatedCount;
    const allowed = remaining > 0;
    if (allowed) c.curr++;
    const resetAt = windowStart + this.windowMs;
    return {
      allowed,
      remaining: Math.max(0, Math.floor(remaining - (allowed ? 1 : 0))),
      limit: this.limit,
      resetAt,
      retryAfter: allowed ? 0 : Math.max(0, resetAt - now),
      strategy: 'sliding_window_counter'
    };
  }

  reset(key) {
    if (key) this.counters.delete(key);
    else this.counters.clear();
  }

  getState() {
    return Object.fromEntries(this.counters);
  }

  getStats() {
    return { type: 'sliding_window_counter', limit: this.limit, windowMs: this.windowMs, activeKeys: this.counters.size };
  }
}

class TokenBucket {
  constructor(limit, windowMs, burst = 0) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.burst = burst;
    this.maxTokens = limit + burst;
    this.refillRate = limit / windowMs; // tokens per ms
    this.buckets = new Map(); // key -> { tokens, lastRefill }
  }

  check(key) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, b);
    }
    // Refill
    const elapsed = now - b.lastRefill;
    b.tokens = Math.min(this.maxTokens, b.tokens + elapsed * this.refillRate);
    b.lastRefill = now;
    const allowed = b.tokens >= 1;
    if (allowed) b.tokens--;
    const tokensNeeded = 1 - b.tokens;
    const retryAfter = allowed ? 0 : Math.ceil(tokensNeeded / this.refillRate);
    return {
      allowed,
      remaining: Math.floor(b.tokens),
      limit: this.maxTokens,
      resetAt: now + Math.ceil((this.maxTokens - b.tokens) / this.refillRate),
      retryAfter,
      strategy: 'token_bucket'
    };
  }

  reset(key) {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }

  getState() {
    const result = {};
    for (const [k, v] of this.buckets) result[k] = { tokens: v.tokens, lastRefill: v.lastRefill };
    return result;
  }

  getStats() {
    return { type: 'token_bucket', limit: this.limit, windowMs: this.windowMs, burst: this.burst, maxTokens: this.maxTokens, activeKeys: this.buckets.size };
  }
}

class LeakyBucket {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.leakRate = windowMs / limit; // ms per leak
    this.buckets = new Map(); // key -> { level, lastLeak }
  }

  check(key) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { level: 0, lastLeak: now };
      this.buckets.set(key, b);
    }
    // Leak
    const elapsed = now - b.lastLeak;
    const leaked = Math.floor(elapsed / this.leakRate);
    b.level = Math.max(0, b.level - leaked);
    b.lastLeak = now - (elapsed % this.leakRate);
    const allowed = b.level < this.limit;
    if (allowed) b.level++;
    const nextLeak = b.lastLeak + this.leakRate;
    return {
      allowed,
      remaining: this.limit - b.level,
      limit: this.limit,
      resetAt: nextLeak,
      retryAfter: allowed ? 0 : Math.max(0, nextLeak - now),
      strategy: 'leaky_bucket'
    };
  }

  reset(key) {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }

  getState() {
    const result = {};
    for (const [k, v] of this.buckets) result[k] = { level: v.level, lastLeak: v.lastLeak };
    return result;
  }

  getStats() {
    return { type: 'leaky_bucket', limit: this.limit, windowMs: this.windowMs, activeKeys: this.buckets.size };
  }
}

// ─── Main Class ─────────────────────────────────────────────────────────────

const STRATEGIES = { fixed_window: FixedWindow, sliding_window_log: SlidingWindowLog, sliding_window_counter: SlidingWindowCounter, token_bucket: TokenBucket, leaky_bucket: LeakyBucket };

export class AgentRate extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.limiters = new Map();
    this.globalStats = { totalChecks: 0, allowed: 0, rejected: 0 };
    this.persistenceFile = opts.persistenceFile || null;
    if (opts.defaultLimiter) {
      this.addLimiter('default', opts.defaultLimiter);
    }
  }

  addLimiter(name, opts) {
    const { strategy = 'fixed_window', limit = 100, windowMs = 60000, burst = 0 } = opts;
    const Cls = STRATEGIES[strategy];
    if (!Cls) throw new Error(`Unknown strategy: ${strategy}. Use: ${Object.keys(STRATEGIES).join(', ')}`);
    const limiter = strategy === 'token_bucket' ? new Cls(limit, windowMs, burst) : new Cls(limit, windowMs);
    this.limiters.set(name, limiter);
    this.emit('limiter:added', { name, strategy, limit, windowMs });
    return this;
  }

  removeLimiter(name) {
    this.limiters.delete(name);
    this.emit('limiter:removed', { name });
    return this;
  }

  check(key, limiterName = 'default') {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) throw new Error(`Limiter '${limiterName}' not found`);
    const result = limiter.check(key);
    this.globalStats.totalChecks++;
    if (result.allowed) this.globalStats.allowed++;
    else this.globalStats.rejected++;
    this.emit('check', { key, limiter: limiterName, ...result });
    if (!result.allowed) this.emit('rejected', { key, limiter: limiterName, retryAfter: result.retryAfter });
    if (this.persistenceFile) this._persist(key, limiterName, result);
    return result;
  }

  /** Check multiple limiters — returns worst (most restrictive) result */
  checkAll(key, limiterNames) {
    let worst = null;
    for (const name of limiterNames) {
      const r = this.check(key, name);
      if (!r.allowed && (!worst || r.retryAfter > worst.retryAfter)) worst = r;
      if (r.allowed && !worst) worst = r;
    }
    return worst;
  }

  /** Convenience: returns boolean */
  isAllowed(key, limiterName = 'default') {
    return this.check(key, limiterName).allowed;
  }

  /** Consume N tokens at once */
  consume(key, n, limiterName = 'default') {
    const results = [];
    for (let i = 0; i < n; i++) {
      results.push(this.check(key, limiterName));
    }
    const allAllowed = results.every(r => r.allowed);
    if (!allAllowed) {
      // Refund consumed tokens
      // Note: we can't truly refund in fixed/sliding, but for token bucket we can
      // This is a best-effort approach
    }
    return { allowed: allAllowed, results, consumed: allAllowed ? n : results.filter(r => r.allowed).length };
  }

  reset(key, limiterName = 'default') {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) throw new Error(`Limiter '${limiterName}' not found`);
    limiter.reset(key);
    this.emit('reset', { key, limiter: limiterName });
    return this;
  }

  resetAll(limiterName = 'default') {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) throw new Error(`Limiter '${limiterName}' not found`);
    limiter.reset();
    this.emit('reset:all', { limiter: limiterName });
    return this;
  }

  getStats(limiterName) {
    if (limiterName) {
      const limiter = this.limiters.get(limiterName);
      if (!limiter) throw new Error(`Limiter '${limiterName}' not found`);
      return { ...limiter.getStats(), global: this.globalStats };
    }
    const limiters = {};
    for (const [name, limiter] of this.limiters) limiters[name] = limiter.getStats();
    return { limiters, global: this.globalStats };
  }

  getState(limiterName = 'default') {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) throw new Error(`Limiter '${limiterName}' not found`);
    return limiter.getState();
  }

  listLimiters() {
    return [...this.limiters.entries()].map(([name, l]) => ({ name, ...l.getStats() }));
  }

  // ─── Middleware (Express/Koa style) ──────────────────────────────────────

  middleware(limiterName = 'default', keyFn) {
    const self = this;
    return function rateLimitMiddleware(req, res, next) {
      const key = keyFn ? keyFn(req) : (req.ip || req.headers['x-forwarded-for'] || 'anonymous');
      const result = self.check(key, limiterName);
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
      if (!result.allowed) {
        res.setHeader('Retry-After', Math.ceil(result.retryAfter / 1000));
        res.statusCode = 429;
        res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: result.retryAfter }));
        return;
      }
      if (next) next();
    };
  }

  // ─── JSONL Persistence ──────────────────────────────────────────────────

  _persist(key, limiterName, result) {
    try {
      const dir = this.persistenceFile.substring(0, this.persistenceFile.lastIndexOf('/'));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(this.persistenceFile, JSON.stringify({ ts: Date.now(), key, limiter: limiterName, ...result }) + '\n');
    } catch { /* ignore */ }
  }
}

export default AgentRate;
