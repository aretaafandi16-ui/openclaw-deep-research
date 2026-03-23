#!/usr/bin/env node
/**
 * agent-store — Persistent key-value store for AI agents
 * 
 * Zero dependencies. Pure Node.js. HTTP API.
 * 
 * Features:
 *  - Namespaced storage (separate namespaces per agent/project)
 *  - TTL (time-to-live) for auto-expiring entries
 *  - JSON values with schema-free storage
 *  - Pattern search (glob-style key matching)
 *  - List all keys in a namespace
 *  - Backup/restore to/from JSON file
 *  - Stats and health endpoints
 *  - Auto-persistence to disk (debounced writes)
 *  - Atomic operations (set-if-absent, set-if-newer)
 * 
 * Usage:
 *   PORT=3096 node server.mjs
 *   curl http://localhost:3096/health
 * 
 * API:
 *   GET  /health                           — Health check + stats
 *   GET  /ns                               — List namespaces
 *   GET  /ns/:namespace                    — List keys in namespace
 *   GET  /ns/:namespace/:key               — Get value
 *   PUT  /ns/:namespace/:key               — Set value (body = JSON value)
 *   DELETE /ns/:namespace/:key             — Delete key
 *   POST /ns/:namespace/:key/ttl           — Set TTL (body = {ttl: seconds})
 *   GET  /ns/:namespace/search?pattern=*   — Search keys by pattern
 *   POST /backup                           — Backup all data to file
 *   POST /restore                          — Restore from backup file
 *   GET  /stats                            — Detailed statistics
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ── Configuration ───────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3096");
const DATA_DIR = process.env.DATA_DIR || join(process.env.HOME || "/tmp", ".agent-store");
const AUTO_SAVE_MS = 5000; // Debounce auto-save every 5s
const TTL_CHECK_MS = 10000; // Check for expired keys every 10s
const MAX_VALUE_SIZE = 1024 * 1024; // 1MB max value size

// ── Storage ─────────────────────────────────────────────────────────

/** In-memory store: namespace → key → { value, metadata } */
const store = new Map();

/** Stats tracking */
const stats = {
  startedAt: new Date().toISOString(),
  totalGets: 0,
  totalSets: 0,
  totalDeletes: 0,
  totalSearches: 0,
  totalBackups: 0,
  totalRestores: 0,
  expiredKeys: 0,
  lastSave: null,
  lastLoad: null,
};

let dirty = false;
let saveTimer = null;

// ── Persistence ─────────────────────────────────────────────────────

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
    console.log(`📁 Created data directory: ${DATA_DIR}`);
  }
}

/** Save all namespaces to disk */
async function saveToDisk() {
  if (!dirty) return;
  
  await ensureDataDir();
  
  for (const [ns, entries] of store) {
    const nsDir = join(DATA_DIR, ns);
    if (!existsSync(nsDir)) await mkdir(nsDir, { recursive: true });

    const data = {};
    for (const [key, entry] of entries) {
      // Skip expired
      if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
      data[key] = entry;
    }

    await writeFile(join(nsDir, "_store.json"), JSON.stringify(data, null, 2));
  }

  dirty = false;
  stats.lastSave = new Date().toISOString();
}

/** Load all namespaces from disk */
async function loadFromDisk() {
  if (!existsSync(DATA_DIR)) return;

  const namespaces = await readdir(DATA_DIR);
  let loaded = 0;

  for (const ns of namespaces) {
    const storeFile = join(DATA_DIR, ns, "_store.json");
    if (!existsSync(storeFile)) continue;

    try {
      const raw = await readFile(storeFile, "utf-8");
      const data = JSON.parse(raw);
      const entries = new Map();

      for (const [key, entry] of Object.entries(data)) {
        // Skip expired on load
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
          stats.expiredKeys++;
          continue;
        }
        entries.set(key, entry);
        loaded++;
      }

      if (entries.size > 0) {
        store.set(ns, entries);
      }
    } catch (err) {
      console.error(`⚠️ Failed to load namespace ${ns}:`, err.message);
    }
  }

  stats.lastLoad = new Date().toISOString();
  console.log(`📂 Loaded ${loaded} entries from ${store.size} namespaces`);
}

/** Schedule debounced save */
function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await saveToDisk();
  }, AUTO_SAVE_MS);
}

// ── TTL Expiration ──────────────────────────────────────────────────

function checkExpired() {
  const now = Date.now();
  for (const [ns, entries] of store) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt && now > entry.expiresAt) {
        entries.delete(key);
        stats.expiredKeys++;
        dirty = true;
      }
    }
    if (entries.size === 0) store.delete(ns);
  }
}

// ── Rate Limiting ─────────────────────────────────────────────────

const rateLimits = {
  /** ip → { count, windowStart } */
  _clients: new Map(),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"), // 1 minute
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX || "300"), // 300 req/min per IP
  enabled: process.env.RATE_LIMIT !== "false",

  check(ip) {
    if (!this.enabled) return { allowed: true };
    const now = Date.now();
    let client = this._clients.get(ip);
    if (!client || now - client.windowStart > this.windowMs) {
      client = { count: 0, windowStart: now };
      this._clients.set(ip, client);
    }
    client.count++;
    const remaining = Math.max(0, this.maxRequests - client.count);
    if (client.count > this.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((this.windowMs - (now - client.windowStart)) / 1000) };
    }
    return { allowed: true, remaining };
  },

  // Cleanup stale entries every 5 minutes
  _cleanup: setInterval(() => {
    const now = Date.now();
    for (const [ip, client] of rateLimits._clients) {
      if (now - client.windowStart > rateLimits.windowMs * 2) {
        rateLimits._clients.delete(ip);
      }
    }
  }, 300000),
};

// ── Pattern Matching ────────────────────────────────────────────────

function globMatch(pattern, str) {
  const regex = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  );
  return regex.test(str);
}

// ── Helpers ─────────────────────────────────────────────────────────

function getNamespace(ns) {
  if (!store.has(ns)) store.set(ns, new Map());
  return store.get(ns);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseUrl(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return {
    pathname: url.pathname.replace(/\/+$/, "") || "/",
    query: Object.fromEntries(url.searchParams),
  };
}

// ── Route Handlers ──────────────────────────────────────────────────

const routes = {
  // Health check
  "GET /health": async () => ({
    status: "ok",
    uptime: Math.round((Date.now() - new Date(stats.startedAt).getTime()) / 1000),
    namespaces: store.size,
    totalKeys: [...store.values()].reduce((s, m) => s + m.size, 0),
    dataDir: DATA_DIR,
  }),

  // List namespaces
  "GET /ns": async () => ({
    namespaces: [...store.entries()].map(([ns, entries]) => ({
      name: ns,
      keys: entries.size,
    })),
  }),

  // List keys in namespace
  "GET /ns/:namespace": async (params) => {
    const entries = getNamespace(params.namespace);
    const keys = [...entries.entries()].map(([key, entry]) => ({
      key,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
      size: JSON.stringify(entry.value).length,
    }));
    return { namespace: params.namespace, count: keys.length, keys };
  },

  // Get value
  "GET /ns/:namespace/:key": async (params) => {
    stats.totalGets++;
    const entries = getNamespace(params.namespace);
    const entry = entries.get(params.key);
    if (!entry) return { error: "Key not found", key: params.key };
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      entries.delete(params.key);
      stats.expiredKeys++;
      return { error: "Key expired", key: params.key };
    }
    return {
      key: params.key,
      value: entry.value,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
    };
  },

  // Set value
  "PUT /ns/:namespace/:key": async (params, req) => {
    stats.totalSets++;
    const body = await readBody(req);
    const entries = getNamespace(params.namespace);
    const now = new Date().toISOString();
    const existing = entries.get(params.key);

    // Check conditional update
    if (req.headers["x-if-absent"] === "true" && existing) {
      return { skipped: true, reason: "Key already exists", key: params.key };
    }
    if (req.headers["x-if-newer"] && existing) {
      const ifNewer = new Date(req.headers["x-if-newer"]);
      const existingUpdated = new Date(existing.updatedAt);
      if (existingUpdated > ifNewer) {
        return { skipped: true, reason: "Existing entry is newer", key: params.key };
      }
    }

    const valueSize = JSON.stringify(body).length;
    if (valueSize > MAX_VALUE_SIZE) {
      return { error: "Value too large", maxSize: MAX_VALUE_SIZE, actualSize: valueSize };
    }

    const entry = {
      value: body,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: existing?.expiresAt || null,
    };

    entries.set(params.key, entry);
    scheduleSave();

    return { ok: true, key: params.key, updatedAt: now };
  },

  // Delete key
  "DELETE /ns/:namespace/:key": async (params) => {
    stats.totalDeletes++;
    const entries = getNamespace(params.namespace);
    const existed = entries.delete(params.key);
    if (entries.size === 0) store.delete(params.namespace);
    scheduleSave();
    return { ok: true, key: params.key, existed };
  },

  // Set TTL
  "POST /ns/:namespace/:key/ttl": async (params, req) => {
    const body = await readBody(req);
    const ttlSeconds = body.ttl;
    if (typeof ttlSeconds !== "number" || ttlSeconds < 0) {
      return { error: "Invalid TTL. Must be a positive number of seconds." };
    }
    const entries = getNamespace(params.namespace);
    const entry = entries.get(params.key);
    if (!entry) return { error: "Key not found", key: params.key };

    entry.expiresAt = ttlSeconds === 0 ? null : Date.now() + ttlSeconds * 1000;
    entry.updatedAt = new Date().toISOString();
    scheduleSave();

    return { ok: true, key: params.key, expiresAt: entry.expiresAt };
  },

  // Search keys by pattern
  "GET /ns/:namespace/search": async (params, query) => {
    stats.totalSearches++;
    const pattern = query.pattern || "*";
    const entries = getNamespace(params.namespace);
    const results = [];

    for (const [key, entry] of entries) {
      if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
      if (globMatch(pattern, key)) {
        results.push({
          key,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          expiresAt: entry.expiresAt,
          size: JSON.stringify(entry.value).length,
        });
      }
    }

    return { namespace: params.namespace, pattern, count: results.length, results };
  },

  // Backup
  "POST /backup": async (params, req) => {
    stats.totalBackups++;
    const body = await readBody(req);
    const backupFile = body.file || join(DATA_DIR, `backup-${Date.now()}.json`);

    const backup = {};
    for (const [ns, entries] of store) {
      backup[ns] = {};
      for (const [key, entry] of entries) {
        if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
        backup[ns][key] = entry;
      }
    }

    await writeFile(backupFile, JSON.stringify(backup, null, 2));
    return { ok: true, file: backupFile, namespaces: Object.keys(backup).length };
  },

  // Restore
  "POST /restore": async (params, req) => {
    stats.totalRestores++;
    const body = await readBody(req);
    const backupFile = body.file;
    if (!backupFile) return { error: "Missing 'file' in body" };

    const raw = await readFile(backupFile, "utf-8");
    const backup = JSON.parse(raw);
    let restored = 0;

    for (const [ns, data] of Object.entries(backup)) {
      const entries = getNamespace(ns);
      for (const [key, entry] of Object.entries(data)) {
        if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
        entries.set(key, entry);
        restored++;
      }
    }

    scheduleSave();
    return { ok: true, restored, namespaces: Object.keys(backup).length };
  },

  // Stats
  "GET /stats": async () => ({
    ...stats,
    namespaces: [...store.entries()].map(([ns, entries]) => ({
      name: ns,
      keys: entries.size,
      totalSize: [...entries.values()].reduce((s, e) => s + JSON.stringify(e.value).length, 0),
    })),
    totalKeys: [...store.values()].reduce((s, m) => s + m.size, 0),
  }),

  // Batch get — POST /ns/:namespace/_mget  body = { keys: [...] }
  "POST /ns/:namespace/_mget": async (params, req) => {
    const body = await readBody(req);
    const keys = body.keys;
    if (!Array.isArray(keys)) return { error: "Body must be { keys: string[] }" };

    const entries = getNamespace(params.namespace);
    const results = {};
    for (const key of keys) {
      stats.totalGets++;
      const entry = entries.get(key);
      if (!entry || (entry.expiresAt && Date.now() > entry.expiresAt)) {
        results[key] = null;
      } else {
        results[key] = entry.value;
      }
    }
    return { namespace: params.namespace, results };
  },

  // Batch set — PUT /ns/:namespace/_mset  body = { entries: [{key, value, ttl?}] }
  "PUT /ns/:namespace/_mset": async (params, req) => {
    const body = await readBody(req);
    const batchEntries = body.entries;
    if (!Array.isArray(batchEntries)) return { error: "Body must be { entries: [{key, value, ttl?}] }" };

    const entries = getNamespace(params.namespace);
    const now = new Date().toISOString();
    const results = [];

    for (const item of batchEntries) {
      stats.totalSets++;
      const { key, value, ttl } = item;
      if (!key || value === undefined) {
        results.push({ key, error: "Missing key or value" });
        continue;
      }
      const existing = entries.get(key);
      entries.set(key, {
        value,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        expiresAt: ttl ? Date.now() + ttl * 1000 : existing?.expiresAt || null,
      });
      results.push({ key, ok: true });
    }

    scheduleSave();
    return { namespace: params.namespace, count: results.length, results };
  },

  // Batch delete — POST /ns/:namespace/_mdelete  body = { keys: [...] }
  "POST /ns/:namespace/_mdelete": async (params, req) => {
    const body = await readBody(req);
    const keys = body.keys;
    if (!Array.isArray(keys)) return { error: "Body must be { keys: string[] }" };

    const entries = getNamespace(params.namespace);
    let deleted = 0;
    for (const key of keys) {
      stats.totalDeletes++;
      if (entries.delete(key)) deleted++;
    }
    if (entries.size === 0) store.delete(params.namespace);
    scheduleSave();
    return { namespace: params.namespace, deleted, total: keys.length };
  },
};

// ── Router ──────────────────────────────────────────────────────────

function matchRoute(method, pathname, query) {
  const routeKey = `${method} ${pathname}`;

  // Exact match
  if (routes[routeKey]) return { handler: routes[routeKey], params: {}, query };

  // Pattern match for :params
  for (const [pattern, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = pattern.split(" ");
    if (routeMethod !== method) continue;

    const patternParts = routePath.split("/").filter(Boolean);
    const pathParts = pathname.split("/").filter(Boolean);

    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    let match = true;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(":")) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (patternParts[i] !== pathParts[i]) {
        match = false;
        break;
      }
    }

    if (match) return { handler, params, query };
  }

  return null;
}

// ── Server ──────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    // Rate limiting
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const rl = rateLimits.check(clientIp);
    if (!rl.allowed) {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": String(rl.retryAfter),
      });
      return res.end(JSON.stringify({ error: "Rate limited", retryAfter: rl.retryAfter }));
    }

    const { pathname, query } = parseUrl(req);
    const route = matchRoute(req.method, pathname, query);

    if (!route) {
      // Serve simple HTML UI on root
      if (pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(getUI());
        return;
      }
      return json(res, 404, { error: "Not found", path: pathname });
    }

    const result = await route.handler(route.params, req, route.query);
    return json(res, 200, result);

  } catch (err) {
    console.error("❌ Request error:", err);
    return json(res, 500, { error: err.message });
  }
});

// ── Web UI ──────────────────────────────────────────────────────────

function getUI() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Agent Store</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; margin-bottom: 16px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .card h3 { color: #58a6ff; margin-bottom: 8px; }
  .stat { display: inline-block; margin-right: 24px; }
  .stat span { font-size: 24px; color: #3fb950; font-weight: bold; }
  .stat label { font-size: 12px; color: #8b949e; }
  pre { background: #0d1117; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 13px; }
  .ns-item { padding: 8px 0; border-bottom: 1px solid #21262d; }
  .ns-item:last-child { border: none; }
  code { color: #f0883e; }
  a { color: #58a6ff; text-decoration: none; }
</style></head><body>
<h1>🗄️ Agent Store</h1>
<div id="stats" class="card"><h3>Loading...</h3></div>
<div id="namespaces" class="card"><h3>Namespaces</h3></div>
<script>
async function refresh() {
  const [health, stats, ns] = await Promise.all([
    fetch('/health').then(r=>r.json()),
    fetch('/stats').then(r=>r.json()),
    fetch('/ns').then(r=>r.json()),
  ]);
  document.getElementById('stats').innerHTML = \`
    <h3>Server Stats</h3>
    <div class="stat"><span>\${health.totalKeys}</span><br><label>Keys</label></div>
    <div class="stat"><span>\${health.namespaces}</span><br><label>Namespaces</label></div>
    <div class="stat"><span>\${stats.totalGets}</span><br><label>Gets</label></div>
    <div class="stat"><span>\${stats.totalSets}</span><br><label>Sets</label></div>
    <div class="stat"><span>\${stats.expiredKeys}</span><br><label>Expired</label></div>
  \`;
  let html = '<h3>Namespaces</h3>';
  for (const n of ns.namespaces) {
    html += \`<div class="ns-item"><code>\${n.name}</code> — \${n.keys} keys — <a href="/ns/\${n.name}">Browse</a></div>\`;
  }
  document.getElementById('namespaces').innerHTML = html;
}
refresh(); setInterval(refresh, 5000);
</script></body></html>`;
}

// ── Startup ─────────────────────────────────────────────────────────

async function main() {
  await ensureDataDir();
  await loadFromDisk();

  // TTL check interval
  setInterval(checkExpired, TTL_CHECK_MS);

  // Auto-save interval (in case of no writes)
  setInterval(() => { if (dirty) saveToDisk(); }, AUTO_SAVE_MS * 2);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down...");
    await saveToDisk();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await saveToDisk();
    process.exit(0);
  });

  server.listen(PORT, () => {
    console.log(`\n🗄️  Agent Store running on http://localhost:${PORT}`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
    console.log(`📖 API docs: GET /health | /ns | /stats\n`);
  });
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
