#!/usr/bin/env node
/**
 * agent-schedule MCP Server — JSON-RPC stdio
 *
 * Tools:
 *  schedule, unschedule, enable, disable, get, list,
 *  trigger, upcoming, history, stats, add_handler
 */

import { createInterface } from 'node:readline';
import { AgentSchedule } from './index.mjs';

const TOOLS = [
  { name: 'schedule', description: 'Schedule a cron job', inputSchema: { type: 'object', properties: { name: { type: 'string' }, cron: { type: 'string' }, handlerName: { type: 'string' }, payload: { type: 'object' }, timeout: { type: 'number' }, retry: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['cron'] } },
  { name: 'unschedule', description: 'Remove a scheduled job', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'enable', description: 'Enable a job', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'disable', description: 'Disable a job', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'get', description: 'Get job details', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'list', description: 'List all jobs (optional filter)', inputSchema: { type: 'object', properties: { tag: { type: 'string' }, enabled: { type: 'boolean' } } } },
  { name: 'trigger', description: 'Manually trigger a job', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'upcoming', description: 'Get upcoming jobs', inputSchema: { type: 'object', properties: { minutes: { type: 'number' } } } },
  { name: 'history', description: 'Get run history', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, entryId: { type: 'string' } } } },
  { name: 'stats', description: 'Get scheduler stats', inputSchema: { type: 'object', properties: {} } },
];

const sched = new AgentSchedule();
sched.start();

function respond(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] } });
  process.stdout.write(msg + '\n');
}

function error(id, message, code = -32603) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(msg + '\n');
}

const handlers = {
  schedule: (p) => sched.schedule(p),
  unschedule: (p) => sched.unschedule(p.id),
  enable: (p) => sched.enable(p.id),
  disable: (p) => sched.disable(p.id),
  get: (p) => sched.get(p.id),
  list: (p) => sched.list(p),
  trigger: async (p) => sched.trigger(p.id),
  upcoming: (p) => sched.getUpcoming(p.minutes || 60),
  history: (p) => sched.getHistory(p),
  stats: () => sched.getStats(),
};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { method, params, id } = msg;

  if (method === 'initialize') {
    return respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-schedule', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') return respond(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    const handler = handlers[name];
    if (!handler) return error(id, `Unknown tool: ${name}`);
    try {
      const result = await handler(args || {});
      return respond(id, result);
    } catch (e) { return error(id, e.message); }
  }
  error(id, `Unknown method: ${method}`, -32601);
});

process.stderr.write('🐋 agent-schedule MCP server ready\n');
