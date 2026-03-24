#!/usr/bin/env node
// agent-notify MCP Server — 10 tools for multi-channel notification dispatch
// Usage: node mcp-server.mjs  (stdio JSON-RPC)

import { AgentNotify, Priority, createChannel } from './index.mjs';
import { readFileSync } from 'node:fs';

const notify = new AgentNotify();

let _id = 0;
const ok = (id, result) => JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
const err = (id, msg) => JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: msg } });

const TOOLS = [
  { name: 'notify_send', description: 'Send a notification', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] }, tag: { type: 'string' }, channels: { type: 'array', items: { type: 'string' }, description: 'Target channels (empty = all)' } }, required: ['body'] } },
  { name: 'notify_channel_add', description: 'Add a notification channel', inputSchema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['console', 'file', 'http', 'webhook', 'telegram', 'discord', 'slack'] }, config: { type: 'object', description: 'Channel-specific config' } }, required: ['name', 'type'] } },
  { name: 'notify_channel_remove', description: 'Remove a channel', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'notify_channel_enable', description: 'Enable a channel', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'notify_channel_disable', description: 'Disable a channel', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'notify_channels_list', description: 'List all channels', inputSchema: { type: 'object', properties: {} } },
  { name: 'notify_template_add', description: 'Add a message template', inputSchema: { type: 'object', properties: { name: { type: 'string' }, template: { type: 'string', description: 'Template with {{var}} placeholders' } }, required: ['name', 'template'] } },
  { name: 'notify_stats', description: 'Get notification stats', inputSchema: { type: 'object', properties: {} } },
  { name: 'notify_rule_add', description: 'Add routing rule', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Rule identifier' }, matchTag: { type: 'string', description: 'Match notifications with this tag' }, matchMinPriority: { type: 'string' }, channels: { type: 'array', items: { type: 'string' } } }, required: ['channels'] } },
  { name: 'notify_quiet_hours', description: 'Set quiet hours (24h format)', inputSchema: { type: 'object', properties: { start: { type: 'number', description: 'Hour to start (0-23)' }, end: { type: 'number', description: 'Hour to end (0-23)' } }, required: ['start', 'end'] } },
];

function handleRequest(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return null; }
  const { id, method, params } = msg;

  if (method === 'initialize') return ok(id, { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-notify', version: '1.0.0' }, capabilities: { tools: {} } });
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      switch (name) {
        case 'notify_send': {
          const priMap = { low: 0, normal: 1, high: 2, critical: 3 };
          const result = notify.send({
            title: args.title,
            body: args.body,
            priority: priMap[args.priority] ?? 1,
            tag: args.tag,
          });
          return result.then(r => ok(id, r)).catch(e => err(id, e.message));
        }
        case 'notify_channel_add': {
          notify.addChannel(args.name, args.type, args.config || {});
          return ok(id, { added: args.name });
        }
        case 'notify_channel_remove': {
          notify.removeChannel(args.name);
          return ok(id, { removed: args.name });
        }
        case 'notify_channel_enable': {
          notify.enableChannel(args.name);
          return ok(id, { enabled: args.name });
        }
        case 'notify_channel_disable': {
          notify.disableChannel(args.name);
          return ok(id, { disabled: args.name });
        }
        case 'notify_channels_list': {
          return ok(id, notify.listChannels());
        }
        case 'notify_template_add': {
          notify.addTemplate(args.name, args.template);
          return ok(id, { added: args.name });
        }
        case 'notify_stats': {
          return ok(id, notify.stats());
        }
        case 'notify_rule_add': {
          const priMap = { low: 0, normal: 1, high: 2, critical: 3 };
          notify.addRule({
            match: (n) => {
              if (args.matchTag && n.tag !== args.matchTag) return false;
              if (args.matchMinPriority && n.priority < (priMap[args.matchMinPriority] ?? 0)) return false;
              return true;
            },
            channels: args.channels,
          });
          return ok(id, { ruleAdded: true });
        }
        case 'notify_quiet_hours': {
          notify.setQuietHours(args.start, args.end);
          return ok(id, { quietStart: args.start, quietEnd: args.end });
        }
        default: return err(id, `Unknown tool: ${name}`);
      }
    } catch (e) { return err(id, e.message); }
  }
  return err(id, `Unknown method: ${method}`);
}

// Add default console channel
notify.addChannel('console', 'console');

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const response = handleRequest(line);
    if (response) process.stdout.write(response + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));

console.error('agent-notify MCP server running (stdio)');
