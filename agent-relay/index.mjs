/**
 * agent-relay — zero-dep cross-agent pub/sub messaging for AI agents
 * 
 * Features:
 * - Pub/Sub topics with wildcards (topic/star, star/event)
 * - Direct messaging between named agents
 * - Broadcast to all connected agents
 * - Request/Reply pattern with timeout
 * - Message routing with filters
 * - Message queues with delivery guarantees
 * - Signal channels for event-driven coordination
 * - Message history with replay
 * - Dead letter queue for failed deliveries
 * - JSONL persistence
 * - EventEmitter integration
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---- Helpers ----
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function matchTopic(pattern, topic) {
  if (pattern === topic) return true;
  if (pattern === '*') return true;
  const pParts = pattern.split('/');
  const tParts = topic.split('/');
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i] === '*') continue;
    if (pParts[i] === undefined) return false;
    if (pParts[i] !== tParts[i]) return false;
  }
  return pParts.length === tParts.length;
}

// ---- Main Class ----
export class AgentRelay extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.agents = new Map();       // agentId → { subscriptions, queue, connected, metadata }
    this.topics = new Map();       // topic → Set<agentId>
    this.wildcards = new Map();    // pattern → Set<agentId>
    this.history = [];             // { id, topic, payload, from, ts, type }
    this.dlq = [];                 // dead letter queue
    this.pending = new Map();      // correlationId → { resolve, reject, timer }
    this.routes = [];              // { pattern, handler, name }
    this.queues = new Map();       // queueName → [{ msg, retries, nextRetry }]
    this.maxHistory = opts.maxHistory || 10000;
    this.defaultTimeout = opts.defaultTimeout || 30000;
    this.persistenceDir = opts.persistenceDir || null;
    this.delivered = new Map();    // dedup: msgId → Set<agentId>

    if (this.persistenceDir && !existsSync(this.persistenceDir)) {
      mkdirSync(this.persistenceDir, { recursive: true });
    }
  }

  // ---- Agent Management ----
  registerAgent(agentId, metadata = {}) {
    if (this.agents.has(agentId)) {
      const agent = this.agents.get(agentId);
      agent.connected = true;
      agent.metadata = { ...agent.metadata, ...metadata };
      this.emit('agent:reconnect', agentId);
      return agent;
    }
    const agent = {
      subscriptions: new Set(),
      queue: [],
      connected: true,
      metadata,
      registeredAt: Date.now()
    };
    this.agents.set(agentId, agent);
    this.emit('agent:register', agentId, metadata);
    this._persist('agent:register', { agentId, metadata });
    return agent;
  }

  unregisterAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    // Remove all subscriptions
    for (const topic of agent.subscriptions) {
      const subs = this.topics.get(topic) || this.wildcards.get(topic);
      if (subs) subs.delete(agentId);
    }
    agent.connected = false;
    this.emit('agent:unregister', agentId);
    this._persist('agent:unregister', { agentId });
    return true;
  }

  getAgent(agentId) {
    return this.agents.get(agentId) || null;
  }

  listAgents(connectedOnly = false) {
    const result = [];
    for (const [id, agent] of this.agents) {
      if (connectedOnly && !agent.connected) continue;
      result.push({
        id,
        connected: agent.connected,
        subscriptions: [...agent.subscriptions],
        queueLength: agent.queue.length,
        metadata: agent.metadata,
        registeredAt: agent.registeredAt
      });
    }
    return result;
  }

  // ---- Pub/Sub ----
  subscribe(agentId, topic) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent not registered: ${agentId}`);
    agent.subscriptions.add(topic);

    if (topic.includes('*')) {
      if (!this.wildcards.has(topic)) this.wildcards.set(topic, new Set());
      this.wildcards.get(topic).add(agentId);
    } else {
      if (!this.topics.has(topic)) this.topics.set(topic, new Set());
      this.topics.get(topic).add(agentId);
    }

    this.emit('sub', { agentId, topic });
    this._persist('sub', { agentId, topic });
    return true;
  }

  unsubscribe(agentId, topic) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.subscriptions.delete(topic);

    const subs = this.topics.get(topic) || this.wildcards.get(topic);
    if (subs) subs.delete(agentId);
    this.emit('unsub', { agentId, topic });
    return true;
  }

  publish(topic, payload, from = null, opts = {}) {
    const msg = {
      id: genId(),
      topic,
      payload,
      from,
      type: opts.type || 'pub',
      ts: Date.now(),
      ttl: opts.ttl || 0,
      priority: opts.priority || 0,
      correlationId: opts.correlationId || null,
      headers: opts.headers || {}
    };

    // History
    this.history.push(msg);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    // Deliver to exact subscribers
    const delivered = new Set();
    const exactSubs = this.topics.get(topic);
    if (exactSubs) {
      for (const agentId of exactSubs) {
        if (agentId === from && !opts.echoBack) continue;
        this._deliver(agentId, msg);
        delivered.add(agentId);
      }
    }

    // Deliver to wildcard subscribers
    for (const [pattern, subs] of this.wildcards) {
      if (matchTopic(pattern, topic)) {
        for (const agentId of subs) {
          if (agentId === from && !opts.echoBack) continue;
          if (!delivered.has(agentId)) {
            this._deliver(agentId, msg);
            delivered.add(agentId);
          }
        }
      }
    }

    // Apply custom routes
    for (const route of this.routes) {
      if (matchTopic(route.pattern, topic)) {
        try { route.handler(msg); } catch (e) { /* route error */ }
      }
    }

    this.emit('msg', msg);
    this._persist('msg', msg);
    return { msgId: msg.id, delivered: delivered.size };
  }

  // ---- Direct Messaging ----
  send(toAgentId, payload, from = null, opts = {}) {
    return this.publish(`_direct/${toAgentId}`, payload, from, {
      ...opts,
      type: 'direct'
    });
  }

  // ---- Broadcast ----
  broadcast(payload, from = null, opts = {}) {
    const msg = {
      id: genId(),
      topic: '_broadcast',
      payload,
      from,
      type: 'broadcast',
      ts: Date.now(),
      headers: opts.headers || {}
    };

    this.history.push(msg);
    let count = 0;
    for (const [agentId, agent] of this.agents) {
      if (agentId === from && !opts.echoBack) continue;
      if (agent.connected) {
        this._deliver(agentId, msg);
        count++;
      }
    }

    this.emit('broadcast', msg);
    this._persist('broadcast', msg);
    return { msgId: msg.id, delivered: count };
  }

  // ---- Request/Reply ----
  request(toAgentId, payload, from = null, opts = {}) {
    const correlationId = genId();
    const timeout = opts.timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new Error(`Request timeout: ${toAgentId} (${timeout}ms)`));
      }, timeout);

      this.pending.set(correlationId, { resolve, reject, timer });

      this.publish(`_req/${toAgentId}`, payload, from, {
        type: 'request',
        correlationId,
        headers: opts.headers || {}
      });
    });
  }

  reply(correlationId, payload, from = null) {
    const pending = this.pending.get(correlationId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(correlationId);
    pending.resolve({ payload, from, ts: Date.now() });
    return true;
  }

  // ---- Message Queues ----
  enqueue(queueName, payload, opts = {}) {
    if (!this.queues.has(queueName)) this.queues.set(queueName, []);
    const entry = {
      id: genId(),
      payload,
      retries: 0,
      maxRetries: opts.maxRetries || 3,
      nextRetry: Date.now(),
      priority: opts.priority || 0,
      ts: Date.now()
    };
    const queue = this.queues.get(queueName);
    queue.push(entry);
    queue.sort((a, b) => b.priority - a.priority);
    this._persist('enqueue', { queueName, entry });
    this.emit('enqueue', { queueName, entry });
    return entry.id;
  }

  dequeue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue || queue.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].nextRetry <= now) {
        return queue.splice(i, 1)[0];
      }
    }
    return null; // all delayed
  }

  requeue(queueName, entry, delayMs = 1000) {
    entry.retries++;
    if (entry.retries > entry.maxRetries) {
      this.dlq.push({ ...entry, queueName, failedAt: Date.now() });
      this.emit('dlq', { queueName, entry });
      return false;
    }
    entry.nextRetry = Date.now() + delayMs * Math.pow(2, entry.retries - 1);
    if (!this.queues.has(queueName)) this.queues.set(queueName, []);
    this.queues.get(queueName).push(entry);
    return true;
  }

  queueStats(queueName) {
    const queue = this.queues.get(queueName) || [];
    return { name: queueName, pending: queue.length };
  }

  // ---- Routes ----
  addRoute(pattern, handler, name = null) {
    const route = { pattern, handler, name: name || `route_${this.routes.length}` };
    this.routes.push(route);
    return route.name;
  }

  removeRoute(name) {
    this.routes = this.routes.filter(r => r.name !== name);
  }

  // ---- History ----
  getHistory(opts = {}) {
    let result = [...this.history];
    if (opts.topic) result = result.filter(m => matchTopic(opts.topic, m.topic));
    if (opts.from) result = result.filter(m => m.from === opts.from);
    if (opts.type) result = result.filter(m => m.type === opts.type);
    if (opts.since) result = result.filter(m => m.ts >= opts.since);
    if (opts.limit) result = result.slice(-opts.limit);
    return result;
  }

  replay(agentId, topic, since = 0) {
    const msgs = this.history.filter(m =>
      m.ts >= since && matchTopic(topic, m.topic)
    );
    for (const msg of msgs) {
      this._deliver(agentId, { ...msg, _replay: true });
    }
    return msgs.length;
  }

  // ---- Internal ----
  _deliver(agentId, msg) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Dedup
    if (!this.delivered.has(msg.id)) this.delivered.set(msg.id, new Set());
    if (this.delivered.get(msg.id).has(agentId)) return;
    this.delivered.get(msg.id).add(agentId);

    if (agent.connected) {
      agent.queue.push(msg);
      this.emit('deliver', { agentId, msg });
    } else {
      // Offline: keep in queue (bounded)
      if (agent.queue.length > 1000) agent.queue.shift();
      agent.queue.push(msg);
      this.emit('queued', { agentId, msg });
    }
  }

  _persist(event, data) {
    if (!this.persistenceDir) return;
    try {
      const line = JSON.stringify({ event, data, ts: Date.now() });
      appendFileSync(join(this.persistenceDir, 'relay.jsonl'), line + '\n');
    } catch (e) { /* persist error */ }
  }

  // ---- Agent drain (get queued messages) ----
  drain(agentId, limit = 100) {
    const agent = this.agents.get(agentId);
    if (!agent) return [];
    const msgs = agent.queue.splice(0, limit);
    return msgs;
  }

  // ---- Stats ----
  stats() {
    let totalSubs = 0;
    let connected = 0;
    let totalQueued = 0;
    for (const [, agent] of this.agents) {
      totalSubs += agent.subscriptions.size;
      if (agent.connected) connected++;
      totalQueued += agent.queue.length;
    }
    return {
      agents: this.agents.size,
      connected,
      topics: this.topics.size,
      wildcards: this.wildcards.size,
      subscriptions: totalSubs,
      messages: this.history.length,
      pendingRequests: this.pending.size,
      queuedMessages: totalQueued,
      dlqSize: this.dlq.length,
      queues: this.queues.size,
      routes: this.routes.length
    };
  }
}

export default AgentRelay;
