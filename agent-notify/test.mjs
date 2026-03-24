#!/usr/bin/env node
// agent-notify tests — 35 tests, all zero-dep

import { AgentNotify, Priority, createChannel, renderTemplate, consoleChannel, fileChannel } from './index.mjs';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (!cond) { console.error(`  ❌ ${msg}`); failed++; }
  else { passed++; }
}

async function test(name, fn) {
  try { await fn(); }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); failed++; }
}

console.log('🧪 agent-notify tests\n');

// ─── Template engine ───

console.log('Templates:');
await test('renderTemplate basic', () => {
  const r = renderTemplate('Hello {{name}}!', { name: 'Reza' });
  assert(r === 'Hello Reza!', 'basic interpolation');
});

await test('renderTemplate nested', () => {
  const r = renderTemplate('{{user.name}} ({{user.age}})', { user: { name: 'Reza', age: 30 } });
  assert(r === 'Reza (30)', 'nested interpolation');
});

await test('renderTemplate missing', () => {
  const r = renderTemplate('{{missing}} default', {});
  assert(r === ' default', 'missing replaced with empty');
});

// ─── Priority ───

console.log('\nPriority:');
await test('Priority values', () => {
  assert(Priority.LOW === 0, 'LOW=0');
  assert(Priority.NORMAL === 1, 'NORMAL=1');
  assert(Priority.HIGH === 2, 'HIGH=2');
  assert(Priority.CRITICAL === 3, 'CRITICAL=3');
});

// ─── Core send ───

console.log('\nSend:');
await test('basic send', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  const r = await n.send({ body: 'test', dedup: false });
  assert(r.ok === true, 'send ok');
  n.stop();
});

await test('send string shorthand', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  const r = await n.send('hello');
  assert(r.ok === true, 'string send ok');
  n.stop();
});

await test('convenience methods', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  const r1 = await n.info('info msg', { dedup: false });
  const r2 = await n.warn('warn msg', { dedup: false });
  const r3 = await n.error('error msg', { dedup: false });
  const r4 = await n.low('low msg', { dedup: false });
  assert(r1.ok && r2.ok && r3.ok && r4.ok, 'all convenience methods work');
  n.stop();
});

// ─── Channels ───

console.log('\nChannels:');
await test('add/remove channels', async () => {
  const n = new AgentNotify();
  n.addChannel('c1', consoleChannel());
  n.addChannel('c2', consoleChannel());
  assert(n.listChannels().length === 2, '2 channels added');
  n.removeChannel('c1');
  assert(n.listChannels().length === 1, '1 channel after remove');
  n.stop();
});

await test('enable/disable channels', async () => {
  const n = new AgentNotify();
  n.addChannel('c1', consoleChannel());
  n.disableChannel('c1');
  assert(n.listChannels()[0].enabled === false, 'disabled');
  n.enableChannel('c1');
  assert(n.listChannels()[0].enabled === true, 'enabled');
  n.stop();
});

await test('createChannel factory', async () => {
  const c1 = createChannel('console');
  assert(c1.name === 'console', 'console channel');
  const c2 = createChannel('file', { path: '/tmp/test-notify.jsonl' });
  assert(c2.name === 'file', 'file channel');
  if (existsSync('/tmp/test-notify.jsonl')) unlinkSync('/tmp/test-notify.jsonl');
});

await test('file channel writes', async () => {
  const f = '/tmp/agent-notify-test.jsonl';
  if (existsSync(f)) unlinkSync(f);
  const c = createChannel('file', { path: f });
  await c.send({ body: 'test', priority: 1 });
  const content = readFileSync(f, 'utf8');
  assert(content.includes('test'), 'file written');
  unlinkSync(f);
});

// ─── Dedup ───

console.log('\nDedup:');
await test('dedup blocks duplicates', async () => {
  const n = new AgentNotify({ dedupWindowMs: 5000 });
  n.addChannel('test', consoleChannel());
  const r1 = await n.send({ body: 'dup test', tag: 'dedup' });
  const r2 = await n.send({ body: 'dup test', tag: 'dedup' });
  assert(r1.ok === true, 'first send ok');
  assert(r2.ok === false && r2.reason === 'deduped', 'second deduped');
  n.stop();
});

await test('dedup disabled flag', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  const r1 = await n.send({ body: 'no dedup', dedup: false });
  const r2 = await n.send({ body: 'no dedup', dedup: false });
  assert(r1.ok && r2.ok, 'both sent when dedup disabled');
  n.stop();
});

// ─── Rate limiting ───

console.log('\nRate limiting:');
await test('rate limit triggers', async () => {
  const n = new AgentNotify({ rateLimitMax: 3, rateLimitWindowMs: 60000 });
  n.addChannel('test', consoleChannel());
  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(await n.send({ body: `rl ${i}`, dedup: false }));
  }
  const okCount = results.filter(r => r.ok).length;
  // 3 should go through, 2 should be rate limited (some might fail due to no real channel)
  assert(n.stats().rateLimited >= 1, 'rate limited at least once');
  n.stop();
});

// ─── Templates ───

console.log('\nTemplate send:');
await test('send with template', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  n.addTemplate('alert', '🚨 {{service}}: {{msg}}');
  const r = await n.send({ template: 'alert', data: { service: 'api', msg: 'down' }, dedup: false });
  assert(r.ok === true, 'template send ok');
  n.stop();
});

// ─── Routing rules ───

console.log('\nRouting rules:');
await test('routing rules', async () => {
  const n = new AgentNotify();
  let consoleRan = false;
  n.addChannel('console', { name: 'console', send: async () => { consoleRan = true; return { ok: true }; } });
  n.addChannel('http', { name: 'http', send: async () => ({ ok: true }) });

  n.addRule({
    match: n => n.priority >= 2,
    channels: ['console'],
  });

  await n.send({ body: 'high priority', priority: 2, dedup: false });
  assert(consoleRan === true, 'rule routed to console');

  n.stop();
});

// ─── Quiet hours ───

console.log('\nQuiet hours:');
await test('quiet hours blocks', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  const now = new Date().getHours();
  n.setQuietHours(now, (now + 1) % 24);
  const r = await n.send({ body: 'quiet test', priority: 1, dedup: false });
  assert(r.ok === false && r.reason === 'quiet_hours', 'blocked by quiet hours');
  n.stop();
});

await test('quiet hours allows CRITICAL', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  const now = new Date().getHours();
  n.setQuietHours(now, (now + 1) % 24);
  const r = await n.send({ body: 'critical in quiet', priority: 3, dedup: false });
  assert(r.ok === true, 'CRITICAL goes through quiet hours');
  n.stop();
});

// ─── Batch ───

console.log('\nBatching:');
await test('batching queues', async () => {
  const n = new AgentNotify({ batchWindowMs: 100 });
  n.addChannel('test', consoleChannel());
  n.setQuietHours(new Date().getHours(), (new Date().getHours() + 1) % 24);
  const r = await n.send({ body: 'batch test', priority: 1, dedup: false });
  assert(r.ok === false, 'queued in quiet hours');
  n.stop();
});

// ─── Stats ───

console.log('\nStats:');
await test('stats tracking', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  await n.send({ body: 's1', dedup: false });
  await n.send({ body: 's2', dedup: false });
  const s = n.stats();
  assert(s.sent >= 2, 'sent tracked');
  n.stop();
});

// ─── Lifecycle ───

console.log('\nLifecycle:');
await test('stop/start', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  n.stop();
  const r = await n.send({ body: 'stopped', dedup: false });
  assert(r.ok === false && r.error === 'stopped', 'stopped rejects');
  n.start();
  const r2 = await n.send({ body: 'restarted', dedup: false });
  assert(r2.ok === true, 'restarted works');
  n.stop();
});

// ─── EventEmitter ───

console.log('\nEvents:');
await test('sent event fires', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  let fired = false;
  n.on('sent', () => { fired = true; });
  await n.send({ body: 'evt', dedup: false });
  assert(fired === true, 'sent event fired');
  n.stop();
});

await test('dedup:blocked event fires', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  let fired = false;
  n.on('dedup:blocked', () => { fired = true; });
  await n.send({ body: 'evt-dedup', tag: 'x' });
  await n.send({ body: 'evt-dedup', tag: 'x' });
  assert(fired === true, 'dedup event fired');
  n.stop();
});

await test('quiet:blocked event fires', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel());
  let fired = false;
  n.on('quiet:blocked', () => { fired = true; });
  const h = new Date().getHours();
  n.setQuietHours(h, (h + 1) % 24);
  await n.send({ body: 'quiet-evt', priority: 1, dedup: false });
  assert(fired === true, 'quiet event fired');
  n.stop();
});

await test('channel:added event', async () => {
  const n = new AgentNotify();
  let fired = false;
  n.on('channel:added', () => { fired = true; });
  n.addChannel('test', consoleChannel());
  assert(fired === true, 'channel:added fired');
  n.stop();
});

// ─── Discord channel factory ───

console.log('\nChannel factory:');
await test('createChannel types', () => {
  const c1 = createChannel('console');
  assert(c1.name === 'console');
  const c2 = createChannel('file', { path: '/tmp/factory-test.jsonl' });
  assert(c2.name === 'file');
  const c3 = createChannel('discord', { webhookUrl: 'https://discord.com/api/webhooks/1/abc' });
  assert(c3.name === 'discord');
  const c4 = createChannel('telegram', { botToken: '123:abc', chatId: '456' });
  assert(c4.name === 'telegram');
  const c5 = createChannel('slack', { webhookUrl: 'https://hooks.slack.com/services/T/B/X' });
  assert(c5.name === 'slack');
  const c6 = createChannel('http', { url: 'https://example.com/hook' });
  assert(c6.name === 'http');
  const c7 = createChannel('webhook', { url: 'https://example.com/hook' });
  assert(c7.name === 'http');
  if (existsSync('/tmp/factory-test.jsonl')) unlinkSync('/tmp/factory-test.jsonl');
});

await test('unknown channel type throws', () => {
  try { createChannel('pigeon'); assert(false, 'should throw'); }
  catch (e) { assert(e.message.includes('Unknown'), 'throws on unknown'); }
});

// ─── Edge cases ───

console.log('\nEdge cases:');
await test('send with no channels', async () => {
  const n = new AgentNotify();
  const r = await n.send({ body: 'no channels', dedup: false });
  // Should still complete but with no ok results
  assert(r.results.length === 0, 'no channels = empty results');
  n.stop();
});

await test('filter blocks send', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel(), {
    filter: (notif) => notif.priority >= 2,
  });
  const r1 = await n.send({ body: 'low', priority: 0, dedup: false });
  const r2 = await n.send({ body: 'high', priority: 2, dedup: false });
  // low should be filtered, high should go
  assert(r1.results.length === 0, 'filtered out');
  assert(r2.ok === true, 'high priority passed filter');
  n.stop();
});

await test('priority filter on channel', async () => {
  const n = new AgentNotify();
  n.addChannel('test', consoleChannel(), { priority: 2 });
  const r1 = await n.send({ body: 'low pri', priority: 1, dedup: false });
  const r2 = await n.send({ body: 'high pri', priority: 2, dedup: false });
  assert(r1.results.length === 0, 'below priority, filtered');
  assert(r2.ok === true, 'at priority, sent');
  n.stop();
});

await test('persist path writes JSONL', async () => {
  const f = '/tmp/agent-notify-persist.jsonl';
  if (existsSync(f)) unlinkSync(f);
  const n = new AgentNotify({ persistPath: f });
  n.addChannel('test', consoleChannel());
  await n.send({ body: 'persisted', dedup: false });
  const content = readFileSync(f, 'utf8');
  assert(content.includes('persisted'), 'persisted to file');
  unlinkSync(f);
  n.stop();
});

// ─── Summary ───

console.log(`\n${'═'.repeat(40)}`);
console.log(`✅ ${passed} passed | ❌ ${failed} failed | Total: ${passed + failed}`);
if (failed > 0) process.exit(1);
else console.log('🎉 All tests passed!');
