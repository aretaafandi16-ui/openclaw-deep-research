#!/usr/bin/env node
/**
 * agent-state MCP Server — JSON-RPC stdio interface for state machine management
 *
 * Tools:
 * - state_create      Create a new state machine
 * - state_start       Start a state machine
 * - state_send        Send an event
 * - state_get         Get current state info
 * - state_can         Check if event can be handled
 * - state_stop        Stop a machine
 * - state_snapshot    Get machine snapshot
 * - state_restore     Restore from snapshot
 * - state_list        List all machines
 * - state_history     Get transition history
 * - workflow_create   Create a workflow (linear pipeline)
 * - state_stats       Get statistics
 */

import { StateMachine, Guards, createWorkflow, createGameLoop } from './index.mjs';
import { readFileSync } from 'fs';

const machines = new Map();
let idCounter = 0;

function nextId() { return `sm-${++idCounter}`; }

// ─── Parse action strings ───────────────────────────────────────
function parseActions(states) {
  for (const [name, def] of Object.entries(states)) {
    if (typeof def.onEntry === 'string') {
      def.onEntry = new Function('ctx', def.onEntry);
    }
    if (typeof def.onExit === 'string') {
      def.onExit = new Function('ctx', def.onExit);
    }
    if (def.on) {
      for (const [evt, trans] of Object.entries(def.on)) {
        const arr = Array.isArray(trans) ? trans : [trans];
        for (const t of arr) {
          if (typeof t.action === 'string') {
            t.action = new Function('ctx', 'data', t.action);
          }
          if (typeof t.guard === 'string') {
            t.guard = new Function('ctx', 'data', `return (${t.guard})`);
          }
        }
        def.on[evt] = arr.length === 1 ? arr[0] : arr;
      }
    }
  }
  return states;
}

// ─── Tool definitions ───────────────────────────────────────────
const TOOLS = [
  {
    name: 'state_create',
    description: 'Create a new state machine with states, transitions, guards, and actions',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Machine ID (auto-generated if omitted)' },
        initial: { type: 'string', description: 'Initial state name' },
        context: { type: 'object', description: 'Initial context data' },
        states: {
          type: 'object',
          description: 'State definitions. Each state has: on (transitions), onEntry/onExit (action strings), type (normal/final), after (timers), always (auto-transition), meta',
        },
        persistenceDir: { type: 'string', description: 'Directory for JSONL persistence' },
      },
      required: ['initial', 'states'],
    },
  },
  {
    name: 'state_start',
    description: 'Start a state machine',
    inputSchema: {
      type: 'object',
      properties: {
        machineId: { type: 'string', description: 'Machine ID' },
        initialState: { type: 'string', description: 'Override initial state' },
      },
      required: ['machineId'],
    },
  },
  {
    name: 'state_send',
    description: 'Send an event to a state machine',
    inputSchema: {
      type: 'object',
      properties: {
        machineId: { type: 'string' },
        event: { type: 'string', description: 'Event name' },
        data: { type: 'object', description: 'Event data' },
      },
      required: ['machineId', 'event'],
    },
  },
  {
    name: 'state_get',
    description: 'Get current state, context, and available events',
    inputSchema: {
      type: 'object',
      properties: { machineId: { type: 'string' } },
      required: ['machineId'],
    },
  },
  {
    name: 'state_can',
    description: 'Check if a specific event can be handled in the current state',
    inputSchema: {
      type: 'object',
      properties: {
        machineId: { type: 'string' },
        event: { type: 'string' },
      },
      required: ['machineId', 'event'],
    },
  },
  {
    name: 'state_stop',
    description: 'Stop a state machine',
    inputSchema: {
      type: 'object',
      properties: { machineId: { type: 'string' } },
      required: ['machineId'],
    },
  },
  {
    name: 'state_snapshot',
    description: 'Get a serializable snapshot of the machine state',
    inputSchema: {
      type: 'object',
      properties: { machineId: { type: 'string' } },
      required: ['machineId'],
    },
  },
  {
    name: 'state_restore',
    description: 'Restore a machine from a snapshot',
    inputSchema: {
      type: 'object',
      properties: {
        machineId: { type: 'string' },
        snapshot: { type: 'object' },
      },
      required: ['machineId', 'snapshot'],
    },
  },
  {
    name: 'state_list',
    description: 'List all state machines with their current states',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'state_history',
    description: 'Get transition history for a machine',
    inputSchema: {
      type: 'object',
      properties: {
        machineId: { type: 'string' },
        limit: { type: 'number', description: 'Max entries (default 50)' },
      },
      required: ['machineId'],
    },
  },
  {
    name: 'workflow_create',
    description: 'Create a linear workflow (pipeline of steps)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              action: { type: 'string', description: 'Action as JS string: (ctx) => { ... }' },
              meta: { type: 'object' },
            },
            required: ['name'],
          },
        },
        context: { type: 'object' },
      },
      required: ['steps'],
    },
  },
  {
    name: 'state_stats',
    description: 'Get statistics about all machines',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Handler ────────────────────────────────────────────────────
function handleTool(name, args) {
  switch (name) {
    case 'state_create': {
      const id = args.id || nextId();
      if (args.states) parseActions(args.states);
      const sm = new StateMachine({
        id,
        initial: args.initial,
        context: args.context || {},
        states: args.states,
        persistenceDir: args.persistenceDir,
      });
      machines.set(id, sm);
      return { id, state: null, states: Object.keys(args.states), created: true };
    }

    case 'state_start': {
      const sm = machines.get(args.machineId);
      if (!sm) return { error: `Machine "${args.machineId}" not found` };
      sm.start(args.initialState);
      return { id: sm.id, state: sm.state, running: sm.isRunning, events: sm.events };
    }

    case 'state_send': {
      const sm = machines.get(args.machineId);
      if (!sm) return { error: `Machine "${args.machineId}" not found` };
      const result = sm.send(args.event, args.data || {});
      return { ...result, state: sm.state, context: sm.context, events: sm.events };
    }

    case 'state_get': {
      const sm = machines.get(args.machineId);
      if (!sm) return { error: `Machine "${args.machineId}" not found` };
      return {
        id: sm.id,
        state: sm.state,
        running: sm.isRunning,
        isDone: sm.isDone,
        context: sm.context,
        events: sm.events,
        can: Object.fromEntries(sm.events.map(e => [e, sm.can(e)])),
      };
    }

    case 'state_can': {
      const sm = machines.get(args.machineId);
      if (!sm) return { error: `Machine "${args.machineId}" not found` };
      return { event: args.event, can: sm.can(args.event), currentState: sm.state };
    }

    case 'state_stop': {
      const sm = machines.get(args.machineId);
      if (!sm) return { error: `Machine "${args.machineId}" not found` };
      sm.stop();
      return { id: sm.id, state: sm.state, stopped: true };
    }

    case 'state_snapshot': {
      const sm = machines.get(args.machineId);
      if (!sm) return { error: `Machine "${args.machineId}" not found` };
      return sm.snapshot();
    }

    case 'state_restore': {
      const sm = machines.get(args.machineId);
      if (!sm) return { error: `Machine "${args.machineId}" not found` };
      sm.restore(args.snapshot);
      return { id: sm.id, state: sm.state, restored: true };
    }

    case 'state_list': {
      const list = [];
      for (const [id, sm] of machines) {
        list.push({ id, state: sm.state, running: sm.isRunning, isDone: sm.isDone, transitions: sm.history.length });
      }
      return { machines: list, total: list.length };
    }

    case 'state_history': {
      const sm = machines.get(args.machineId);
      if (!sm) return { error: `Machine "${args.machineId}" not found` };
      const limit = args.limit || 50;
      return { history: sm.history.slice(-limit), total: sm.history.length };
    }

    case 'workflow_create': {
      const steps = args.steps || [];
      for (const step of steps) {
        if (typeof step.action === 'string') {
          step.action = new Function('ctx', step.action);
        }
      }
      const wf = createWorkflow(args.id || nextId(), steps, { context: args.context || {} });
      machines.set(wf.id, wf);
      return { id: wf.id, state: wf.state, steps: steps.map(s => s.name), created: true };
    }

    case 'state_stats': {
      let totalTransitions = 0;
      let running = 0;
      let done = 0;
      for (const [, sm] of machines) {
        totalTransitions += sm.history.length;
        if (sm.isRunning) running++;
        if (sm.isDone) done++;
      }
      return { totalMachines: machines.size, running, done, totalTransitions };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── JSON-RPC stdio server ──────────────────────────────────────
function startServer() {
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
        let result;

        if (req.method === 'initialize') {
          result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-state', version: '1.0.0' } };
        } else if (req.method === 'tools/list') {
          result = { tools: TOOLS };
        } else if (req.method === 'tools/call') {
          result = handleTool(req.params.name, req.params.arguments || {});
        } else {
          result = { error: `Unknown method: ${req.method}` };
        }

        const resp = { jsonrpc: '2.0', id: req.id, result };
        process.stdout.write(JSON.stringify(resp) + '\n');
      } catch (e) {
        // ignore parse errors
      }
    }
  });

  process.stdin.on('end', () => process.exit(0));
  console.error('agent-state MCP server running (stdio)');
}

startServer();
