#!/usr/bin/env node
/**
 * agent-relay test suite
 */

import { AgentRelay } from './index.mjs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

console.log('agent-relay test suite\n');

// ---- Agent Management ----
console.log('Agent Management:');
{
  const r = new AgentRelay();
  r.registerAgent('a1', { role: 'worker' });
  assert(r.agents.has('a1'), 'register agent');
  assert(r.agents.get('a1').connected === true, 'agent connected');
  assert(r.agents.get('a1').metadata.role === 'worker', 'metadata stored');

  r.unregisterAgent('a1');
  assert(r.agents.get('a1').connected === false, 'unregister sets connected=false');

  const list = r.listAgents();
  assert(list.length === 1, 'listAgents returns registered agents');
  assert(list[0].id === 'a1', 'listAgents has correct id');

  const connected = r.listAgents(true);
  assert(connected.length === 0, 'listAgents(true) filters disconnected');
}

// ---- Subscribe/Unsubscribe ----
console.log('\nSubscribe/Unsubscribe:');
{
  const r = new AgentRelay();
  r.registerAgent('a1');
  r.registerAgent('a2');

  r.subscribe('a1', 'news/sports');
  r.subscribe('a2', 'news/sports');
  r.subscribe('a1', 'news/*');
  assert(r.topics.has('news/sports'), 'exact topic created');
  assert(r.topics.get('news/sports').size === 2, '2 subscribers for exact topic');
  assert(r.wildcards.has('news/*'), 'wildcard topic created');

  r.unsubscribe('a1', 'news/sports');
  assert(r.topics.get('news/sports').size === 1, 'unsubscribe removes from topic');
}

// ---- Publish/Subscribe ----
console.log('\nPublish/Subscribe:');
{
  const r = new AgentRelay();
  r.registerAgent('a1');
  r.registerAgent('a2');
  r.registerAgent('a3');

  r.subscribe('a1', 'events');
  r.subscribe('a2', 'events');

  let delivered = [];
  r.on('deliver', ({ agentId, msg }) => delivered.push(agentId));

  const result = r.publish('events', { action: 'click' }, 'a1', { type: 'ui-event' });
  assert(result.delivered === 1, 'delivered to 1 subscriber (a1 excluded)');
  assert(result.msgId, 'returns msgId');

  assert(delivered.includes('a2'), 'a2 received');
  assert(!delivered.includes('a1'), 'a1 excluded (sender)');

  // Echo back
  delivered = [];
  r.publish('events', { action: 'hover' }, 'a1', { echoBack: true, type: 'ui-event' });
  assert(delivered.includes('a1'), 'echoBack includes sender');

  // History
  const history = r.getHistory();
  assert(history.length === 2, 'history has 2 messages');
  assert(history[0].topic === 'events', 'history topic correct');

  // Filtered history
  const filtered = r.getHistory({ type: 'ui-event' });
  assert(filtered.length === 2, 'history filter by type works');
}

// ---- Wildcard Matching ----
console.log('\nWildcard Matching:');
{
  const r = new AgentRelay();
  r.registerAgent('a1');
  r.subscribe('a1', '*');

  let received = 0;
  r.on('deliver', () => received++);

  r.publish('any/topic/here', 'data', 'external');
  assert(received === 1, 'wildcard * matches any topic');
}

// ---- Direct Messaging ----
console.log('\nDirect Messaging:');
{
  const r = new AgentRelay();
  r.registerAgent('a1');
  r.registerAgent('a2');

  // Subscribe to direct channel
  r.subscribe('a2', '_direct/a2');

  let received = null;
  r.on('deliver', ({ msg }) => { if (msg.type === 'direct') received = msg; });

  r.send('a2', { hello: 'world' }, 'a1');
  assert(received !== null, 'direct message delivered');
  assert(received.payload.hello === 'world', 'direct message payload correct');
}

// ---- Broadcast ----
console.log('\nBroadcast:');
{
  const r = new AgentRelay();
  r.registerAgent('a1');
  r.registerAgent('a2');
  r.registerAgent('a3');

  let count = 0;
  r.on('deliver', () => count++);

  const result = r.broadcast({ notice: 'maintenance' }, 'a1');
  assert(result.delivered === 2, 'broadcast delivers to all except sender');
  assert(count === 2, '2 deliver events');
}

// ---- Request/Reply ----
console.log('\nRequest/Reply:');
{
  const r = new AgentRelay();
  r.registerAgent('client');
  r.registerAgent('server');
  r.subscribe('server', '_req/server');

  // Simulate server reply
  r.on('deliver', ({ agentId, msg }) => {
    if (msg.type === 'request' && msg.correlationId) {
      setTimeout(() => {
        r.reply(msg.correlationId, { answer: 42 }, 'server');
      }, 10);
    }
  });

  const p = r.request('server', { query: 'meaning of life' }, 'client', { timeout: 1000 });
  p.then(result => {
    assert(result.payload.answer === 42, 'request-reply returns correct payload');
    assert(result.from === 'server', 'reply has correct from');
  });
  await p;
}

// ---- Request Timeout ----
console.log('\nRequest Timeout:');
{
  const r = new AgentRelay();
  r.registerAgent('client');
  r.registerAgent('ghost');

  try {
    await r.request('ghost', { ping: true }, 'client', { timeout: 50 });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.message.includes('timeout'), 'request times out');
  }
  assert(r.pending.size === 0, 'pending cleaned up after timeout');
}

// ---- Message Queues ----
console.log('\nMessage Queues:');
{
  const r = new AgentRelay();
  const id1 = r.enqueue('jobs', { task: 'A' }, { priority: 1 });
  const id2 = r.enqueue('jobs', { task: 'B' }, { priority: 10 });
  assert(id1 && id2, 'enqueue returns ids');

  // Higher priority first
  const item = r.dequeue('jobs');
  assert(item.payload.task === 'B', 'dequeue returns highest priority first');

  const item2 = r.dequeue('jobs');
  assert(item2.payload.task === 'A', 'second dequeue returns next');

  const empty = r.dequeue('jobs');
  assert(empty === null, 'dequeue on empty queue returns null');

  // Queue stats
  r.enqueue('q1', 'x');
  const stats = r.queueStats('q1');
  assert(stats.pending === 1, 'queueStats returns pending count');
}

// ---- Requeue / DLQ ----
console.log('\nRequeue / DLQ:');
{
  const r = new AgentRelay();
  const entry = { id: 'x', payload: 'fail', retries: 0, maxRetries: 2, nextRetry: Date.now() };

  let ok = r.requeue('q', { ...entry }, 10);
  assert(ok === true, 'requeue within max retries');

  const exhausted = { id: 'y', payload: 'dead', retries: 3, maxRetries: 2, nextRetry: Date.now() };
  ok = r.requeue('q', exhausted);
  assert(ok === false, 'requeue exhausted goes to DLQ');
  assert(r.dlq.length === 1, 'DLQ has 1 entry');
}

// ---- Routes ----
console.log('\nRoutes:');
{
  const r = new AgentRelay();
  r.registerAgent('a1');

  let routed = null;
  const name = r.addRoute('alerts/*', msg => { routed = msg; }, 'alert-handler');
  assert(name === 'alert-handler', 'route name returned');

  r.publish('alerts/critical', { msg: 'disk full' }, 'a1');
  assert(routed !== null, 'route handler called');
  assert(routed.payload.msg === 'disk full', 'route handler receives message');

  r.removeRoute('alert-handler');
  assert(r.routes.length === 0, 'route removed');
}

// ---- Drain ----
console.log('\nDrain:');
{
  const r = new AgentRelay();
  r.registerAgent('a1');
  r.subscribe('a1', 't');
  r.publish('t', 'msg1');
  r.publish('t', 'msg2');

  const msgs = r.drain('a1', 10);
  assert(msgs.length === 2, 'drain returns queued messages');

  const empty = r.drain('a1', 10);
  assert(empty.length === 0, 'drain on empty queue');
}

// ---- Replay ----
console.log('\nReplay:');
{
  const r = new AgentRelay();
  r.registerAgent('late');
  r.publish('events', { id: 1 });
  r.publish('events', { id: 2 });

  const count = r.replay('late', 'events', 0);
  assert(count === 2, 'replay delivers historical messages');
}

// ---- Stats ----
console.log('\nStats:');
{
  const r = new AgentRelay();
  r.registerAgent('a1');
  r.registerAgent('a2');
  r.subscribe('a1', 't1');
  r.subscribe('a2', 't1');
  r.subscribe('a2', 't2/*');
  r.publish('t1', 'x');
  r.enqueue('q1', 'y');

  const s = r.stats();
  assert(s.agents === 2, 'stats.agents');
  assert(s.connected === 2, 'stats.connected');
  assert(s.topics === 1, 'stats.topics');
  assert(s.wildcards === 1, 'stats.wildcards');
  assert(s.subscriptions === 3, 'stats.subscriptions');
  assert(s.messages === 1, 'stats.messages');
  assert(s.queues === 1, 'stats.queues');
}

// ---- Event Emissions ----
console.log('\nEvent Emissions:');
{
  const r = new AgentRelay();
  const events = [];
  r.on('agent:register', id => events.push(`register:${id}`));
  r.on('sub', ({ agentId, topic }) => events.push(`sub:${agentId}:${topic}`));
  r.on('msg', msg => events.push(`msg:${msg.topic}`));
  r.on('broadcast', msg => events.push(`broadcast`));
  r.on('enqueue', ({ queueName }) => events.push(`enqueue:${queueName}`));
  r.on('dlq', ({ queueName }) => events.push(`dlq:${queueName}`));

  r.registerAgent('a1');
  r.subscribe('a1', 't');
  r.publish('t', 'x');
  r.broadcast('y');
  r.enqueue('q', 'z');
  r.requeue('q', { id: 'd', payload: 'x', retries: 5, maxRetries: 1, nextRetry: Date.now() });

  assert(events.includes('register:a1'), 'emits agent:register');
  assert(events.includes('sub:a1:t'), 'emits sub');
  assert(events.includes('msg:t'), 'emits msg');
  assert(events.includes('broadcast'), 'emits broadcast');
  assert(events.includes('enqueue:q'), 'emits enqueue');
  assert(events.includes('dlq:q'), 'emits dlq');
}

// ---- Summary ----
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
