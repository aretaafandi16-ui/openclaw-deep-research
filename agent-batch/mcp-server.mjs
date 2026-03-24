#!/usr/bin/env node
/**
 * agent-batch MCP Server — JSON-RPC stdio interface
 * 10 tools for batch processing
 */

import { BatchProcessor } from './index.mjs';

const bp = new BatchProcessor({ persistRuns: false });

const TOOLS = {
  batch_execute: {
    description: 'Execute a batch of items with a processor function',
    inputSchema: { type: 'object', properties: {
      items: { type: 'array', description: 'Array of items to process' },
      fn: { type: 'string', description: 'JS function body (receives item, index)' },
      concurrency: { type: 'number', default: 5 },
      retries: { type: 'number', default: 0 },
      retryDelay: { type: 'number', default: 1000 },
      itemTimeout: { type: 'number', default: 30000 },
      rateLimit: { type: 'number', description: 'Items per second (0=unlimited)', default: 0 },
      chunkSize: { type: 'number', description: 'Chunk size (0=single batch)', default: 0 }
    }, required: ['items', 'fn'] }
  },
  batch_map: {
    description: 'Map-style: transform each item and collect results',
    inputSchema: { type: 'object', properties: {
      items: { type: 'array' }, fn: { type: 'string', description: 'JS transform function body' },
      concurrency: { type: 'number', default: 5 }, retries: { type: 'number', default: 0 }
    }, required: ['items', 'fn'] }
  },
  batch_filter: {
    description: 'Filter items where predicate returns true',
    inputSchema: { type: 'object', properties: {
      items: { type: 'array' }, fn: { type: 'string', description: 'JS predicate body (return true to keep)' },
      concurrency: { type: 'number', default: 5 }
    }, required: ['items', 'fn'] }
  },
  batch_reduce: {
    description: 'Reduce items to a single accumulator value',
    inputSchema: { type: 'object', properties: {
      items: { type: 'array' }, fn: { type: 'string', description: 'JS reducer body (acc, item, idx)' },
      initial: { description: 'Initial accumulator value' }
    }, required: ['items', 'fn', 'initial'] }
  },
  batch_retry: {
    description: 'Retry a single async function with exponential backoff',
    inputSchema: { type: 'object', properties: {
      fn: { type: 'string', description: 'JS function body (receives attempt)' },
      retries: { type: 'number', default: 3 },
      delay: { type: 'number', default: 1000 },
      backoff: { type: 'number', default: 2 }
    }, required: ['fn'] }
  },
  batch_chunk: {
    description: 'Split an array into chunks of specified size',
    inputSchema: { type: 'object', properties: {
      items: { type: 'array' }, size: { type: 'number' }
    }, required: ['items', 'size'] }
  },
  batch_progress: {
    description: 'Get progress of a running batch',
    inputSchema: { type: 'object', properties: { batchId: { type: 'string' } }, required: ['batchId'] }
  },
  batch_cancel: {
    description: 'Cancel a running batch',
    inputSchema: { type: 'object', properties: { batchId: { type: 'string' } }, required: ['batchId'] }
  },
  batch_runs: {
    description: 'List all batch runs with stats',
    inputSchema: { type: 'object', properties: {} }
  },
  batch_stats: {
    description: 'Get aggregate batch processing statistics',
    inputSchema: { type: 'object', properties: {} }
  }
};

let id = 0;
function respond(result, error) {
  const resp = { jsonrpc: '2.0', id: id++, result: result ?? null };
  if (error) { delete resp.result; resp.error = { code: -32000, message: error }; }
  process.stdout.write(JSON.stringify(resp) + '\n');
}

async function handleRequest(req) {
  const { method, params } = req;
  if (method === 'initialize') {
    return respond({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-batch', version: '1.0.0' } });
  }
  if (method === 'tools/list') {
    return respond({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, ...t })) });
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      switch (name) {
        case 'batch_execute': {
          const fn = new Function('item', 'index', args.fn);
          const result = await bp.execute(args.items, fn, { concurrency: args.concurrency, retries: args.retries, retryDelay: args.retryDelay, itemTimeout: args.itemTimeout, rateLimit: args.rateLimit, chunkSize: args.chunkSize });
          return respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        }
        case 'batch_map': {
          const fn = new Function('item', 'index', args.fn);
          const result = await bp.map(args.items, fn, { concurrency: args.concurrency, retries: args.retries });
          return respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        }
        case 'batch_filter': {
          const fn = new Function('item', 'index', 'return ' + args.fn);
          const result = await bp.filter(args.items, fn, { concurrency: args.concurrency });
          return respond({ content: [{ type: 'text', text: JSON.stringify(result.filtered, null, 2) }] });
        }
        case 'batch_reduce': {
          const fn = new Function('acc', 'item', 'index', args.fn);
          const result = await bp.reduce(args.items, fn, args.initial);
          return respond({ content: [{ type: 'text', text: JSON.stringify({ accumulator: result.accumulator }, null, 2) }] });
        }
        case 'batch_retry': {
          const fn = new Function('attempt', args.fn);
          const result = await bp.retry(fn, { retries: args.retries, delay: args.delay, backoff: args.backoff });
          return respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        }
        case 'batch_chunk': {
          const result = bp.chunk(args.items, args.size);
          return respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        }
        case 'batch_progress': {
          const run = bp.getRun(args.batchId);
          if (!run) return respond(null, 'Batch not found');
          return respond({ content: [{ type: 'text', text: JSON.stringify(run.getProgress(), null, 2) }] });
        }
        case 'batch_cancel': {
          const run = bp.getRun(args.batchId);
          if (!run) return respond(null, 'Batch not found');
          run.cancel();
          return respond({ content: [{ type: 'text', text: 'Cancelled' }] });
        }
        case 'batch_runs': return respond({ content: [{ type: 'text', text: JSON.stringify(bp.getRuns(), null, 2) }] });
        case 'batch_stats': return respond({ content: [{ type: 'text', text: JSON.stringify(bp.getStats(), null, 2) }] });
        default: return respond(null, `Unknown tool: ${name}`);
      }
    } catch (e) {
      return respond({ content: [{ type: 'text', text: `Error: ${e.message}` }] });
    }
  }
  respond(null, `Unknown method: ${method}`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try { handleRequest(JSON.parse(line)); } catch (e) { /* skip */ }
  }
});
console.error('agent-batch MCP server ready (stdio)');
