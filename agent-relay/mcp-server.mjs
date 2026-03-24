#!/usr/bin/env node
/**
 * agent-relay MCP server — 10 tools via JSON-RPC stdio
 */

import { AgentRelay } from './index.mjs';
import { readFileSync } from 'fs';

const relay = new AgentRelay({
  persistenceDir: process.env.DATA_DIR || null,
  maxHistory: parseInt(process.env.MAX_HISTORY || '10000')
});

const TOOLS = [
  { name: 'relay_register', description: 'Register an agent', inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, metadata: { type: 'object' } }, required: ['agentId'] } },
  { name: 'relay_unregister', description: 'Unregister an agent', inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] } },
  { name: 'relay_subscribe', description: 'Subscribe agent to topic (supports wildcards: topic/*)', inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, topic: { type: 'string' } }, required: ['agentId', 'topic'] } },
  { name: 'relay_unsubscribe', description: 'Unsubscribe from topic', inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, topic: { type: 'string' } }, required: ['agentId', 'topic'] } },
  { name: 'relay_publish', description: 'Publish message to topic', inputSchema: { type: 'object', properties: { topic: { type: 'string' }, payload: {}, from: { type: 'string' } }, required: ['topic', 'payload'] } },
  { name: 'relay_send', description: 'Direct message to agent', inputSchema: { type: 'object', properties: { to: { type: 'string' }, payload: {}, from: { type: 'string' } }, required: ['to', 'payload'] } },
  { name: 'relay_broadcast', description: 'Broadcast to all agents', inputSchema: { type: 'object', properties: { payload: {}, from: { type: 'string' } }, required: ['payload'] } },
  { name: 'relay_request', description: 'Request-reply with timeout', inputSchema: { type: 'object', properties: { to: { type: 'string' }, payload: {}, from: { type: 'string' }, timeout: { type: 'number' } }, required: ['to', 'payload'] } },
  { name: 'relay_drain', description: 'Drain queued messages for agent', inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, limit: { type: 'number' } }, required: ['agentId'] } },
  { name: 'relay_history', description: 'Get message history', inputSchema: { type: 'object', properties: { topic: { type: 'string' }, from: { type: 'string' }, type: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'relay_stats', description: 'Get relay statistics', inputSchema: { type: 'object', properties: {} } },
  { name: 'relay_agents', description: 'List registered agents', inputSchema: { type: 'object', properties: { connectedOnly: { type: 'boolean' } } } }
];

function handle(toolName, args) {
  switch (toolName) {
    case 'relay_register': return relay.registerAgent(args.agentId, args.metadata || {});
    case 'relay_unregister': return { ok: relay.unregisterAgent(args.agentId) };
    case 'relay_subscribe': return { ok: relay.subscribe(args.agentId, args.topic) };
    case 'relay_unsubscribe': return { ok: relay.unsubscribe(args.agentId, args.topic) };
    case 'relay_publish': return relay.publish(args.topic, args.payload, args.from || null);
    case 'relay_send': return relay.send(args.to, args.payload, args.from || null);
    case 'relay_broadcast': return relay.broadcast(args.payload, args.from || null);
    case 'relay_request': return relay.request(args.to, args.payload, args.from || null, { timeout: args.timeout });
    case 'relay_drain': return relay.drain(args.agentId, args.limit || 100);
    case 'relay_history': return relay.getHistory(args);
    case 'relay_stats': return relay.stats();
    case 'relay_agents': return relay.listAgents(args.connectedOnly || false);
  }
}

// JSON-RPC stdio
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    if (req.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-relay', version: '1.0.0' } } }) + '\n');
    } else if (req.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } }) + '\n');
    } else if (req.method === 'tools/call') {
      const { name, arguments: args } = req.params;
      try {
        let result = handle(name, args || {});
        if (result instanceof Promise) {
          result.then(r => {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] } }) + '\n');
          }).catch(err => {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -1, message: err.message } }) + '\n');
          });
        } else {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }) + '\n');
        }
      } catch (err) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -1, message: err.message } }) + '\n');
      }
    }
  }
});

process.stdin.on('end', () => process.exit(0));
