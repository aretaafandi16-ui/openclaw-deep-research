#!/usr/bin/env node
/**
 * agent-hub CLI
 */

import { AgentHub } from './index.mjs';

const hub = new AgentHub({ dataDir: process.env.DATA_DIR || '.hub-data' });
const [,, cmd, ...args] = process.argv;

function parseArgs(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const k = args[i].slice(2);
      o[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    }
  }
  return o;
}

const cmds = {
  register() {
    const o = parseArgs(args);
    const agent = hub.register({
      name: o.name,
      capabilities: (o.capabilities || o.caps || '').split(',').filter(Boolean),
      tags: (o.tags || '').split(',').filter(Boolean),
      version: o.version || '1.0.0',
      endpoint: o.endpoint || null,
      group: o.group || 'default',
      metadata: o.metadata ? JSON.parse(o.metadata) : {},
    });
    console.log(JSON.stringify(agent, null, 2));
  },

  unregister() {
    const o = parseArgs(args);
    console.log(JSON.stringify({ ok: hub.unregister(o.id || o.agent || args[0]) }));
  },

  discover() {
    const o = parseArgs(args);
    const q = {};
    if (o.capability) q.capability = o.capability;
    if (o.group) q.group = o.group;
    if (o.tags) q.tags = o.tags.split(',');
    if (o.status) q.status = o.status;
    if (o.sort) q.sort = o.sort;
    if (o.limit) q.limit = parseInt(o.limit);
    console.log(JSON.stringify(hub.discover(q), null, 2));
  },

  route() {
    const o = parseArgs(args);
    const result = hub.route(o.capability || args[0], {
      strategy: o.strategy || 'round_robin',
      group: o.group,
      tags: o.tags ? o.tags.split(',') : undefined,
    });
    console.log(result ? JSON.stringify(result, null, 2) : 'No candidate found');
  },

  heartbeat() {
    const o = parseArgs(args);
    console.log(JSON.stringify({ ok: hub.heartbeat(o.id || args[0], { load: o.load ? parseInt(o.load) : undefined, status: o.status }) }));
  },

  agents() {
    console.log(JSON.stringify(hub.discover({ status: undefined }), null, 2));
  },

  capabilities() {
    console.log(JSON.stringify(hub.listCapabilities(), null, 2));
  },

  stats() {
    console.log(JSON.stringify(hub.getStats(), null, 2));
  },

  'add-route'() {
    const o = parseArgs(args);
    console.log(JSON.stringify(hub.addRoute(o.name, { capability: o.capability, strategy: o.strategy, fallback: o.fallback }), null, 2));
  },

  'execute-route'() {
    const o = parseArgs(args);
    const result = hub.executeRoute(o.name || args[0]);
    console.log(result ? JSON.stringify(result, null, 2) : 'No candidate found');
  },

  groups() {
    console.log(JSON.stringify(hub.listGroups(), null, 2));
  },

  circuit() {
    const o = parseArgs(args);
    if (o.id) console.log(JSON.stringify(hub.getCircuitStatus(o.id)));
    else console.log(JSON.stringify([...hub.circuitBreakers.entries()].map(([id, cb]) => ({ agentId: id, ...cb })), null, 2));
  },

  serve() {
    const PORT = parseInt(process.env.PORT || '3136');
    import('./server.mjs');
  },

  mcp() {
    import('./mcp-server.mjs');
  },

  demo() {
    console.log('Registering demo agents...');
    hub.register({ name: 'translator-es', capabilities: ['translate'], tags: ['spanish', 'fast'], version: '1.0.0', metadata: { weight: 2 } });
    hub.register({ name: 'translator-fr', capabilities: ['translate'], tags: ['french'], version: '1.0.0' });
    hub.register({ name: 'translator-de', capabilities: ['translate'], tags: ['german', 'premium'], version: '1.1.0', metadata: { weight: 3 } });
    hub.register({ name: 'coder-js', capabilities: ['code'], tags: ['javascript', 'fast'], version: '2.0.0' });
    hub.register({ name: 'coder-py', capabilities: ['code'], tags: ['python'], version: '1.5.0' });
    hub.register({ name: 'summarizer', capabilities: ['summarize'], tags: ['fast'], endpoint: 'http://localhost:4001' });
    hub.addRoute('translation', { capability: 'translate', strategy: 'best_match' });
    hub.addRoute('coding', { capability: 'code', strategy: 'least_loaded' });

    console.log('\nAgents:');
    console.table(hub.discover({ status: undefined }).map(a => ({ name: a.name, caps: a.capabilities.join(','), tags: a.tags.join(','), status: a.status, load: a.load })));

    console.log('\nCapabilities:');
    console.table(hub.listCapabilities());

    console.log('\nRouting translate task (round_robin):');
    for (let i = 0; i < 3; i++) {
      const r = hub.route('translate', { strategy: 'round_robin' });
      console.log(`  → ${r.name}`);
    }

    console.log('\nRouting translate task (weighted):');
    const wr = hub.route('translate', { strategy: 'weighted' });
    console.log(`  → ${wr.name}`);

    console.log('\nRouting translate task (least_loaded):');
    const llr = hub.route('translate', { strategy: 'least_loaded' });
    console.log(`  → ${llr.name}`);

    console.log('\nRouting code task (best_match):');
    const bmr = hub.route('code', { strategy: 'best_match' });
    console.log(`  → ${bmr.name}`);

    console.log('\nStats:', JSON.stringify(hub.getStats(), null, 2));
  },

  help() {
    console.log(`
agent-hub CLI — Capability registry & service mesh for AI agents

Commands:
  register        Register an agent (--name --caps --tags --version --endpoint --group)
  unregister      Unregister an agent (--id)
  discover        Find agents by capability/tags/metadata (--capability --tags --group --sort --limit)
  route           Route a task to an agent (--capability --strategy --tags)
  heartbeat       Send heartbeat (--id --load --status)
  agents          List all agents
  capabilities    List all capabilities with agent counts
  groups          List all groups
  stats           Show hub statistics
  add-route       Add named route (--name --capability --strategy --fallback)
  execute-route   Execute a named route (--name)
  circuit         Show circuit breaker status (--id)
  serve           Start HTTP server (PORT=3136)
  mcp             Start MCP server (stdio)
  demo            Run demo with sample agents
  help            Show this help
`);
  },
};

(cmds[cmd] || cmds.help)();
