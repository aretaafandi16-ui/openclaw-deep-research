/**
 * agent-queue test suite
 */

import { AgentQueue, matchesTopic } from './index.mjs';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = '/tmp/agent-queue-test-' + Date.now();
let passed = 0, failed = 0, total = 0;

function assert(cond, msg) {
  total++;
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => console.log(`  ✓ ${name}`)).catch(e => { failed++; total++; console.error(`  ✗ ${name}: ${e.message}`); });
      return;
    }
    console.log(`  ✓ ${name}`);
  }
  catch (e) { failed++; total++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// Clean up
if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });

// ─── Topic Matching ──────────────────────────────────────────────

test('matchesTopic exact match', () => {
  assert(matchesTopic('foo.bar', 'foo.bar'), 'exact');
});

test('matchesTopic single wildcard', () => {
  assert(matchesTopic('foo.*', 'foo.bar'), 'single wildcard');
  assert(!matchesTopic('foo.*', 'foo.bar.baz'), 'too deep');
});

test('matchesTopic double wildcard', () => {
  assert(matchesTopic('foo.**', 'foo.bar.baz'), 'double wildcard');
  assert(matchesTopic('foo.**', 'foo.bar'), 'shallow');
});

test('matchesTopic no match', () => {
  assert(!matchesTopic('foo.bar', 'baz.qux'), 'no match');
});

// ─── Basic Publish/Subscribe ─────────────────────────────────────

test('publish and receive', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'pubsub'), enablePersistence: true });
  let received = null;
  q.subscribe('test.topic', (msg) => { received = msg; });
  q.publish('test.topic', { hello: 'world' });
  assert(received !== null, 'received');
  assert(received.payload.hello === 'world', 'payload');
  q.destroy();
});

test('wildcard subscribe', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'wildcard') });
  const msgs = [];
  q.subscribe('events.*', (msg) => msgs.push(msg.topic));
  q.publish('events.click', 1);
  q.publish('events.hover', 2);
  q.publish('other.thing', 3);
  assert(msgs.length === 2, 'got 2');
  assert(msgs.includes('events.click'), 'click');
  assert(msgs.includes('events.hover'), 'hover');
  q.destroy();
});

// ─── Ack/Nack ────────────────────────────────────────────────────

test('ack removes from inflight', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'ack') });
  let ackFn = null;
  const subId = q.subscribe('ack.test', (msg, { ack }) => { ackFn = ack; });
  q.publish('ack.test', 'data');
  ackFn();
  const sub = q.subscribers.get(subId);
  assert(sub.inflight.size === 0, 'inflight empty');
  assert(sub.acked === 1, 'acked count');
  q.destroy();
});

test('nack with requeue re-delivers', async () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'nack'), retryDelay: 50 });
  let count = 0;
  let lastNackFn = null;
  q.subscribe('nack.test', (msg, { nack }) => {
    count++;
    if (count === 1) { lastNackFn = nack; }
  });
  q.publish('nack.test', 'data');
  // Trigger nack
  lastNackFn({ requeue: true });
  // Wait for retry
  await new Promise(r => setTimeout(r, 300));
  assert(count >= 2, `re-delivered (count=${count})`);
  q.destroy();
});

// ─── Priority ────────────────────────────────────────────────────

test('priority ordering', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'priority') });
  // Publish all first, then subscribe to check bucket ordering
  q.publish('pri.test', 'low', { priority: 'low' });
  q.publish('pri.test', 'critical', { priority: 'critical' });
  q.publish('pri.test', 'normal', { priority: 'normal' });
  q.publish('pri.test', 'high', { priority: 'high' });

  // Check bucket order
  const bucket = q.topics.get('pri.test');
  assert(bucket[0].priorityValue === 3, 'critical first (3)');
  assert(bucket[1].priorityValue === 2, 'high second (2)');
  assert(bucket[2].priorityValue === 1, 'normal third (1)');
  assert(bucket[3].priorityValue === 0, 'low last (0)');
  q.destroy();
});

test('priority delivery order', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'pri-del') });
  const order = [];
  // Subscribe after publish, so delivery happens from bucket order
  q.publish('pd.test', 'low', { priority: 'low' });
  q.publish('pd.test', 'critical', { priority: 'critical' });
  q.publish('pd.test', 'high', { priority: 'high' });
  q.subscribe('pd.test', (msg) => order.push(msg.payload));
  // Now subscribe triggers _deliverPending which respects bucket order
  assert(order[0] === 'critical', 'critical first');
  assert(order[1] === 'high', 'high second');
  assert(order[2] === 'low', 'low last');
  q.destroy();
});

// ─── TTL ─────────────────────────────────────────────────────────

test('message TTL expiry', async () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'ttl') });
  const msg = q.publish('ttl.test', 'data', { ttl: 5 });
  await new Promise(r => setTimeout(r, 10));
  const m = q.messages.get(msg.id);
  assert(m.expired === true, `expired (age=${Date.now() - m.createdAt}ms, ttl=${m.ttl})`);
  q.destroy();
});

// ─── Dead Letter ─────────────────────────────────────────────────

test('dead letter on max retries', async () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'dl'), maxRetries: 1, retryDelay: 50 });
  let nackFns = [];
  q.subscribe('dl.test', (msg, { nack }) => {
    nackFns.push(nack);
  });
  q.publish('dl.test', 'fail-me');
  // First delivery - nack
  assert(nackFns.length === 1, 'first delivery');
  nackFns[0]();
  // Wait for retry delivery
  await new Promise(r => setTimeout(r, 200));
  // Second delivery - nack again -> dead letter
  assert(nackFns.length >= 2, `second delivery (got ${nackFns.length})`);
  if (nackFns.length >= 2) nackFns[1]();
  await new Promise(r => setTimeout(r, 100));
  assert(q.deadLetter.length >= 1, `dead lettered (count=${q.deadLetter.length})`);
  q.destroy();
});

test('replay dead letter', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'dl-replay'), maxRetries: 1, retryDelay: 10 });
  let received = false;
  q.subscribe('dlr.test', (msg) => { received = true; });
  // Force dead letter entry
  q.deadLetter.push({ id: 'test-dl', topic: 'dlr.test', payload: 'retry', attempts: 3, message: { id: 'test-dl', topic: 'dlr.test', payload: 'retry', priority: 'normal', ttl: 0, headers: {} } });
  const result = q.replayDeadLetter('test-dl');
  assert(result !== null, 'replayed');
  assert(received, 'delivered on replay');
  q.destroy();
});

// ─── Request/Reply ───────────────────────────────────────────────

test('request-reply pattern', async () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'reqreply') });
  q.subscribe('echo', (msg, { ack }) => {
    q.reply(msg, { echoed: msg.payload });
    ack();
  });
  const reply = await q.request('echo', 'hello');
  assert(reply.payload.echoed === 'hello', 'reply received');
  q.destroy();
});

test('request timeout', async () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'reqtimeout') });
  try {
    await q.request('no-handler', 'hello', { timeout: 100 });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.message.includes('timeout'), 'timeout error');
  }
  q.destroy();
});

// ─── Queries ─────────────────────────────────────────────────────

test('getMessages query', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'query') });
  q.publish('q.test', 'a');
  q.publish('q.test', 'b');
  q.publish('q.other', 'c');
  const msgs = q.getMessages('q.test');
  assert(msgs.length === 2, 'got 2');
  q.destroy();
});

test('getTopics', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'topics') });
  q.publish('t1', 1);
  q.publish('t2', 2);
  q.publish('t1', 3);
  const topics = q.getTopics();
  assert(topics.length === 2, '2 topics');
  assert(topics.find(t => t.topic === 't1').total === 2, 't1 has 2');
  q.destroy();
});

test('getSubscribers', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'subs') });
  q.subscribe('a', () => {});
  q.subscribe('b', () => {});
  const subs = q.getSubscribers();
  assert(subs.length === 2, '2 subs');
  q.destroy();
});

// ─── Purge ───────────────────────────────────────────────────────

test('purge topic', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'purge') });
  q.publish('purge.me', 1);
  q.publish('purge.me', 2);
  q.publish('keep.me', 3);
  const count = q.purge('purge.me');
  assert(count === 2, 'purged 2');
  assert(q.getMessages('purge.me').length === 0, 'empty');
  assert(q.getMessages('keep.me').length === 1, 'kept');
  q.destroy();
});

test('purge all', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'purge-all') });
  q.publish('a', 1);
  q.publish('b', 2);
  const count = q.purge();
  assert(count === 2, 'purged all');
  assert(q.messages.size === 0, 'empty');
  q.destroy();
});

// ─── Consumer Groups ─────────────────────────────────────────────

test('consumer group round-robin', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'groups') });
  const received = { a: 0, b: 0 };
  q.subscribeGroup('workers', 'work.*', () => { received.a++; });
  q.subscribeGroup('workers', 'work.*', () => { received.b++; });
  q.publish('work.task', 1);
  q.publish('work.task', 2);
  q.publish('work.task', 3);
  // Each publish goes to exactly one consumer (round-robin)
  assert(received.a + received.b === 3, `total=3 (a=${received.a} b=${received.b})`);
  assert(Math.abs(received.a - received.b) <= 1, 'balanced');
  q.destroy();
});

// ─── Events ──────────────────────────────────────────────────────

test('emits published event', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'events') });
  let emitted = false;
  q.on('published', () => { emitted = true; });
  q.publish('evt.test', 'hi');
  assert(emitted, 'event fired');
  q.destroy();
});

test('emits subscribed event', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'evt-sub') });
  let emitted = false;
  q.on('subscribed', () => { emitted = true; });
  q.subscribe('x', () => {});
  assert(emitted, 'event fired');
  q.destroy();
});

test('emits acked event', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'evt-ack') });
  let acked = false;
  let ackFn = null;
  q.on('acked', () => { acked = true; });
  q.subscribe('ack-evt', (msg, { ack }) => { ackFn = ack; });
  q.publish('ack-evt', 'data');
  ackFn();
  assert(acked, 'acked event fired');
  q.destroy();
});

// ─── Backpressure ────────────────────────────────────────────────

test('backpressure drops old messages', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'bp'), maxDepth: 5 });
  let dropped = false;
  q.on('dropped', () => { dropped = true; });
  for (let i = 0; i < 10; i++) q.publish('bp.test', i);
  assert(dropped, 'dropped fired');
  assert(q.messages.size <= 5, 'depth limited');
  q.destroy();
});

// ─── Snapshot / Recovery ─────────────────────────────────────────

test('snapshot and recovery', () => {
  const dir = join(DATA_DIR, 'snapshot');
  const q1 = new AgentQueue({ dataDir: dir });
  q1.publish('snap.test', 'persisted');
  q1.snapshot();
  q1.destroy();

  const q2 = new AgentQueue({ dataDir: dir });
  assert(q2.messages.size === 1, 'recovered 1 message');
  const msgs = q2.getMessages('snap.test');
  assert(msgs.length === 1, 'queryable');
  assert(msgs[0].payload === 'persisted', 'payload intact');
  q2.destroy();
});

// ─── Replay ──────────────────────────────────────────────────────

test('replay messages', async () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'replay') });
  q.publish('replay.test', 'a');
  q.publish('replay.test', 'b');
  q.publish('replay.test', 'c');
  const received = [];
  await q.replay('replay.test', (msg) => received.push(msg.payload));
  assert(received.length === 3, 'replayed 3');
  assert(received.join(',') === 'a,b,c', 'order preserved');
  q.destroy();
});

// ─── Headers ─────────────────────────────────────────────────────

test('message headers', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'headers') });
  let receivedHeaders = null;
  q.subscribe('hdr.*', (msg) => { receivedHeaders = msg.headers; });
  q.publish('hdr.test', 'data', { headers: { 'x-source': 'test' } });
  assert(receivedHeaders['x-source'] === 'test', 'headers preserved');
  q.destroy();
});

// ─── No-match handling ───────────────────────────────────────────

test('undelivered event for no subscribers', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'undelivered') });
  let undelivered = false;
  q.on('undelivered', () => { undelivered = true; });
  q.publish('no.sub', 'data');
  assert(undelivered, 'undelivered fired');
  q.destroy();
});

// ─── Empty topic queries ─────────────────────────────────────────

test('getMessages on empty topic', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'empty') });
  const msgs = q.getMessages('nonexistent');
  assert(msgs.length === 0, 'empty array');
  q.destroy();
});

test('purge nonexistent topic', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'purgex') });
  const count = q.purge('nonexistent');
  assert(count === 0, 'zero purged');
  q.destroy();
});

// ─── Stats ───────────────────────────────────────────────────────

test('stats track published/delivered', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'stats') });
  q.subscribe('s.*', () => {});
  q.publish('s.a', 1);
  q.publish('s.b', 2);
  q.publish('s.c', 3);
  assert(q.stats.published === 3, 'published=3');
  assert(q.stats.delivered === 3, 'delivered=3');
  assert(q.stats.active === 3, 'active=3');
  q.destroy();
});

// ─── Double unsubscribe ──────────────────────────────────────────

test('double unsubscribe returns false', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'unsub2') });
  const subId = q.subscribe('x', () => {});
  assert(q.unsubscribe(subId) === true, 'first unsub');
  assert(q.unsubscribe(subId) === false, 'second unsub');
  q.destroy();
});

// ─── Custom filter ───────────────────────────────────────────────

test('subscriber filter', () => {
  const q = new AgentQueue({ dataDir: join(DATA_DIR, 'filter') });
  const received = [];
  q.subscribe('f.*', (msg) => received.push(msg), {
    filter: (msg) => msg.payload > 5
  });
  q.publish('f.a', 3);
  q.publish('f.b', 10);
  q.publish('f.c', 7);
  q.publish('f.d', 1);
  assert(received.length === 2, `filtered: got ${received.length}`);
  assert(received[0].payload === 10, 'first=10');
  assert(received[1].payload === 7, 'second=7');
  q.destroy();
});

// ─── Summary ─────────────────────────────────────────────────────

// Wait for async tests
function finalSummary() {
  console.log(`\n  ${passed}/${total} passed, ${failed} failed\n`);
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

setTimeout(finalSummary, 1000);
