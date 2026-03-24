#!/usr/bin/env node
// agent-fsm MCP server — 10 tools via JSON-RPC stdio

import { FSM, FSMRegistry, presets } from './index.mjs';
import { readFileSync } from 'fs';

const registry = new FSMRegistry();
let msgId = 0;

const TOOLS = {
  fsm_create: {
    description: 'Create a new state machine',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Machine name' },
        initial: { type: 'string', description: 'Initial state' },
        finalStates: { type: 'array', items: { type: 'string' }, description: 'Terminal states' },
        context: { type: 'object', description: 'Initial context data' },
        transitions: { type: 'array', items: { type: 'object' }, description: 'Transition definitions [{from,event,to,guard}]' },
        preset: { type: 'string', enum: Object.keys(presets), description: 'Use a built-in preset' },
      },
    },
    handler: async (args) => {
      let config = {};
      if (args.preset && presets[args.preset]) config = { ...presets[args.preset] };
      if (args.name) config.name = args.name;
      if (args.initial) config.initial = args.initial;
      if (args.finalStates) config.finalStates = args.finalStates;
      if (args.context) config.context = args.context;
      if (args.transitions) config.transitions = args.transitions;
      const fsm = registry.create(config);
      fsm.start();
      return { id: fsm.id, name: fsm.name, state: fsm.state, done: fsm.done };
    },
  },

  fsm_send: {
    description: 'Send an event to a state machine',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Machine ID' },
        event: { type: 'string', description: 'Event name' },
        payload: { type: 'object', description: 'Event payload' },
      },
      required: ['id', 'event'],
    },
    handler: async (args) => {
      const fsm = registry.get(args.id);
      if (!fsm) throw new Error('FSM not found: ' + args.id);
      return fsm.send(args.event, args.payload || {});
    },
  },

  fsm_get: {
    description: 'Get state machine details',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => {
      const fsm = registry.get(args.id);
      if (!fsm) throw new Error('FSM not found: ' + args.id);
      return fsm.toJSON();
    },
  },

  fsm_can: {
    description: 'Check if an event can be sent',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, event: { type: 'string' } },
      required: ['id', 'event'],
    },
    handler: async (args) => {
      const fsm = registry.get(args.id);
      if (!fsm) throw new Error('FSM not found: ' + args.id);
      return { can: fsm.can(args.event), available: fsm.availableEvents() };
    },
  },

  fsm_list: {
    description: 'List all state machines',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ machines: registry.list(), stats: registry.stats() }),
  },

  fsm_history: {
    description: 'Get transition history',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, limit: { type: 'number' } },
      required: ['id'],
    },
    handler: async (args) => {
      const fsm = registry.get(args.id);
      if (!fsm) throw new Error('FSM not found: ' + args.id);
      const h = fsm.history;
      return args.limit ? h.slice(-args.limit) : h;
    },
  },

  fsm_reset: {
    description: 'Reset a state machine',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => {
      const fsm = registry.get(args.id);
      if (!fsm) throw new Error('FSM not found: ' + args.id);
      fsm.reset();
      return fsm.toJSON();
    },
  },

  fsm_remove: {
    description: 'Remove a state machine',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => {
      return { removed: registry.remove(args.id) };
    },
  },

  fsm_export: {
    description: 'Export diagram (mermaid/dot/json)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, format: { type: 'string', enum: ['mermaid', 'dot', 'json'] } },
      required: ['id'],
    },
    handler: async (args) => {
      const fsm = registry.get(args.id);
      if (!fsm) throw new Error('FSM not found: ' + args.id);
      if (args.format === 'mermaid') return { diagram: fsm.toMermaid() };
      if (args.format === 'dot') return { diagram: fsm.toDot() };
      return fsm.toJSON();
    },
  },

  fsm_presets: {
    description: 'List available presets',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const result = {};
      for (const [k, v] of Object.entries(presets)) {
        result[k] = { name: v.name, initial: v.initial, finalStates: v.finalStates, transitionCount: v.transitions.length };
      }
      return result;
    },
  },
};

// JSON-RPC stdio handler
function handleRequest(req) {
  if (req.method === 'tools/list') {
    const tools = Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return { tools };
  }

  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params;
    const tool = TOOLS[name];
    if (!tool) throw new Error('Unknown tool: ' + name);
    return tool.handler(args || {});
  }

  if (req.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'agent-fsm', version: '1.0.0' },
      capabilities: { tools: {} },
    };
  }

  if (req.method === 'notifications/initialized') return null;
  throw new Error('Unknown method: ' + req.method);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      handleRequest(req).then(result => {
        if (result === null) return;
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
      }).catch(err => {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: err.message } }) + '\n');
      });
    } catch { /* ignore malformed */ }
  }
});

process.stderr.write('agent-fsm MCP server ready\n');
