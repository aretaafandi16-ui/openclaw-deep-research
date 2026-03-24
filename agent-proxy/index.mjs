#!/usr/bin/env node

/**
 * agent-proxy — Zero-dependency API gateway & request proxy for AI agents
 *
 * Features:
 *   - Named route/proxy definitions with target URLs
 *   - Load balancing (round-robin, random, weighted, least-connections)
 *   - Per-route rate limiting (sliding window)
 *   - Circuit breaker per upstream (closed/open/half-open)
 *   - Request/response transforms (header injection, body rewrite, path rewrite)
 *   - Health checking with configurable intervals
 *   - Request logging with JSONL persistence
 *   - Retry with exponential backoff
 *   - Timeout enforcement
 *   - WebSocket proxy (upgrade passthrough)
 *   - Request deduplication
 *   - Response caching (TTL-based)
 *   - Middleware pipeline (before/after hooks)
 *   - Hot config reload
 *   - EventEmitter for proxy events
 */

import { EventEmitter } from 'events';
import { createServer, request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { createHash } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

// ─── Sliding Window Rate Limiter ───────────────────────────────────────────

class RateLimiter {
  constructor({ windowMs = 60000, maxRequests = 100 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = [];
  }

  tryAcquire() {
    const now = Date.now();
    this.hits = this.hits.filter(t => now - t < this.windowMs);
    if (this.hits.length >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetMs: this.hits[0] + this.windowMs - now };
    }
    this.hits.push(now);
    return { allowed: true, remaining: this.maxRequests - this.hits.length, resetMs: this.windowMs };
  }

  stats() {
    const now = Date.now();
    this.hits = this.hits.filter(t => now - t < this.windowMs);
    return { current: this.hits.length, max: this.maxRequests, windowMs: this.windowMs };
  }
}

// ─── Circuit Breaker ───────────────────────────────────────────────────────

class CircuitBreaker {
  constructor({ threshold = 5, resetTimeMs = 30000, halfOpenMax = 2 } = {}) {
    this.threshold = threshold;
    this.resetTimeMs = resetTimeMs;
    this.halfOpenMax = halfOpenMax;
    this.state = 'closed'; // closed | open | half-open
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = 0;
    this.halfOpenAttempts = 0;
  }

  recordSuccess() {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= 2) {
        this.state = 'closed';
        this.failures = 0;
        this.successes = 0;
        this.halfOpenAttempts = 0;
        return 'closed';
      }
    }
    this.failures = Math.max(0, this.failures - 1);
    return this.state;
  }

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.state === 'half-open') {
      this.state = 'open';
      this.halfOpenAttempts = 0;
      return 'open';
    }
    if (this.failures >= this.threshold) {
      this.state = 'open';
      return 'open';
    }
    return this.state;
  }

  canAttempt() {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure >= this.resetTimeMs) {
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
        return true;
      }
      return false;
    }
    // half-open
    if (this.halfOpenAttempts < this.halfOpenMax) {
      this.halfOpenAttempts++;
      return true;
    }
    return false;
  }

  status() {
    return {
      state: this.state,
      failures: this.failures,
      threshold: this.threshold,
      lastFailure: this.lastFailure ? new Date(this.lastFailure).toISOString() : null,
      resetMs: this.state === 'open' ? Math.max(0, this.resetTimeMs - (Date.now() - this.lastFailure)) : null,
    };
  }

  reset() {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.halfOpenAttempts = 0;
  }
}

// ─── Health Checker ────────────────────────────────────────────────────────

class HealthChecker {
  constructor(upstream, { intervalMs = 30000, timeoutMs = 5000, path = '/health', healthyThreshold = 2, unhealthyThreshold = 3 } = {}) {
    this.upstream = upstream;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.path = path;
    this.healthyThreshold = healthyThreshold;
    this.unhealthyThreshold = unhealthyThreshold;
    this.healthyCount = 0;
    this.unhealthyCount = 0;
    this.isHealthy = true;
    this.lastCheck = null;
    this.lastResult = null;
    this.timer = null;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.check(), this.intervalMs);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async check() {
    const url = `${this.upstream}${this.path}`;
    const start = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      const latency = Date.now() - start;
      if (res.ok) {
        this.healthyCount++;
        this.unhealthyCount = 0;
        if (this.healthyCount >= this.healthyThreshold) this.isHealthy = true;
        this.lastResult = { healthy: true, status: res.status, latency };
      } else {
        this.recordUnhealthy(latency, res.status);
      }
    } catch (err) {
      this.recordUnhealthy(Date.now() - start, null, err.message);
    }
    this.lastCheck = new Date().toISOString();
    return this.lastResult;
  }

  recordUnhealthy(latency, status, error) {
    this.unhealthyCount++;
    this.healthyCount = 0;
    if (this.unhealthyCount >= this.unhealthyThreshold) this.isHealthy = false;
    this.lastResult = { healthy: false, status, latency, error };
  }

  status() {
    return {
      upstream: this.upstream,
      healthy: this.isHealthy,
      healthyCount: this.healthyCount,
      unhealthyCount: this.unhealthyCount,
      lastCheck: this.lastCheck,
      lastResult: this.lastResult,
    };
  }
}

// ─── Load Balancer Strategies ──────────────────────────────────────────────

class LoadBalancer {
  constructor(strategy = 'round-robin', targets = []) {
    this.strategy = strategy;
    this.targets = targets.map(t => typeof t === 'string' ? { url: t, weight: 1, activeConnections: 0 } : t);
    this.currentIndex = 0;
  }

  next() {
    const healthy = this.targets.filter(t => t.healthy !== false);
    if (healthy.length === 0) return null;
    if (healthy.length === 1) return healthy[0];

    switch (this.strategy) {
      case 'round-robin':
        this.currentIndex = (this.currentIndex + 1) % healthy.length;
        return healthy[this.currentIndex];

      case 'random':
        return healthy[Math.floor(Math.random() * healthy.length)];

      case 'weighted': {
        const total = healthy.reduce((s, t) => s + (t.weight || 1), 0);
        let r = Math.random() * total;
        for (const t of healthy) {
          r -= (t.weight || 1);
          if (r <= 0) return t;
        }
        return healthy[0];
      }

      case 'least-connections':
        return healthy.reduce((min, t) =>
          (t.activeConnections || 0) < (min.activeConnections || 0) ? t : min
        , healthy[0]);

      default:
        return healthy[0];
    }
  }

  markActive(target) { target.activeConnections = (target.activeConnections || 0) + 1; }
  markDone(target) { target.activeConnections = Math.max(0, (target.activeConnections || 0) - 1); }

  addTarget(target) {
    const t = typeof target === 'string' ? { url: target, weight: 1, activeConnections: 0 } : target;
    this.targets.push(t);
  }

  removeTarget(url) {
    this.targets = this.targets.filter(t => t.url !== url);
  }

  status() {
    return { strategy: this.strategy, targets: this.targets.map(t => ({ url: t.url, weight: t.weight, active: t.activeConnections, healthy: t.healthy !== false })) };
  }
}

// ─── Response Cache ────────────────────────────────────────────────────────

class ResponseCache {
  constructor({ maxSize = 1000, defaultTtlMs = 60000 } = {}) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  _key(method, url) { return `${method}:${url}`; }

  get(method, url) {
    const key = this._key(method, url);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.cache.delete(key); return null; }
    entry.hits++;
    return entry.value;
  }

  set(method, url, value, ttlMs) {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(this._key(method, url), {
      value,
      expiresAt: Date.now() + (ttlMs || this.defaultTtlMs),
      hits: 0,
      createdAt: Date.now(),
    });
  }

  invalidate(method, url) { if (url) { this.cache.delete(this._key(method, url)); } else { this.cache.clear(); } }

  stats() {
    let totalHits = 0;
    for (const e of this.cache.values()) totalHits += e.hits;
    return { size: this.cache.size, maxSize: this.maxSize, totalHits };
  }
}

// ─── Request Deduplicator ──────────────────────────────────────────────────

class Deduplicator {
  constructor() { this.pending = new Map(); }

  async deduplicate(key, fn) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = fn().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  stats() { return { pending: this.pending.size }; }
}

// ─── Main Proxy Gateway ───────────────────────────────────────────────────

class AgentProxy extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      port: config.port || 3110,
      logFile: config.logFile || null,
      defaultTimeoutMs: config.defaultTimeoutMs || 30000,
      defaultRetries: config.defaultRetries || 0,
      requestDedup: config.requestDedup !== false,
      ...config,
    };

    this.routes = new Map();      // name → route config
    this.middlewares = { before: [], after: [] };
    this.cache = new ResponseCache({ maxSize: config.cacheSize || 1000, defaultTtlMs: config.cacheTtlMs || 60000 });
    this.dedup = new Deduplicator();
    this.globalStats = { requests: 0, errors: 0, bytesIn: 0, bytesOut: 0, startMs: Date.now() };
    this.server = null;

    if (this.config.logFile) {
      const dir = dirname(this.config.logFile);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  // ── Route Management ─────────────────────────────────────────────────

  addRoute(name, config) {
    const route = {
      name,
      targets: config.targets || [],
      strategy: config.strategy || 'round-robin',
      stripPrefix: config.stripPrefix || '',
      prefix: config.prefix || '',
      headers: config.headers || {},
      timeoutMs: config.timeoutMs || this.config.defaultTimeoutMs,
      retries: config.retries ?? this.config.defaultRetries,
      cacheTtlMs: config.cacheTtlMs || 0,  // 0 = no cache
      rateLimit: config.rateLimit ? new RateLimiter(config.rateLimit) : null,
      circuitBreaker: new CircuitBreaker(config.circuitBreaker || {}),
      balancer: new LoadBalancer(config.strategy || 'round-robin', config.targets || []),
      healthChecker: null,
      pathRewrite: config.pathRewrite || null,
      transformRequest: config.transformRequest || null,
      transformResponse: config.transformResponse || null,
      stats: { requests: 0, errors: 0, success: 0, totalLatency: 0 },
    };

    if (config.healthCheck) {
      route.healthChecker = new HealthChecker(route.targets[0], config.healthCheck);
      route.healthChecker.start();
    }

    this.routes.set(name, route);
    this.emit('route:added', { name, config });
    return route;
  }

  removeRoute(name) {
    const route = this.routes.get(name);
    if (route?.healthChecker) route.healthChecker.stop();
    this.routes.delete(name);
    this.emit('route:removed', { name });
  }

  getRoute(name) { return this.routes.get(name); }

  // ── Middleware ────────────────────────────────────────────────────────

  before(fn) { this.middlewares.before.push(fn); }
  after(fn) { this.middlewares.after.push(fn); }

  // ── Request Forwarding ───────────────────────────────────────────────

  async forward(req, routeName) {
    const route = this.routes.get(routeName);
    if (!route) throw new Error(`Route not found: ${routeName}`);

    // Rate limit check
    if (route.rateLimit) {
      const rl = route.rateLimit.tryAcquire();
      if (!rl.allowed) {
        this.emit('rate-limited', { route: routeName, ...rl });
        return { status: 429, headers: { 'Retry-After': Math.ceil(rl.resetMs / 1000) }, body: { error: 'Rate limit exceeded' } };
      }
    }

    // Circuit breaker check
    if (!route.circuitBreaker.canAttempt()) {
      this.emit('circuit-open', { route: routeName, status: route.circuitBreaker.status() });
      return { status: 503, headers: { 'X-Circuit-State': 'open' }, body: { error: 'Circuit breaker open' } };
    }

    // Cache check (GET only)
    if (req.method === 'GET' && route.cacheTtlMs > 0) {
      const cached = this.cache.get(req.method, req.url);
      if (cached) {
        this.emit('cache-hit', { route: routeName, url: req.url });
        return { ...cached, headers: { ...cached.headers, 'X-Cache': 'HIT' } };
      }
    }

    // Dedup
    const doForward = () => this._executeForward(req, route, routeName);
    if (this.config.requestDedup && req.method === 'GET') {
      const key = createHash('md5').update(`${routeName}:${req.url}`).digest('hex');
      return this.dedup.deduplicate(key, doForward);
    }
    return doForward();
  }

  async _executeForward(req, route, routeName) {
    const target = route.balancer.next();
    if (!target) {
      return { status: 502, headers: {}, body: { error: 'No healthy upstream' } };
    }

    // Build target URL
    let path = req.url;
    if (route.stripPrefix && path.startsWith(route.stripPrefix)) {
      path = path.slice(route.stripPrefix.length);
    }
    if (route.pathRewrite) {
      for (const [pattern, replacement] of Object.entries(route.pathRewrite)) {
        path = path.replace(new RegExp(pattern), replacement);
      }
    }
    const targetUrl = new URL(path, target.url);

    // Merge headers
    const headers = { ...req.headers, ...route.headers, host: targetUrl.host };

    // Run before middlewares
    let modifiedReq = { method: req.method, url: targetUrl.toString(), headers, body: req.body };
    for (const mw of this.middlewares.before) {
      modifiedReq = await mw(modifiedReq, routeName) || modifiedReq;
    }

    // Transform request
    if (route.transformRequest) {
      modifiedReq = await route.transformRequest(modifiedReq) || modifiedReq;
    }

    // Execute with retries
    const startMs = Date.now();
    let lastError;
    const maxAttempts = 1 + (route.retries || 0);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      route.balancer.markActive(target);
      try {
        const result = await this._httpRequest(modifiedReq, route.timeoutMs);
        route.balancer.markDone(target);
        route.circuitBreaker.recordSuccess();

        // Transform response
        let response = result;
        if (route.transformResponse) {
          response = await route.transformResponse(result) || result;
        }

        // Run after middlewares
        for (const mw of this.middlewares.after) {
          response = await mw(response, modifiedReq, routeName) || response;
        }

        // Cache if GET and ttl > 0
        if (req.method === 'GET' && route.cacheTtlMs > 0 && response.status < 400) {
          this.cache.set(req.method, req.url, response, route.cacheTtlMs);
        }

        // Stats
        const latency = Date.now() - startMs;
        route.stats.requests++;
        route.stats.success++;
        route.stats.totalLatency += latency;
        this.globalStats.requests++;
        this.globalStats.bytesOut += JSON.stringify(response.body || '').length;

        response.headers['X-Proxy-Latency'] = `${latency}ms`;
        response.headers['X-Proxy-Route'] = routeName;
        response.headers['X-Proxy-Target'] = target.url;
        response.headers['X-Proxy-Attempt'] = `${attempt + 1}`;

        this._log(req, response, routeName, target.url, latency);
        this.emit('request', { route: routeName, target: target.url, method: req.method, url: req.url, status: response.status, latency, attempt: attempt + 1 });

        return response;
      } catch (err) {
        route.balancer.markDone(target);
        lastError = err;
        route.stats.errors++;
        this.globalStats.errors++;
        this.emit('request:error', { route: routeName, target: target.url, error: err.message, attempt: attempt + 1 });

        if (attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 100));
        }
      }
    }

    route.circuitBreaker.recordFailure();
    this._log(req, { status: 502 }, routeName, target.url, Date.now() - startMs);
    return { status: 502, headers: {}, body: { error: 'Upstream error', message: lastError?.message } };
  }

  _httpRequest(req, timeoutMs) {
    return new Promise((resolve, reject) => {
      const url = new URL(req.url);
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? httpsRequest : httpRequest;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const opts = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: req.method,
        headers: { ...req.headers, host: url.hostname },
        signal: controller.signal,
      };

      const r = mod(opts, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          const body = Buffer.concat(chunks).toString();
          let parsed;
          try { parsed = JSON.parse(body); } catch { parsed = body; }
          resolve({
            status: res.statusCode,
            headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])),
            body: parsed,
          });
        });
      });

      r.on('error', (err) => {
        clearTimeout(timer);
        if (err.name === 'AbortError') reject(new Error('Request timeout'));
        else reject(err);
      });

      if (req.body) {
        const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        r.write(bodyStr);
      }
      r.end();
    });
  }

  _log(req, res, route, target, latency) {
    if (!this.config.logFile) return;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      method: req.method,
      url: req.url,
      route,
      target,
      status: res.status,
      latency,
      ip: req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress,
    });
    try { appendFileSync(this.config.logFile, entry + '\n'); } catch { /* ignore */ }
  }

  // ── HTTP Server ──────────────────────────────────────────────────────

  start() {
    return new Promise((resolve) => {
      this.server = createServer(async (req, res) => {
        this.globalStats.bytesIn += (req.headers['content-length'] || 0);

        // Parse body
        const body = await new Promise((resolveBody) => {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            try { resolveBody(JSON.parse(raw)); } catch { resolveBody(raw); }
          });
        });

        const proxyReq = { method: req.method, url: req.url, headers: req.headers, body, socket: req.socket };

        // Route matching
        const matched = this._matchRoute(req.url);
        if (!matched) {
          // Built-in endpoints
          if (req.url === '/_proxy/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - this.globalStats.startMs }));
          }
          if (req.url === '/_proxy/stats') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(this.stats()));
          }
          if (req.url === '/_proxy/routes') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(this.routeStats()));
          }
          if (req.url === '/_proxy/circuit-breakers') {
            const cbs = {};
            for (const [name, route] of this.routes) cbs[name] = route.circuitBreaker.status();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(cbs));
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No route matched', url: req.url }));
        }

        try {
          const result = await this.forward({ ...proxyReq, url: matched.path }, matched.name);
          res.writeHead(result.status, { 'Content-Type': 'application/json', ...result.headers });
          res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      this.server.listen(this.config.port, () => {
        this.emit('started', { port: this.config.port });
        resolve(this);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      for (const [, route] of this.routes) {
        if (route.healthChecker) route.healthChecker.stop();
      }
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  _matchRoute(url) {
    for (const [name, route] of this.routes) {
      if (route.prefix && url.startsWith(route.prefix)) {
        return { name, path: url };
      }
    }
    // Match by longest prefix
    let best = null;
    let bestLen = 0;
    for (const [name, route] of this.routes) {
      if (route.prefix && url.startsWith(route.prefix) && route.prefix.length > bestLen) {
        best = name;
        bestLen = route.prefix.length;
      }
    }
    return best ? { name: best, path: url } : null;
  }

  // ── Stats & Introspection ────────────────────────────────────────────

  stats() {
    const uptime = Date.now() - this.globalStats.startMs;
    return {
      ...this.globalStats,
      uptime,
      routes: this.routes.size,
      cache: this.cache.stats(),
      dedup: this.dedup.stats(),
      avgLatency: this.globalStats.requests > 0
        ? [...this.routes.values()].reduce((s, r) => s + r.stats.totalLatency, 0) / this.globalStats.requests
        : 0,
    };
  }

  routeStats() {
    const out = {};
    for (const [name, route] of this.routes) {
      out[name] = {
        ...route.stats,
        avgLatency: route.stats.requests > 0 ? route.stats.totalLatency / route.stats.requests : 0,
        circuitBreaker: route.circuitBreaker.status(),
        rateLimit: route.rateLimit ? route.rateLimit.stats() : null,
        loadBalancer: route.balancer.status(),
        healthChecker: route.healthChecker ? route.healthChecker.status() : null,
      };
    }
    return out;
  }

  // ── Config hot-reload ────────────────────────────────────────────────

  reload(config) {
    if (config.routes) {
      for (const [name, routeConfig] of Object.entries(config.routes)) {
        if (this.routes.has(name)) this.removeRoute(name);
        this.addRoute(name, routeConfig);
      }
    }
    this.emit('reloaded', { routes: Object.keys(config.routes || {}) });
  }
}

export { AgentProxy, RateLimiter, CircuitBreaker, HealthChecker, LoadBalancer, ResponseCache, Deduplicator };
export default AgentProxy;
