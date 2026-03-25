#!/usr/bin/env node
/**
 * agent-stream MCP Server — JSON-RPC stdio interface
 * 12 tools for streaming data processing
 */

import { StreamEngine, Aggregations } from './index.mjs';
import { createInterface } from 'readline';

// Active streams registry
const streams = new Map();
let streamCounter = 0;

const tools = {
  stream_create: {
    description: 'Create a new stream pipeline',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional stream ID' },
        source: { type: 'string', enum: ['array', 'interval'], description: 'Source type' },
        data: { description: 'Source data (array)' },
        intervalMs: { type: 'number', description: 'Interval in ms for interval source' },
        maxItems: { type: 'number', description: 'Max items for interval source' },
      },
      required: ['source'],
    },
    handler: async (params) => {
      const id = params.id || `stream-${++streamCounter}`;
      const engine = new StreamEngine({ id });
      
      if (params.source === 'array') {
        engine.from(params.data || []);
      } else if (params.source === 'interval') {
        engine.fromInterval(params.intervalMs || 1000, params.maxItems || 10);
      }
      
      streams.set(id, engine);
      return { id, status: 'created', source: params.source };
    },
  },

  stream_map: {
    description: 'Add a map transform to a stream',
    inputSchema: {
      type: 'object',
      properties: {
        streamId: { type: 'string' },
        expression: { type: 'string', description: 'JS expression, use `item` for current value' },
      },
      required: ['streamId', 'expression'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      const fn = new Function('item', `return ${params.expression}`);
      engine.map(fn);
      return { ok: true, stages: engine.stages.length };
    },
  },

  stream_filter: {
    description: 'Add a filter to a stream',
    inputSchema: {
      type: 'object',
      properties: {
        streamId: { type: 'string' },
        expression: { type: 'string', description: 'JS boolean expression, use `item`' },
      },
      required: ['streamId', 'expression'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      const fn = new Function('item', `return ${params.expression}`);
      engine.filter(fn);
      return { ok: true, stages: engine.stages.length };
    },
  },

  stream_batch: {
    description: 'Add batch grouping to a stream',
    inputSchema: {
      type: 'object',
      properties: {
        streamId: { type: 'string' },
        size: { type: 'number', description: 'Batch size' },
      },
      required: ['streamId', 'size'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      engine.batch(params.size || 10);
      return { ok: true, batchSize: params.size };
    },
  },

  stream_window: {
    description: 'Add windowing to a stream',
    inputSchema: {
      type: 'object',
      properties: {
        streamId: { type: 'string' },
        size: { type: 'number' },
        type: { type: 'string', enum: ['tumbling', 'sliding'] },
      },
      required: ['streamId', 'size'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      engine.window(params.size, params.type || 'tumbling');
      return { ok: true, windowSize: params.size, type: params.type || 'tumbling' };
    },
  },

  stream_take: {
    description: 'Take first N items from stream',
    inputSchema: {
      type: 'object',
      properties: {
        streamId: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['streamId', 'count'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      engine.take(params.count);
      return { ok: true, take: params.count };
    },
  },

  stream_distinct: {
    description: 'Remove duplicate items',
    inputSchema: {
      type: 'object',
      properties: {
        streamId: { type: 'string' },
        key: { type: 'string', description: 'Optional property key for comparison' },
      },
      required: ['streamId'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      engine.distinct(params.key ? item => item[params.key] : null);
      return { ok: true };
    },
  },

  stream_run: {
    description: 'Execute the stream and collect results',
    inputSchema: {
      type: 'object',
      properties: {
        streamId: { type: 'string' },
        maxResults: { type: 'number', description: 'Max items to collect' },
      },
      required: ['streamId'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      
      const results = [];
      const max = params.maxResults || 1000;
      
      for await (const item of engine) {
        results.push(item);
        if (results.length >= max) {
          engine.stop();
          break;
        }
      }
      
      return { results, stats: engine.getStats() };
    },
  },

  stream_stats: {
    description: 'Get stream statistics',
    inputSchema: {
      type: 'object',
      properties: { streamId: { type: 'string' } },
      required: ['streamId'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      return engine.describe();
    },
  },

  stream_stop: {
    description: 'Stop a running stream',
    inputSchema: {
      type: 'object',
      properties: { streamId: { type: 'string' } },
      required: ['streamId'],
    },
    handler: async (params) => {
      const engine = streams.get(params.streamId);
      if (!engine) throw new Error(`Stream not found: ${params.streamId}`);
      engine.stop();
      streams.delete(params.streamId);
      return { stopped: true, stats: engine.getStats() };
    },
  },

  stream_list: {
    description: 'List all active streams',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      return [...streams.entries()].map(([id, e]) => ({
        id,
        running: e.running,
        stages: e.stages.length,
        stats: e.getStats(),
      }));
    },
  },

  stream_aggregate: {
    description: 'Aggregate windowed results (sum, avg, min, max, count, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array of items to aggregate' },
        operation: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count', 'median', 'stddev', 'first', 'last'] },
        key: { type: 'string', description: 'Property key for aggregation' },
      },
      required: ['data', 'operation'],
    },
    handler: async (params) => {
      const fn = Aggregations[params.operation];
      if (!fn) throw new Error(`Unknown operation: ${params.operation}`);
      return { result: fn(params.data, params.key), operation: params.operation, count: params.data.length };
    },
  },
};

// ── JSON-RPC Handler ──────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const respond = (result, error) => {
    const resp = { jsonrpc: '2.0', id: req.id };
    if (error) resp.error = { code: -32000, message: error.message || String(error) };
    else resp.result = result;
    process.stdout.write(JSON.stringify(resp) + '\n');
  };

  if (req.method === 'tools/list') {
    respond({
      tools: Object.entries(tools).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    return;
  }

  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params || {};
    const tool = tools[name];
    if (!tool) {
      respond(null, new Error(`Unknown tool: ${name}`));
      return;
    }
    try {
      respond(await tool.handler(args || {}));
    } catch (err) {
      respond(null, err);
    }
    return;
  }

  respond(null, new Error(`Unknown method: ${req.method}`));
});

process.stderr.write('agent-stream MCP server ready\n');
