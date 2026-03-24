#!/usr/bin/env node
/**
 * agent-hub MCP Server — 12 tools via JSON-RPC stdio
 */

import { AgentHub } from './index.mjs';
import { createInterface } from 'readline';

const hub = new AgentHub({ persist: false });

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

const tools = {
  hub_register: (p) => hub.register(p),
  hub_unregister: (p) => ({ ok: hub.unregister(p.agentId) }),
  hub_heartbeat: (p) => ({ ok: hub.heartbeat(p.agentId, p) }),
  hub_discover: (p) => hub.discover(p),
  hub_route: (p) => hub.route(p.capability, p),
  hub_route_complete: (p) => ({ ok: hub.routeComplete(p.routeId, p) }),
  hub_add_route: (p) => hub.addRoute(p.name, p),
  hub_remove_route: (p) => ({ ok: hub.removeRoute(p.name) }),
  hub_execute_route: (p) => hub.executeRoute(p.routeName, p),
  hub_list_capabilities: () => hub.listCapabilities(),
  hub_stats: () => hub.getStats(),
  hub_agents: (p) => (p && p.id) ? hub.getAgent(p.id) : hub.discover(p || {}),
};

let id = 0;
rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }

  const { method, params, id: reqId } = req;
  if (method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-hub', version: '1.0.0' }, capabilities: { tools: {} } } }) + '\n');
  } else if (method === 'notifications/initialized') {
    // no-op
  } else if (method === 'tools/list') {
    const list = Object.keys(tools).map(name => ({
      name,
      description: `Agent Hub: ${name.replace('hub_', '').replace(/_/g, ' ')}`,
      inputSchema: { type: 'object', properties: {} },
    }));
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, result: { tools: list } }) + '\n');
  } else if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const fn = tools[name];
      if (!fn) throw new Error(`Unknown tool: ${name}`);
      const result = fn(args || {});
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } }) + '\n');
    }
  }
});

process.on('SIGINT', () => { hub.destroy(); process.exit(0); });
process.on('SIGTERM', () => { hub.destroy(); process.exit(0); });
