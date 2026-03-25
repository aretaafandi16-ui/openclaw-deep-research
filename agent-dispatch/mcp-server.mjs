#!/usr/bin/env node
/**
 * agent-dispatch MCP Server
 * 12 tools via JSON-RPC stdio
 */

import { Dispatcher, Classifier } from './index.mjs';

const dispatcher = new Dispatcher({ id: 'mcp-dispatcher' });
const classifier = new Classifier();

// ── JSON-RPC stdio transport ──────────────────────────────────────

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleRequest(JSON.parse(line));
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
}

// ── Tool Definitions ──────────────────────────────────────────────

const TOOLS = [
  {
    name: 'dispatch_submit',
    description: 'Submit a message for dispatch. Routes matching the message pattern will receive it.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'object', description: 'Message payload (any JSON object)' },
        priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
        tags: { type: 'array', items: { type: 'string' } },
        enqueue: { type: 'boolean', default: false, description: 'If true, enqueue instead of immediate dispatch' },
      },
      required: ['message'],
    },
  },
  {
    name: 'dispatch_add_route',
    description: 'Add a routing rule with pattern matching and handler configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        pattern: { type: 'object', description: 'Pattern object: {type, field, value} or filter object' },
        priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
        weight: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        transforms: { type: 'array', description: 'Transform pipeline' },
        rateLimitMax: { type: 'number' },
        rateLimitWindowMs: { type: 'number' },
      },
    },
  },
  {
    name: 'dispatch_remove_route',
    description: 'Remove a routing rule by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'dispatch_list_routes',
    description: 'List all routing rules with stats.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dispatch_enable_route',
    description: 'Enable a route by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'dispatch_disable_route',
    description: 'Disable a route by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'dispatch_fan_out',
    description: 'Send a message to multiple specific routes simultaneously.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'object' },
        routeIds: { type: 'array', items: { type: 'string' } },
        parallel: { type: 'boolean', default: true },
      },
      required: ['message', 'routeIds'],
    },
  },
  {
    name: 'dispatch_process_queue',
    description: 'Process queued messages (up to batchSize).',
    inputSchema: {
      type: 'object',
      properties: { batchSize: { type: 'number', default: 10 } },
    },
  },
  {
    name: 'dispatch_dlq_retry',
    description: 'Retry messages from the dead letter queue.',
    inputSchema: {
      type: 'object',
      properties: { maxItems: { type: 'number', default: 10 } },
    },
  },
  {
    name: 'dispatch_dlq_list',
    description: 'List dead letter queue entries.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dispatch_history',
    description: 'Get dispatch history with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        routeId: { type: 'string' },
        success: { type: 'boolean' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'dispatch_stats',
    description: 'Get dispatcher stats and info.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Tool Handlers ─────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case 'dispatch_submit': {
      const result = await dispatcher.submit(args.message || {}, {
        priority: args.priority,
        tags: args.tags,
        enqueue: args.enqueue,
      });
      return result;
    }
    case 'dispatch_add_route': {
      const route = dispatcher.addRoute({
        id: args.id,
        name: args.name,
        pattern: args.pattern,
        priority: args.priority,
        weight: args.weight,
        tags: args.tags,
        transforms: args.transforms,
        rateLimit: args.rateLimitMax ? { max: args.rateLimitMax, windowMs: args.rateLimitWindowMs || 60000 } : null,
        handler: null, // MCP routes don't have JS handlers — they just record matches
      });
      return { id: route.id, name: route.name, enabled: route.enabled };
    }
    case 'dispatch_remove_route': {
      return { removed: dispatcher.removeRoute(args.id) };
    }
    case 'dispatch_list_routes': {
      return dispatcher.listRoutes().map(r => ({
        id: r.id, name: r.name, enabled: r.enabled, priority: r.priority,
        weight: r.weight, tags: r.tags, pattern: r.pattern,
        stats: r.stats,
      }));
    }
    case 'dispatch_enable_route': {
      return { enabled: dispatcher.enableRoute(args.id) };
    }
    case 'dispatch_disable_route': {
      return { disabled: dispatcher.disableRoute(args.id) };
    }
    case 'dispatch_fan_out': {
      return await dispatcher.fanOut(args.message || {}, args.routeIds || [], { parallel: args.parallel });
    }
    case 'dispatch_process_queue': {
      const processed = await dispatcher.processQueue(args.batchSize || 10);
      return { processed, queueRemaining: dispatcher.queue.size };
    }
    case 'dispatch_dlq_retry': {
      return await dispatcher.retryDLQ(args.maxItems || 10);
    }
    case 'dispatch_dlq_list': {
      return dispatcher.getDLQ().map(e => ({
        messageId: e.messageId, reason: e.reason, error: e.error,
        timestamp: e.timestamp, retries: e.retries,
      }));
    }
    case 'dispatch_history': {
      return dispatcher.getHistory({ routeId: args.routeId, success: args.success, limit: args.limit || 50 });
    }
    case 'dispatch_stats': {
      return dispatcher.getInfo();
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Request Handler ───────────────────────────────────────────────

async function handleRequest(req) {
  try {
    if (req.method === 'initialize') {
      return respond(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-dispatch', version: '1.0.0' },
      });
    }
    if (req.method === 'tools/list') {
      return respond(req.id, { tools: TOOLS });
    }
    if (req.method === 'tools/call') {
      const { name, arguments: args } = req.params;
      const result = await handleTool(name, args || {});
      return respond(req.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }
    respond(req.id, {});
  } catch (e) {
    respondError(req.id, e.message);
  }
}
