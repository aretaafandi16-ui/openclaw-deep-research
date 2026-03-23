/**
 * agent-store — Library API
 * 
 * Use as a programmatic library (not just HTTP server):
 * 
 *   import { AgentStore } from "./index.mjs";
 *   const store = new AgentStore({ dataDir: "./data" });
 *   await store.init();
 *   await store.set("my-ns", "key", { hello: "world" });
 *   const val = await store.get("my-ns", "key");
 */

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export class AgentStore {
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || join(process.env.HOME || "/tmp", ".agent-store");
    this.autoSaveMs = opts.autoSaveMs || 5000;
    this.maxValueSize = opts.maxValueSize || 1024 * 1024;
    this.store = new Map();
    this.dirty = false;
    this.saveTimer = null;
    this.stats = {
      startedAt: new Date().toISOString(),
      totalGets: 0,
      totalSets: 0,
      totalDeletes: 0,
      expiredKeys: 0,
      lastSave: null,
      lastLoad: null,
    };
    this._ttlInterval = null;
  }

  async init() {
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }
    await this._loadFromDisk();
    this._ttlInterval = setInterval(() => this._checkExpired(), 10000);
  }

  async destroy() {
    if (this._ttlInterval) clearInterval(this._ttlInterval);
    await this.saveToDisk();
  }

  // ── Core CRUD ───────────────────────────────────────────────────

  async get(namespace, key) {
    this.stats.totalGets++;
    const entries = this._getNs(namespace);
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      entries.delete(key);
      this.stats.expiredKeys++;
      return undefined;
    }
    return structuredClone(entry.value);
  }

  async getMeta(namespace, key) {
    const entries = this._getNs(namespace);
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) return null;
    return {
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
      size: JSON.stringify(entry.value).length,
    };
  }

  async set(namespace, key, value, opts = {}) {
    this.stats.totalSets++;
    const entries = this._getNs(namespace);
    const now = new Date().toISOString();
    const existing = entries.get(key);

    if (opts.ifAbsent && existing) return { skipped: true, reason: "exists" };
    if (opts.ifNewer && existing && new Date(existing.updatedAt) > new Date(opts.ifNewer)) {
      return { skipped: true, reason: "newer_exists" };
    }

    const size = JSON.stringify(value).length;
    if (size > this.maxValueSize) {
      throw new Error(`Value too large: ${size} > ${this.maxValueSize}`);
    }

    const entry = {
      value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: opts.ttl ? Date.now() + opts.ttl * 1000 : existing?.expiresAt || null,
    };

    entries.set(key, entry);
    this._scheduleSave();
    return { ok: true, updatedAt: now };
  }

  async delete(namespace, key) {
    this.stats.totalDeletes++;
    const entries = this._getNs(namespace);
    const existed = entries.delete(key);
    if (entries.size === 0) this.store.delete(namespace);
    this._scheduleSave();
    return existed;
  }

  async setTTL(namespace, key, ttlSeconds) {
    const entries = this._getNs(namespace);
    const entry = entries.get(key);
    if (!entry) return false;
    entry.expiresAt = ttlSeconds === 0 ? null : Date.now() + ttlSeconds * 1000;
    entry.updatedAt = new Date().toISOString();
    this._scheduleSave();
    return true;
  }

  // ── Batch Operations ────────────────────────────────────────────

  async mget(namespace, keys) {
    const results = {};
    for (const key of keys) {
      results[key] = await this.get(namespace, key);
    }
    return results;
  }

  async mset(namespace, entries) {
    const results = [];
    for (const { key, value, ttl } of entries) {
      results.push(await this.set(namespace, key, value, { ttl }));
    }
    return results;
  }

  async mdelete(namespace, keys) {
    let deleted = 0;
    for (const key of keys) {
      if (await this.delete(namespace, key)) deleted++;
    }
    return deleted;
  }

  // ── Search ──────────────────────────────────────────────────────

  search(namespace, pattern = "*") {
    const entries = this._getNs(namespace);
    const results = [];
    for (const [key, entry] of entries) {
      if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
      if (this._globMatch(pattern, key)) {
        results.push({
          key,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          expiresAt: entry.expiresAt,
          size: JSON.stringify(entry.value).length,
        });
      }
    }
    return results;
  }

  listKeys(namespace) {
    const entries = this.store.get(namespace);
    if (!entries) return [];
    return [...entries.keys()].filter(k => {
      const e = entries.get(k);
      return !e.expiresAt || Date.now() <= e.expiresAt;
    });
  }

  listNamespaces() {
    return [...this.store.entries()].map(([ns, entries]) => ({
      name: ns,
      keys: entries.size,
    }));
  }

  // ── Backup / Restore ────────────────────────────────────────────

  async backup(file) {
    const backup = {};
    for (const [ns, entries] of this.store) {
      backup[ns] = {};
      for (const [key, entry] of entries) {
        if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
        backup[ns][key] = entry;
      }
    }
    await writeFile(file, JSON.stringify(backup, null, 2));
    return { file, namespaces: Object.keys(backup).length };
  }

  async restore(file) {
    const raw = await readFile(file, "utf-8");
    const backup = JSON.parse(raw);
    let restored = 0;
    for (const [ns, data] of Object.entries(backup)) {
      const entries = this._getNs(ns);
      for (const [key, entry] of Object.entries(data)) {
        if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
        entries.set(key, entry);
        restored++;
      }
    }
    this._scheduleSave();
    return { restored, namespaces: Object.keys(backup).length };
  }

  // ── Stats ───────────────────────────────────────────────────────

  getStats() {
    return {
      ...this.stats,
      namespaces: this.listNamespaces(),
      totalKeys: [...this.store.values()].reduce((s, m) => s + m.size, 0),
    };
  }

  // ── Internals ───────────────────────────────────────────────────

  _getNs(ns) {
    if (!this.store.has(ns)) this.store.set(ns, new Map());
    return this.store.get(ns);
  }

  _globMatch(pattern, str) {
    const regex = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
    );
    return regex.test(str);
  }

  _checkExpired() {
    const now = Date.now();
    for (const [ns, entries] of this.store) {
      for (const [key, entry] of entries) {
        if (entry.expiresAt && now > entry.expiresAt) {
          entries.delete(key);
          this.stats.expiredKeys++;
          this.dirty = true;
        }
      }
      if (entries.size === 0) this.store.delete(ns);
    }
  }

  async _loadFromDisk() {
    if (!existsSync(this.dataDir)) return;
    const namespaces = await readdir(this.dataDir);
    let loaded = 0;
    for (const ns of namespaces) {
      const storeFile = join(this.dataDir, ns, "_store.json");
      if (!existsSync(storeFile)) continue;
      try {
        const raw = await readFile(storeFile, "utf-8");
        const data = JSON.parse(raw);
        const entries = new Map();
        for (const [key, entry] of Object.entries(data)) {
          if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.stats.expiredKeys++;
            continue;
          }
          entries.set(key, entry);
          loaded++;
        }
        if (entries.size > 0) this.store.set(ns, entries);
      } catch (err) {
        console.error(`Failed to load namespace ${ns}:`, err.message);
      }
    }
    this.stats.lastLoad = new Date().toISOString();
    console.log(`Loaded ${loaded} entries from ${this.store.size} namespaces`);
  }

  async saveToDisk() {
    if (!this.dirty) return;
    if (!existsSync(this.dataDir)) await mkdir(this.dataDir, { recursive: true });
    for (const [ns, entries] of this.store) {
      const nsDir = join(this.dataDir, ns);
      if (!existsSync(nsDir)) await mkdir(nsDir, { recursive: true });
      const data = {};
      for (const [key, entry] of entries) {
        if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
        data[key] = entry;
      }
      await writeFile(join(nsDir, "_store.json"), JSON.stringify(data, null, 2));
    }
    this.dirty = false;
    this.stats.lastSave = new Date().toISOString();
  }

  _scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.saveToDisk();
    }, this.autoSaveMs);
  }
}

export default AgentStore;
