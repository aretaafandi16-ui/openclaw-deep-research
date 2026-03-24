/**
 * agent-hub v1.0 — Zero-dependency capability registry & service mesh for AI agents
 *
 * Features:
 * - Agent registration with capabilities, tags, metadata
 * - Capability-based discovery with tag + metadata filtering
 * - Task routing by capability with 5 strategies (round-robin, random, least-loaded, weighted, best-match)
 * - Health checking with heartbeat tracking and auto-deregister
 * - Service mesh: load balancing, failover, circuit breaking
 * - Capability versioning with semver-compatible matching
 * - Agent groups/namespaces for multi-tenant isolation
 * - Real-time event streaming (SSE-compatible)
 * - JSONL persistence + periodic snapshots
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Helpers ───────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ts() {
  return Date.now();
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function matchVersion(pattern, version) {
  if (!pattern || pattern === '*' || pattern === 'any') return true;
  const pv = pattern.split('.').map(Number);
  const vv = version.split('.').map(Number);
  if (pattern.startsWith('^') || pattern.startsWith('~')) {
    const op = pattern[0];
    const pvNums = pattern.slice(1).split('.').map(Number);
    if (op === '~') return vv[0] === pvNums[0] && vv[1] === pvNums[1] && vv[2] >= pvNums[2];
    if (op === '^') return vv[0] === pvNums[0] && (vv[1] > pvNums[1] || (vv[1] === pvNums[1] && vv[2] >= pvNums[2]));
  }
  return pattern === version;
}

function matchTags(required, available) {
  if (!required || !required.length) return true;
  return required.every(t => available.includes(t));
}

function matchMetadata(filters, metadata) {
  if (!filters || !Object.keys(filters).length) return true;
  for (const [key, filter] of Object.entries(filters)) {
    const val = metadata[key];
    if (typeof filter === 'object' && filter !== null) {
      if (filter.$eq !== undefined && val !== filter.$eq) return false;
      if (filter.$ne !== undefined && val === filter.$ne) return false;
      if (filter.$gt !== undefined && !(val > filter.$gt)) return false;
      if (filter.$gte !== undefined && !(val >= filter.$gte)) return false;
      if (filter.$lt !== undefined && !(val < filter.$lt)) return false;
      if (filter.$lte !== undefined && !(val <= filter.$lte)) return false;
      if (filter.$in !== undefined && !filter.$in.includes(val)) return false;
      if (filter.$nin !== undefined && filter.$nin.includes(val)) return false;
      if (filter.$exists !== undefined) {
        if (filter.$exists && val === undefined) return false;
        if (!filter.$exists && val !== undefined) return false;
      }
      if (filter.$contains !== undefined) {
        if (typeof val === 'string' && !val.includes(filter.$contains)) return false;
        if (Array.isArray(val) && !val.includes(filter.$contains)) return false;
      }
    } else {
      if (val !== filter) return false;
    }
  }
  return true;
}

// ─── AgentHub Core ─────────────────────────────────────────────────────

export class AgentHub extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.agents = new Map();         // id → agent record
    this.capabilities = new Map();   // capability → Set<agentId>
    this.groups = new Map();         // group → Set<agentId>
    this.routes = new Map();         // routeName → { capability, strategy, ... }
    this.routeCounters = new Map();  // strategy state (round-robin idx, etc.)
    this.circuitBreakers = new Map();// agentId → { failures, state, lastFailure }
    this.healthChecks = new Map();   // agentId → { interval, timer }
    this.taskHistory = [];           // recent routing decisions
    this.stats = { registered: 0, routed: 0, failed: 0, deregistered: 0, heartbeats: 0 };

    this.dataDir = opts.dataDir || '.hub-data';
    this.heartbeatInterval = opts.heartbeatInterval || 30000;   // 30s
    this.heartbeatTimeout = opts.heartbeatTimeout || 90000;     // 90s
    this.autoDeregister = opts.autoDeregister !== false;
    this.maxTaskHistory = opts.maxTaskHistory || 500;
    this.circuitBreakerThreshold = opts.circuitBreakerThreshold || 5;
    this.circuitBreakerResetMs = opts.circuitBreakerResetMs || 60000;
    this.persistInterval = opts.persistInterval || 300000; // 5min
    this.namespace = opts.namespace || 'default';

    if (opts.persist !== false) {
      this._ensureDir();
      this._loadFromDisk();
      this._persistTimer = setInterval(() => this.save(), this.persistInterval);
    }

    // Health check sweep
    this._healthTimer = setInterval(() => this._sweepStale(), this.heartbeatInterval);
  }

  // ── Registration ──────────────────────────────────────────────────

  register(agent) {
    const id = agent.id || genId();
    const record = {
      id,
      name: agent.name || id,
      capabilities: agent.capabilities || [],
      tags: agent.tags || [],
      metadata: agent.metadata || {},
      version: agent.version || '1.0.0',
      endpoint: agent.endpoint || null,
      group: agent.group || this.namespace,
      status: 'online',
      registeredAt: ts(),
      lastHeartbeat: ts(),
      load: 0,            // current task count
      totalTasks: 0,
      successTasks: 0,
      failedTasks: 0,
      avgLatencyMs: 0,
      latencySamples: [],
    };

    this.agents.set(id, record);

    // Index capabilities
    for (const cap of record.capabilities) {
      if (!this.capabilities.has(cap)) this.capabilities.set(cap, new Set());
      this.capabilities.get(cap).add(id);
    }

    // Index group
    if (!this.groups.has(record.group)) this.groups.set(record.group, new Set());
    this.groups.get(record.group).add(id);

    this.stats.registered++;
    this.emit('agent:registered', record);
    return record;
  }

  unregister(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    // Remove from capability index
    for (const cap of agent.capabilities) {
      const set = this.capabilities.get(cap);
      if (set) {
        set.delete(agentId);
        if (this.capabilities.get(cap)?.size === 0) this.capabilities.delete(cap);
      }
    }

    // Remove from group index
    const grp = this.groups.get(agent.group);
    if (grp) { grp.delete(agentId); if (!grp.size) this.groups.delete(agent.group); }

    // Clear circuit breaker
    this.circuitBreakers.delete(agentId);

    this.agents.delete(agentId);
    this.stats.deregistered++;
    this.emit('agent:unregistered', agent);
    return true;
  }

  // ── Heartbeat ─────────────────────────────────────────────────────

  heartbeat(agentId, status = {}) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.lastHeartbeat = ts();
    if (status.load !== undefined) agent.load = status.load;
    if (status.status) agent.status = status.status;
    this.stats.heartbeats++;
    this.emit('agent:heartbeat', { id: agentId, ...status });
    return true;
  }

  _sweepStale() {
    const now = ts();
    for (const [id, agent] of this.agents) {
      if (now - agent.lastHeartbeat > this.heartbeatTimeout) {
        if (this.autoDeregister) {
          this.unregister(id);
          this.emit('agent:stale', { id, reason: 'heartbeat_timeout' });
        } else {
          agent.status = 'offline';
          this.emit('agent:offline', { id, reason: 'heartbeat_timeout' });
        }
      }
    }
  }

  // ── Discovery ─────────────────────────────────────────────────────

  discover(query = {}) {
    let candidates = [];

    // Filter by capability
    if (query.capability) {
      const agentIds = this.capabilities.get(query.capability);
      if (!agentIds || !agentIds.size) return [];
      candidates = [...agentIds].map(id => this.agents.get(id)).filter(Boolean);
    } else {
      candidates = [...this.agents.values()];
    }

    // Filter by group
    if (query.group) {
      candidates = candidates.filter(a => a.group === query.group);
    }

    // Filter by tags
    if (query.tags && query.tags.length) {
      candidates = candidates.filter(a => matchTags(query.tags, a.tags));
    }

    // Filter by metadata
    if (query.metadata) {
      candidates = candidates.filter(a => matchMetadata(query.metadata, a.metadata));
    }

    // Filter by version
    if (query.version) {
      candidates = candidates.filter(a => matchVersion(query.version, a.version));
    }

    // Filter by status
    if (query.status) {
      candidates = candidates.filter(a => a.status === query.status);
    } else {
      candidates = candidates.filter(a => a.status === 'online');
    }

    // Filter by endpoint type
    if (query.hasEndpoint) {
      candidates = candidates.filter(a => !!a.endpoint);
    }

    // Sort options
    if (query.sort === 'load') {
      candidates.sort((a, b) => a.load - b.load);
    } else if (query.sort === 'success_rate') {
      candidates.sort((a, b) => {
        const ra = a.totalTasks ? a.successTasks / a.totalTasks : 0.5;
        const rb = b.totalTasks ? b.successTasks / b.totalTasks : 0.5;
        return rb - ra;
      });
    } else if (query.sort === 'latency') {
      candidates.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
    }

    // Limit
    if (query.limit) candidates = candidates.slice(0, query.limit);

    return candidates.map(a => this._sanitizeAgent(a));
  }

  // ── Routing ───────────────────────────────────────────────────────

  route(capability, opts = {}) {
    const strategy = opts.strategy || 'round_robin';
    const group = opts.group;
    const tags = opts.tags;
    const exclude = new Set(opts.exclude || []);

    // Discover candidates
    const candidates = this.discover({ capability, group, tags, status: 'online' })
      .filter(a => !exclude.has(a.id))
      .filter(a => !this._isCircuitOpen(a.id));

    if (!candidates.length) {
      this.stats.failed++;
      this.emit('route:failed', { capability, reason: 'no_candidates' });
      return null;
    }

    let selected;
    switch (strategy) {
      case 'round_robin':
        selected = this._routeRoundRobin(capability, candidates);
        break;
      case 'random':
        selected = candidates[Math.floor(Math.random() * candidates.length)];
        break;
      case 'least_loaded':
        selected = candidates.reduce((min, c) => c.load < min.load ? c : min, candidates[0]);
        break;
      case 'weighted':
        selected = this._routeWeighted(candidates, opts.weights);
        break;
      case 'best_match':
        selected = this._routeBestMatch(candidates, opts);
        break;
      default:
        selected = candidates[0];
    }

    // Record routing decision
    const decision = {
      id: genId(),
      capability,
      strategy,
      agentId: selected.id,
      timestamp: ts(),
      latencyMs: null,
      success: null,
    };
    this.taskHistory.push(decision);
    if (this.taskHistory.length > this.maxTaskHistory) this.taskHistory.shift();

    // Increment load
    const agent = this.agents.get(selected.id);
    if (agent) agent.load++;

    this.stats.routed++;
    this.emit('route:selected', decision);

    return { ...this._sanitizeAgent(selected), routeId: decision.id };
  }

  routeComplete(routeId, result = {}) {
    const decision = this.taskHistory.find(d => d.id === routeId);
    if (!decision) return false;
    decision.latencyMs = result.latencyMs;
    decision.success = result.success !== false;

    const agent = this.agents.get(decision.agentId);
    if (agent) {
      agent.load = Math.max(0, agent.load - 1);
      agent.totalTasks++;
      if (decision.success) agent.successTasks++;
      else agent.failedTasks++;

      // Update avg latency
      if (result.latencyMs != null) {
        agent.latencySamples.push(result.latencyMs);
        if (agent.latencySamples.length > 100) agent.latencySamples.shift();
        agent.avgLatencyMs = Math.round(agent.latencySamples.reduce((a, b) => a + b, 0) / agent.latencySamples.length);
      }

      // Circuit breaker
      if (!decision.success) {
        this._recordFailure(decision.agentId);
      } else {
        this._recordSuccess(decision.agentId);
      }
    }

    this.emit('route:completed', decision);
    return true;
  }

  // ── Strategies ────────────────────────────────────────────────────

  _routeRoundRobin(capability, candidates) {
    const key = `rr:${capability}`;
    const idx = (this.routeCounters.get(key) || 0) % candidates.length;
    this.routeCounters.set(key, idx + 1);
    return candidates[idx];
  }

  _routeWeighted(candidates, weights = {}) {
    const totalWeight = candidates.reduce((sum, c) => sum + (weights[c.id] || c.metadata.weight || 1), 0);
    let r = Math.random() * totalWeight;
    for (const c of candidates) {
      r -= (weights[c.id] || c.metadata.weight || 1);
      if (r <= 0) return c;
    }
    return candidates[candidates.length - 1];
  }

  _routeBestMatch(candidates, opts) {
    // Score each candidate
    const scored = candidates.map(c => {
      let score = 0;
      // Prefer lower load
      score += Math.max(0, 10 - c.load) * 2;
      // Prefer higher success rate
      if (c.totalTasks > 0) score += (c.successTasks / c.totalTasks) * 20;
      // Prefer lower latency
      if (c.avgLatencyMs > 0) score += Math.max(0, 10 - c.avgLatencyMs / 100);
      // Prefer exact tag matches
      if (opts.tags) score += opts.tags.filter(t => c.tags.includes(t)).length * 5;
      // Prefer exact metadata matches
      if (opts.metadata) {
        for (const [k, v] of Object.entries(opts.metadata)) {
          if (c.metadata[k] === v) score += 3;
        }
      }
      return { agent: c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].agent;
  }

  // ── Circuit Breaker ───────────────────────────────────────────────

  _isCircuitOpen(agentId) {
    const cb = this.circuitBreakers.get(agentId);
    if (!cb) return false;
    if (cb.state === 'open') {
      if (ts() - cb.lastFailure > this.circuitBreakerResetMs) {
        cb.state = 'half_open';
        cb.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  _recordFailure(agentId) {
    let cb = this.circuitBreakers.get(agentId);
    if (!cb) { cb = { failures: 0, state: 'closed', lastFailure: 0 }; this.circuitBreakers.set(agentId, cb); }
    cb.failures++;
    cb.lastFailure = ts();
    if (cb.failures >= this.circuitBreakerThreshold) {
      cb.state = 'open';
      this.emit('circuit:open', { agentId, failures: cb.failures });
    }
  }

  _recordSuccess(agentId) {
    const cb = this.circuitBreakers.get(agentId);
    if (!cb) return;
    if (cb.state === 'half_open') {
      cb.state = 'closed';
      cb.failures = 0;
      this.emit('circuit:closed', { agentId });
    } else if (cb.state === 'closed') {
      cb.failures = Math.max(0, cb.failures - 1);
    }
  }

  // ── Routes (named) ───────────────────────────────────────────────

  addRoute(name, config) {
    const route = {
      name,
      capability: config.capability,
      strategy: config.strategy || 'round_robin',
      group: config.group || null,
      tags: config.tags || [],
      metadata: config.metadata || null,
      fallback: config.fallback || null,
      timeout: config.timeout || 30000,
      retries: config.retries || 0,
    };
    this.routes.set(name, route);
    this.emit('route:added', route);
    return route;
  }

  removeRoute(name) {
    const route = this.routes.get(name);
    if (!route) return false;
    this.routes.delete(name);
    this.emit('route:removed', route);
    return true;
  }

  executeRoute(routeName, payload = {}) {
    const route = this.routes.get(routeName);
    if (!route) return null;

    const result = this.route(route.capability, {
      strategy: route.strategy,
      group: route.group,
      tags: route.tags,
      metadata: route.metadata,
    });

    if (!result && route.fallback) {
      return this.route(route.fallback, { strategy: route.strategy });
    }

    return result;
  }

  // ── Queries ───────────────────────────────────────────────────────

  getAgent(id) {
    const a = this.agents.get(id);
    return a ? this._sanitizeAgent(a) : null;
  }

  listCapabilities() {
    const result = [];
    for (const [cap, agentIds] of this.capabilities) {
      result.push({
        capability: cap,
        agentCount: agentIds.size,
        agents: [...agentIds].map(id => this.agents.get(id)?.name || id),
      });
    }
    return result.sort((a, b) => b.agentCount - a.agentCount);
  }

  listGroups() {
    const result = [];
    for (const [group, agentIds] of this.groups) {
      result.push({ group, agentCount: agentIds.size });
    }
    return result.sort((a, b) => b.agentCount - a.agentCount);
  }

  getCircuitStatus(agentId) {
    return this.circuitBreakers.get(agentId) || { failures: 0, state: 'closed', lastFailure: 0 };
  }

  getStats() {
    return {
      ...this.stats,
      agents: this.agents.size,
      capabilities: this.capabilities.size,
      groups: this.groups.size,
      routes: this.routes.size,
      openCircuits: [...this.circuitBreakers.values()].filter(c => c.state === 'open').length,
    };
  }

  // ── Persistence ───────────────────────────────────────────────────

  save() {
    try {
      const data = {
        agents: [...this.agents.entries()],
        capabilities: [...this.capabilities.entries()].map(([k, v]) => [k, [...v]]),
        groups: [...this.groups.entries()].map(([k, v]) => [k, [...v]]),
        routes: [...this.routes.entries()],
        stats: this.stats,
        savedAt: ts(),
      };
      writeFileSync(join(this.dataDir, 'hub-snapshot.json'), JSON.stringify(data, null, 2));

      // Append event log
      appendFileSync(join(this.dataDir, 'hub-events.jsonl'), JSON.stringify({
        type: 'snapshot', timestamp: ts(), agentCount: this.agents.size
      }) + '\n');
    } catch (e) {
      this.emit('error', e);
    }
  }

  _loadFromDisk() {
    try {
      const snapPath = join(this.dataDir, 'hub-snapshot.json');
      if (!existsSync(snapPath)) return;
      const data = JSON.parse(readFileSync(snapPath, 'utf-8'));

      this.agents = new Map(data.agents || []);
      this.capabilities = new Map((data.capabilities || []).map(([k, v]) => [k, new Set(v)]));
      this.groups = new Map((data.groups || []).map(([k, v]) => [k, new Set(v)]));
      this.routes = new Map(data.routes || []);
      if (data.stats) Object.assign(this.stats, data.stats);
    } catch (e) {
      this.emit('error', e);
    }
  }

  _ensureDir() {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  // ── Helpers ───────────────────────────────────────────────────────

  _sanitizeAgent(a) {
    const { latencySamples, ...rest } = a;
    return { ...rest, circuitState: this.getCircuitStatus(a.id).state };
  }

  destroy() {
    clearInterval(this._persistTimer);
    clearInterval(this._healthTimer);
    this.save();
    this.removeAllListeners();
  }
}

export default AgentHub;
