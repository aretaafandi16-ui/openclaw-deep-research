#!/usr/bin/env node
/**
 * agent-trace MCP Server — stdio JSON-RPC
 */

import { TraceStore } from './index.mjs';
import { createInterface } from 'readline';

const TOOLS = [
  { name: 'trace_start', description: 'Start a new span', inputSchema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['span', 'llm', 'tool', 'decision', 'error', 'custom'] }, service: { type: 'string' }, traceId: { type: 'string' }, parentId: { type: 'string' }, attributes: { type: 'object' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['name'] } },
  { name: 'trace_end', description: 'End an active span', inputSchema: { type: 'object', properties: { spanId: { type: 'string' }, error: { type: 'object' }, attributes: { type: 'object' } }, required: ['spanId'] } },
  { name: 'trace_event', description: 'Add event to active span', inputSchema: { type: 'object', properties: { spanId: { type: 'string' }, name: { type: 'string' }, data: { type: 'object' } }, required: ['spanId', 'name'] } },
  { name: 'trace_error', description: 'Record error on span', inputSchema: { type: 'object', properties: { spanId: { type: 'string' }, message: { type: 'string' }, fatal: { type: 'boolean' } }, required: ['spanId', 'message'] } },
  { name: 'trace_query', description: 'Query spans with filters', inputSchema: { type: 'object', properties: { type: { type: 'string' }, service: { type: 'string' }, status: { type: 'string' }, name: { type: 'string' }, traceId: { type: 'string' }, error: { type: 'boolean' }, limit: { type: 'number' }, since: { type: 'number' } } } },
  { name: 'trace_get', description: 'Get a trace by traceId (all spans)', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } }, required: ['traceId'] } },
  { name: 'trace_timeline', description: 'Get text timeline for a trace', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } }, required: ['traceId'] } },
  { name: 'trace_tree', description: 'Get span tree for a trace', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } }, required: ['traceId'] } },
  { name: 'trace_perf', description: 'Get performance statistics', inputSchema: { type: 'object', properties: { type: { type: 'string' }, service: { type: 'string' } } } },
  { name: 'trace_active', description: 'List active (unfinished) spans', inputSchema: { type: 'object', properties: {} } },
  { name: 'trace_export', description: 'Export spans as JSONL', inputSchema: { type: 'object', properties: { type: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'trace_stats', description: 'Get store stats (total, errors, byType)', inputSchema: { type: 'object', properties: {} } },
];

export class MCPStdioServer {
  constructor(store) {
    this.store = store;
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on('line', line => this._handle(line.trim()));
  }

  _respond(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }

  _error(id, message, code = -32603) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  }

  async _handle(line) {
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    try {
      if (msg.method === 'initialize') {
        return this._respond(msg.id, { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-trace', version: '1.0.0' }, capabilities: { tools: {} } });
      }
      if (msg.method === 'tools/list') {
        return this._respond(msg.id, { tools: TOOLS });
      }
      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        const result = await this._call(name, args || {});
        return this._respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      }
      this._error(msg.id, 'Unknown method: ' + msg.method, -32601);
    } catch (err) {
      this._error(msg.id, err.message);
    }
  }

  async _call(name, args) {
    switch (name) {
      case 'trace_start':
        return this.store.startSpan(args.name, args);
      case 'trace_end':
        return this.store.endSpan(args.spanId, args);
      case 'trace_event':
        return this.store.addEvent(args.spanId, args.name, args.data);
      case 'trace_error':
        return this.store.recordError(args.spanId, new Error(args.message), args.fatal);
      case 'trace_query':
        return this.store.query(args);
      case 'trace_get':
        return { spans: this.store.getTrace(args.traceId), timeline: this.store.timeline(args.traceId) };
      case 'trace_timeline':
        return this.store.timeline(args.traceId);
      case 'trace_tree':
        return this.store.buildTree(args.traceId);
      case 'trace_perf':
        return this.store.perfStats(args);
      case 'trace_active':
        return this.store.getActive();
      case 'trace_export':
        return this.store.exportJSONL(args);
      case 'trace_stats':
        return this.store.stats;
      default:
        throw new Error('Unknown tool: ' + name);
    }
  }
}

// Standalone MCP
if (process.argv[1]?.includes('mcp-server')) {
  new MCPStdioServer(new TraceStore());
}
