/**
 * agent-collab tests
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollabEngine, ROLES, STATUS, STRATEGIES } from './index.mjs';

let engine;

beforeEach(() => {
  engine = new CollabEngine();
});

// ── Agent Management ──
describe('Agent Management', () => {
  it('registers an agent', () => {
    const agent = engine.registerAgent({ name: 'alice', role: ROLES.WORKER, capabilities: ['coding', 'testing'] });
    assert.equal(agent.name, 'alice');
    assert.equal(agent.role, ROLES.WORKER);
    assert.equal(engine.agents.size, 1);
  });

  it('unregisters an agent and releases tasks', () => {
    const agent = engine.registerAgent({ name: 'bob' });
    const task = engine.createTask({ type: 'test', payload: {} });
    engine.assignTask(task.id, agent.id);
    assert.equal(task.status, STATUS.ASSIGNED);
    engine.unregisterAgent(agent.id);
    assert.equal(engine.agents.size, 0);
    assert.equal(task.status, STATUS.PENDING);
  });

  it('lists agents with filters', () => {
    engine.registerAgent({ name: 'a1', role: ROLES.WORKER });
    engine.registerAgent({ name: 'a2', role: ROLES.COORDINATOR });
    engine.registerAgent({ name: 'a3', role: ROLES.WORKER });
    assert.equal(engine.listAgents({ role: ROLES.WORKER }).length, 2);
    assert.equal(engine.listAgents({ role: ROLES.COORDINATOR }).length, 1);
  });

  it('tracks agent load and availability', () => {
    const agent = engine.registerAgent({ name: 'worker', maxConcurrent: 2 });
    assert.equal(agent.load, 0);
    assert.equal(agent.isAvailable, true);
    const t1 = engine.createTask({ type: 'work', payload: {} });
    const t2 = engine.createTask({ type: 'work', payload: {} });
    engine.assignTask(t1.id, agent.id);
    engine.assignTask(t2.id, agent.id);
    assert.equal(agent.load, 1);
    assert.equal(agent.isAvailable, false);
  });
});

// ── Task Management ──
describe('Task Management', () => {
  it('creates and retrieves a task', () => {
    const task = engine.createTask({ type: 'analysis', payload: { query: 'test' }, priority: 3 });
    assert.equal(task.type, 'analysis');
    assert.equal(task.priority, 3);
    assert.equal(task.status, STATUS.PENDING);
    const retrieved = engine.getTask(task.id);
    assert.deepEqual(retrieved.payload, { query: 'test' });
  });

  it('assigns, starts, completes a task', () => {
    const agent = engine.registerAgent({ name: 'w1' });
    const task = engine.createTask({ type: 'work', payload: {} });
    engine.assignTask(task.id, agent.id);
    assert.equal(task.status, STATUS.ASSIGNED);
    engine.startTask(task.id);
    assert.equal(task.status, STATUS.RUNNING);
    engine.completeTask(task.id, { answer: 42 });
    assert.equal(task.status, STATUS.DONE);
    assert.deepEqual(task.result, { answer: 42 });
    assert.equal(agent.completedTasks, 1);
  });

  it('fails a task with retry', () => {
    const agent = engine.registerAgent({ name: 'w1' });
    const task = engine.createTask({ type: 'work', payload: {} });
    engine.assignTask(task.id, agent.id);
    engine.startTask(task.id);
    engine.failTask(task.id, 'timeout');
    assert.equal(task.status, STATUS.PENDING); // retried
    assert.equal(task.retries, 1);
  });

  it('fails permanently after max retries', () => {
    const agent = engine.registerAgent({ name: 'w1' });
    const task = engine.createTask({ type: 'work', payload: {} });
    task.maxRetries = 0;
    engine.assignTask(task.id, agent.id);
    engine.startTask(task.id);
    engine.failTask(task.id, 'fatal');
    assert.equal(task.status, STATUS.FAILED);
    assert.equal(agent.failedTasks, 1);
  });

  it('enforces capability requirements', () => {
    const agent = engine.registerAgent({ name: 'basic', capabilities: ['reading'] });
    const task = engine.createTask({ type: 'code', payload: {}, requires: ['coding'] });
    assert.throws(() => engine.assignTask(task.id, agent.id), /missing capabilities/);
  });

  it('respects task dependencies', () => {
    const agent = engine.registerAgent({ name: 'w1' });
    const t1 = engine.createTask({ type: 'step1', payload: {} });
    const t2 = engine.createTask({ type: 'step2', payload: {} });
    t2.dependencies.push(t1.id);
    assert.throws(() => engine.assignTask(t2.id, agent.id), /Dependency/);
    engine.assignTask(t1.id, agent.id);
    engine.startTask(t1.id);
    engine.completeTask(t1.id);
    engine.assignTask(t2.id, agent.id); // now OK
  });

  it('lists tasks with filters', () => {
    engine.createTask({ type: 'alpha', payload: {} });
    engine.createTask({ type: 'beta', payload: {} });
    engine.createTask({ type: 'alpha', payload: {} });
    assert.equal(engine.listTasks({ type: 'alpha' }).length, 2);
    assert.equal(engine.listTasks({ status: STATUS.PENDING }).length, 3);
  });

  it('cancels a task', () => {
    const task = engine.createTask({ type: 'work', payload: {} });
    engine.cancelTask(task.id);
    assert.equal(task.status, STATUS.CANCELLED);
  });
});

// ── Auto-Assignment ──
describe('Auto-Assignment', () => {
  it('assigns to least loaded agent', () => {
    const a1 = engine.registerAgent({ name: 'busy', maxConcurrent: 5 });
    const a2 = engine.registerAgent({ name: 'free', maxConcurrent: 5 });
    const t1 = engine.createTask({ type: 'work', payload: {} });
    engine.assignTask(t1.id, a1.id);
    const t2 = engine.createTask({ type: 'work', payload: {} });
    engine.autoAssign(t2.id, STRATEGIES.LEAST_LOADED);
    assert.equal(t2.assignedTo, a2.id);
  });

  it('assigns by capability match', () => {
    engine.registerAgent({ name: 'py', capabilities: ['python'] });
    engine.registerAgent({ name: 'js', capabilities: ['javascript'] });
    const task = engine.createTask({ type: 'code', payload: {}, requires: ['javascript'] });
    engine.autoAssign(task.id, STRATEGIES.CAPABILITY);
    assert.equal(task.assignedTo, engine.listAgents().find(a => a.name === 'js').id);
  });

  it('returns null when no agents available', () => {
    engine.registerAgent({ name: 'busy', maxConcurrent: 1 });
    const t1 = engine.createTask({ type: 'work', payload: {} });
    const t2 = engine.createTask({ type: 'work', payload: {} });
    engine.assignTask(t1.id, [...engine.agents.keys()][0]);
    const result = engine.autoAssign(t2.id);
    assert.equal(result, null);
  });
});

// ── Delegation & Chains ──
describe('Delegation & Chains', () => {
  it('delegates subtasks in parallel', () => {
    engine.registerAgent({ name: 'a1' });
    engine.registerAgent({ name: 'a2' });
    const parent = engine.createTask({ type: 'parent', payload: {} });
    const subs = engine.delegate(parent.id, [
      { type: 'sub1', payload: {} },
      { type: 'sub2', payload: {} },
    ]);
    assert.equal(subs.length, 2);
    assert.equal(subs[0].task.parentId, parent.id);
    assert.ok(subs[0].task.assignedTo);
  });

  it('chains tasks with dependencies', () => {
    engine.registerAgent({ name: 'w1' });
    const tasks = engine.chain([
      { type: 'step1', payload: {} },
      { type: 'step2', payload: {} },
      { type: 'step3', payload: {} },
    ]);
    assert.equal(tasks.length, 3);
    assert.equal(tasks[1].dependencies[0], tasks[0].id);
    assert.equal(tasks[2].dependencies[0], tasks[1].id);
  });
});

// ── Messaging ──
describe('Messaging', () => {
  it('sends a message between agents', () => {
    engine.registerAgent({ id: 'a', name: 'alice' });
    engine.registerAgent({ id: 'b', name: 'bob' });
    const msg = engine.sendMessage('a', 'b', 'hello');
    assert.equal(msg.from, 'a');
    assert.equal(msg.to, 'b');
    assert.equal(engine.messages.length, 1);
  });

  it('broadcasts to all agents except sender', () => {
    engine.registerAgent({ id: 'a', name: 'alice' });
    engine.registerAgent({ id: 'b', name: 'bob' });
    engine.registerAgent({ id: 'c', name: 'carol' });
    const msgs = engine.broadcast('a', 'hey everyone');
    assert.equal(msgs.length, 2);
  });

  it('filters messages', () => {
    engine.registerAgent({ id: 'a', name: 'alice' });
    engine.registerAgent({ id: 'b', name: 'bob' });
    engine.sendMessage('a', 'b', 'hello');
    engine.sendMessage('b', 'a', 'hi');
    const fromA = engine.getMessages({ agentId: 'a' });
    assert.equal(fromA.length, 2);
  });
});

// ── Shared Memory ──
describe('Shared Memory', () => {
  it('sets and gets values', async () => {
    await engine.memory.set('key1', 'value1');
    assert.equal(engine.memory.get('key1'), 'value1');
  });

  it('handles TTL expiration', async () => {
    await engine.memory.set('temp', 'data', { ttlMs: 1 });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(engine.memory.get('temp'), undefined);
  });

  it('manages locks', async () => {
    assert.ok(await engine.memory.lock('res', 'agent1'));
    assert.ok(!await engine.memory.lock('res', 'agent2'));
    await engine.memory.unlock('res', 'agent1');
    assert.ok(await engine.memory.lock('res', 'agent2'));
  });

  it('watches for changes', async () => {
    const changes = [];
    engine.memory.watch('x', (key, action, value) => changes.push({ key, action, value }));
    await engine.memory.set('x', 1);
    await engine.memory.delete('x');
    assert.equal(changes.length, 2);
    assert.equal(changes[0].action, 'set');
    assert.equal(changes[1].action, 'delete');
  });
});

// ── Stats ──
describe('Stats', () => {
  it('returns comprehensive stats', () => {
    engine.registerAgent({ name: 'a1' });
    engine.registerAgent({ name: 'a2' });
    engine.createTask({ type: 'work', payload: {} });
    const stats = engine.stats();
    assert.equal(stats.agents.total, 2);
    assert.equal(stats.tasks.total, 1);
    assert.equal(stats.tasks.pending, 1);
  });
});

// ── Queue limit ──
describe('Queue Limit', () => {
  it('rejects tasks when queue is full', () => {
    engine.maxQueueSize = 2;
    engine.createTask({ type: 'a', payload: {} });
    engine.createTask({ type: 'b', payload: {} });
    assert.throws(() => engine.createTask({ type: 'c', payload: {} }), /Queue full/);
  });
});

// ── Events ──
describe('Events', () => {
  it('emits lifecycle events', () => {
    const events = [];
    engine.on('agent:registered', () => events.push('agent:registered'));
    engine.on('task:created', () => events.push('task:created'));
    engine.on('task:completed', () => events.push('task:completed'));
    engine.on('message', () => events.push('message'));
    engine.registerAgent({ name: 'a1' });
    const task = engine.createTask({ type: 't', payload: {} });
    engine.completeTask(task.id);
    engine.sendMessage('a1', 'a1', 'test');
    assert.ok(events.includes('agent:registered'));
    assert.ok(events.includes('task:created'));
    assert.ok(events.includes('task:completed'));
    assert.ok(events.includes('message'));
  });
});
