#!/usr/bin/env node
/**
 * agent-sandbox MCP Server
 * Provides 10 tools via JSON-RPC stdio for isolated code execution
 */

import { createInterface } from 'readline';
import { AgentSandbox } from './index.mjs';

const sandbox = new AgentSandbox({ persistFile: '.agent-sandbox/sandbox.jsonl' });

const TOOLS = [
  { name: 'sandbox_run', description: 'Run code in sandbox', inputSchema: { type: 'object', properties: { code: { type: 'string' }, timeout: { type: 'number' }, globals: { type: 'object' } }, required: ['code'] } },
  { name: 'sandbox_run_function', description: 'Run a function with args', inputSchema: { type: 'object', properties: { fn: { type: 'string', description: 'Function body or arrow function' }, args: { type: 'array' }, timeout: { type: 'number' } }, required: ['fn'] } },
  { name: 'sandbox_run_expression', description: 'Evaluate expression with context', inputSchema: { type: 'object', properties: { expression: { type: 'string' }, context: { type: 'object' } }, required: ['expression'] } },
  { name: 'sandbox_run_batch', description: 'Run multiple code snippets', inputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } }, concurrency: { type: 'number' } }, required: ['items'] } },
  { name: 'sandbox_snapshot', description: 'Create a persistent context snapshot', inputSchema: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' }, globals: { type: 'object' } }, required: ['name', 'code'] } },
  { name: 'sandbox_run_in_snapshot', description: 'Run code in existing snapshot', inputSchema: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' } }, required: ['name', 'code'] } },
  { name: 'sandbox_list_snapshots', description: 'List all snapshots', inputSchema: { type: 'object', properties: {} } },
  { name: 'sandbox_delete_snapshot', description: 'Delete a snapshot', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'sandbox_stats', description: 'Get execution statistics', inputSchema: { type: 'object', properties: {} } },
  { name: 'sandbox_history', description: 'Get execution history', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, success: { type: 'boolean' } } } },
];

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-sandbox', version: '1.0.0' } };
  }
  if (method === 'tools/list') {
    return { tools: TOOLS };
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      switch (name) {
        case 'sandbox_run': {
          const result = sandbox.run(args.code, { timeout: args.timeout, globals: args.globals });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'sandbox_run_function': {
          const fn = eval(args.fn);
          const result = sandbox.runFunction(fn, args.args ?? [], { timeout: args.timeout });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'sandbox_run_expression': {
          const result = sandbox.runExpression(args.expression, args.context ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'sandbox_run_batch': {
          return sandbox.runBatch(args.items, { concurrency: args.concurrency }).then(results =>
            ({ content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] })
          );
        }
        case 'sandbox_snapshot': {
          const result = sandbox.snapshot(args.name, args.code, { globals: args.globals });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'sandbox_run_in_snapshot': {
          const result = sandbox.runInSnapshot(args.name, args.code);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'sandbox_list_snapshots': {
          return { content: [{ type: 'text', text: JSON.stringify(sandbox.listSnapshots(), null, 2) }] };
        }
        case 'sandbox_delete_snapshot': {
          sandbox.deleteSnapshot(args.name);
          return { content: [{ type: 'text', text: JSON.stringify({ deleted: true }) }] };
        }
        case 'sandbox_stats': {
          return { content: [{ type: 'text', text: JSON.stringify(sandbox.getStats(), null, 2) }] };
        }
        case 'sandbox_history': {
          return { content: [{ type: 'text', text: JSON.stringify(sandbox.getHistory({ limit: args.limit, success: args.success }), null, 2) }] };
        }
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
  return {};
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  try {
    const req = JSON.parse(line);
    const result = handleRequest(req);
    if (result && typeof result.then === 'function') {
      result.then(r => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: r }) + '\n'));
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
    }
  } catch {}
});
