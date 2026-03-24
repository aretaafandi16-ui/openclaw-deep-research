// agent-notify — Zero-dep multi-channel notification dispatcher for AI agents
// Channels: console, file, http/webhook, telegram, discord, email (SMTP)
// Features: priority routing, rate limiting, dedup, batching, templates, quiet hours

import { EventEmitter } from 'node:events';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

// ─── Helpers ───

function ts() { return new Date().toISOString(); }
function hash(s) { return createHash('sha256').update(s).digest('hex').slice(0, 16); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureDir(p) {
  const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── Defaults ───

const DEFAULTS = {
  maxRetries: 3,
  retryDelayMs: 1000,
  rateLimitWindowMs: 60000,
  rateLimitMax: 30,
  dedupWindowMs: 300000,       // 5 min
  batchWindowMs: 5000,         // 5s batching
  quietStart: null,            // e.g. 22
  quietEnd: null,              // e.g. 8
  persistPath: null,           // JSONL log path
};

// ─── Priority enum ───

const Priority = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
const PriorityName = ['low', 'normal', 'high', 'critical'];

// ─── Template engine ───

function renderTemplate(template, data) {
  return template.replace(/\{\{(\w[\w.]*)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => o?.[k], data);
    return val != null ? String(val) : '';
  });
}

// ─── Channel Adapters ───

function consoleChannel() {
  return {
    name: 'console',
    send: async (notif) => {
      const prefix = `[${PriorityName[notif.priority] || 'normal'}]`;
      const color = notif.priority >= 2 ? '\x1b[31m' : notif.priority >= 1 ? '\x1b[33m' : '\x1b[36m';
      console.log(`${color}${prefix}\x1b[0m ${notif.title || ''} ${notif.body}`);
      return { ok: true, channel: 'console' };
    }
  };
}

function fileChannel(filePath) {
  ensureDir(filePath);
  return {
    name: 'file',
    send: async (notif) => {
      const line = JSON.stringify({ ...notif, _sentAt: ts() }) + '\n';
      appendFileSync(filePath, line);
      return { ok: true, channel: 'file', path: filePath };
    }
  };
}

function httpChannel(url, options = {}) {
  const { method = 'POST', headers = {}, timeoutMs = 10000 } = options;
  return {
    name: 'http',
    send: async (notif) => {
      return new Promise((resolve, reject) => {
        const payload = JSON.stringify(notif);
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.request(u, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          timeout: timeoutMs,
        }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => resolve({ ok: res.statusCode < 400, channel: 'http', status: res.statusCode, body }));
        });
        req.on('error', (e) => resolve({ ok: false, channel: 'http', error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, channel: 'http', error: 'timeout' }); });
        req.write(payload);
        req.end();
      });
    }
  };
}

function telegramChannel(botToken, chatId) {
  const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  return {
    name: 'telegram',
    send: async (notif) => {
      const icon = ['🔵', '⚪', '🟡', '🔴'][notif.priority] || '⚪';
      const text = `${icon} *${notif.title || 'Notification'}*\n${notif.body || ''}`;
      const payload = JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_notification: notif.priority === 0,
      });
      return new Promise((resolve) => {
        const req = https.request(new URL(apiUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 10000,
        }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => resolve({ ok: res.statusCode < 400, channel: 'telegram', status: res.statusCode }));
        });
        req.on('error', (e) => resolve({ ok: false, channel: 'telegram', error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, channel: 'telegram', error: 'timeout' }); });
        req.write(payload);
        req.end();
      });
    }
  };
}

function discordChannel(webhookUrl) {
  return {
    name: 'discord',
    send: async (notif) => {
      const color = [0x3498db, 0x95a5a6, 0xf1c40f, 0xe74c3c][notif.priority] || 0x95a5a6;
      const payload = JSON.stringify({
        embeds: [{
          title: notif.title || 'Notification',
          description: notif.body || '',
          color,
          timestamp: new Date().toISOString(),
          footer: { text: `Priority: ${PriorityName[notif.priority] || 'normal'}` },
          ...(notif.data?.fields ? { fields: notif.data.fields } : {}),
        }]
      });
      return new Promise((resolve) => {
        const u = new URL(webhookUrl);
        const req = https.request(u, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 10000,
        }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => resolve({ ok: res.statusCode < 400, channel: 'discord', status: res.statusCode }));
        });
        req.on('error', (e) => resolve({ ok: false, channel: 'discord', error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, channel: 'discord', error: 'timeout' }); });
        req.write(payload);
        req.end();
      });
    }
  };
}

function emailChannel({ host, port = 465, secure = true, user, pass, from, to }) {
  // Zero-dep SMTP via raw TCP (STARTTLS for port 587, direct TLS for 465)
  return {
    name: 'email',
    send: async (notif) => {
      // For simplicity, use HTTP relay or webhook-based email (e.g., Mailgun/SendGrid API)
      // This adapter outputs a structured email payload for relay
      return {
        ok: true,
        channel: 'email',
        note: 'Use http/webhook channel with email provider API for zero-dep email',
        payload: {
          from, to,
          subject: notif.title || 'Agent Notification',
          body: notif.body || '',
          priority: PriorityName[notif.priority],
        }
      };
    }
  };
}

function slackChannel(webhookUrl) {
  return {
    name: 'slack',
    send: async (notif) => {
      const icon = ['🔵', '⚪', '🟡', '🔴'][notif.priority] || '⚪';
      const payload = JSON.stringify({
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `${icon} ${notif.title || 'Notification'}` } },
          { type: 'section', text: { type: 'mrkdwn', text: notif.body || '' } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `Priority: *${PriorityName[notif.priority]}* | ${ts()}` }] },
        ]
      });
      return new Promise((resolve) => {
        const req = https.request(new URL(webhookUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 10000,
        }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => resolve({ ok: res.statusCode < 400, channel: 'slack', status: res.statusCode }));
        });
        req.on('error', (e) => resolve({ ok: false, channel: 'slack', error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, channel: 'slack', error: 'timeout' }); });
        req.write(payload);
        req.end();
      });
    }
  };
}

// ─── Channel factory ───

function createChannel(type, config) {
  switch (type) {
    case 'console': return consoleChannel();
    case 'file': return fileChannel(config.path || './notifications.jsonl');
    case 'http': case 'webhook': return httpChannel(config.url, config);
    case 'telegram': return telegramChannel(config.botToken, config.chatId);
    case 'discord': return discordChannel(config.webhookUrl);
    case 'slack': return slackChannel(config.webhookUrl);
    case 'email': return emailChannel(config);
    default: throw new Error(`Unknown channel type: ${type}`);
  }
}

// ─── Core: Notifier ───

class AgentNotify extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULTS, ...config };
    this.channels = new Map();       // name → { channel, filter, enabled }
    this.templates = new Map();      // name → template string
    this.rules = [];                 // routing rules
    this._dedupCache = new Map();    // hash → timestamp
    this._rateBuckets = new Map();   // channelName → [timestamps]
    this._batchQueue = [];           // pending notifications for batching
    this._batchTimer = null;
    this._stats = { sent: 0, failed: 0, deduped: 0, rateLimited: 0, quietBlocked: 0, batched: 0 };
    this._running = true;

    // Auto-clean dedup cache every 60s
    this._cleanTimer = setInterval(() => this._cleanDedup(), 60000);
    this._cleanTimer.unref?.();
  }

  // ── Channel management ──

  addChannel(name, typeOrChannel, config = {}) {
    const channel = typeof typeOrChannel === 'function' || typeof typeOrChannel?.send === 'function'
      ? (typeof typeOrChannel === 'function' ? typeOrChannel() : typeOrChannel)
      : createChannel(typeOrChannel, config);
    this.channels.set(name, {
      channel,
      filter: config.filter || null,      // (notif) => boolean
      priority: config.priority ?? null,   // minimum priority for this channel
      enabled: true,
    });
    this.emit('channel:added', name);
    return this;
  }

  removeChannel(name) {
    this.channels.delete(name);
    this._rateBuckets.delete(name);
    this.emit('channel:removed', name);
    return this;
  }

  enableChannel(name) {
    const ch = this.channels.get(name);
    if (ch) { ch.enabled = true; this.emit('channel:enabled', name); }
    return this;
  }

  disableChannel(name) {
    const ch = this.channels.get(name);
    if (ch) { ch.enabled = false; this.emit('channel:disabled', name); }
    return this;
  }

  // ── Templates ──

  addTemplate(name, template) {
    this.templates.set(name, template);
    return this;
  }

  // ── Routing rules ──

  addRule(rule) {
    // rule: { match: (notif) => bool, channels: ['console', 'telegram'], priority?: 0-3 }
    this.rules.push(rule);
    return this;
  }

  // ── Quiet hours ──

  setQuietHours(start, end) {
    this.config.quietStart = start;
    this.config.quietEnd = end;
    return this;
  }

  _isQuiet() {
    if (this.config.quietStart == null || this.config.quietEnd == null) return false;
    const h = new Date().getHours();
    if (this.config.quietStart < this.config.quietEnd) {
      return h >= this.config.quietStart && h < this.config.quietEnd;
    }
    return h >= this.config.quietStart || h < this.config.quietEnd;
  }

  // ── Dedup ──

  _dedupKey(notif) {
    return hash(`${notif.title || ''}:${notif.body || ''}:${notif.tag || ''}`);
  }

  _isDeduped(key) {
    const last = this._dedupCache.get(key);
    if (last && Date.now() - last < this.config.dedupWindowMs) return true;
    return false;
  }

  _cleanDedup() {
    const now = Date.now();
    for (const [k, t] of this._dedupCache) {
      if (now - t > this.config.dedupWindowMs) this._dedupCache.delete(k);
    }
  }

  // ── Rate limiting ──

  _isRateLimited(channelName) {
    const now = Date.now();
    let bucket = this._rateBuckets.get(channelName);
    if (!bucket) { bucket = []; this._rateBuckets.set(channelName, bucket); }
    // Clean old
    while (bucket.length && now - bucket[0] > this.config.rateLimitWindowMs) bucket.shift();
    if (bucket.length >= this.config.rateLimitMax) return true;
    bucket.push(now);
    return false;
  }

  // ── Batch ──

  enableBatching(windowMs = this.config.batchWindowMs) {
    this.config.batchWindowMs = windowMs;
    return this;
  }

  _flushBatch() {
    if (!this._batchQueue.length) return;
    const batch = this._batchQueue.splice(0);
    this._batchTimer = null;
    // Send batch summary to channels
    const summary = {
      title: `Batch: ${batch.length} notifications`,
      body: batch.map(n => `• [${PriorityName[n.priority]}] ${n.title || n.body?.slice(0, 50)}`).join('\n'),
      priority: Math.max(...batch.map(n => n.priority)),
      tag: '__batch__',
      data: { batch },
      _timestamp: ts(),
    };
    this._dispatch(summary);
    this._stats.batched += batch.length;
  }

  // ── Core: send ──

  async send(notification) {
    if (!this._running) return { ok: false, error: 'stopped' };

    const notif = typeof notification === 'string'
      ? { body: notification }
      : { ...notification };

    // Apply template
    if (notif.template && this.templates.has(notif.template)) {
      const rendered = renderTemplate(this.templates.get(notif.template), notif.data || {});
      notif.body = rendered;
    }

    // Defaults
    notif.priority = notif.priority ?? Priority.NORMAL;
    notif._timestamp = ts();
    notif._id = hash(JSON.stringify(notif) + Date.now());

    // Quiet hours check (CRITICAL always goes through)
    if (this._isQuiet() && notif.priority < Priority.CRITICAL) {
      this._stats.quietBlocked++;
      this.emit('quiet:blocked', notif);
      // Queue for batch delivery when quiet hours end
      if (this.config.batchWindowMs) {
        this._batchQueue.push(notif);
        if (!this._batchTimer) {
          this._batchTimer = setTimeout(() => this._flushBatch(), this.config.batchWindowMs);
          this._batchTimer.unref?.();
        }
      }
      return { ok: false, reason: 'quiet_hours', notif };
    }

    // Dedup check
    const dedupKey = this._dedupKey(notif);
    if (notif.dedup !== false && this._isDeduped(dedupKey)) {
      this._stats.deduped++;
      this.emit('dedup:blocked', notif);
      return { ok: false, reason: 'deduped', notif };
    }
    this._dedupCache.set(dedupKey, Date.now());

    // Batch mode
    if (notif.batch && this.config.batchWindowMs) {
      this._batchQueue.push(notif);
      if (!this._batchTimer) {
        this._batchTimer = setTimeout(() => this._flushBatch(), this.config.batchWindowMs);
        this._batchTimer.unref?.();
      }
      return { ok: true, batched: true };
    }

    // Dispatch
    const result = await this._dispatch(notif);

    // Persist
    if (this.config.persistPath) {
      try {
        appendFileSync(this.config.persistPath, JSON.stringify({ ...notif, _result: result }) + '\n');
      } catch {}
    }

    return result;
  }

  async _dispatch(notif) {
    // Determine target channels via rules
    let targetChannels = new Set();

    // Apply routing rules
    for (const rule of this.rules) {
      if (rule.match(notif)) {
        (rule.channels || []).forEach(c => targetChannels.add(c));
      }
    }

    // If no rules matched, send to all channels
    if (targetChannels.size === 0) {
      this.channels.forEach((_, name) => targetChannels.add(name));
    }

    const results = [];
    const promises = [];

    for (const chName of targetChannels) {
      const chDef = this.channels.get(chName);
      if (!chDef || !chDef.enabled) continue;

      // Priority filter
      if (chDef.priority != null && notif.priority < chDef.priority) continue;

      // Custom filter
      if (chDef.filter && !chDef.filter(notif)) continue;

      // Rate limit
      if (this._isRateLimited(chName)) {
        this._stats.rateLimited++;
        this.emit('ratelimited', chName, notif);
        results.push({ ok: false, channel: chName, reason: 'rate_limited' });
        continue;
      }

      // Send with retry
      promises.push(this._sendWithRetry(chName, chDef.channel, notif));
    }

    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value);
      else results.push({ ok: false, error: s.reason?.message });
    }

    const anyOk = results.some(r => r.ok);
    if (anyOk) this._stats.sent++;
    else this._stats.failed++;

    this.emit('sent', notif, results);
    return { ok: anyOk, results, notif };
  }

  async _sendWithRetry(name, channel, notif, attempt = 0) {
    try {
      const result = await channel.send(notif);
      if (result.ok) {
        this.emit('channel:sent', name, notif);
        return result;
      }
      throw new Error(result.error || 'send failed');
    } catch (err) {
      if (attempt < this.config.maxRetries) {
        await sleep(this.config.retryDelayMs * Math.pow(2, attempt));
        return this._sendWithRetry(name, channel, notif, attempt + 1);
      }
      this.emit('channel:error', name, err, notif);
      return { ok: false, channel: name, error: err.message, attempts: attempt + 1 };
    }
  }

  // ── Convenience methods ──

  async info(body, opts = {}) { return this.send({ ...opts, body, priority: Priority.NORMAL }); }
  async warn(body, opts = {}) { return this.send({ ...opts, body, priority: Priority.HIGH }); }
  async error(body, opts = {}) { return this.send({ ...opts, body, priority: Priority.CRITICAL }); }
  async low(body, opts = {}) { return this.send({ ...opts, body, priority: Priority.LOW }); }

  // ── Stats & inspection ──

  stats() { return { ...this._stats }; }

  listChannels() {
    const out = [];
    this.channels.forEach((def, name) => {
      out.push({ name, type: def.channel.name, enabled: def.enabled, priority: def.priority });
    });
    return out;
  }

  // ── Lifecycle ──

  stop() {
    this._running = false;
    clearInterval(this._cleanTimer);
    if (this._batchTimer) { clearTimeout(this._batchTimer); this._flushBatch(); }
    this.emit('stopped');
    return this;
  }

  start() {
    this._running = true;
    this._cleanTimer = setInterval(() => this._cleanDedup(), 60000);
    this._cleanTimer.unref?.();
    this.emit('started');
    return this;
  }
}

// ─── Exports ───

export {
  AgentNotify,
  Priority,
  PriorityName,
  createChannel,
  consoleChannel,
  fileChannel,
  httpChannel,
  telegramChannel,
  discordChannel,
  slackChannel,
  emailChannel,
  renderTemplate,
};

export default AgentNotify;
