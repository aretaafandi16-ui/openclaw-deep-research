/**
 * agent-queue — Zero-dependency message queue for AI agents
 *
 * Features:
 * - Topic-based pub/sub with wildcards (foo.*, foo.bar.**)
 * - At-least-once delivery with ack/nack
 * - Priority messages (low/normal/high/critical)
 * - Dead-letter queue for failed messages
 * - Message TTL with auto-expiry
 * - Consumer groups with round-robin distribution
 * - Request-reply pattern support
 * - Message replay from timestamp/offset
 * - Backpressure with configurable queue depth
 * - JSONL persistence + snapshots
 * - SSE endpoint for real-time streaming
 * - EventEmitter for monitoring
 */

import { EventEmitter } from 'events';
import { createReadStream, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

// ─── Helpers ─────────────────────────────────────────────────────

const PRIORITIES = { low: 0, normal: 1, high: 2, critical: 3 };

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ts() {
  return Date.now();
}

function matchesTopic(pattern, topic) {
  if (pattern === topic) return true;
  const patParts = pattern.split('.');
  const topParts = topic.split('.');
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i] === '**') return true;
    if (patParts[i] === '*') {
      if (i >= topParts.length) return false;
      continue;
    }
    if (patParts[i] !== topParts[i]) return false;
  }
  return patParts.length === topParts.length;
}

// ─── Message ─────────────────────────────────────────────────────

class Message {
  constructor({ topic, payload, priority = 'normal', ttl = 0, correlationId, replyTo, headers = {} }) {
    this.id = uid();
    this.topic = topic;
    this.payload = payload;
    this.priority = priority;
    this.priorityValue = PRIORITIES[priority] ?? 1;
    this.ttl = ttl; // ms, 0 = no expiry
    this.correlationId = correlationId || null;
    this.replyTo = replyTo || null;
    this.headers = headers;
    this.createdAt = ts();
    this.acknowledged = false;
    this.deliveredTo = []; // subscriber ids
    this.attempts = 0;
  }

  get expired() {
    return this.ttl > 0 && (ts() - this.createdAt) > this.ttl;
  }

  toJSON() {
    return {
      id: this.id, topic: this.topic, payload: this.payload,
      priority: this.priority, ttl: this.ttl,
      correlationId: this.correlationId, replyTo: this.replyTo,
      headers: this.headers, createdAt: this.createdAt,
      acknowledged: this.acknowledged, attempts: this.attempts
    };
  }

  static fromJSON(json) {
    const m = new Message({ topic: json.topic, payload: json.payload, priority: json.priority, ttl: json.ttl, correlationId: json.correlationId, replyTo: json.replyTo, headers: json.headers });
    m.id = json.id;
    m.createdAt = json.createdAt;
    m.acknowledged = json.acknowledged;
    m.attempts = json.attempts;
    return m;
  }
}

// ─── Subscriber ──────────────────────────────────────────────────

class Subscriber {
  constructor(id, pattern, options = {}) {
    this.id = id;
    this.pattern = pattern;
    this.group = options.group || null;
    this.maxInflight = options.maxInflight || 10;
    this.filter = options.filter || null; // function(msg) => bool
    this.handler = null; // set externally
    this.inflight = new Map(); // msgId => message
    this.acked = 0;
    this.nacked = 0;
    this.createdAt = ts();
  }

  canAccept() {
    return this.inflight.size < this.maxInflight;
  }
}

// ─── AgentQueue ──────────────────────────────────────────────────

class AgentQueue extends EventEmitter {
  constructor(config = {}) {
    super();
    this.id = config.id || 'agent-queue';
    this.maxDepth = config.maxDepth || 10000;
    this.defaultTTL = config.defaultTTL || 0;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.ackTimeout = config.ackTimeout || 30000; // auto-nack after 30s
    this.enablePersistence = config.enablePersistence !== false;
    this.dataDir = config.dataDir || join(process.cwd(), '.agent-queue-data');

    // Storage
    this.topics = new Map(); // topic => Message[]
    this.messages = new Map(); // msgId => Message
    this.subscribers = new Map(); // subId => Subscriber
    this.deadLetter = []; // failed messages
    this.offset = 0; // global sequence
    this.groups = new Map(); // groupName => lastConsumerIndex

    // Stats
    this.stats = { published: 0, delivered: 0, acked: 0, nacked: 0, deadLettered: 0, expired: 0, active: 0 };

    // Persistence
    if (this.enablePersistence) {
      if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
      this._jsonlPath = join(this.dataDir, 'queue.jsonl');
      this._snapshotPath = join(this.dataDir, 'snapshot.json');
      this._recover();
    }

    // Auto-expiry timer
    this._expiryTimer = setInterval(() => this._expireMessages(), 5000);
    // Ack timeout timer
    this._ackTimer = setInterval(() => this._checkAckTimeouts(), 10000);

    this.setMaxListeners(100);
  }

  // ── Publish ──────────────────────────────────────────────────

  publish(topic, payload, options = {}) {
    const msg = new Message({ topic, payload, priority: options.priority, ttl: options.ttl || this.defaultTTL, correlationId: options.correlationId, replyTo: options.replyTo, headers: options.headers });

    // Backpressure
    if (this.messages.size >= this.maxDepth) {
      this.emit('backpressure', { depth: this.messages.size, maxDepth: this.maxDepth });
      // Drop oldest normal-priority message
      for (const [id, m] of this.messages) {
        if (m.priorityValue <= 1 && !m.acknowledged) {
          this._removeMessage(id);
          this.emit('dropped', { reason: 'backpressure', message: m.toJSON() });
          break;
        }
      }
    }

    this.messages.set(msg.id, msg);
    this.offset++;

    // Topic bucket
    if (!this.topics.has(topic)) this.topics.set(topic, []);
    const bucket = this.topics.get(topic);

    // Insert by priority (higher first)
    let inserted = false;
    for (let i = 0; i < bucket.length; i++) {
      if (msg.priorityValue > bucket[i].priorityValue) {
        bucket.splice(i, 0, msg);
        inserted = true;
        break;
      }
    }
    if (!inserted) bucket.push(msg);

    this.stats.published++;
    this.stats.active++;

    // Persist
    this._persist({ type: 'publish', msg: msg.toJSON() });

    // Deliver to matching subscribers
    this._deliverMessage(msg);

    this.emit('published', msg.toJSON());
    return msg.toJSON();
  }

  request(topic, payload, options = {}) {
    const correlationId = uid();
    const replyTopic = `_reply.${correlationId}`;

    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 10000;
      const timer = setTimeout(() => {
        this.unsubscribe(subId);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      const subId = this.subscribe(replyTopic, (msg) => {
        clearTimeout(timer);
        this.unsubscribe(subId);
        resolve(msg);
      });

      this.publish(topic, payload, { ...options, correlationId, replyTo: replyTopic });
    });
  }

  reply(originalMsg, payload, options = {}) {
    if (!originalMsg.replyTo) throw new Error('No replyTo address on original message');
    this.publish(originalMsg.replyTo, payload, {
      correlationId: originalMsg.correlationId,
      priority: options.priority,
      ...options
    });
  }

  // ── Subscribe ────────────────────────────────────────────────

  subscribe(pattern, handler, options = {}) {
    const subId = options.id || `sub-${uid()}`;
    const sub = new Subscriber(subId, pattern, options);
    sub.handler = handler;
    this.subscribers.set(subId, sub);

    this._persist({ type: 'subscribe', sub: { id: subId, pattern, group: sub.group } });
    this.emit('subscribed', { id: subId, pattern, group: sub.group });

    // Deliver any pending matching messages
    this._deliverPending(sub);

    return subId;
  }

  unsubscribe(subId) {
    const sub = this.subscribers.get(subId);
    if (!sub) return false;

    // Return inflight messages to queue
    for (const [, msg] of sub.inflight) {
      msg.deliveredTo = msg.deliveredTo.filter(id => id !== subId);
    }
    sub.inflight.clear();

    this.subscribers.delete(subId);
    this._persist({ type: 'unsubscribe', subId });
    this.emit('unsubscribed', { id: subId });
    return true;
  }

  // ── Ack / Nack ───────────────────────────────────────────────

  ack(subId, msgId) {
    const sub = this.subscribers.get(subId);
    if (!sub) return false;

    const msg = sub.inflight.get(msgId);
    if (!msg) return false;

    sub.inflight.delete(msgId);
    msg.acknowledged = true;
    sub.acked++;
    this.stats.acked++;
    this.stats.active--;

    this._persist({ type: 'ack', subId, msgId });
    this.emit('acked', { subId, msgId });
    this._removeMessage(msgId);
    return true;
  }

  nack(subId, msgId, options = {}) {
    const sub = this.subscribers.get(subId);
    if (!sub) return false;

    const msg = sub.inflight.get(msgId);
    if (!msg) return false;

    sub.inflight.delete(msgId);
    sub.nacked++;
    this.stats.nacked++;

    const requeue = options.requeue !== false;

    if (requeue && msg.attempts < this.maxRetries) {
      msg.attempts++;
      setTimeout(() => {
        if (this.messages.has(msg.id)) {
          this._deliverMessage(msg);
        }
      }, this.retryDelay * msg.attempts);

      this._persist({ type: 'nack', subId, msgId, requeue: true });
      this.emit('nacked', { subId, msgId, requeue: true, attempt: msg.attempts });
    } else {
      // Dead-letter
      this._deadLetter(msg, options.reason || 'max_retries_exceeded');
      this._persist({ type: 'nack', subId, msgId, requeue: false, deadLettered: true });
      this.emit('nacked', { subId, msgId, requeue: false, deadLettered: true });
    }

    return true;
  }

  // ── Consumer Groups ──────────────────────────────────────────

  subscribeGroup(groupName, pattern, handler, options = {}) {
    if (!this.groups.has(groupName)) this.groups.set(groupName, { subscribers: [], index: 0 });
    const group = this.groups.get(groupName);

    const subId = this.subscribe(pattern, handler, { ...options, group: groupName });

    // Override delivery to round-robin within group
    const sub = this.subscribers.get(subId);
    group.subscribers.push(subId);

    return subId;
  }

  // ── Replay ───────────────────────────────────────────────────

  async replay(topic, handler, options = {}) {
    const since = options.since || 0; // timestamp
    const limit = options.limit || 100;
    const msgs = this.getMessages(topic, { since, limit, acknowledged: options.includeAcked !== false });

    for (const msg of msgs) {
      await handler(msg);
    }
    return msgs.length;
  }

  // ── Queries ──────────────────────────────────────────────────

  getMessages(topic, options = {}) {
    const since = options.since || 0;
    const limit = options.limit || 100;
    const includeAcked = options.includeAcked !== false;

    const bucket = this.topics.get(topic) || [];
    let msgs = bucket.filter(m => m.createdAt >= since);
    if (!includeAcked) msgs = msgs.filter(m => !m.acknowledged);
    return msgs.slice(0, limit).map(m => m.toJSON());
  }

  getTopics() {
    const result = [];
    for (const [topic, bucket] of this.topics) {
      const pending = bucket.filter(m => !m.acknowledged && !m.expired).length;
      result.push({ topic, pending, total: bucket.length, lastPublished: bucket.length > 0 ? bucket[bucket.length - 1].createdAt : 0 });
    }
    return result.sort((a, b) => b.lastPublished - a.lastPublished);
  }

  getSubscribers() {
    const result = [];
    for (const [id, sub] of this.subscribers) {
      result.push({ id, pattern: sub.pattern, group: sub.group, inflight: sub.inflight.size, acked: sub.acked, nacked: sub.nacked, maxInflight: sub.maxInflight });
    }
    return result;
  }

  getDeadLetter(options = {}) {
    const limit = options.limit || 50;
    return this.deadLetter.slice(-limit).map(m => (typeof m === 'object' ? m : { message: m }));
  }

  replayDeadLetter(msgId) {
    const idx = this.deadLetter.findIndex(m => (m.id || (typeof m === 'object' && m.message?.id)) === msgId);
    if (idx === -1) return null;
    const entry = this.deadLetter.splice(idx, 1)[0];
    const msgData = entry.message || entry;
    const msg = Message.fromJSON(msgData);
    msg.attempts = 0;
    this.messages.set(msg.id, msg);
    this._deliverMessage(msg);
    this.stats.deadLettered--;
    this.emit('dead_letter_replayed', msg.toJSON());
    return msg.toJSON();
  }

  purge(topic) {
    if (topic) {
      const bucket = this.topics.get(topic);
      if (!bucket) return 0;
      const count = bucket.length;
      for (const msg of bucket) {
        this.messages.delete(msg.id);
      }
      this.topics.delete(topic);
      this.stats.active -= count;
      this._persist({ type: 'purge', topic, count });
      return count;
    } else {
      const count = this.messages.size;
      this.topics.clear();
      this.messages.clear();
      this.deadLetter.length = 0;
      this.stats.active = 0;
      this._persist({ type: 'purge_all', count });
      return count;
    }
  }

  snapshot() {
    if (!this.enablePersistence) return;
    const data = {
      id: this.id,
      offset: this.offset,
      stats: { ...this.stats },
      messages: [...this.messages.values()].map(m => m.toJSON()),
      deadLetter: this.deadLetter.slice(-500),
      timestamp: ts()
    };
    writeFileSync(this._snapshotPath, JSON.stringify(data));

    // Rewrite JSONL from snapshot point
    const lines = [];
    for (const msg of this.messages.values()) {
      lines.push(JSON.stringify({ type: 'publish', msg: msg.toJSON() }));
    }
    writeFileSync(this._jsonlPath, lines.join('\n') + '\n');
  }

  // ── Internal ─────────────────────────────────────────────────

  _deliverMessage(msg) {
    let delivered = false;

    // Group delivery pass first — round-robin within each group
    const groupMessages = new Map(); // group => [subId, ...]
    for (const [subId, sub] of this.subscribers) {
      if (sub.group && matchesTopic(sub.pattern, msg.topic) && sub.canAccept() && (!sub.filter || sub.filter(msg))) {
        if (!groupMessages.has(sub.group)) groupMessages.set(sub.group, []);
        groupMessages.get(sub.group).push(subId);
      }
    }

    for (const [groupName, subIds] of groupMessages) {
      const group = this.groups.get(groupName);
      if (!group) continue;
      const idx = group.index % subIds.length;
      group.index++;
      const chosenId = subIds[idx];
      const sub = this.subscribers.get(chosenId);
      if (!sub) continue;

      sub.inflight.set(msg.id, msg);
      msg.deliveredTo.push(chosenId);
      this.stats.delivered++;
      delivered = true;

      try {
        sub.handler(msg.toJSON(), {
          ack: () => this.ack(chosenId, msg.id),
          nack: (opts) => this.nack(chosenId, msg.id, opts)
        });
      } catch (err) {
        this.nack(chosenId, msg.id, { reason: `handler_error: ${err.message}` });
      }
    }

    // Non-group subscriber pass
    for (const [subId, sub] of this.subscribers) {
      if (sub.group) continue; // already handled
      if (!matchesTopic(sub.pattern, msg.topic)) continue;
      if (!sub.canAccept()) continue;
      if (sub.filter && !sub.filter(msg)) continue;

      sub.inflight.set(msg.id, msg);
      msg.deliveredTo.push(subId);
      this.stats.delivered++;
      delivered = true;

      try {
        sub.handler(msg.toJSON(), {
          ack: () => this.ack(subId, msg.id),
          nack: (opts) => this.nack(subId, msg.id, opts)
        });
      } catch (err) {
        this.nack(subId, msg.id, { reason: `handler_error: ${err.message}` });
      }
    }

    if (!delivered && !msg.acknowledged) {
      this.emit('undelivered', msg.toJSON());
    }
  }

  _deliverPending(sub) {
    for (const [topic, bucket] of this.topics) {
      if (!matchesTopic(sub.pattern, topic)) continue;
      for (const msg of bucket) {
        if (msg.acknowledged || msg.expired) continue;
        if (!sub.canAccept()) break;
        if (sub.inflight.has(msg.id)) continue;

        sub.inflight.set(msg.id, msg);
        msg.deliveredTo.push(sub.id);

        try {
          sub.handler(msg.toJSON(), {
            ack: () => this.ack(sub.id, msg.id),
            nack: (opts) => this.nack(sub.id, msg.id, opts)
          });
        } catch (err) {
          this.nack(sub.id, msg.id, { reason: `handler_error: ${err.message}` });
        }
      }
    }
  }

  _removeMessage(msgId) {
    const msg = this.messages.get(msgId);
    if (!msg) return;
    this.messages.delete(msgId);
    const bucket = this.topics.get(msg.topic);
    if (bucket) {
      const idx = bucket.indexOf(msg);
      if (idx !== -1) bucket.splice(idx, 1);
    }
  }

  _deadLetter(msg, reason) {
    this.deadLetter.push({
      id: msg.id, topic: msg.topic, payload: msg.payload,
      reason, attempts: msg.attempts, deadLetteredAt: ts(),
      message: msg.toJSON()
    });
    this.stats.deadLettered++;
    this.stats.active--;
    this._removeMessage(msg.id);
    this.emit('dead_lettered', { id: msg.id, topic: msg.topic, reason });
  }

  _expireMessages() {
    for (const [id, msg] of this.messages) {
      if (msg.expired && !msg.acknowledged) {
        this._removeMessage(id);
        this.stats.expired++;
        this.stats.active--;
        this.emit('expired', msg.toJSON());
      }
    }
  }

  _checkAckTimeouts() {
    const now = ts();
    for (const [, sub] of this.subscribers) {
      for (const [msgId, msg] of sub.inflight) {
        if (now - msg.createdAt > this.ackTimeout) {
          this.nack(sub.id, msgId, { reason: 'ack_timeout' });
        }
      }
    }
  }

  _persist(entry) {
    if (!this.enablePersistence) return;
    try {
      const line = JSON.stringify(entry) + '\n';
      writeFileSync(this._jsonlPath, line, { flag: 'a' });
    } catch {}
  }

  _recover() {
    if (!existsSync(this._snapshotPath)) return;
    try {
      const snap = JSON.parse(readFileSync(this._snapshotPath, 'utf8'));
      this.id = snap.id;
      this.offset = snap.offset;
      this.stats = { ...this.stats, ...snap.stats };
      this.stats.active = 0;

      for (const msgData of snap.messages || []) {
        const msg = Message.fromJSON(msgData);
        this.messages.set(msg.id, msg);
        if (!this.topics.has(msg.topic)) this.topics.set(msg.topic, []);
        this.topics.get(msg.topic).push(msg);
        this.stats.active++;
      }

      for (const dl of snap.deadLetter || []) {
        this.deadLetter.push(dl);
      }
    } catch {}
  }

  destroy() {
    clearInterval(this._expiryTimer);
    clearInterval(this._ackTimer);
    this.snapshot();
    this.removeAllListeners();
  }
}

export { AgentQueue, Message, Subscriber, matchesTopic, PRIORITIES };
export default AgentQueue;
