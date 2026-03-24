#!/usr/bin/env node
/**
 * agent-memory — Zero-dependency persistent memory for AI agents
 *
 * Features:
 *   • Store memories with tags, importance (0-1), metadata
 *   • Keyword-based relevance search (BM25-inspired scoring)
 *   • Session/conversation context tracking
 *   • Memory consolidation (merge similar memories)
 *   • Auto-forget: decay importance over time, purge low-value memories
 *   • JSONL persistence + periodic snapshots
 *   • EventEmitter for programmatic hooks
 *   • HTTP server with REST API + web dashboard
 *
 * Zero dependencies. Node 18+.
 */

import { EventEmitter } from "node:events";
import { readFile, writeFile, mkdir, access, readdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Tokenizer ────────────────────────────────────────────────────
function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// ─── BM25-inspired scorer ─────────────────────────────────────────
function bm25Score(queryTokens, docTokens, docFreq, avgDocLen, totalDocs, k1 = 1.5, b = 0.75) {
  const docLen = docTokens.length;
  const tfMap = {};
  for (const t of docTokens) tfMap[t] = (tfMap[t] || 0) + 1;

  let score = 0;
  for (const qt of queryTokens) {
    const tf = tfMap[qt] || 0;
    if (!tf) continue;
    const df = docFreq[qt] || 1;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / (avgDocLen || 1))));
    score += idf * tfNorm;
  }
  return score;
}

// ─── Memory Entry ─────────────────────────────────────────────────
/**
 * @typedef {Object} MemoryEntry
 * @property {string} id
 * @property {string} content
 * @property {string[]} tags
 * @property {number} importance - 0..1
 * @property {Object} metadata
 * @property {string} session - session/conversation id
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number} accessCount
 * @property {number} lastAccessed
 */

// ─── AgentMemory ──────────────────────────────────────────────────
export class AgentMemory extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.dataDir - persistence directory
   * @param {number} [opts.maxMemories=10000] - max entries before auto-cleanup
   * @param {number} [opts.importanceDecay=0.01] - importance decay per day
   * @param {number} [opts.forgetThreshold=0.05] - forget memories below this importance
   * @param {number} [opts.snapshotIntervalMs=60000] - snapshot interval
   * @param {number} [opts.port] - HTTP server port (optional)
   */
  constructor(opts = {}) {
    super();
    this.dataDir = opts.dataDir || "./data";
    this.maxMemories = opts.maxMemories || 10000;
    this.importanceDecay = opts.importanceDecay || 0.01;
    this.forgetThreshold = opts.forgetThreshold || 0.05;
    this.snapshotIntervalMs = opts.snapshotIntervalMs || 60000;
    this.port = opts.port || null;

    /** @type {Map<string, MemoryEntry>} */
    this.memories = new Map();
    this.sessions = new Map(); // sessionId → Set<memId>
    this.tokenCache = new Map(); // memId → string[]
    this.snapshotTimer = null;
    this.httpServer = null;
    this.ready = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    await this._load();
    this.snapshotTimer = setInterval(() => this._snapshot().catch(() => {}), this.snapshotIntervalMs);
    if (this.port) await this._startHttp();
    this.ready = true;
    this.emit("ready");
    return this;
  }

  async destroy() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.httpServer) this.httpServer.close();
    await this._snapshot();
    this.ready = false;
    this.emit("destroy");
  }

  // ── Core CRUD ──────────────────────────────────────────────────

  /**
   * Store a new memory
   * @param {string} content
   * @param {Object} [opts]
   * @param {string[]} [opts.tags]
   * @param {number} [opts.importance=0.5]
   * @param {Object} [opts.metadata]
   * @param {string} [opts.session]
   * @param {string} [opts.id] - custom id
   * @returns {MemoryEntry}
   */
  store(content, opts = {}) {
    const id = opts.id || randomUUID();
    const now = Date.now();
    const entry = {
      id,
      content,
      tags: opts.tags || [],
      importance: Math.min(1, Math.max(0, opts.importance ?? 0.5)),
      metadata: opts.metadata || {},
      session: opts.session || "default",
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessed: now,
    };
    this.memories.set(id, entry);
    this.tokenCache.set(id, tokenize(content + " " + entry.tags.join(" ")));

    // Session tracking
    if (!this.sessions.has(entry.session)) this.sessions.set(entry.session, new Set());
    this.sessions.get(entry.session).add(id);

    this._appendLog({ op: "store", ...entry });
    this.emit("store", entry);

    // Auto-cleanup if over limit
    if (this.memories.size > this.maxMemories) {
      this._prune(Math.floor(this.maxMemories * 0.8));
    }
    return entry;
  }

  /**
   * Get a memory by id
   * @param {string} id
   * @returns {MemoryEntry|null}
   */
  get(id) {
    const entry = this.memories.get(id);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      this.emit("access", entry);
    }
    return entry || null;
  }

  /**
   * Update a memory
   * @param {string} id
   * @param {Object} patch - fields to update
   * @returns {MemoryEntry|null}
   */
  update(id, patch) {
    const entry = this.memories.get(id);
    if (!entry) return null;
    if (patch.content !== undefined) {
      entry.content = patch.content;
      this.tokenCache.set(id, tokenize(patch.content + " " + entry.tags.join(" ")));
    }
    if (patch.tags) { entry.tags = patch.tags; this.tokenCache.set(id, tokenize(entry.content + " " + entry.tags.join(" "))); }
    if (patch.importance !== undefined) entry.importance = Math.min(1, Math.max(0, patch.importance));
    if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
    if (patch.session && patch.session !== entry.session) {
      this.sessions.get(entry.session)?.delete(id);
      if (!this.sessions.has(patch.session)) this.sessions.set(patch.session, new Set());
      this.sessions.get(patch.session).add(id);
      entry.session = patch.session;
    }
    entry.updatedAt = Date.now();
    this._appendLog({ op: "update", id, ...patch });
    this.emit("update", entry);
    return entry;
  }

  /**
   * Delete a memory
   * @param {string} id
   * @returns {boolean}
   */
  delete(id) {
    const entry = this.memories.get(id);
    if (!entry) return false;
    this.sessions.get(entry.session)?.delete(id);
    this.tokenCache.delete(id);
    this.memories.delete(id);
    this._appendLog({ op: "delete", id });
    this.emit("delete", entry);
    return true;
  }

  // ── Search ─────────────────────────────────────────────────────

  /**
   * Search memories by keyword relevance (BM25)
   * @param {string} query
   * @param {Object} [opts]
   * @param {number} [opts.limit=10]
   * @param {string} [opts.session] - filter by session
   * @param {string[]} [opts.tags] - filter by tags (AND)
   * @param {number} [opts.minImportance] - minimum importance
   * @param {Object} [opts.metadata] - metadata key-value filters
   * @returns {Array<{entry: MemoryEntry, score: number}>}
   */
  search(query, opts = {}) {
    const limit = opts.limit || 10;
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];

    // Build doc frequency
    const docFreq = {};
    const entries = [];
    for (const [id, entry] of this.memories) {
      // Filters
      if (opts.session && entry.session !== opts.session) continue;
      if (opts.tags && !opts.tags.every((t) => entry.tags.includes(t))) continue;
      if (opts.minImportance && entry.importance < opts.minImportance) continue;
      if (opts.metadata) {
        let metaMatch = true;
        for (const [k, v] of Object.entries(opts.metadata)) {
          if (entry.metadata[k] !== v) { metaMatch = false; break; }
        }
        if (!metaMatch) continue;
      }

      const tokens = this.tokenCache.get(id) || tokenize(entry.content + " " + entry.tags.join(" "));
      this.tokenCache.set(id, tokens);
      entries.push({ entry, tokens });
      const seen = new Set();
      for (const t of tokens) {
        if (!seen.has(t)) { docFreq[t] = (docFreq[t] || 0) + 1; seen.add(t); }
      }
    }

    const totalDocs = entries.length || 1;
    const avgDocLen = entries.reduce((s, e) => s + e.tokens.length, 0) / totalDocs;

    const scored = entries.map(({ entry, tokens }) => {
      let score = bm25Score(queryTokens, tokens, docFreq, avgDocLen, totalDocs);
      // Importance boost
      score *= 1 + entry.importance * 0.5;
      // Recency boost (last 24h gets up to 20% boost)
      const ageHours = (Date.now() - entry.createdAt) / 3600000;
      if (ageHours < 24) score *= 1 + (1 - ageHours / 24) * 0.2;
      // Access frequency boost
      score *= 1 + Math.min(entry.accessCount, 20) * 0.01;
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // ── Session Context ────────────────────────────────────────────

  /**
   * Get all memories for a session, sorted by recency
   * @param {string} session
   * @param {number} [limit=50]
   * @returns {MemoryEntry[]}
   */
  getContext(session, limit = 50) {
    const ids = this.sessions.get(session) || new Set();
    const entries = [];
    for (const id of ids) {
      const e = this.memories.get(id);
      if (e) entries.push(e);
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    return entries.slice(0, limit);
  }

  /**
   * List all sessions
   * @returns {string[]}
   */
  listSessions() {
    return [...this.sessions.keys()];
  }

  // ── Consolidation ──────────────────────────────────────────────

  /**
   * Merge similar memories (same session, overlapping keywords)
   * @param {string} session
   * @param {number} [threshold=0.6] - token overlap ratio to consider similar
   * @returns {number} - count of merges performed
   */
  consolidate(session, threshold = 0.6) {
    const ids = [...(this.sessions.get(session) || [])];
    const merged = new Set();
    let count = 0;

    for (let i = 0; i < ids.length; i++) {
      if (merged.has(ids[i])) continue;
      const a = this.memories.get(ids[i]);
      if (!a) continue;
      const tokensA = new Set(this.tokenCache.get(ids[i]) || []);

      for (let j = i + 1; j < ids.length; j++) {
        if (merged.has(ids[j])) continue;
        const b = this.memories.get(ids[j]);
        if (!b) continue;
        const tokensB = new Set(this.tokenCache.get(ids[j]) || []);

        // Jaccard similarity
        let intersection = 0;
        for (const t of tokensA) if (tokensB.has(t)) intersection++;
        const union = tokensA.size + tokensB.size - intersection;
        const similarity = union > 0 ? intersection / union : 0;

        if (similarity >= threshold) {
          // Merge b into a
          a.content = a.content + "\n---\n" + b.content;
          a.tags = [...new Set([...a.tags, ...b.tags])];
          a.importance = Math.max(a.importance, b.importance);
          a.metadata = { ...b.metadata, ...a.metadata };
          a.updatedAt = Date.now();
          this.tokenCache.set(ids[i], tokenize(a.content + " " + a.tags.join(" ")));
          this.delete(ids[j]);
          merged.add(ids[j]);
          count++;
        }
      }
    }
    if (count > 0) {
      this._appendLog({ op: "consolidate", session, merged: count });
      this.emit("consolidate", { session, count });
    }
    return count;
  }

  // ── Auto-Forget ────────────────────────────────────────────────

  /**
   * Decay importance and forget low-value memories
   * @returns {{decayed: number, forgotten: number}}
   */
  forget() {
    const now = Date.now();
    let decayed = 0;
    let forgotten = 0;
    const toDelete = [];

    for (const [id, entry] of this.memories) {
      const ageDays = (now - entry.createdAt) / 86400000;
      if (ageDays > 0) {
        const decay = this.importanceDecay * ageDays;
        const newImportance = Math.max(0, entry.importance - decay);
        if (newImportance !== entry.importance) {
          entry.importance = newImportance;
          entry.updatedAt = now;
          decayed++;
        }
      }
      if (entry.importance < this.forgetThreshold) {
        toDelete.push(id);
        forgotten++;
      }
    }
    for (const id of toDelete) this.delete(id);
    if (decayed || forgotten) {
      this._appendLog({ op: "forget", decayed, forgotten });
      this.emit("forget", { decayed, forgotten });
    }
    return { decayed, forgotten };
  }

  /**
   * Reinforce a memory (bump importance)
   * @param {string} id
   * @param {number} [boost=0.1]
   * @returns {MemoryEntry|null}
   */
  reinforce(id, boost = 0.1) {
    const entry = this.memories.get(id);
    if (!entry) return null;
    entry.importance = Math.min(1, entry.importance + boost);
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    entry.updatedAt = Date.now();
    this.emit("reinforce", entry);
    return entry;
  }

  // ── Pruning ─────────────────────────────────────────────────────

  /**
   * Prune to keep only top N memories by importance + recency
   * @param {number} keep - number of memories to keep
   */
  _prune(keep) {
    if (this.memories.size <= keep) return;
    const entries = [...this.memories.entries()].map(([id, e]) => {
      const ageDays = (Date.now() - e.createdAt) / 86400000;
      const score = e.importance * 0.6 + (e.accessCount / (e.accessCount + 10)) * 0.2 + (1 / (1 + ageDays)) * 0.2;
      return { id, score };
    });
    entries.sort((a, b) => b.score - a.score);
    const toRemove = entries.slice(keep);
    for (const { id } of toRemove) {
      const entry = this.memories.get(id);
      if (entry) this.sessions.get(entry.session)?.delete(id);
      this.tokenCache.delete(id);
      this.memories.delete(id);
    }
    this._appendLog({ op: "prune", removed: toRemove.length });
    this.emit("prune", { removed: toRemove.length });
  }

  // ── Stats ──────────────────────────────────────────────────────

  stats() {
    const now = Date.now();
    const entries = [...this.memories.values()];
    return {
      total: entries.length,
      sessions: this.sessions.size,
      avgImportance: entries.length ? +(entries.reduce((s, e) => s + e.importance, 0) / entries.length).toFixed(3) : 0,
      totalAccesses: entries.reduce((s, e) => s + e.accessCount, 0),
      bySession: Object.fromEntries([...this.sessions].map(([s, ids]) => [s, ids.size])),
      oldestMemory: entries.length ? new Date(Math.min(...entries.map((e) => e.createdAt))).toISOString() : null,
      newestMemory: entries.length ? new Date(Math.max(...entries.map((e) => e.createdAt))).toISOString() : null,
    };
  }

  // ── Export / Import ────────────────────────────────────────────

  export(session) {
    const entries = session
      ? [...this.memories.values()].filter((e) => e.session === session)
      : [...this.memories.values()];
    return entries.map((e) => ({ ...e }));
  }

  import(entries) {
    let count = 0;
    for (const e of entries) {
      if (!this.memories.has(e.id)) {
        this.store(e.content, {
          id: e.id,
          tags: e.tags,
          importance: e.importance,
          metadata: e.metadata,
          session: e.session,
        });
        count++;
      }
    }
    return count;
  }

  // ── Persistence ────────────────────────────────────────────────

  _logPath() { return join(this.dataDir, "memory.jsonl"); }
  _snapPath() { return join(this.dataDir, "memory.snap.json"); }

  async _appendLog(entry) {
    try {
      const line = JSON.stringify({ ...entry, _ts: Date.now() }) + "\n";
      await writeFile(this._logPath(), line, { flag: "a" });
    } catch {}
  }

  async _snapshot() {
    const data = {
      memories: Object.fromEntries(this.memories),
      sessions: Object.fromEntries([...this.sessions].map(([k, v]) => [k, [...v]])),
      savedAt: Date.now(),
    };
    await writeFile(this._snapPath(), JSON.stringify(data));
  }

  async _load() {
    try {
      const raw = await readFile(this._snapPath(), "utf8");
      const data = JSON.parse(raw);
      if (data.memories) {
        for (const [id, entry] of Object.entries(data.memories)) {
          this.memories.set(id, entry);
          this.tokenCache.set(id, tokenize(entry.content + " " + (entry.tags || []).join(" ")));
        }
      }
      if (data.sessions) {
        for (const [s, ids] of Object.entries(data.sessions)) {
          this.sessions.set(s, new Set(ids));
        }
      }
    } catch {}
    // Replay JSONL log after snapshot
    try {
      const logRaw = await readFile(this._logPath(), "utf8");
      const lines = logRaw.trim().split("\n");
      const snapTime = (await this._readSnapTime()) || 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry._ts <= snapTime) continue;
          if (entry.op === "store") {
            if (!this.memories.has(entry.id)) {
              this.memories.set(entry.id, entry);
              this.tokenCache.set(entry.id, tokenize(entry.content + " " + (entry.tags || []).join(" ")));
              if (!this.sessions.has(entry.session)) this.sessions.set(entry.session, new Set());
              this.sessions.get(entry.session).add(entry.id);
            }
          } else if (entry.op === "delete") {
            const e = this.memories.get(entry.id);
            if (e) this.sessions.get(e.session)?.delete(entry.id);
            this.memories.delete(entry.id);
            this.tokenCache.delete(entry.id);
          } else if (entry.op === "update" && this.memories.has(entry.id)) {
            const e = this.memories.get(entry.id);
            if (entry.content) { e.content = entry.content; this.tokenCache.set(entry.id, tokenize(entry.content + " " + (entry.tags || []).join(" "))); }
            if (entry.tags) e.tags = entry.tags;
            if (entry.importance !== undefined) e.importance = entry.importance;
          }
        } catch {}
      }
    } catch {}
  }

  async _readSnapTime() {
    try {
      const raw = await readFile(this._snapPath(), "utf8");
      return JSON.parse(raw).savedAt || 0;
    } catch { return 0; }
  }

  // ── HTTP Server ────────────────────────────────────────────────

  _json(res, code, data) {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(data));
  }

  async _startHttp() {
    const self = this;
    this.httpServer = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${self.port}`);
      const path = url.pathname;
      const method = req.method;

      // CORS preflight
      if (method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE", "Access-Control-Allow-Headers": "Content-Type" });
        return res.end();
      }

      const body = async () => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        return JSON.parse(Buffer.concat(chunks).toString() || "{}");
      };

      try {
        // GET / — dashboard
        if (path === "/" && method === "GET") {
          res.writeHead(200, { "Content-Type": "text/html" });
          return res.end(self._dashboardHtml());
        }
        // GET /stats
        if (path === "/stats" && method === "GET") return self._json(res, 200, self.stats());
        // POST /store
        if (path === "/store" && method === "POST") {
          const b = await body();
          if (!b.content) return self._json(res, 400, { error: "content required" });
          return self._json(res, 201, self.store(b.content, b));
        }
        // GET /memory/:id
        if (path.startsWith("/memory/") && method === "GET") {
          const id = path.split("/")[2];
          const entry = self.get(id);
          return entry ? self._json(res, 200, entry) : self._json(res, 404, { error: "not found" });
        }
        // PUT /memory/:id
        if (path.startsWith("/memory/") && method === "PUT") {
          const id = path.split("/")[2];
          const b = await body();
          const entry = self.update(id, b);
          return entry ? self._json(res, 200, entry) : self._json(res, 404, { error: "not found" });
        }
        // DELETE /memory/:id
        if (path.startsWith("/memory/") && method === "DELETE") {
          const id = path.split("/")[2];
          return self.delete(id) ? self._json(res, 200, { deleted: true }) : self._json(res, 404, { error: "not found" });
        }
        // GET /search?q=...&session=...&limit=...
        if (path === "/search" && method === "GET") {
          const q = url.searchParams.get("q") || "";
          const opts = {};
          if (url.searchParams.get("session")) opts.session = url.searchParams.get("session");
          if (url.searchParams.get("limit")) opts.limit = +url.searchParams.get("limit");
          if (url.searchParams.get("tags")) opts.tags = url.searchParams.get("tags").split(",");
          if (url.searchParams.get("min_importance")) opts.minImportance = +url.searchParams.get("min_importance");
          const results = self.search(q, opts);
          return self._json(res, 200, results);
        }
        // GET /context/:session
        if (path.startsWith("/context/") && method === "GET") {
          const session = decodeURIComponent(path.split("/")[2]);
          const limit = +(url.searchParams.get("limit") || 50);
          return self._json(res, 200, self.getContext(session, limit));
        }
        // POST /consolidate
        if (path === "/consolidate" && method === "POST") {
          const b = await body();
          return self._json(res, 200, { merged: self.consolidate(b.session || "default", b.threshold) });
        }
        // POST /forget
        if (path === "/forget" && method === "POST") {
          return self._json(res, 200, self.forget());
        }
        // POST /reinforce/:id
        if (path.startsWith("/reinforce/") && method === "POST") {
          const id = path.split("/")[2];
          const b = await body();
          const entry = self.reinforce(id, b.boost);
          return entry ? self._json(res, 200, entry) : self._json(res, 404, { error: "not found" });
        }
        // GET /sessions
        if (path === "/sessions" && method === "GET") return self._json(res, 200, self.listSessions());
        // GET /export?session=...
        if (path === "/export" && method === "GET") {
          const session = url.searchParams.get("session");
          return self._json(res, 200, self.export(session));
        }
        // POST /import
        if (path === "/import" && method === "POST") {
          const b = await body();
          if (!Array.isArray(b)) return self._json(res, 400, { error: "array of entries required" });
          return self._json(res, 200, { imported: self.import(b) });
        }
        self._json(res, 404, { error: "not found" });
      } catch (e) {
        self._json(res, 500, { error: e.message });
      }
    });
    this.httpServer.listen(this.port);
  }

  _dashboardHtml() {
    const s = this.stats();
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>agent-memory</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}h2{color:#8b949e;margin:16px 0 8px;font-size:14px;text-transform:uppercase}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .value{font-size:28px;font-weight:700;color:#58a6ff}.card .label{font-size:12px;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #30363d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}tr:hover{background:#161b22}
.tag{display:inline-block;background:#1f6feb33;color:#58a6ff;padding:2px 8px;border-radius:4px;font-size:11px;margin:1px}
.search{display:flex;gap:8px;margin:16px 0}input{flex:1;padding:8px 12px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#c9d1d9}
button{padding:8px 16px;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:600}
button:hover{background:#2ea043}#results{margin-top:12px}</style></head><body>
<h1>🧠 agent-memory</h1>
<div class="cards">
<div class="card"><div class="value">${s.total}</div><div class="label">Total Memories</div></div>
<div class="card"><div class="value">${s.sessions}</div><div class="label">Sessions</div></div>
<div class="card"><div class="value">${s.avgImportance}</div><div class="label">Avg Importance</div></div>
<div class="card"><div class="value">${s.totalAccesses}</div><div class="label">Total Accesses</div></div>
</div>
<h2>Search</h2>
<div class="search"><input id="q" placeholder="Search memories..." /><button onclick="doSearch()">Search</button></div>
<div id="results"></div>
<h2>Sessions</h2>
<table><tr><th>Session</th><th>Memories</th></tr>${Object.entries(s.bySession).map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
<script>async function doSearch(){const q=document.getElementById("q").value;if(!q)return;const r=await fetch("/search?q="+encodeURIComponent(q));const d=await r.json();
document.getElementById("results").innerHTML="<table><tr><th>Score</th><th>Content</th><th>Tags</th><th>Importance</th></tr>"+d.map(r=>"<tr><td>"+r.score.toFixed(2)+"</td><td>"+r.entry.content.substring(0,100)+"</td><td>"+(r.entry.tags||[]).map(t=>'<span class="tag">'+t+'</span>').join("")+"</td><td>"+r.entry.importance.toFixed(2)+"</td></tr>").join("")+"</table>";}
document.getElementById("q").addEventListener("keypress",e=>{if(e.key==="Enter")doSearch();});</script></body></html>`;
  }
}

// ─── CLI entry point ──────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith("index.mjs");
if (isMain) {
  const port = +(process.env.PORT || 3101);
  const mem = new AgentMemory({ port });
  mem.on("ready", () => console.log(`🧠 agent-memory running on :${port}`));
  mem.init().catch(console.error);
}

export default AgentMemory;
