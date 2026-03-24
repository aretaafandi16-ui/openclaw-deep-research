#!/usr/bin/env node
/**
 * agent-events MCP Server — JSON-RPC stdio MCP interface
 */
import { EventStore, ProjectionEngine, SagaEngine, EventUpcaster, ReadModel } from './index.mjs';
import { createInterface } from 'readline';

const store = new EventStore({ dir: process.env.EVENTS_DIR || '.agent-events' });
const proj = new ProjectionEngine(store);
const saga = new SagaEngine(store);

const TOOLS = {
  events_append: {
    desc: 'Append event to stream',
    params: { streamId: 'string', eventType: 'string', payload: 'object', correlationId: 'string?', causationId: 'string?' },
    fn: (p) => store.append(p.streamId, p.eventType, p.payload || {}, { correlationId: p.correlationId, causationId: p.causationId })
  },
  events_get_stream: {
    desc: 'Get events from a stream',
    params: { streamId: 'string', fromVersion: 'number?', toVersion: 'number?' },
    fn: (p) => store.getStream(p.streamId, p.fromVersion || 0, p.toVersion ?? Infinity)
  },
  events_get_all: {
    desc: 'Get all events across streams',
    params: { fromSeq: 'number?' },
    fn: (p) => store.getAllEvents(p.fromSeq || 0)
  },
  events_by_type: {
    desc: 'Get events by type',
    params: { eventType: 'string', fromSeq: 'number?' },
    fn: (p) => store.getByType(p.eventType, p.fromSeq || 0)
  },
  events_by_correlation: {
    desc: 'Get events by correlation ID',
    params: { correlationId: 'string' },
    fn: (p) => store.getByCorrelation(p.correlationId)
  },
  events_snapshot: {
    desc: 'Save aggregate snapshot',
    params: { aggregateId: 'string', state: 'object', version: 'number' },
    fn: (p) => store.saveSnapshot(p.aggregateId, p.state, p.version)
  },
  events_get_snapshot: {
    desc: 'Get aggregate snapshot',
    params: { aggregateId: 'string' },
    fn: (p) => store.getSnapshot(p.aggregateId)
  },
  events_projection_define: {
    desc: 'Define a projection',
    params: { name: 'string', initialState: 'object', handlers: 'object' },
    fn: (p) => { proj.define(p.name, p.initialState || {}, p.handlers || {}); return { name: p.name, created: true }; }
  },
  events_projection_state: {
    desc: 'Get projection state',
    params: { name: 'string' },
    fn: (p) => proj.getState(p.name)
  },
  events_saga_define: {
    desc: 'Define a saga',
    params: { name: 'string', steps: 'array' },
    fn: (p) => { saga.define(p.name, { steps: (p.steps || []).map(s => ({ ...s, action: new Function('data', 'results', s.actionCode || 'return true;') })) }); return { name: p.name, defined: true }; }
  },
  events_saga_start: {
    desc: 'Start a saga instance',
    params: { sagaName: 'string', data: 'object?' },
    fn: async (p) => { const inst = await saga.start(p.sagaName, p.data || {}); return { id: inst.id, status: inst.status, results: inst.results }; }
  },
  events_stats: {
    desc: 'Get event store stats',
    params: {},
    fn: () => ({ ...store.stats(), sagas: saga.stats() })
  },
  events_streams: {
    desc: 'List all streams',
    params: {},
    fn: () => store.listStreams()
  }
};

// JSON-RPC stdio handler
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;

  if (method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'agent-events', version: '1.0.0' } } }) + '\n');
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'ping') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }) + '\n'); return; }

  if (method === 'tools/list') {
    const tools = Object.entries(TOOLS).map(([name, t]) => ({
      name, description: t.desc,
      inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, { type: v.replace('?', '') }])) }
    }));
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { tools } }) + '\n');
    return;
  }

  if (method === 'tools/call') {
    const tool = TOOLS[params?.name];
    if (!tool) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params?.name}` } }) + '\n');
      return;
    }
    try {
      const result = await tool.fn(params?.arguments || {});
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }] } }) + '\n');
    }
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } }) + '\n');
});

process.stderr.write(JSON.stringify({ type: 'info', msg: 'agent-events MCP server ready' }) + '\n');
