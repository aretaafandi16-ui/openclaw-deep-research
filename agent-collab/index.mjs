/**
 * agent-collab v1.0 — Multi-agent collaboration protocol
 * Zero-dependency. Spawn, delegate, coordinate, share state.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Roles ──
const ROLES = {
  COORDINATOR: 'coordinator',
  WORKER: 'worker',
  OBSERVER: 'observer',
  SPECIALIST: 'specialist',
};

// ── Task status ──
const STATUS = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// ── Strategies ──
const STRATEGIES = {
  ROUND_ROBIN: 'round_robin',
  LEAST_LOADED: 'least_loaded',
  RANDOM: 'random',
  CAPABILITY: 'capability',
  BROADCAST: 'broadcast',
};

class Agent {
  constructor({ id, name, role = ROLES.WORKER, capabilities = [], maxConcurrent = 3 }) {
    this.id = id || randomUUID();
    this.name = name || `agent-${this.id.slice(0, 8)}`;
    this.role = role;
    this.capabilities = new Set(capabilities);
    this.maxConcurrent = maxConcurrent;
    this.activeTasks = new Set();
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.totalLatencyMs = 0;
    this.status = 'idle';
    this.joinedAt = Date.now();
    this.lastActiveAt = Date.now();
    this.metadata = {};
  }

  get load() { return this.activeTasks.size / this.maxConcurrent; }
  get isAvailable() { return this.activeTasks.size < this.maxConcurrent; }
  get avgLatencyMs() {
    const total = this.completedTasks + this.failedTasks;
    return total > 0 ? Math.round(this.totalLatencyMs / total) : 0;
  }

  toJSON() {
    return {
      id: this.id, name: this.name, role: this.role,
      capabilities: [...this.capabilities], maxConcurrent: this.maxConcurrent,
      activeTasks: [...this.activeTasks], completedTasks: this.completedTasks,
      failedTasks: this.failedTasks, load: this.load, isAvailable: this.isAvailable,
      avgLatencyMs: this.avgLatencyMs, status: this.status,
      joinedAt: this.joinedAt, lastActiveAt: this.lastActiveAt,
    };
  }
}

class Task {
  constructor({ id, type, payload, priority = 5, requires = [], parentId = null, metadata = {} }) {
    this.id = id || randomUUID();
    this.type = type;
    this.payload = payload;
    this.priority = priority; // 1=highest, 10=lowest
    this.requires = requires; // capability requirements
    this.parentId = parentId;
    this.dependencies = []; // task IDs this depends on
    this.assignedTo = null;
    this.status = STATUS.PENDING;
    this.result = null;
    this.error = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    this.retries = 0;
    this.maxRetries = 2;
    this.metadata = metadata;
  }

  get latencyMs() {
    return this.startedAt && this.completedAt ? this.completedAt - this.startedAt : null;
  }

  toJSON() {
    return {
      id: this.id, type: this.type, payload: this.payload,
      priority: this.priority, requires: this.requires,
      parentId: this.parentId, dependencies: this.dependencies,
      assignedTo: this.assignedTo, status: this.status,
      result: this.result, error: this.error,
      createdAt: this.createdAt, startedAt: this.startedAt,
      completedAt: this.completedAt, latencyMs: this.latencyMs,
      retries: this.retries, maxRetries: this.maxRetries,
    };
  }
}

class SharedMemory {
  constructor() {
    this.data = new Map();
    this.locks = new Map();
    this.watchers = new Map();
  }

  async set(key, value, { owner = null, ttlMs = null } = {}) {
    const entry = { value, owner, createdAt: Date.now(), expiresAt: ttlMs ? Date.now() + ttlMs : null };
    this.data.set(key, entry);
    this._notify(key, 'set', value);
    return entry;
  }

  get(key) {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async delete(key) {
    this.data.delete(key);
    this._notify(key, 'delete', undefined);
  }

  async lock(key, owner, timeoutMs = 30000) {
    const existing = this.locks.get(key);
    if (existing && existing.owner !== owner && Date.now() < existing.expiresAt) {
      return false;
    }
    this.locks.set(key, { owner, expiresAt: Date.now() + timeoutMs });
    return true;
  }

  async unlock(key, owner) {
    const existing = this.locks.get(key);
    if (existing && existing.owner === owner) {
      this.locks.delete(key);
      return true;
    }
    return false;
  }

  isLocked(key) {
    const lock = this.locks.get(key);
    if (!lock) return false;
    if (Date.now() > lock.expiresAt) { this.locks.delete(key); return false; }
    return true;
  }

  watch(key, callback) {
    if (!this.watchers.has(key)) this.watchers.set(key, new Set());
    this.watchers.get(key).add(callback);
    return () => this.watchers.get(key)?.delete(callback);
  }

  _notify(key, action, value) {
    const watchers = this.watchers.get(key);
    if (watchers) for (const cb of watchers) cb(key, action, value);
  }

  list(prefix = '') {
    const result = {};
    for (const [key, entry] of this.data) {
      if (prefix && !key.startsWith(prefix)) continue;
      if (entry.expiresAt && Date.now() > entry.expiresAt) { this.data.delete(key); continue; }
      result[key] = entry.value;
    }
    return result;
  }
}

class CollabEngine extends EventEmitter {
  constructor({ dataDir = null, maxQueueSize = 1000 } = {}) {
    super();
    this.agents = new Map();
    this.tasks = new Map();
    this.messages = [];
    this.memory = new SharedMemory();
    this.dataDir = dataDir;
    this.maxQueueSize = maxQueueSize;
    this._roundRobinIdx = 0;
    this._eventLog = [];
  }

  // ── Agent Management ──
  registerAgent(config) {
    const agent = new Agent(config);
    this.agents.set(agent.id, agent);
    this.emit('agent:registered', agent);
    this._log('agent:registered', { agentId: agent.id, name: agent.name });
    return agent;
  }

  unregisterAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    // release tasks
    for (const taskId of agent.activeTasks) {
      const task = this.tasks.get(taskId);
      if (task) { task.status = STATUS.PENDING; task.assignedTo = null; }
    }
    this.agents.delete(agentId);
    this.emit('agent:unregistered', agent);
    this._log('agent:unregistered', { agentId });
    return true;
  }

  getAgent(id) { return this.agents.get(id)?.toJSON(); }
  listAgents({ role = null, available = null } = {}) {
    const agents = [...this.agents.values()];
    return agents
      .filter(a => !role || a.role === role)
      .filter(a => available === null || a.isAvailable === available)
      .map(a => a.toJSON());
  }

  // ── Task Management ──
  createTask(config) {
    if (this.tasks.size >= this.maxQueueSize) throw new Error('Queue full');
    const task = new Task(config);
    this.tasks.set(task.id, task);
    this.emit('task:created', task);
    this._log('task:created', { taskId: task.id, type: task.type });
    return task;
  }

  assignTask(taskId, agentId) {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (!agent.isAvailable) throw new Error(`Agent ${agent.name} is at capacity`);
    if (task.requires.length) {
      const missing = task.requires.filter(r => !agent.capabilities.has(r));
      if (missing.length) throw new Error(`Agent missing capabilities: ${missing.join(', ')}`);
    }
    // check deps
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (dep && dep.status !== STATUS.DONE) throw new Error(`Dependency ${depId} not done`);
    }
    task.assignedTo = agentId;
    task.status = STATUS.ASSIGNED;
    agent.activeTasks.add(taskId);
    agent.status = 'busy';
    agent.lastActiveAt = Date.now();
    this.emit('task:assigned', task, agent);
    this._log('task:assigned', { taskId, agentId });
    return task;
  }

  startTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = STATUS.RUNNING;
    task.startedAt = Date.now();
    this.emit('task:started', task);
    this._log('task:started', { taskId });
    return task;
  }

  completeTask(taskId, result = null) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = STATUS.DONE;
    task.result = result;
    task.completedAt = Date.now();
    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) {
        agent.activeTasks.delete(taskId);
        agent.completedTasks++;
        agent.totalLatencyMs += task.latencyMs || 0;
        agent.status = agent.activeTasks.size > 0 ? 'busy' : 'idle';
        agent.lastActiveAt = Date.now();
      }
    }
    this.emit('task:completed', task);
    this._log('task:completed', { taskId, latencyMs: task.latencyMs });
    return task;
  }

  failTask(taskId, error = null) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.error = error?.message || error;
    if (task.retries < task.maxRetries) {
      task.retries++;
      task.status = STATUS.PENDING;
      task.assignedTo = null;
      if (task.assignedTo) {
        const agent = this.agents.get(task.assignedTo);
        if (agent) { agent.activeTasks.delete(taskId); agent.status = agent.activeTasks.size > 0 ? 'busy' : 'idle'; }
      }
      this.emit('task:retrying', task);
      this._log('task:retrying', { taskId, retries: task.retries });
    } else {
      task.status = STATUS.FAILED;
      task.completedAt = Date.now();
      if (task.assignedTo) {
        const agent = this.agents.get(task.assignedTo);
        if (agent) {
          agent.activeTasks.delete(taskId);
          agent.failedTasks++;
          agent.totalLatencyMs += task.latencyMs || 0;
          agent.status = agent.activeTasks.size > 0 ? 'busy' : 'idle';
        }
      }
      this.emit('task:failed', task);
      this._log('task:failed', { taskId, error: task.error });
    }
    return task;
  }

  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) { agent.activeTasks.delete(taskId); agent.status = agent.activeTasks.size > 0 ? 'busy' : 'idle'; }
    }
    task.status = STATUS.CANCELLED;
    task.completedAt = Date.now();
    this.emit('task:cancelled', task);
    this._log('task:cancelled', { taskId });
    return task;
  }

  getTask(id) { return this.tasks.get(id)?.toJSON(); }

  listTasks({ status = null, assignedTo = null, type = null } = {}) {
    return [...this.tasks.values()]
      .filter(t => !status || t.status === status)
      .filter(t => !assignedTo || t.assignedTo === assignedTo)
      .filter(t => !type || t.type === type)
      .map(t => t.toJSON());
  }

  // ── Auto-Assignment ──
  autoAssign(taskId, strategy = STRATEGIES.LEAST_LOADED) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    let candidates = [...this.agents.values()].filter(a =>
      a.isAvailable && a.role !== ROLES.OBSERVER
    );

    if (task.requires.length) {
      candidates = candidates.filter(a => task.requires.every(r => a.capabilities.has(r)));
    }

    if (!candidates.length) return null;

    let chosen;
    switch (strategy) {
      case STRATEGIES.ROUND_ROBIN:
        this._roundRobinIdx = (this._roundRobinIdx + 1) % candidates.length;
        chosen = candidates[this._roundRobinIdx];
        break;
      case STRATEGIES.LEAST_LOADED:
        chosen = candidates.sort((a, b) => a.load - b.load)[0];
        break;
      case STRATEGIES.RANDOM:
        chosen = candidates[Math.floor(Math.random() * candidates.length)];
        break;
      case STRATEGIES.CAPABILITY:
        // prefer agent with most matching capabilities
        chosen = candidates.sort((a, b) => {
          const aScore = task.requires.filter(r => a.capabilities.has(r)).length;
          const bScore = task.requires.filter(r => b.capabilities.has(r)).length;
          return bScore - aScore || a.load - b.load;
        })[0];
        break;
      case STRATEGIES.BROADCAST:
        // assign to all available (for observation/collection)
        for (const c of candidates) this.assignTask(taskId, c.id);
        return candidates.map(c => c.id);
      default:
        chosen = candidates[0];
    }
    return this.assignTask(taskId, chosen.id);
  }

  // ── Parallel Delegation ──
  delegate(parentTaskId, subTaskConfigs, strategy = STRATEGIES.LEAST_LOADED) {
    const parent = this.tasks.get(parentTaskId);
    if (!parent) throw new Error(`Parent task ${parentTaskId} not found`);

    const results = [];
    for (const config of subTaskConfigs) {
      const sub = this.createTask({ ...config, parentId: parentTaskId });
      if (config.dependencies) sub.dependencies = config.dependencies;
      const assigned = this.autoAssign(sub.id, strategy);
      results.push({ task: sub, assigned });
    }
    this.emit('tasks:delegated', parentTaskId, results);
    this._log('tasks:delegated', { parentTaskId, count: results.length });
    return results;
  }

  // ── Chained Tasks ──
  chain(taskConfigs) {
    const tasks = [];
    for (let i = 0; i < taskConfigs.length; i++) {
      const task = this.createTask(taskConfigs[i]);
      if (i > 0) task.dependencies.push(tasks[i - 1].id);
      tasks.push(task);
    }
    return tasks;
  }

  // ── Messaging ──
  sendMessage(from, to, content, { type = 'info', metadata = {} } = {}) {
    const msg = { id: randomUUID(), from, to, type, content, metadata, timestamp: Date.now() };
    this.messages.push(msg);
    this.emit('message', msg);
    this._log('message', { from, to, type });
    return msg;
  }

  broadcast(from, content, { type = 'broadcast', excludeRoles = [] } = {}) {
    const msgs = [];
    for (const [id, agent] of this.agents) {
      if (id === from || excludeRoles.includes(agent.role)) continue;
      msgs.push(this.sendMessage(from, id, content, { type }));
    }
    return msgs;
  }

  getMessages({ agentId = null, since = null, type = null } = {}) {
    return this.messages
      .filter(m => !agentId || m.from === agentId || m.to === agentId)
      .filter(m => !since || m.timestamp >= since)
      .filter(m => !type || m.type === type);
  }

  // ── Stats ──
  stats() {
    const agents = [...this.agents.values()];
    const tasks = [...this.tasks.values()];
    return {
      agents: { total: agents.length, busy: agents.filter(a => a.status === 'busy').length, idle: agents.filter(a => a.status === 'idle').length },
      tasks: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === STATUS.PENDING).length,
        running: tasks.filter(t => t.status === STATUS.RUNNING).length,
        done: tasks.filter(t => t.status === STATUS.DONE).length,
        failed: tasks.filter(t => t.status === STATUS.FAILED).length,
        blocked: tasks.filter(t => t.status === STATUS.BLOCKED).length,
      },
      messages: this.messages.length,
      memoryKeys: Object.keys(this.memory.list()).length,
      events: this._eventLog.length,
    };
  }

  // ── Persistence ──
  async save() {
    if (!this.dataDir) return;
    await mkdir(this.dataDir, { recursive: true });
    const data = {
      agents: [...this.agents.values()].map(a => a.toJSON()),
      tasks: [...this.tasks.values()].map(t => t.toJSON()),
      messages: this.messages.slice(-500),
      memory: this.memory.list(),
      eventLog: this._eventLog.slice(-200),
    };
    await writeFile(join(this.dataDir, 'collab-state.json'), JSON.stringify(data, null, 2));
  }

  async load() {
    if (!this.dataDir) return;
    const path = join(this.dataDir, 'collab-state.json');
    if (!existsSync(path)) return;
    const data = JSON.parse(await readFile(path, 'utf-8'));
    for (const a of data.agents || []) {
      const agent = new Agent(a);
      agent.activeTasks = new Set(a.activeTasks || []);
      this.agents.set(a.id, agent);
    }
    for (const t of data.tasks || []) {
      const task = new Task(t);
      task.status = t.status;
      task.assignedTo = t.assignedTo;
      task.result = t.result;
      task.error = t.error;
      task.startedAt = t.startedAt;
      task.completedAt = t.completedAt;
      task.retries = t.retries;
      this.tasks.set(t.id, task);
    }
    this.messages = data.messages || [];
    for (const [k, v] of Object.entries(data.memory || {})) this.memory.data.set(k, { value: v, owner: null, createdAt: Date.now(), expiresAt: null });
    this._eventLog = data.eventLog || [];
  }

  // ── Internals ──
  _log(event, data) {
    const entry = { event, data, timestamp: Date.now() };
    this._eventLog.push(entry);
    if (this._eventLog.length > 500) this._eventLog.shift();
  }
}

export { CollabEngine, Agent, Task, SharedMemory, ROLES, STATUS, STRATEGIES };
