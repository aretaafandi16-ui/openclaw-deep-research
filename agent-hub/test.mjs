#!/usr/bin/env node
/**
 * agent-hub test suite
 */

import { AgentHub } from './index.mjs';
import { rmSync, existsSync } from 'fs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

const DATA_DIR = '.hub-test-data';
if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true });

console.log('agent-hub tests\n');

// ─── Registration ─────────────────────────────────────────────────────
console.log('Registration:');
{
  const hub = new AgentHub({ persist: false });
  const a = hub.register({ name: 'agent-1', capabilities: ['translate'], tags: ['fast'], version: '1.0.0' });
  assert(a.id, 'register returns agent with id');
  assert(a.name === 'agent-1', 'name set');
  assert(a.capabilities[0] === 'translate', 'capabilities set');
  assert(a.status === 'online', 'default status online');
  assert(hub.agents.size === 1, 'agent in map');

  const a2 = hub.register({ name: 'agent-2', capabilities: ['translate', 'summarize'] });
  assert(hub.agents.size === 2, 'second agent registered');
  assert(hub.capabilities.get('translate').size === 2, 'capability index updated');
  assert(hub.capabilities.get('summarize').size === 1, 'new capability indexed');

  const ok = hub.unregister(a.id);
  assert(ok === true, 'unregister returns true');
  assert(hub.agents.size === 1, 'agent removed');
  assert(hub.capabilities.has('translate'), 'capability still exists (other agent)');
  assert(hub.capabilities.has('summarize'), 'summarize still exists (agent-2 has it)');
  assert(hub.capabilities.get('translate').size === 1, 'translate has 1 agent left');

  // Now unregister agent-2 too — capabilities should be cleaned up
  hub.unregister(a2.id);
  assert(!hub.capabilities.has('translate'), 'translate removed after last agent unregistered');
  assert(!hub.capabilities.has('summarize'), 'summarize removed after last agent unregistered');

  const ok2 = hub.unregister('nonexistent');
  assert(ok2 === false, 'unregister nonexistent returns false');
}

// ─── Heartbeat ────────────────────────────────────────────────────────
console.log('Heartbeat:');
{
  const hub = new AgentHub({ persist: false, heartbeatTimeout: 100 });
  const a = hub.register({ name: 'hb-agent' });
  assert(hub.heartbeat(a.id), 'heartbeat returns true');
  assert(hub.heartbeat(a.id, { load: 5 }), 'heartbeat with load');
  const ag = hub.agents.get(a.id);
  assert(ag.load === 5, 'load updated');
  assert(hub.heartbeat('nonexistent') === false, 'heartbeat nonexistent returns false');
}

// ─── Discovery ────────────────────────────────────────────────────────
console.log('Discovery:');
{
  const hub = new AgentHub({ persist: false });
  hub.register({ name: 'fast-trans', capabilities: ['translate'], tags: ['fast', 'es'], version: '1.0.0', metadata: { quality: 9 } });
  hub.register({ name: 'slow-trans', capabilities: ['translate'], tags: ['slow', 'fr'], version: '2.0.0', metadata: { quality: 5 } });
  hub.register({ name: 'coder', capabilities: ['code'], tags: ['fast'], version: '1.5.0' });

  let r = hub.discover({ capability: 'translate' });
  assert(r.length === 2, 'discover by capability');

  r = hub.discover({ tags: ['fast'] });
  assert(r.length === 2, 'discover by tags');

  r = hub.discover({ capability: 'translate', tags: ['fast'] });
  assert(r.length === 1, 'capability + tags filter');
  assert(r[0].name === 'fast-trans', 'correct agent');

  r = hub.discover({ version: '^1.0.0' });
  assert(r.length === 2, 'semver range matching');

  r = hub.discover({ metadata: { quality: { $gte: 7 } } });
  assert(r.length === 1, 'metadata filter $gte');

  r = hub.discover({ sort: 'load' });
  assert(r.length === 3, 'sort by load');

  r = hub.discover({ limit: 1 });
  assert(r.length === 1, 'limit works');

  r = hub.discover({ status: 'offline' });
  assert(r.length === 0, 'status filter works');

  // Include offline
  hub.agents.get([...hub.agents.keys()][0]).status = 'offline';
  r = hub.discover({ status: 'offline' });
  assert(r.length === 1, 'offline status filter');
}

// ─── Routing ──────────────────────────────────────────────────────────
console.log('Routing:');
{
  const hub = new AgentHub({ persist: false });
  hub.register({ name: 'a1', capabilities: ['x'] });
  hub.register({ name: 'a2', capabilities: ['x'] });
  hub.register({ name: 'a3', capabilities: ['x'] });

  // Round robin
  const r1 = hub.route('x', { strategy: 'round_robin' });
  const r2 = hub.route('x', { strategy: 'round_robin' });
  const r3 = hub.route('x', { strategy: 'round_robin' });
  const r4 = hub.route('x', { strategy: 'round_robin' });
  assert(r1.name !== r2.name || r2.name !== r3.name, 'round_robin distributes');

  // Random
  const rr = hub.route('x', { strategy: 'random' });
  assert(rr && rr.id, 'random selects agent');

  // Least loaded
  hub.agents.get(r1.id).load = 10;
  const ll = hub.route('x', { strategy: 'least_loaded' });
  assert(ll.id !== r1.id, 'least_loaded avoids high-load agent');

  // Weighted
  hub.register({ name: 'w1', capabilities: ['y'], metadata: { weight: 10 } });
  hub.register({ name: 'w2', capabilities: ['y'], metadata: { weight: 1 } });
  const ws = [];
  for (let i = 0; i < 20; i++) ws.push(hub.route('y', { strategy: 'weighted' }).name);
  assert(ws.filter(n => n === 'w1').length > ws.filter(n => n === 'w2').length, 'weighted favors higher weight');

  // Best match
  hub.register({ name: 'bm1', capabilities: ['z'], tags: ['premium'], metadata: { quality: 10 } });
  hub.agents.get([...hub.agents.keys()].find(id => hub.agents.get(id).name === 'bm1')).totalTasks = 50;
  hub.agents.get([...hub.agents.keys()].find(id => hub.agents.get(id).name === 'bm1')).successTasks = 48;
  const bm = hub.route('z', { strategy: 'best_match', tags: ['premium'] });
  assert(bm.name === 'bm1', 'best_match selects optimal');

  // No candidates
  const nc = hub.route('nonexistent');
  assert(nc === null, 'no candidates returns null');

  // Route complete — fresh hub to isolate load state
  {
    const hub2 = new AgentHub({ persist: false });
    hub2.register({ name: 'b1', capabilities: ['x'] });
    hub2.register({ name: 'b2', capabilities: ['x'] });
    const r = hub2.route('x');
    assert(hub2.routeComplete(r.routeId, { success: true, latencyMs: 50 }), 'routeComplete returns true');
    const ag = hub2.agents.get(r.id);
    assert(ag.totalTasks === 1, 'totalTasks incremented');
    assert(ag.successTasks === 1, 'successTasks incremented');
    assert(ag.load === 0, 'load decremented after complete');
  }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────
console.log('Circuit Breaker:');
{
  const hub = new AgentHub({ persist: false, circuitBreakerThreshold: 3 });
  const a = hub.register({ name: 'cb-agent', capabilities: ['test'] });

  // Simulate failures
  for (let i = 0; i < 3; i++) {
    const r = hub.route('test');
    hub.routeComplete(r.routeId, { success: false });
  }
  assert(hub.getCircuitStatus(a.id).state === 'open', 'circuit opens after threshold failures');

  // Should not route to open circuit
  const nr = hub.route('test');
  assert(nr === null, 'no routing to open circuit');

  // Force half-open
  hub.circuitBreakers.get(a.id).state = 'half_open';
  hub.circuitBreakers.get(a.id).failures = 0;
  const hr = hub.route('test');
  assert(hr && hr.id === a.id, 'routes to half-open agent');
  hub.routeComplete(hr.routeId, { success: true });
  assert(hub.getCircuitStatus(a.id).state === 'closed', 'circuit closes on success');
}

// ─── Named Routes ─────────────────────────────────────────────────────
console.log('Named Routes:');
{
  const hub = new AgentHub({ persist: false });
  hub.register({ name: 'r1', capabilities: ['cap1'] });
  hub.register({ name: 'r2', capabilities: ['cap2'] });

  hub.addRoute('my-route', { capability: 'cap1', strategy: 'round_robin' });
  assert(hub.routes.has('my-route'), 'route added');

  const result = hub.executeRoute('my-route');
  assert(result && result.name === 'r1', 'executeRoute selects correct agent');

  hub.addRoute('fallback-route', { capability: 'missing', strategy: 'random', fallback: 'cap2' });
  const fr = hub.executeRoute('fallback-route');
  assert(fr && fr.name === 'r2', 'fallback route works');

  hub.removeRoute('my-route');
  assert(!hub.routes.has('my-route'), 'route removed');
}

// ─── Groups & Namespaces ──────────────────────────────────────────────
console.log('Groups:');
{
  const hub = new AgentHub({ persist: false, namespace: 'prod' });
  hub.register({ name: 'g1', capabilities: ['x'], group: 'frontend' });
  hub.register({ name: 'g2', capabilities: ['x'], group: 'backend' });
  hub.register({ name: 'g3', capabilities: ['x'], group: 'frontend' });

  const groups = hub.listGroups();
  assert(groups.length === 2, 'two groups');
  assert(groups.find(g => g.group === 'frontend').agentCount === 2, 'frontend has 2 agents');

  const r = hub.discover({ capability: 'x', group: 'frontend' });
  assert(r.length === 2, 'discover by group');
}

// ─── Capability Queries ───────────────────────────────────────────────
console.log('Capabilities:');
{
  const hub = new AgentHub({ persist: false });
  hub.register({ name: 'c1', capabilities: ['a', 'b'] });
  hub.register({ name: 'c2', capabilities: ['a', 'c'] });
  hub.register({ name: 'c3', capabilities: ['b'] });

  const caps = hub.listCapabilities();
  assert(caps.length === 3, 'three capabilities');
  assert(caps.find(c => c.capability === 'a').agentCount === 2, 'cap a has 2 agents');
}

// ─── Stats ────────────────────────────────────────────────────────────
console.log('Stats:');
{
  const hub = new AgentHub({ persist: false });
  hub.register({ name: 's1', capabilities: ['x'] });
  hub.route('x');
  hub.route('missing');

  const s = hub.getStats();
  assert(s.agents === 1, 'agents count');
  assert(s.routed === 1, 'routed count');
  assert(s.failed === 1, 'failed count');
}

// ─── Persistence ──────────────────────────────────────────────────────
console.log('Persistence:');
{
  const hub1 = new AgentHub({ persist: true, dataDir: DATA_DIR });
  hub1.register({ name: 'persist-agent', capabilities: ['persist'], tags: ['test'] });
  hub1.addRoute('persist-route', { capability: 'persist' });
  hub1.save();
  hub1.destroy();

  const hub2 = new AgentHub({ persist: true, dataDir: DATA_DIR });
  assert(hub2.agents.size === 1, 'agents restored from disk');
  const a = hub2.agents.get([...hub2.agents.keys()][0]);
  assert(a.name === 'persist-agent', 'agent name restored');
  assert(a.capabilities[0] === 'persist', 'capabilities restored');
  assert(hub2.routes.has('persist-route'), 'route restored');
  hub2.destroy();
  rmSync(DATA_DIR, { recursive: true });
}

// ─── Events ───────────────────────────────────────────────────────────
console.log('Events:');
{
  const hub = new AgentHub({ persist: false });
  let events = [];
  hub.on('agent:registered', () => events.push('registered'));
  hub.on('agent:unregistered', () => events.push('unregistered'));
  hub.on('route:selected', () => events.push('route:selected'));
  hub.on('circuit:open', () => events.push('circuit:open'));

  const a = hub.register({ name: 'evt' });
  hub.route('evt');
  hub.unregister(a.id);
  assert(events.includes('registered'), 'registered event fired');
  assert(events.includes('unregistered'), 'unregistered event fired');
}

// ─── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
