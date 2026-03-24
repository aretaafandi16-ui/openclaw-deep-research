#!/usr/bin/env node
/**
 * agent-collab MCP Server — JSON-RPC stdio for tool integration
 * 12 tools: collab_register_agent/unregister_agent/list_agents/create_task/assign_task/auto_assign/delegate/complete_task/fail_task/send_message/get_messages/stats
 */
import { CollabEngine, ROLES, STATUS, STRATEGIES } from './index.mjs';

const engine = new CollabEngine();

const tools = {
  collab_register_agent: {
    description: 'Register a new agent in the collaboration engine',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        role: { type: 'string', enum: Object.values(ROLES) },
        capabilities: { type: 'array', items: { type: 'string' } },
        maxConcurrent: { type: 'number' },
      },
      required: ['name'],
    },
    handler: (args) => engine.registerAgent(args),
  },
  collab_unregister_agent: {
    description: 'Unregister an agent',
    inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
    handler: ({ agentId }) => { engine.unregisterAgent(agentId); return { success: true }; },
  },
  collab_list_agents: {
    description: 'List registered agents',
    inputSchema: { type: 'object', properties: { role: { type: 'string' }, available: { type: 'boolean' } } },
    handler: (args) => engine.listAgents(args),
  },
  collab_create_task: {
    description: 'Create a new task',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        payload: { type: 'object' },
        priority: { type: 'number' },
        requires: { type: 'array', items: { type: 'string' } },
        maxRetries: { type: 'number' },
      },
      required: ['type', 'payload'],
    },
    handler: (args) => engine.createTask(args),
  },
  collab_assign_task: {
    description: 'Assign a task to an agent',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, agentId: { type: 'string' } }, required: ['taskId', 'agentId'] },
    handler: ({ taskId, agentId }) => engine.assignTask(taskId, agentId),
  },
  collab_auto_assign: {
    description: 'Auto-assign a task using a strategy',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, strategy: { type: 'string', enum: Object.values(STRATEGIES) } }, required: ['taskId'] },
    handler: ({ taskId, strategy }) => engine.autoAssign(taskId, strategy || STRATEGIES.LEAST_LOADED),
  },
  collab_delegate: {
    description: 'Create and assign multiple subtasks under a parent',
    inputSchema: {
      type: 'object',
      properties: {
        parentTaskId: { type: 'string' },
        subtasks: { type: 'array', items: { type: 'object' } },
        strategy: { type: 'string', enum: Object.values(STRATEGIES) },
      },
      required: ['parentTaskId', 'subtasks'],
    },
    handler: ({ parentTaskId, subtasks, strategy }) => engine.delegate(parentTaskId, subtasks, strategy || STRATEGIES.LEAST_LOADED),
  },
  collab_complete_task: {
    description: 'Mark a task as complete with optional result',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, result: { type: 'object' } }, required: ['taskId'] },
    handler: ({ taskId, result }) => engine.completeTask(taskId, result),
  },
  collab_fail_task: {
    description: 'Mark a task as failed',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, error: { type: 'string' } }, required: ['taskId'] },
    handler: ({ taskId, error }) => engine.failTask(taskId, error),
  },
  collab_send_message: {
    description: 'Send a message between agents',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, content: { type: 'string' }, type: { type: 'string' } }, required: ['from', 'to', 'content'] },
    handler: (args) => engine.sendMessage(args.from, args.to, args.content, { type: args.type }),
  },
  collab_get_messages: {
    description: 'Get messages filtered by agent, time, or type',
    inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, since: { type: 'number' }, type: { type: 'string' } } },
    handler: (args) => engine.getMessages(args),
  },
  collab_stats: {
    description: 'Get collaboration engine stats',
    inputSchema: { type: 'object', properties: {} },
    handler: () => engine.stats(),
  },
};

// JSON-RPC stdio
const BUFFER = [];
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  BUFFER.push(chunk);
  processBuffer();
});

async function processBuffer() {
  const raw = BUFFER.join('');
  let req;
  try {
    req = JSON.parse(raw);
  } catch { return; }
  BUFFER.length = 0;

  const tool = tools[req.method];
  if (!tool) {
    respond(req.id, null, { code: -32601, message: `Unknown method: ${req.method}` });
    return;
  }
  try {
    const result = await tool.handler(req.params || {});
    respond(req.id, result);
  } catch (err) {
    respond(req.id, null, { code: -32000, message: err.message });
  }
}

function respond(id, result, error = null) {
  const resp = { jsonrpc: '2.0', id, ...(error ? { error } : { result }) };
  process.stdout.write(JSON.stringify(resp) + '\n');
}

// Tool list for discovery
if (process.argv.includes('--list')) {
  for (const [name, t] of Object.entries(tools)) {
    console.log(`${name}: ${t.description}`);
  }
  process.exit(0);
}

console.error('agent-collab MCP server running (stdio)');
