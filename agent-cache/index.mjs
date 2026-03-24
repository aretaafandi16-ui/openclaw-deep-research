// agent-cache — Zero-dependency caching layer for AI agents
// Core: LRU cache with TTL, tags, persistence, stats, and event emission

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'fs';
import { dirname } from 'path';

export class AgentCache extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.defaultTTL = opts.defaultTTL ?? 300000; // 5 min
    this.maxSize = opts.maxSize ?? 10000;
    this.namespace = opts.namespace ?? 'default';
    this.persistPath = opts.persistPath ?? null;
    this.persistInterval = opts.persistInterval ?? 30000;
    this.enableStats = opts.enableStats !== false;

    // Data structures
    this._store = new Map();       // key -> { value, expires, tags, created, accessed, hits }
    this._tagIndex = new Map();    // tag -> Set<key>
    this._accessOrder = [];       // LRU list (most recent last)

    // Stats
    this._stats = { hits: 0, misses: 0, evictions: 0, expirations: 0, sets: 0, deletes: 0 };

    // Persistence timer
    this._persistTimer = null;

    if (this.persistPath) {
      this._restore();
      this._persistTimer = setInterval(() => this._persist(), this.persistInterval);
    }
  }

  // ── Core Operations ──────────────────────────────────────────────

  async get(key, touch = true) {
    const entry = this._store.get(key);
    if (!entry) {
      this._stats.misses++;
      this.emit('miss', key);
      return null;
    }
    if (entry.expires && Date.now() > entry.expires) {
      this._evict(key, 'expired');
      this._stats.expirations++;
      this._stats.misses++;
      this.emit('expire', key);
      return null;
    }
    if (touch) {
      entry.accessed = Date.now();
      entry.hits++;
      this._touchLRU(key);
    }
    this._stats.hits++;
    this.emit('hit', key);
    return structuredClone(entry.value);
  }

  async set(key, value, opts = {}) {
    const ttl = opts.ttl ?? this.defaultTTL;
    const tags = opts.tags ?? [];
    const expires = ttl > 0 ? Date.now() + ttl : null;

    // Remove old entry's tag refs if overwriting
    const old = this._store.get(key);
    if (old) {
      for (const tag of old.tags) {
        const s = this._tagIndex.get(tag);
        if (s) { s.delete(key); if (s.size === 0) this._tagIndex.delete(tag); }
      }
    }

    // Evict if at capacity
    if (!this._store.has(key) && this._store.size >= this.maxSize) {
      this._evictLRU();
    }

    this._store.set(key, {
      value: structuredClone(value),
      expires,
      tags,
      created: Date.now(),
      accessed: Date.now(),
      hits: 0,
    });

    // Update tag index
    for (const tag of tags) {
      if (!this._tagIndex.has(tag)) this._tagIndex.set(tag, new Set());
      this._tagIndex.get(tag).add(key);
    }

    this._touchLRU(key);
    this._stats.sets++;
    this.emit('set', key, value);
    this._maybePersistEvent({ type: 'set', key, value, tags, expires, ts: Date.now() });
    return true;
  }

  async delete(key) {
    return this._evict(key, 'deleted');
  }

  has(key) {
    const entry = this._store.get(key);
    if (!entry) return false;
    if (entry.expires && Date.now() > entry.expires) return false;
    return true;
  }

  async clear() {
    const count = this._store.size;
    this._store.clear();
    this._tagIndex.clear();
    this._accessOrder.length = 0;
    this.emit('clear', count);
    this._maybePersistEvent({ type: 'clear', ts: Date.now() });
    return count;
  }

  // ── Tag Operations ───────────────────────────────────────────────

  async invalidateTag(tag) {
    const keys = this._tagIndex.get(tag);
    if (!keys || keys.size === 0) return 0;
    let count = 0;
    for (const key of [...keys]) {
      if (this._evict(key, 'tag_invalidated')) count++;
    }
    this._tagIndex.delete(tag);
    this.emit('invalidate_tag', tag, count);
    return count;
  }

  tags() {
    const result = {};
    for (const [tag, keys] of this._tagIndex) {
      result[tag] = keys.size;
    }
    return result;
  }

  // ── Pattern Operations ───────────────────────────────────────────

  async invalidatePattern(pattern) {
    const keys = this._matchPattern(pattern);
    let count = 0;
    for (const key of keys) {
      if (this._evict(key, 'pattern_invalidated')) count++;
    }
    this.emit('invalidate_pattern', pattern, count);
    return count;
  }

  keys(pattern) {
    if (!pattern) return [...this._store.keys()];
    return this._matchPattern(pattern);
  }

  // ── Batch Operations ─────────────────────────────────────────────

  async mget(keys) {
    const result = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async mset(entries) {
    const results = {};
    for (const entry of entries) {
      results[entry.key] = await this.set(entry.key, entry.value, entry);
    }
    return results;
  }

  // ── Utility Operations ───────────────────────────────────────────

  async touch(key, ttl) {
    const entry = this._store.get(key);
    if (!entry) return false;
    if (entry.expires && Date.now() > entry.expires) return false;
    entry.expires = ttl != null ? Date.now() + ttl : Date.now() + this.defaultTTL;
    entry.accessed = Date.now();
    this._touchLRU(key);
    return true;
  }

  async getOrSet(key, fn, opts = {}) {
    const val = await this.get(key);
    if (val !== null) return val;
    const computed = await fn();
    await this.set(key, computed, opts);
    return computed;
  }

  async wrap(key, fn, opts = {}) {
    return this.getOrSet(key, fn, opts);
  }

  async peek(key) {
    return this.get(key, false);
  }

  // ── Stats ────────────────────────────────────────────────────────

  stats() {
    const total = this._stats.hits + this._stats.misses;
    return {
      namespace: this.namespace,
      size: this._store.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? +(this._stats.hits / total).toFixed(4) : null,
      ...this._stats,
      tagCount: this._tagIndex.size,
    };
  }

  // ── Export ───────────────────────────────────────────────────────

  export() {
    const entries = [];
    for (const [key, entry] of this._store) {
      if (entry.expires && Date.now() > entry.expires) continue;
      entries.push({ key, value: entry.value, tags: entry.tags, created: entry.created, accessed: entry.accessed, hits: entry.hits });
    }
    return entries;
  }

  // ── Internal ─────────────────────────────────────────────────────

  _evict(key, reason) {
    const entry = this._store.get(key);
    if (!entry) return false;
    // Remove from tag index
    for (const tag of entry.tags) {
      const s = this._tagIndex.get(tag);
      if (s) { s.delete(key); if (s.size === 0) this._tagIndex.delete(tag); }
    }
    this._store.delete(key);
    const idx = this._accessOrder.indexOf(key);
    if (idx !== -1) this._accessOrder.splice(idx, 1);
    this._stats.deletes++;
    if (reason === 'lru') this._stats.evictions++;
    this.emit('evict', key, reason);
    this._maybePersistEvent({ type: 'delete', key, ts: Date.now() });
    return true;
  }

  _evictLRU() {
    if (this._accessOrder.length === 0) return;
    const oldestKey = this._accessOrder.shift();
    this._evict(oldestKey, 'lru');
  }

  _touchLRU(key) {
    const idx = this._accessOrder.indexOf(key);
    if (idx !== -1) this._accessOrder.splice(idx, 1);
    this._accessOrder.push(key);
  }

  _matchPattern(pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return [...this._store.keys()].filter(k => regex.test(k));
  }

  // ── Persistence ──────────────────────────────────────────────────

  _maybePersistEvent(event) {
    if (!this.persistPath) return;
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(this.persistPath + '.events', JSON.stringify(event) + '\n');
    } catch { /* ignore */ }
  }

  _persist() {
    if (!this.persistPath) return;
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data = {
        namespace: this.namespace,
        ts: Date.now(),
        stats: this._stats,
        entries: this.export(),
      };
      const tmp = this.persistPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.persistPath);
    } catch { /* ignore */ }
  }

  _restore() {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.persistPath, 'utf8'));
      if (data.entries) {
        for (const entry of data.entries) {
          const ttl = entry.accessed ? (this.defaultTTL - (Date.now() - entry.accessed)) : this.defaultTTL;
          if (ttl > 0) {
            this.set(entry.key, entry.value, { ttl, tags: entry.tags });
          }
        }
      }
      if (data.stats) Object.assign(this._stats, data.stats);
      this.emit('restore', data.entries?.length ?? 0);
    } catch { /* ignore */ }
  }

  destroy() {
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }
    this._persist();
  }
}

// ── HTTP Cache Middleware ───────────────────────────────────────────

export function httpCacheMiddleware(cache, opts = {}) {
  const keyFn = opts.keyFn ?? ((req) => `${req.method}:${req.url}`);
  const ttl = opts.ttl ?? cache.defaultTTL;
  const filter = opts.filter ?? (() => true);

  return async function cachedHandler(req, res, next) {
    if (!filter(req)) return next();

    const key = typeof keyFn === 'function' ? keyFn(req) : keyFn;
    const cached = await cache.get(key);

    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', cached.contentType ?? 'application/json');
      res.writeHead(cached.statusCode ?? 200);
      res.end(typeof cached.body === 'string' ? cached.body : JSON.stringify(cached.body));
      return;
    }

    // Monkey-patch res.end to capture response
    const originalEnd = res.end.bind(res);
    let body = '';
    const _write = res.write.bind(res);
    res.write = (chunk, ...args) => { body += chunk; return _write(chunk, ...args); };
    res.end = async (chunk, ...args) => {
      if (chunk) body += chunk;
      const entry = {
        body: body,
        statusCode: res.statusCode,
        contentType: res.getHeader('content-type') ?? 'application/json',
      };
      if (filter(req)) {
        await cache.set(key, entry, { ttl, tags: opts.tags });
      }
      res.setHeader('X-Cache', 'MISS');
      return originalEnd(chunk, ...args);
    };
    next();
  };
}

export default AgentCache;
