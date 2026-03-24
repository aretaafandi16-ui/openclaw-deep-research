#!/usr/bin/env node
/**
 * agent-rate MCP Server — JSON-RPC stdio
 */
import { AgentRate } from './index.mjs';

const rate = new AgentRate();
rate.addLimiter('default', { strategy: 'fixed_window', limit: 100, windowMs: 60000 });

const TOOLS = [
  { name: 'rate_check', description: 'Check if a request is allowed by rate limiter', inputSchema: { type: 'object', properties: { key: { type: 'string' }, limiter: { type: 'string', default: 'default' } }, required: ['key'] } },
  { name: 'rate_is_allowed', description: 'Returns boolean — is request allowed?', inputSchema: { type: 'object', properties: { key: { type: 'string' }, limiter: { type: 'string', default: 'default' } }, required: ['key'] } },
  { name: 'rate_consume', description: 'Consume N tokens at once', inputSchema: { type: 'object', properties: { key: { type: 'string' }, n: { type: 'number' }, limiter: { type: 'string', default: 'default' } }, required: ['key', 'n'] } },
  { name: 'rate_reset', description: 'Reset rate limit for a key', inputSchema: { type: 'object', properties: { key: { type: 'string' }, limiter: { type: 'string', default: 'default' } }, required: ['key'] } },
  { name: 'rate_reset_all', description: 'Reset all keys for a limiter', inputSchema: { type: 'object', properties: { limiter: { type: 'string', default: 'default' } } } },
  { name: 'rate_add_limiter', description: 'Add a named rate limiter', inputSchema: { type: 'object', properties: { name: { type: 'string' }, strategy: { type: 'string', enum: ['fixed_window', 'sliding_window_log', 'sliding_window_counter', 'token_bucket', 'leaky_bucket'] }, limit: { type: 'number' }, windowMs: { type: 'number' }, burst: { type: 'number' } }, required: ['name', 'limit', 'windowMs'] } },
  { name: 'rate_remove_limiter', description: 'Remove a named limiter', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'rate_list_limiters', description: 'List all limiters', inputSchema: { type: 'object', properties: {} } },
  { name: 'rate_stats', description: 'Get global rate limit stats', inputSchema: { type: 'object', properties: { limiter: { type: 'string' } } } },
  { name: 'rate_state', description: 'Get current state of a limiter', inputSchema: { type: 'object', properties: { limiter: { type: 'string', default: 'default' } } } },
];

let id = 0;
function respond(result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: id++, result }) + '\n'); }

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handle(msg);
    } catch { /* ignore */ }
  }
});

function handle(msg) {
  if (msg.method === 'initialize') {
    return reply(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-rate', version: '1.0.0' } });
  }
  if (msg.method === 'tools/list') return reply(msg.id, { tools: TOOLS });
  if (msg.method === 'tools/call') return handleTool(msg);
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function replyError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -1, message } }) + '\n');
}

function handleTool(msg) {
  const { name, arguments: args } = msg.params;
  try {
    let result;
    switch (name) {
      case 'rate_check': result = rate.check(args.key, args.limiter); break;
      case 'rate_is_allowed': result = rate.isAllowed(args.key, args.limiter); break;
      case 'rate_consume': result = rate.consume(args.key, args.n, args.limiter); break;
      case 'rate_reset': rate.reset(args.key, args.limiter); result = { ok: true }; break;
      case 'rate_reset_all': rate.resetAll(args.limiter); result = { ok: true }; break;
      case 'rate_add_limiter':
        rate.addLimiter(args.name, { strategy: args.strategy || 'fixed_window', limit: args.limit, windowMs: args.windowMs, burst: args.burst || 0 });
        result = { ok: true, name: args.name };
        break;
      case 'rate_remove_limiter': rate.removeLimiter(args.name); result = { ok: true }; break;
      case 'rate_list_limiters': result = rate.listLimiters(); break;
      case 'rate_stats': result = rate.getStats(args.limiter); break;
      case 'rate_state': result = rate.getState(args.limiter || 'default'); break;
      default: return replyError(msg.id, `Unknown tool: ${name}`);
    }
    reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  } catch (e) {
    replyError(msg.id, e.message);
  }
}

console.error('agent-rate MCP server running on stdio');
