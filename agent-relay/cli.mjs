#!/usr/bin/env node
/**
 * agent-relay CLI
 */

import { AgentRelay } from './index.mjs';

const [,, cmd, ...args] = process.argv;
const relay = new AgentRelay();

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      let val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      try { if (typeof val === 'string') val = JSON.parse(val); } catch {}
      result[key] = val;
    } else {
      result._ = result._ || [];
      result._.push(args[i]);
    }
  }
  return result;
}

const a = parseArgs(args);

function out(data) { console.log(JSON.stringify(data, null, 2)); }

switch (cmd) {
  case 'register': {
    const id = a._?.[0] || a.agentId;
    if (!id) { console.error('Usage: relay register <agentId> [--meta \'{"key":"val"}\']'); process.exit(1); }
    const meta = a.meta || {};
    const agent = relay.registerAgent(id, meta);
    out({ id, connected: agent.connected, subscriptions: [...agent.subscriptions] });
    break;
  }
  case 'unregister': {
    const id = a._?.[0] || a.agentId;
    out({ ok: relay.unregisterAgent(id) });
    break;
  }
  case 'subscribe': {
    const agentId = a._?.[0] || a.agent;
    const topic = a._?.[1] || a.topic;
    if (!agentId || !topic) { console.error('Usage: relay subscribe <agentId> <topic>'); process.exit(1); }
    out({ ok: relay.subscribe(agentId, topic) });
    break;
  }
  case 'unsubscribe': {
    const agentId = a._?.[0] || a.agent;
    const topic = a._?.[1] || a.topic;
    out({ ok: relay.unsubscribe(agentId, topic) });
    break;
  }
  case 'publish': {
    const topic = a._?.[0] || a.topic;
    let payload = a._?.[1] || a.payload;
    if (!topic) { console.error('Usage: relay publish <topic> <payload>'); process.exit(1); }
    try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch {}
    out(relay.publish(topic, payload, a.from || null));
    break;
  }
  case 'send': {
    const to = a._?.[0] || a.to;
    let payload = a._?.[1] || a.payload;
    if (!to) { console.error('Usage: relay send <agentId> <payload>'); process.exit(1); }
    try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch {}
    out(relay.send(to, payload, a.from || null));
    break;
  }
  case 'broadcast': {
    let payload = a._?.[0] || a.payload;
    try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch {}
    out(relay.broadcast(payload, a.from || null));
    break;
  }
  case 'drain': {
    const agentId = a._?.[0] || a.agentId;
    out(relay.drain(agentId, parseInt(a.limit || '100')));
    break;
  }
  case 'history': {
    const opts = {};
    if (a.topic) opts.topic = a.topic;
    if (a.from) opts.from = a.from;
    if (a.type) opts.type = a.type;
    if (a.limit) opts.limit = parseInt(a.limit);
    out(relay.getHistory(opts));
    break;
  }
  case 'agents': {
    out(relay.listAgents(a.connected === true));
    break;
  }
  case 'stats': {
    out(relay.stats());
    break;
  }
  case 'demo': {
    // Interactive demo
    console.log('=== agent-relay demo ===\n');
    
    // Register agents
    relay.registerAgent('agent-alpha', { role: 'coordinator' });
    relay.registerAgent('agent-beta', { role: 'worker' });
    relay.registerAgent('agent-gamma', { role: 'monitor' });
    console.log('✓ Registered 3 agents\n');

    // Subscribe
    relay.subscribe('agent-alpha', 'tasks/*');
    relay.subscribe('agent-beta', 'tasks/*');
    relay.subscribe('agent-gamma', '*'); // wildcard: receives everything
    console.log('✓ Subscribed: alpha+beta → tasks/*, gamma → *\n');

    // Publish
    let r = relay.publish('tasks/created', { id: 'task-1', type: 'compute', priority: 'high' }, 'agent-alpha');
    console.log(`✓ Published to tasks/created — delivered to ${r.delivered} agents\n`);

    // Direct message
    r = relay.send('agent-beta', { instruction: 'process task-1' }, 'agent-alpha');
    console.log(`✓ Direct message to beta — delivered: ${r.delivered}\n`);

    // Broadcast
    r = relay.broadcast({ alert: 'system maintenance in 5 min' }, 'agent-gamma');
    console.log(`✓ Broadcast from gamma — delivered to ${r.delivered} agents\n`);

    // Queue
    relay.enqueue('work-queue', { job: 'batch-process', data: [1,2,3] });
    relay.enqueue('work-queue', { job: 'transform', data: 'csv' });
    console.log('✓ Enqueued 2 jobs to work-queue\n');

    const item = relay.dequeue('work-queue');
    console.log(`✓ Dequeued: ${JSON.stringify(item.payload)}\n`);

    // Drain
    const msgs = relay.drain('agent-beta', 10);
    console.log(`✓ Drained ${msgs.length} messages for agent-beta\n`);
    for (const m of msgs) {
      console.log(`  [${m.type}] ${m.topic}: ${JSON.stringify(m.payload).slice(0, 60)}`);
    }

    // Stats
    console.log('\n--- Stats ---');
    out(relay.stats());
    break;
  }
  case 'serve': {
    process.env.PORT = a.port || '3125';
    await import('./server.mjs');
    break;
  }
  case 'mcp': {
    await import('./mcp-server.mjs');
    break;
  }
  default:
    console.log(`
agent-relay — cross-agent pub/sub messaging

Commands:
  register <agentId> [--meta '{}']     Register an agent
  unregister <agentId>                 Unregister an agent
  subscribe <agentId> <topic>          Subscribe to topic (supports wildcards)
  unsubscribe <agentId> <topic>        Unsubscribe from topic
  publish <topic> <payload> [--from]   Publish message
  send <agentId> <payload> [--from]    Direct message
  broadcast <payload> [--from]         Broadcast to all agents
  drain <agentId> [--limit N]          Get queued messages
  history [--topic] [--from] [--limit] Message history
  agents [--connected]                 List agents
  stats                                Show statistics
  demo                                 Run interactive demo
  serve [--port 3125]                  Start HTTP server
  mcp                                  Start MCP server
`);
}
