/**
 * agent-session — Zero-dependency session manager for AI agents
 *
 * Features:
 *  - Session creation with custom or auto-generated IDs
 *  - TTL-based expiration with auto-cleanup
 *  - Multi-turn conversation history (messages with roles)
 *  - Session state/context storage (key-value)
 *  - Session isolation (group by owner/channel/namespace)
 *  - Session tags for filtering
 *  - Session metadata (userAgent, ip, custom fields)
 *  - Session events (create, expire, touch, destroy, message)
 *  - Max sessions limit with LRU eviction
 *  - Max messages per session with oldest-first eviction
 *  - JSONL persistence + periodic snapshots
 *  - EventEmitter for real-time monitoring
 *  - Statistics & analytics
 */

import { EventEmitter } from 'events';
import { randomBytes, createHash } from 'crypto';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

function uuid() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [...b].map((v, i) => {
    const s = v.toString(16).padStart(2, '0');
    if (i === 4 || i === 6 || i === 8 || i === 10) return '-' + s;
    return s;
  }).join('');
}

function now() { return Date.now(); }

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_SESSIONS = 10000;
const DEFAULT_MAX_MESSAGES = 500;
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute

export class SessionManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._sessions = new Map();
    this._ownerIndex = new Map();   // owner -> Set<sessionId>
    this._namespaceIndex = new Map(); // namespace -> Set<sessionId>
    this._tagIndex = new Map();     // tag -> Set<sessionId>

    this._defaultTTL = opts.defaultTTL ?? DEFAULT_TTL;
    this._maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this._maxMessages = opts.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this._persistDir = opts.persistDir ?? null;
    this._persistInterval = opts.persistInterval ?? 30_000;
    this._cleanupIntervalMs = opts.cleanupInterval ?? CLEANUP_INTERVAL;

    this._stats = {
      created: 0, destroyed: 0, expired: 0,
      messagesAdded: 0, touches: 0
    };

    if (this._persistDir) {
      mkdirSync(this._persistDir, { recursive: true });
      this._loadFromDisk();
    }

    this._cleanupTimer = setInterval(() => this._cleanup(), this._cleanupIntervalMs);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();

    if (this._persistDir && this._persistInterval > 0) {
      this._persistTimer = setInterval(() => this._snapshot(), this._persistInterval);
      if (this._persistTimer.unref) this._persistTimer.unref();
    }
  }

  // ─── Session CRUD ───────────────────────────────────────────

  create(opts = {}) {
    if (this._sessions.size >= this._maxSessions) this._evictLRU();

    const id = opts.id ?? uuid();
    if (this._sessions.has(id)) throw new Error(`Session ${id} already exists`);

    const ttl = opts.ttl ?? this._defaultTTL;
    const session = {
      id,
      owner: opts.owner ?? null,
      namespace: opts.namespace ?? 'default',
      tags: new Set(opts.tags ?? []),
      metadata: opts.metadata ?? {},
      state: {},
      messages: [],
      createdAt: now(),
      lastAccessedAt: now(),
      expiresAt: ttl > 0 ? now() + ttl : 0,
      ttl,
      messageCount: 0,
      status: 'active'
    };

    this._sessions.set(id, session);
    this._indexAdd(session);
    this._stats.created++;
    this._persist('create', session);
    this.emit('create', session);
    return this._safe(session);
  }

  get(id) {
    const s = this._sessions.get(id);
    if (!s) return null;
    if (s.expiresAt > 0 && now() > s.expiresAt) {
      this.expire(id);
      return null;
    }
    s.lastAccessedAt = now();
    return this._safe(s);
  }

  touch(id) {
    const s = this._sessions.get(id);
    if (!s) throw new Error(`Session ${id} not found`);
    s.lastAccessedAt = now();
    if (s.ttl > 0) s.expiresAt = now() + s.ttl;
    this._stats.touches++;
    this._persist('touch', { id });
    this.emit('touch', s);
    return this._safe(s);
  }

  destroy(id) {
    const s = this._sessions.get(id);
    if (!s) return false;
    this._indexRemove(s);
    this._sessions.delete(id);
    this._stats.destroyed++;
    this._persist('destroy', { id });
    this.emit('destroy', s);
    return true;
  }

  expire(id) {
    const s = this._sessions.get(id);
    if (!s) return false;
    s.status = 'expired';
    this._indexRemove(s);
    this._sessions.delete(id);
    this._stats.expired++;
    this._persist('expire', { id });
    this.emit('expire', s);
    return true;
  }

  extend(id, ttl) {
    const s = this._sessions.get(id);
    if (!s) throw new Error(`Session ${id} not found`);
    s.ttl = ttl;
    s.expiresAt = ttl > 0 ? now() + ttl : 0;
    s.lastAccessedAt = now();
    this._persist('extend', { id, ttl });
    return this._safe(s);
  }

  update(id, updates) {
    const s = this._sessions.get(id);
    if (!s) throw new Error(`Session ${id} not found`);
    if (updates.owner !== undefined) {
      this._ownerIndex.get(s.owner)?.delete(id);
      s.owner = updates.owner;
      this._ownerIndexGetSet(s.owner).add(id);
    }
    if (updates.namespace !== undefined) {
      this._namespaceIndex.get(s.namespace)?.delete(id);
      s.namespace = updates.namespace;
      this._namespaceIndexGetSet(s.namespace).add(id);
    }
    if (updates.tags) {
      for (const t of s.tags) this._tagIndex.get(t)?.delete(id);
      s.tags = new Set(updates.tags);
      for (const t of s.tags) this._tagIndexGetSet(t).add(id);
    }
    if (updates.metadata) Object.assign(s.metadata, updates.metadata);
    if (updates.ttl !== undefined) {
      s.ttl = updates.ttl;
      s.expiresAt = updates.ttl > 0 ? now() + updates.ttl : 0;
    }
    s.lastAccessedAt = now();
    this._persist('update', { id, ...updates });
    return this._safe(s);
  }

  // ─── Messages ───────────────────────────────────────────────

  addMessage(sessionId, role, content, opts = {}) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);

    const msg = {
      id: uuid(),
      role,
      content,
      timestamp: now(),
      metadata: opts.metadata ?? {}
    };

    s.messages.push(msg);
    s.messageCount++;
    s.lastAccessedAt = now();
    if (s.ttl > 0) s.expiresAt = now() + s.ttl;
    this._stats.messagesAdded++;

    // Evict oldest if over limit
    if (s.messages.length > this._maxMessages) {
      const removed = s.messages.splice(0, s.messages.length - this._maxMessages);
      s.metadata._evictedMessages = (s.metadata._evictedMessages ?? 0) + removed.length;
    }

    this._persist('message', { sessionId, msg });
    this.emit('message', { session: s, message: msg });
    return msg;
  }

  getMessages(sessionId, opts = {}) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    let msgs = s.messages;
    if (opts.role) msgs = msgs.filter(m => m.role === opts.role);
    if (opts.since) msgs = msgs.filter(m => m.timestamp >= opts.since);
    if (opts.limit) msgs = msgs.slice(-opts.limit);
    return msgs;
  }

  getLastMessage(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    return s.messages.length ? s.messages[s.messages.length - 1] : null;
  }

  clearMessages(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    const count = s.messages.length;
    s.messages = [];
    s.messageCount = 0;
    this._persist('clear_messages', { sessionId });
    return count;
  }

  // ─── State ──────────────────────────────────────────────────

  setState(sessionId, key, value) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    s.state[key] = value;
    s.lastAccessedAt = now();
    this._persist('set_state', { sessionId, key, value });
    return s.state;
  }

  getState(sessionId, key) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    return key !== undefined ? s.state[key] : { ...s.state };
  }

  deleteState(sessionId, key) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    delete s.state[key];
    this._persist('delete_state', { sessionId, key });
  }

  // ─── Query ──────────────────────────────────────────────────

  list(opts = {}) {
    let results = [...this._sessions.values()];
    if (opts.owner) results = results.filter(s => s.owner === opts.owner);
    if (opts.namespace) results = results.filter(s => s.namespace === opts.namespace);
    if (opts.tag) results = results.filter(s => s.tags.has(opts.tag));
    if (opts.status) results = results.filter(s => s.status === opts.status);
    results.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
    if (opts.offset) results = results.slice(opts.offset);
    if (opts.limit) results = results.slice(0, opts.limit);
    return results.map(s => this._safe(s));
  }

  count(opts = {}) {
    if (!opts.owner && !opts.namespace && !opts.tag) return this._sessions.size;
    return this.list(opts).length;
  }

  findByOwner(owner) { return this.list({ owner }); }
  findByNamespace(namespace) { return this.list({ namespace }); }
  findByTag(tag) { return this.list({ tag }); }

  search(predicate) {
    const results = [];
    for (const s of this._sessions.values()) {
      if (predicate(this._safe(s))) results.push(this._safe(s));
    }
    return results;
  }

  // ─── Bulk ───────────────────────────────────────────────────

  destroyByOwner(owner) {
    const sessions = this.findByOwner(owner);
    let count = 0;
    for (const s of sessions) { this.destroy(s.id); count++; }
    return count;
  }

  destroyByNamespace(namespace) {
    const sessions = this.findByNamespace(namespace);
    let count = 0;
    for (const s of sessions) { this.destroy(s.id); count++; }
    return count;
  }

  destroyExpired() { return this._cleanup(); }

  destroyAll() {
    const count = this._sessions.size;
    this._sessions.clear();
    this._ownerIndex.clear();
    this._namespaceIndex.clear();
    this._tagIndex.clear();
    this._persist('destroy_all', {});
    return count;
  }

  // ─── Stats ──────────────────────────────────────────────────

  stats() {
    const sessions = [...this._sessions.values()];
    let totalMessages = 0, totalStateKeys = 0;
    const namespaces = new Set(), owners = new Set();
    for (const s of sessions) {
      totalMessages += s.messages.length;
      totalStateKeys += Object.keys(s.state).length;
      namespaces.add(s.namespace);
      if (s.owner) owners.add(s.owner);
    }
    return {
      active: sessions.length,
      ...this._stats,
      totalMessages,
      totalStateKeys,
      namespaces: namespaces.size,
      owners: owners.size,
      avgMessagesPerSession: sessions.length ? Math.round(totalMessages / sessions.length) : 0
    };
  }

  // ─── Persistence ────────────────────────────────────────────

  _persist(action, data) {
    if (!this._persistDir) return;
    try {
      appendFileSync(join(this._persistDir, 'events.jsonl'), JSON.stringify({ t: now(), action, data }) + '\n');
    } catch {}
  }

  _snapshot() {
    if (!this._persistDir) return;
    try {
      const data = {
        sessions: [...this._sessions.entries()].map(([id, s]) => ({
          ...s, tags: [...s.tags]
        })),
        stats: this._stats,
        ts: now()
      };
      writeFileSync(join(this._persistDir, 'snapshot.json'), JSON.stringify(data));
    } catch {}
  }

  _loadFromDisk() {
    const snapPath = join(this._persistDir, 'snapshot.json');
    if (existsSync(snapPath)) {
      try {
        const data = JSON.parse(readFileSync(snapPath, 'utf8'));
        if (data.stats) Object.assign(this._stats, data.stats);
        if (data.sessions) {
          for (const s of data.sessions) {
            s.tags = new Set(s.tags || []);
            this._sessions.set(s.id, s);
            this._indexAdd(s);
          }
        }
      } catch {}
    }
    // Replay events after snapshot
    const eventsPath = join(this._persistDir, 'events.jsonl');
    if (existsSync(eventsPath)) {
      try {
        const lines = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
        const snapTime = existsSync(snapPath) ? (() => {
          try { return JSON.parse(readFileSync(snapPath, 'utf8')).ts ?? 0; } catch { return 0; }
        })() : 0;
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            if (ev.t <= snapTime) continue;
            this._replayEvent(ev);
          } catch {}
        }
      } catch {}
    }
  }

  _replayEvent(ev) {
    switch (ev.action) {
      case 'destroy': case 'expire':
        this._sessions.delete(ev.data.id);
        break;
      case 'destroy_all':
        this._sessions.clear();
        break;
    }
  }

  // ─── Internal ───────────────────────────────────────────────

  _cleanup() {
    const t = now();
    let cleaned = 0;
    for (const [id, s] of this._sessions) {
      if (s.expiresAt > 0 && t > s.expiresAt) {
        this.expire(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  _evictLRU() {
    let oldest = null;
    for (const s of this._sessions.values()) {
      if (!oldest || s.lastAccessedAt < oldest.lastAccessedAt) oldest = s;
    }
    if (oldest) this.destroy(oldest.id);
  }

  _indexAdd(s) {
    if (s.owner) this._ownerIndexGetSet(s.owner).add(s.id);
    this._namespaceIndexGetSet(s.namespace).add(s.id);
    for (const t of s.tags) this._tagIndexGetSet(t).add(s.id);
  }

  _indexRemove(s) {
    this._ownerIndex.get(s.owner)?.delete(s.id);
    this._namespaceIndex.get(s.namespace)?.delete(s.id);
    for (const t of s.tags) this._tagIndex.get(t)?.delete(s.id);
  }

  _ownerIndexGetSet(owner) {
    if (!this._ownerIndex.has(owner)) this._ownerIndex.set(owner, new Set());
    return this._ownerIndex.get(owner);
  }

  _namespaceIndexGetSet(ns) {
    if (!this._namespaceIndex.has(ns)) this._namespaceIndex.set(ns, new Set());
    return this._namespaceIndex.get(ns);
  }

  _tagIndexGetSet(tag) {
    if (!this._tagIndex.has(tag)) this._tagIndex.set(tag, new Set());
    return this._tagIndex.get(tag);
  }

  _safe(s) {
    return {
      id: s.id, owner: s.owner, namespace: s.namespace,
      tags: [...s.tags], metadata: { ...s.metadata },
      state: { ...s.state },
      messageCount: s.messageCount,
      messages: s.messages, // reference for efficiency
      createdAt: s.createdAt, lastAccessedAt: s.lastAccessedAt,
      expiresAt: s.expiresAt, ttl: s.ttl, status: s.status
    };
  }

  destroy_manager() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    if (this._persistTimer) clearInterval(this._persistTimer);
    this._snapshot();
    this.emit('shutdown');
  }
}

export default SessionManager;
