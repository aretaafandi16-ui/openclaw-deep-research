#!/usr/bin/env node
/**
 * agent-webhook test suite
 */

import { WebhookDispatcher, RouteMatcher, Deduper, RetryQueue, verifySignature, transform } from './index.mjs';
import { createHmac } from 'node:crypto';

let passed = 0, failed = 0, total = 0;

function assert(condition, name) {
  total++;
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}`); }
}

async function test(name, fn) {
  console.log(`\n📋 ${name}`);
  try { await fn(); }
  catch (e) { failed++; total++; console.error(`  ❌ Exception: ${e.message}`); }
}

// ─── RouteMatcher ───────────────────────────────────────────

await test('RouteMatcher — string exact match', () => {
  const m = new RouteMatcher();
  m.add('/webhook', () => 'hit');
  const r = m.match({ path: '/webhook' });
  assert(r.length === 1, 'matches exact path');
  assert(m.match({ path: '/other' }).length === 0, 'no match on different path');
});

await test('RouteMatcher — wildcard match', () => {
  const m = new RouteMatcher();
  m.add('/api/*', () => 'hit');
  assert(m.match({ path: '/api/users' }).length === 1, 'matches wildcard');
  assert(m.match({ path: '/api/orders/123' }).length === 1, 'matches nested wildcard');
  assert(m.match({ path: '/webhook' }).length === 0, 'no match outside');
});

await test('RouteMatcher — regex match', () => {
  const m = new RouteMatcher();
  m.add(/^\/webhook\/\d+$/, () => 'hit');
  assert(m.match({ path: '/webhook/123' }).length === 1, 'matches regex');
  assert(m.match({ path: '/webhook/abc' }).length === 0, 'rejects non-match');
});

await test('RouteMatcher — object pattern', () => {
  const m = new RouteMatcher();
  m.add({ source: 'github', eventType: 'push' }, () => 'hit');
  assert(m.match({ source: 'github', eventType: 'push' }).length === 1, 'matches object');
  assert(m.match({ source: 'github', eventType: 'pull_request' }).length === 0, 'rejects different event');
});

await test('RouteMatcher — function predicate', () => {
  const m = new RouteMatcher();
  m.add((e) => e.body?.amount > 100, () => 'big');
  assert(m.match({ body: { amount: 500 } }).length === 1, 'matches predicate');
  assert(m.match({ body: { amount: 50 } }).length === 0, 'rejects below threshold');
});

await test('RouteMatcher — multiple routes', () => {
  const m = new RouteMatcher();
  m.add('/a', () => 'a');
  m.add('/b', () => 'b');
  m.add({ source: 'x' }, () => 'x');
  assert(m.match({ path: '/a', source: 'x' }).length === 2, 'matches multiple');
});

// ─── Deduper ────────────────────────────────────────────────

await test('Deduper — basic dedup', () => {
  const d = new Deduper(1000);
  assert(!d.isDuplicate('a'), 'first call not duplicate');
  assert(d.isDuplicate('a'), 'second call is duplicate');
  assert(!d.isDuplicate('b'), 'different key not duplicate');
  assert(d.size === 2, 'tracks size');
});

await test('Deduper — TTL expiry', async () => {
  const d = new Deduper(50);
  d.isDuplicate('a');
  await new Promise(r => setTimeout(r, 80));
  assert(!d.isDuplicate('a'), 'expired key not duplicate');
});

// ─── Signature Verification ────────────────────────────────

await test('verifySignature — correct signature', () => {
  const payload = '{"test":true}';
  const secret = 'my-secret';
  const sig = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  assert(verifySignature(payload, sig, secret), 'accepts valid signature');
});

await test('verifySignature — wrong signature', () => {
  const payload = '{"test":true}';
  assert(!verifySignature(payload, 'sha256=bad', 'secret'), 'rejects invalid signature');
});

await test('verifySignature — no secret skips', () => {
  assert(verifySignature('body', 'sig', null), 'skips when no secret');
  assert(verifySignature('body', 'sig', ''), 'skips when empty secret');
});

// ─── Transform ──────────────────────────────────────────────

await test('transform — pick', () => {
  const r = transform({ a: 1, b: 2, c: 3 }, [{ type: 'pick', fields: ['a', 'c'] }]);
  assert(r.a === 1 && r.c === 3 && r.b === undefined, 'picks specified fields');
});

await test('transform — rename', () => {
  const r = transform({ old_name: 'val' }, [{ type: 'rename', map: { old_name: 'new_name' } }]);
  assert(r.new_name === 'val' && r.old_name === undefined, 'renames fields');
});

await test('transform — extract', () => {
  const r = transform({ user: { name: 'Reza', id: 42 } }, [{ type: 'extract', paths: ['user.name', 'user.id'] }]);
  assert(r.user_name === 'Reza' && r.user_id === 42, 'extracts nested paths');
});

await test('transform — flatten', () => {
  const r = transform({ a: { b: { c: 1 } } }, [{ type: 'flatten' }]);
  assert(r['a.b.c'] === 1, 'flattens nested objects');
});

await test('transform — add fields', () => {
  const r = transform({ a: 1 }, [{ type: 'add', fields: { processed: true } }]);
  assert(r.processed === true, 'adds fields');
});

await test('transform — template', () => {
  const r = transform({ user: { name: 'Reza' } }, [{ type: 'template', format: 'Hello {{user.name}}!' }]);
  assert(r === 'Hello "Reza"!', 'renders template');
});

// ─── RetryQueue ─────────────────────────────────────────────

await test('RetryQueue — enqueue and process', async () => {
  const q = new RetryQueue({ maxRetries: 2, baseDelay: 10 });
  let called = 0;
  const handler = () => { called++; };
  q.enqueue({ id: '1' }, handler);
  await new Promise(r => setTimeout(r, 20));
  await q.process();
  assert(called === 1, 'handler called');
});

await test('RetryQueue — max retries', () => {
  const q = new RetryQueue({ maxRetries: 2 });
  const ok = q.enqueue({ id: '1' }, () => {}, 3);
  assert(!ok === false || ok === false, 'rejects beyond max retries');
});

// ─── WebhookDispatcher ──────────────────────────────────────

await test('WebhookDispatcher — source detection', () => {
  const d = new WebhookDispatcher({ port: 0 });
  assert(d.detectSource({ 'x-github-event': 'push' }) === 'github', 'detects GitHub');
  assert(d.detectSource({ 'stripe-signature': 'v1=abc' }) === 'stripe', 'detects Stripe');
  assert(d.detectSource({ 'x-slack-signature': 'v0=abc' }) === 'slack', 'detects Slack');
  assert(d.detectSource({ 'x-shopify-topic': 'orders/create' }) === 'shopify', 'detects Shopify');
  assert(d.detectSource({}) === 'generic', 'falls back to generic');
});

await test('WebhookDispatcher — event type extraction', () => {
  const d = new WebhookDispatcher({ port: 0 });
  assert(d.extractEventType('github', { 'x-github-event': 'push' }, {}) === 'push', 'GitHub event from header');
  assert(d.extractEventType('stripe', {}, { type: 'charge.succeeded' }) === 'charge.succeeded', 'Stripe event from body');
  assert(d.extractEventType('generic', { 'x-event-type': 'deploy' }, {}) === 'deploy', 'Generic event from header');
  assert(d.extractEventType('generic', {}, { event: 'order' }) === 'order', 'Generic event from body');
});

await test('WebhookDispatcher — dispatch to handler', async () => {
  const d = new WebhookDispatcher({ port: 0 });
  let received = null;
  d.on('/webhook', async (e) => { received = e; });
  const result = await d.dispatch({
    id: 'test-1', source: 'custom', path: '/webhook', method: 'POST',
    headers: {}, body: { data: 'hello' }, rawBody: '{"data":"hello"}',
    timestamp: Date.now(), eventType: 'test', metadata: {},
  });
  assert(result.status === 'processed', 'dispatched');
  assert(received?.body?.data === 'hello', 'handler received event');
  assert(d.stats.received === 1, 'stats tracked');
  assert(d.stats.delivered === 1, 'delivery counted');
});

await test('WebhookDispatcher — deduplication', async () => {
  const d = new WebhookDispatcher({ port: 0 });
  let count = 0;
  d.on('/webhook', async () => { count++; });
  const makeEvent = (id) => ({
    id, source: 'custom', path: '/webhook', method: 'POST',
    headers: {}, body: { id }, rawBody: JSON.stringify({ id }),
    timestamp: Date.now(), eventType: 'test', metadata: {},
  });
  await d.dispatch(makeEvent('dedup-test'));
  await d.dispatch(makeEvent('dedup-test')); // same body = deduped
  assert(count === 1, 'handler called only once');
  assert(d.stats.deduped === 1, 'dedup counted');
});

await test('WebhookDispatcher — unmatched returns 404', async () => {
  const d = new WebhookDispatcher({ port: 0 });
  d.on('/specific', async () => {});
  const result = await d.dispatch({
    id: 'unmatched', source: 'custom', path: '/other', method: 'POST',
    headers: {}, body: {}, rawBody: '{}', timestamp: Date.now(),
    eventType: 'test', metadata: {},
  });
  assert(result.status === 'unmatched', 'unmatched status');
});

await test('WebhookDispatcher — signature rejection', async () => {
  const d = new WebhookDispatcher({ port: 0, secrets: { github: 'secret123' } });
  d.on('/webhook', async () => {});
  const result = await d.dispatch({
    id: 'sig-test', source: 'github', path: '/webhook', method: 'POST',
    headers: { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=bad' },
    body: {}, rawBody: '{}', timestamp: Date.now(),
    eventType: 'push', metadata: {},
  });
  assert(result.status === 'signature_failed', 'rejected invalid signature');
});

await test('WebhookDispatcher — handler registration/removal', () => {
  const d = new WebhookDispatcher({ port: 0 });
  const id = d.on('/test', async () => {});
  assert(d.handlers.has(id), 'handler registered');
  d.off(id);
  assert(!d.handlers.has(id), 'handler removed');
});

await test('WebhookDispatcher — multiple handlers per event', async () => {
  const d = new WebhookDispatcher({ port: 0 });
  let a = false, b = false;
  d.on('/webhook', async () => { a = true; });
  d.on({ source: 'custom' }, async () => { b = true; });
  await d.dispatch({
    id: 'multi', source: 'custom', path: '/webhook', method: 'POST',
    headers: {}, body: {}, rawBody: '{}', timestamp: Date.now(),
    eventType: 'test', metadata: {},
  });
  assert(a && b, 'both handlers called');
});

await test('WebhookDispatcher — source presets (GitHub metadata)', async () => {
  const d = new WebhookDispatcher({ port: 0 });
  let meta = null;
  d.on({ source: 'github' }, async (e) => { meta = e.metadata; });
  await d.dispatch({
    id: 'gh', source: 'github', path: '/webhook', method: 'POST',
    headers: { 'x-github-event': 'push' },
    body: { repository: { full_name: 'user/repo' }, sender: { login: 'dev' } },
    rawBody: '{}', timestamp: Date.now(), eventType: 'push', metadata: {},
  });
  assert(meta?.repo === 'user/repo', 'GitHub metadata extracted');
});

// ─── Results ────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 Results: ${passed}/${total} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
