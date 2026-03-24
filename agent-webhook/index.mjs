#!/usr/bin/env node
/**
 * agent-webhook — Zero-dep webhook dispatcher for AI agents
 * 
 * Receive inbound HTTP webhooks, route/filter/transform them,
 * and deliver to agent handlers with retry, dedup, and signing.
 */

import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── Helpers ────────────────────────────────────────────────

function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [...b].map((v, i) => 
    [4, 6, 8, 10].includes(i) ? `-${v.toString(16).padStart(2, '0')}` : v.toString(16).padStart(2, '0')
  ).join('');
}

function now() { return Date.now(); }

function jsonPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// ─── Signature Verification ─────────────────────────────────

function verifySignature(payload, signature, secret, algorithm = 'sha256') {
  if (!signature || !secret) return !secret; // no secret = skip
  // Support common formats: sha256=xxx, xxx (raw hex)
  const parts = signature.includes('=') ? signature.split('=') : [algorithm, signature];
  const algo = parts[0];
  const sig = parts[1] || parts[0];
  const expected = createHmac(algo, secret).update(payload).digest('hex');
  // Constant-time comparison
  if (sig.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < sig.length; i++) result |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return result === 0;
}

// ─── Webhook Event ──────────────────────────────────────────

/**
 * @typedef {Object} WebhookEvent
 * @property {string} id - Unique event ID
 * @property {string} source - Source name (github, stripe, custom, etc.)
 * @property {string} path - HTTP path received on
 * @property {string} method - HTTP method
 * @property {Object} headers - Request headers
 * @property {*} body - Parsed body
 * @property {string} rawBody - Raw body string
 * @property {number} timestamp - When received
 * @property {string} [eventType] - Extracted event type (from header or body)
 * @property {Object} [metadata] - Extracted metadata
 */

// ─── Route Matcher ──────────────────────────────────────────

class RouteMatcher {
  constructor() {
    this.routes = []; // { pattern, handler, options }
  }

  add(pattern, handler, options = {}) {
    this.routes.push({ pattern: this._compile(pattern), handler, options, raw: pattern });
    return this;
  }

  match(event) {
    const matched = [];
    for (const route of this.routes) {
      if (route.pattern(event)) matched.push(route);
    }
    return matched;
  }

  _compile(pattern) {
    if (typeof pattern === 'function') return pattern;
    if (pattern instanceof RegExp) return (e) => pattern.test(e.path);

    // Object matching: { source: 'github', eventType: 'push' }
    if (typeof pattern === 'object') {
      return (e) => {
        for (const [key, val] of Object.entries(pattern)) {
          if (val instanceof RegExp) {
            if (!val.test(e[key] ?? e.metadata?.[key])) return false;
          } else if (typeof val === 'string') {
            const ev = e[key] ?? e.metadata?.[key];
            if (ev !== val && !val.split(',').map(s=>s.trim()).includes(ev)) return false;
          } else if (typeof val === 'function') {
            if (!val(e[key] ?? e.metadata?.[key])) return false;
          }
        }
        return true;
      };
    }

    // String: exact path match or wildcard
    if (typeof pattern === 'string') {
      if (pattern.includes('*')) {
        const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return (e) => re.test(e.path);
      }
      return (e) => e.path === pattern;
    }

    return () => false;
  }
}

// ─── Transform Engine ───────────────────────────────────────

function transform(event, transforms) {
  let result = deepClone(event);
  for (const t of transforms) {
    switch (t.type) {
      case 'pick':
        result = t.fields.reduce((o, f) => { if (result[f] !== undefined) o[f] = result[f]; return o; }, {});
        break;
      case 'flatten':
        result = _flatten(result);
        break;
      case 'rename':
        for (const [from, to] of Object.entries(t.map || {})) {
          if (result[from] !== undefined) { result[to] = result[from]; delete result[from]; }
        }
        break;
      case 'extract':
        result = t.paths.reduce((o, p) => { const v = jsonPath(event, p); if (v !== undefined) o[p.replace(/\./g, '_')] = v; return o; }, {});
        break;
      case 'map':
        if (typeof t.fn === 'function') result = t.fn(result);
        break;
      case 'add':
        Object.assign(result, t.fields || {});
        break;
      case 'template':
        result = _template(t.format, event);
        break;
    }
  }
  return result;
}

function _flatten(obj, prefix = '', res = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) _flatten(v, key, res);
    else res[key] = v;
  }
  return res;
}

function _template(fmt, data) {
  return fmt.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const v = jsonPath(data, path.trim());
    return v !== undefined ? JSON.stringify(v) : '';
  });
}

// ─── Deduplication ──────────────────────────────────────────

class Deduper {
  constructor(ttlMs = 300000) { // 5 min default
    this.seen = new Map();
    this.ttl = ttlMs;
  }

  isDuplicate(key) {
    this._cleanup();
    if (this.seen.has(key)) return true;
    this.seen.set(key, now());
    return false;
  }

  _cleanup() {
    const cutoff = now() - this.ttl;
    for (const [k, t] of this.seen) {
      if (t < cutoff) this.seen.delete(k);
    }
  }

  get size() { return this.seen.size; }
}

// ─── Retry Queue ────────────────────────────────────────────

class RetryQueue {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.queue = []; // { event, handler, attempt, nextRetry }
    this.processing = false;
  }

  enqueue(event, handler, attempt = 1) {
    if (attempt > this.maxRetries) return false;
    const delay = this.baseDelay * Math.pow(2, attempt - 1);
    this.queue.push({ event, handler, attempt, nextRetry: now() + delay });
    return true;
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    const ready = this.queue.filter(q => q.nextRetry <= now());
    this.queue = this.queue.filter(q => q.nextRetry > now());

    for (const item of ready) {
      try {
        await item.handler(item.event);
      } catch (err) {
        if (item.attempt < this.maxRetries) {
          this.enqueue(item.event, item.handler, item.attempt + 1);
        }
      }
    }
    this.processing = false;
  }

  get size() { return this.queue.length; }
  get pending() { return this.queue.filter(q => q.nextRetry <= now()).length; }
}

// ─── Source Presets ─────────────────────────────────────────

const SOURCES = {
  github: {
    detect: (headers) => !!headers['x-github-event'],
    eventType: (headers) => headers['x-github-event'],
    signature: { header: 'x-hub-signature-256', algorithm: 'sha256' },
    dedupKey: (e) => e.headers['x-github-delivery'] || e.id,
  },
  stripe: {
    detect: (headers) => !!headers['stripe-signature'],
    eventType: (headers, body) => body?.type,
    signature: { header: 'stripe-signature', parse: (v) => { const m = v.match(/v1=([^,]+)/); return m ? `sha256=${m[1]}` : null; } },
    dedupKey: (e) => e.body?.id || e.id,
  },
  slack: {
    detect: (headers) => headers['x-slack-signature'],
    eventType: (headers, body) => body?.type || body?.event?.type,
    signature: { header: 'x-slack-signature', version: 'v0' },
    dedupKey: (e) => e.body?.event_id || e.id,
  },
  shopify: {
    detect: (headers) => !!headers['x-shopify-topic'],
    eventType: (headers) => headers['x-shopify-topic'],
    signature: { header: 'x-shopify-hmac-sha256', algorithm: 'sha256' },
    dedupKey: (e) => e.headers['x-shopify-webhook-id'] || e.id,
  },
  discord: {
    detect: (headers) => headers['x-signature-ed25519'],
    eventType: (headers, body) => body?.type === 1 ? 'ping' : `interaction_${body?.type}`,
    dedupKey: (e) => e.id,
  },
  generic: {
    detect: () => true,
    eventType: (headers, body) => headers['x-event-type'] || body?.event || body?.type || 'unknown',
    dedupKey: (e) => e.id,
  }
};

// ─── Main Dispatcher ────────────────────────────────────────

export class WebhookDispatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      port: options.port || 3107,
      host: options.host || '0.0.0.0',
      maxBodySize: options.maxBodySize || 10 * 1024 * 1024, // 10MB
      dedupTtl: options.dedupTtl || 300000,
      persistDir: options.persistDir || null,
      secrets: options.secrets || {}, // { sourceName: 'secret' }
      ...options,
    };

    this.matcher = new RouteMatcher();
    this.deduper = new Deduper(this.options.dedupTtl);
    this.retryQueue = new RetryQueue(options.retry);
    this.sources = { ...SOURCES, ...(options.sources || {}) };
    this.stats = { received: 0, delivered: 0, failed: 0, deduped: 0, retries: 0, bySource: {}, byPath: {} };
    this.handlers = new Map(); // id -> { pattern, handler, options }
    this.server = null;
    this._retryTimer = null;
    this._logDir = this.options.persistDir;
    if (this._logDir && !existsSync(this._logDir)) mkdirSync(this._logDir, { recursive: true });
  }

  // ── Registration ──

  on(pattern, handler, options = {}) {
    const id = uuid();
    this.matcher.add(pattern, handler, options);
    this.handlers.set(id, { pattern: typeof pattern === 'object' ? pattern : String(pattern), handler, options, id });
    return id;
  }

  off(id) {
    // Rebuild routes without this handler
    const entry = this.handlers.get(id);
    if (!entry) return false;
    this.handlers.delete(id);
    this.matcher.routes = this.matcher.routes.filter(r => r.handler !== entry.handler);
    return true;
  }

  // ── Source Detection ──

  detectSource(headers) {
    for (const [name, preset] of Object.entries(this.sources)) {
      if (preset.detect(headers)) return name;
    }
    return 'generic';
  }

  extractEventType(source, headers, body) {
    const preset = this.sources[source] || this.sources.generic;
    return preset.eventType(headers, body);
  }

  // ── Signature Verification ──

  verifySignature(source, headers, rawBody) {
    const secret = this.options.secrets[source];
    if (!secret) return true; // no secret = pass

    const preset = this.sources[source];
    if (!preset?.signature) return true;

    const sigHeader = headers[preset.signature.header];
    if (!sigHeader) return false;

    let sig = sigHeader;
    if (preset.signature.parse) sig = preset.signature.parse(sigHeader);
    if (!sig) return false;

    let payload = rawBody;
    if (preset.signature.version === 'v0') {
      // Slack: version:timestamp:body
      const ts = headers['x-slack-request-timestamp'];
      if (ts) payload = `${preset.signature.version}:${ts}:${rawBody}`;
    }

    return verifySignature(payload, sig, secret, preset.signature.algorithm || 'sha256');
  }

  // ── Dedup Key ──

  getDedupKey(event) {
    const preset = this.sources[event.source];
    if (preset?.dedupKey) return preset.dedupKey(event);
    // Fallback: hash of path + body
    const bodyStr = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
    return `${event.source}:${event.path}:${bodyStr.slice(0, 200)}`;
  }

  // ── Persistence ──

  _persistEvent(event) {
    if (!this._logDir) return;
    const date = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify({ id: event.id, source: event.source, path: event.path, eventType: event.eventType, timestamp: event.timestamp });
    appendFileSync(join(this._logDir, `events-${date}.jsonl`), line + '\n');
  }

  _persistDelivery(eventId, handlerId, status, error) {
    if (!this._logDir) return;
    const date = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify({ eventId, handlerId, status, error: error?.message, timestamp: now() });
    appendFileSync(join(this._logDir, `deliveries-${date}.jsonl`), line + '\n');
  }

  // ── Core Dispatch ──

  async dispatch(event) {
    this.stats.received++;
    this.stats.bySource[event.source] = (this.stats.bySource[event.source] || 0) + 1;
    this.stats.byPath[event.path] = (this.stats.byPath[event.path] || 0) + 1;

    // Ensure metadata exists with source-specific fields
    if (!event.metadata || Object.keys(event.metadata).length === 0) {
      event.metadata = event.metadata || {};
      if (event.source === 'github') {
        event.metadata = { repo: event.body?.repository?.full_name, action: event.body?.action, sender: event.body?.sender?.login, ...event.metadata };
      } else if (event.source === 'stripe') {
        event.metadata = { stripeEventId: event.body?.id, livemode: event.body?.livemode, ...event.metadata };
      } else if (event.source === 'slack') {
        event.metadata = { teamId: event.body?.team_id, userId: event.body?.event?.user, ...event.metadata };
      } else if (event.source === 'shopify') {
        event.metadata = { shop: event.headers?.['x-shopify-shop-domain'], topic: event.headers?.['x-shopify-topic'], ...event.metadata };
      }
    }

    this.emit('received', event);
    this._persistEvent(event);

    // Dedup
    const dedupKey = this.getDedupKey(event);
    if (this.deduper.isDuplicate(dedupKey)) {
      this.stats.deduped++;
      this.emit('deduped', event);
      return { status: 'deduped', event };
    }

    // Signature check
    if (!this.verifySignature(event.source, event.headers, event.rawBody)) {
      this.stats.failed++;
      this.emit('signature_failed', event);
      return { status: 'signature_failed', event };
    }

    // Match routes
    const matches = this.matcher.match(event);
    if (matches.length === 0) {
      this.emit('unmatched', event);
      return { status: 'unmatched', event };
    }

    const results = [];
    for (const route of matches) {
      try {
        // Apply transforms if any
        let payload = event;
        if (route.options.transform) {
          payload = { ...event, body: transform(event.body, route.options.transform) };
        }

        await route.handler(payload);
        this.stats.delivered++;
        this.emit('delivered', { event: payload, route: route.raw });
        this._persistDelivery(event.id, route.options.id || 'unknown', 'delivered');
        results.push({ status: 'delivered', route: route.raw });
      } catch (err) {
        if (route.options.retry !== false) {
          this.retryQueue.enqueue(event, route.handler);
          this.stats.retries++;
          this.emit('retry_scheduled', { event, error: err });
          results.push({ status: 'retry', error: err.message });
        } else {
          this.stats.failed++;
          this.emit('delivery_failed', { event, error: err });
          this._persistDelivery(event.id, route.options.id || 'unknown', 'failed', err);
          results.push({ status: 'failed', error: err.message });
        }
      }
    }

    return { status: 'processed', matches: results.length, results };
  }

  // ── HTTP Server ──

  async start() {
    if (this.server) return this;

    this.server = createServer(async (req, res) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      // Health / stats endpoints
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', stats: this.stats, retryQueue: this.retryQueue.size, dedupCache: this.deduper.size }));
        return;
      }

      if (req.method === 'GET' && req.url === '/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...this.stats,
          handlers: this.handlers.size,
          retryQueue: { size: this.retryQueue.size, pending: this.retryQueue.pending },
        }));
        return;
      }

      if (req.method === 'GET' && req.url === '/handlers') {
        const list = [...this.handlers.values()].map(h => ({ id: h.id, pattern: h.pattern, options: { ...h.options, handler: undefined } }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
        return;
      }

      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this._dashboardHTML());
        return;
      }

      // Only accept POST for webhooks
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'POST required' }));
        return;
      }

      // Read body
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > this.options.maxBodySize) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Body too large' }));
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        res.writeHead(400); res.end(); return;
      }

      const rawBody = Buffer.concat(chunks).toString('utf8');
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const path = req.url.split('?')[0];

      // Detect source
      const source = this.detectSource(headers);

      // Parse body
      let body;
      const ct = headers['content-type'] || '';
      try {
        if (ct.includes('application/json')) body = JSON.parse(rawBody);
        else if (ct.includes('application/x-www-form-urlencoded')) {
          body = Object.fromEntries(new URLSearchParams(rawBody));
        } else body = rawBody;
      } catch { body = rawBody; }

      // Build event
      const event = {
        id: uuid(),
        source,
        path,
        method: req.method,
        headers,
        body,
        rawBody,
        timestamp: now(),
        eventType: this.extractEventType(source, headers, typeof body === 'object' ? body : {}),
        metadata: {},
        ip: req.socket.remoteAddress,
      };

      // Add source-specific metadata
      if (source === 'github') {
        event.metadata = { repo: body?.repository?.full_name, action: body?.action, sender: body?.sender?.login };
      } else if (source === 'stripe') {
        event.metadata = { stripeEventId: body?.id, livemode: body?.livemode };
      } else if (source === 'slack') {
        event.metadata = { teamId: body?.team_id, userId: body?.event?.user };
      }

      // Dispatch
      const result = await this.dispatch(event);

      const status = result.status === 'signature_failed' ? 401
        : result.status === 'deduped' ? 200
        : result.status === 'unmatched' ? 404
        : 200;

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });

    return new Promise((resolve, reject) => {
      this.server.listen(this.options.port, this.options.host, () => {
        // Start retry processor
        this._retryTimer = setInterval(() => this.retryQueue.process(), 2000);
        this.emit('listening', { port: this.options.port, host: this.options.host });
        resolve(this);
      });
      this.server.on('error', reject);
    });
  }

  async stop() {
    if (this._retryTimer) clearInterval(this._retryTimer);
    if (this.server) {
      return new Promise(resolve => this.server.close(() => resolve()));
    }
  }

  // ── Dashboard ──

  _dashboardHTML() {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-webhook</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center}
.card .num{font-size:28px;font-weight:bold;color:#58a6ff}
.card .label{font-size:12px;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #30363d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
code{background:#1f2937;padding:2px 6px;border-radius:4px;font-size:13px}
</style>
</head><body>
<h1>🐋 agent-webhook</h1>
<div class="cards">
  <div class="card"><div class="num" id="recv">0</div><div class="label">Received</div></div>
  <div class="card"><div class="num" id="del">0</div><div class="label">Delivered</div></div>
  <div class="card"><div class="num" id="fail">0</div><div class="label">Failed</div></div>
  <div class="card"><div class="num" id="dedup">0</div><div class="label">Deduped</div></div>
  <div class="card"><div class="num" id="retry">0</div><div class="label">Retries</div></div>
  <div class="card"><div class="num" id="handlers">0</div><div class="label">Handlers</div></div>
</div>
<h2>By Source</h2><table id="srcTable"><tr><th>Source</th><th>Count</th></tr></table>
<h2>By Path</h2><table id="pathTable"><tr><th>Path</th><th>Count</th></tr></table>
<h2>Registered Handlers</h2><table id="handlerTable"><tr><th>ID</th><th>Pattern</th></tr></table>
<script>
async function refresh(){
  const s=await fetch('/stats').then(r=>r.json());
  document.getElementById('recv').textContent=s.received;
  document.getElementById('del').textContent=s.delivered;
  document.getElementById('fail').textContent=s.failed;
  document.getElementById('dedup').textContent=s.deduped||0;
  document.getElementById('retry').textContent=s.retries||0;
  document.getElementById('handlers').textContent=s.handlers;
  let st='<tr><th>Source</th><th>Count</th></tr>';
  for(const[k,v]of Object.entries(s.bySource||{}))st+=\`<tr><td>\${k}</td><td>\${v}</td></tr>\`;
  document.getElementById('srcTable').innerHTML=st;
  let pt='<tr><th>Path</th><th>Count</th></tr>';
  for(const[k,v]of Object.entries(s.byPath||{}))pt+=\`<tr><td><code>\${k}</code></td><td>\${v}</td></tr>\`;
  document.getElementById('pathTable').innerHTML=pt;
  const h=await fetch('/handlers').then(r=>r.json());
  let ht='<tr><th>ID</th><th>Pattern</th></tr>';
  for(const x of h)ht+=\`<tr><td><code>\${x.id.slice(0,8)}</code></td><td><code>\${JSON.stringify(x.pattern)}</code></td></tr>\`;
  document.getElementById('handlerTable').innerHTML=ht;
}
refresh();setInterval(refresh,3000);
</script></body></html>`;
  }
}

// ─── Export ─────────────────────────────────────────────────

export default WebhookDispatcher;
export { RouteMatcher, Deduper, RetryQueue, verifySignature, transform, SOURCES };
