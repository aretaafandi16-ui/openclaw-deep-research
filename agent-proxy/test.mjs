#!/usr/bin/env node

/**
 * agent-proxy tests — zero-dependency test runner
 */

import { AgentProxy, RateLimiter, CircuitBreaker, HealthChecker, LoadBalancer, ResponseCache, Deduplicator } from './index.mjs';
import { createServer } from 'http';

let passed = 0, failed = 0, total = 0;

function assert(condition, name) {
  total++;
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}`); }
}

// ── Mock upstream server ───────────────────────────────────────────────────

let upstreamServer;
let upstreamPort;

function startMockServer() {
  return new Promise((resolve) => {
    upstreamServer = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/health') {
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'ok' }));
      }
      if (req.url === '/unhealthy') {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: 'unhealthy' }));
      }
      if (req.url === '/echo') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          res.writeHead(200);
          res.end(JSON.stringify({ method: req.method, body, headers: req.headers }));
        });
        return;
      }
      if (req.url === '/slow') {
        setTimeout(() => { res.writeHead(200); res.end(JSON.stringify({ delayed: true })); }, 200);
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ url: req.url, method: req.method }));
    });

    upstreamServer.listen(0, () => {
      upstreamPort = upstreamServer.address().port;
      resolve();
    });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function runTests() {
  await startMockServer();
  const target = `http://localhost:${upstreamPort}`;

  // RateLimiter
  console.log('\n📊 RateLimiter:');
  {
    const rl = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
    assert(rl.tryAcquire().allowed === true, 'First request allowed');
    assert(rl.tryAcquire().allowed === true, 'Second request allowed');
    assert(rl.tryAcquire().allowed === true, 'Third request allowed');
    assert(rl.tryAcquire().allowed === false, 'Fourth request blocked');
    const s = rl.stats();
    assert(s.current === 3 && s.max === 3, 'Stats show 3/3');
  }

  // CircuitBreaker
  console.log('\n⚡ CircuitBreaker:');
  {
    const cb = new CircuitBreaker({ threshold: 3, resetTimeMs: 500 });
    assert(cb.state === 'closed', 'Initial state is closed');
    assert(cb.canAttempt() === true, 'Can attempt when closed');
    cb.recordFailure(); cb.recordFailure();
    assert(cb.state === 'closed', 'Still closed after 2 failures');
    cb.recordFailure();
    assert(cb.state === 'open', 'Opens after 3 failures');
    assert(cb.canAttempt() === false, 'Cannot attempt when open');
    const s = cb.status();
    assert(s.state === 'open' && s.failures === 3, 'Status shows open with 3 failures');

    // Wait for reset
    await new Promise(r => setTimeout(r, 600));
    assert(cb.canAttempt() === true, 'Can attempt after reset timeout (half-open)');
    cb.recordSuccess(); cb.recordSuccess();
    assert(cb.state === 'closed', 'Closes after 2 successes in half-open');
  }

  // LoadBalancer
  console.log('\n⚖️ LoadBalancer:');
  {
    const lb = new LoadBalancer('round-robin', ['http://a:1', 'http://b:2', 'http://c:3']);
    const t1 = lb.next();
    const t2 = lb.next();
    const t3 = lb.next();
    const t4 = lb.next();
    assert(t1.url === 'http://b:2', 'Round-robin cycles (t1)');
    assert(t4.url === 'http://b:2', 'Round-robin wraps around (t4)');
    lb.removeTarget('http://b:2');
    assert(lb.targets.length === 2, 'Remove target works');

    const rlb = new LoadBalancer('random', ['http://a:1', 'http://b:2']);
    const rt = rlb.next();
    assert(rt && rt.url, 'Random returns a target');

    const wlb = new LoadBalancer('weighted', [{ url: 'http://a:1', weight: 10 }, { url: 'http://b:2', weight: 1 }]);
    assert(wlb.next() && wlb.next(), 'Weighted returns targets');

    const llb = new LoadBalancer('least-connections', [{ url: 'http://a:1', activeConnections: 5 }, { url: 'http://b:2', activeConnections: 1 }]);
    const lt = llb.next();
    assert(lt.url === 'http://b:2', 'Least-connections picks lowest');
  }

  // ResponseCache
  console.log('\n🗄️ ResponseCache:');
  {
    const cache = new ResponseCache({ maxSize: 5, defaultTtlMs: 1000 });
    assert(cache.get('GET', '/a') === null, 'Cache miss on empty');
    cache.set('GET', '/a', { status: 200, body: 'hello' });
    assert(cache.get('GET', '/a')?.status === 200, 'Cache hit after set');
    cache.invalidate('GET', '/a');
    assert(cache.get('GET', '/a') === null, 'Invalidate works');

    for (let i = 0; i < 6; i++) cache.set('GET', `/x${i}`, { i });
    assert(cache.stats().size === 5, 'Max size enforced');

    cache.set('GET', '/expire', { data: true }, 10);
    await new Promise(r => setTimeout(r, 20));
    assert(cache.get('GET', '/expire') === null, 'TTL expiry works');
  }

  // Deduplicator
  console.log('\n🔁 Deduplicator:');
  {
    const dedup = new Deduplicator();
    let callCount = 0;
    const p1 = dedup.deduplicate('key', async () => { callCount++; await new Promise(r => setTimeout(r, 50)); return 'result'; });
    const p2 = dedup.deduplicate('key', async () => { callCount++; return 'result2'; });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert(callCount === 1, 'Dedup prevents double execution');
    assert(r1 === r2, 'Both promises get same result');
  }

  // AgentProxy — forward
  console.log('\n🐋 AgentProxy:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('test', { targets: [target], prefix: '/api' });

    const r1 = await proxy.forward({ method: 'GET', url: '/api/echo', headers: {} }, 'test');
    assert(r1.status === 200, 'Forward GET succeeds');
    assert(r1.headers['X-Proxy-Route'] === 'test', 'Response has route header');

    const r2 = await proxy.forward({ method: 'POST', url: '/api/echo', headers: {}, body: { msg: 'hi' } }, 'test');
    assert(r2.status === 200, 'Forward POST succeeds');

    proxy.removeRoute('test');
    assert(proxy.getRoute('test') === undefined, 'Route removed');

    const stats = proxy.stats();
    assert(stats.requests >= 2, 'Stats track requests');
  }

  // AgentProxy — rate limiting
  console.log('\n🚦 Rate Limiting:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('limited', { targets: [target], prefix: '/rl', rateLimit: { maxRequests: 2, windowMs: 60000 } });

    const r1 = await proxy.forward({ method: 'GET', url: '/rl/echo', headers: {} }, 'limited');
    assert(r1.status === 200, 'First request passes rate limit');
    const r2 = await proxy.forward({ method: 'GET', url: '/rl/echo', headers: {} }, 'limited');
    assert(r2.status === 200, 'Second request passes rate limit');
    const r3 = await proxy.forward({ method: 'GET', url: '/rl/echo', headers: {} }, 'limited');
    assert(r3.status === 429, 'Third request is rate limited');
  }

  // AgentProxy — circuit breaker
  console.log('\n⚡ Circuit Breaker Integration:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('cb', { targets: [target], prefix: '/cb', circuitBreaker: { threshold: 2, resetTimeMs: 1000 } });

    // Hit unhealthy endpoint
    const r1 = await proxy.forward({ method: 'GET', url: '/cb/unhealthy', headers: {} }, 'cb');
    // The proxy returns the upstream response, so circuit records success on HTTP-level success
    // We need to trigger actual failures (connection errors)
    proxy.addRoute('cb2', { targets: ['http://localhost:1'], prefix: '/cb2', circuitBreaker: { threshold: 2, resetTimeMs: 500 }, retries: 0 });
    const r2 = await proxy.forward({ method: 'GET', url: '/cb2/test', headers: {} }, 'cb2');
    assert(r2.status === 502, 'Connection failure returns 502');
    const r3 = await proxy.forward({ method: 'GET', url: '/cb2/test', headers: {} }, 'cb2');
    assert(r3.status === 502, 'Second failure returns 502');

    const cbRoute = proxy.getRoute('cb2');
    assert(cbRoute.circuitBreaker.state === 'open', 'Circuit opens after failures');
  }

  // AgentProxy — caching
  console.log('\n🗄️ Caching:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('cached', { targets: [target], prefix: '/c', cacheTtlMs: 5000 });

    const r1 = await proxy.forward({ method: 'GET', url: '/c/echo', headers: {} }, 'cached');
    assert(r1.headers['X-Cache'] !== 'HIT', 'First request is cache miss');
    const r2 = await proxy.forward({ method: 'GET', url: '/c/echo', headers: {} }, 'cached');
    assert(r2.headers['X-Cache'] === 'HIT', 'Second request is cache hit');
  }

  // AgentProxy — middleware
  console.log('\n🔗 Middleware:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('mw', { targets: [target], prefix: '/mw' });
    let beforeCalled = false, afterCalled = false;
    proxy.before(async (req) => { beforeCalled = true; req.headers['x-custom'] = 'added'; });
    proxy.after(async (res) => { afterCalled = true; res.headers['x-modified'] = 'yes'; });

    await proxy.forward({ method: 'GET', url: '/mw/echo', headers: {} }, 'mw');
    assert(beforeCalled, 'Before middleware called');
    assert(afterCalled, 'After middleware called');
  }

  // AgentProxy — retries
  console.log('\n🔄 Retries:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('retry', { targets: ['http://localhost:1'], prefix: '/r', retries: 2 });
    const start = Date.now();
    const r = await proxy.forward({ method: 'GET', url: '/r/test', headers: {} }, 'retry');
    const elapsed = Date.now() - start;
    assert(r.status === 502, 'Retry exhausts and returns 502');
    assert(elapsed >= 300, 'Retries add delay (backoff)');
  }

  // AgentProxy — timeout
  console.log('\n⏱️ Timeout:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('timeout', { targets: [target], prefix: '/t', stripPrefix: '/t', timeoutMs: 50, retries: 0 });
    const r = await proxy.forward({ method: 'GET', url: '/t/slow', headers: {} }, 'timeout');
    assert(r.status === 502, 'Slow request times out (50ms timeout, 200ms response)');
  }

  // AgentProxy — events
  console.log('\n📡 Events:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('events', { targets: [target], prefix: '/e' });
    let eventFired = false;
    proxy.on('request', () => { eventFired = true; });
    await proxy.forward({ method: 'GET', url: '/e/echo', headers: {} }, 'events');
    assert(eventFired, 'Request event fired');
  }

  // AgentProxy — stats
  console.log('\n📊 Stats:');
  {
    const proxy = new AgentProxy();
    proxy.addRoute('s', { targets: [target], prefix: '/s' });
    await proxy.forward({ method: 'GET', url: '/s/echo', headers: {} }, 's');
    const stats = proxy.stats();
    assert(stats.requests >= 1, 'Global stats tracked');
    assert(stats.routes === 1, 'Route count correct');
    const rs = proxy.routeStats();
    assert(rs.s && rs.s.requests >= 1, 'Per-route stats tracked');
  }

  // ── Results ─────────────────────────────────────────────────────────────
  upstreamServer.close();
  console.log(`\n${'═'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  else console.log('🎉 All tests passed!');
}

runTests().catch(err => { console.error(err); process.exit(1); });
