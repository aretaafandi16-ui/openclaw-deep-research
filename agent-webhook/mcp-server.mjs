#!/usr/bin/env node
/**
 * agent-webhook MCP Server
 * 
 * Exposes webhook management as MCP tools over JSON-RPC stdio.
 */

import { createInterface } from 'node:readline';
import { WebhookDispatcher } from './index.mjs';

const dispatcher = new WebhookDispatcher({ port: 0 }); // not started, just for management
const registeredHandlers = new Map();

const TOOLS = [
  {
    name: 'webhook_start',
    description: 'Start the webhook HTTP server',
    inputSchema: { type: 'object', properties: { port: { type: 'number', default: 3107 }, host: { type: 'string', default: '0.0.0.0' } } },
  },
  {
    name: 'webhook_stop',
    description: 'Stop the webhook server',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'webhook_stats',
    description: 'Get webhook delivery statistics',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'webhook_register',
    description: 'Register a webhook handler pattern',
    inputSchema: { type: 'object', properties: {
      pattern: { type: 'object', description: 'Pattern to match: { source, eventType, path } or string path' },
      name: { type: 'string', description: 'Handler name' },
    }, required: ['pattern', 'name'] },
  },
  {
    name: 'webhook_unregister',
    description: 'Remove a webhook handler',
    inputSchema: { type: 'object', properties: { handlerId: { type: 'string' } }, required: ['handlerId'] },
  },
  {
    name: 'webhook_list',
    description: 'List registered handlers',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'webhook_emit',
    description: 'Emit a test webhook event',
    inputSchema: { type: 'object', properties: {
      source: { type: 'string', default: 'custom' },
      path: { type: 'string', default: '/webhook' },
      body: { type: 'object' },
      eventType: { type: 'string' },
    }, required: ['body'] },
  },
  {
    name: 'webhook_sources',
    description: 'List supported webhook source presets',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'webhook_set_secret',
    description: 'Set signature verification secret for a source',
    inputSchema: { type: 'object', properties: {
      source: { type: 'string' },
      secret: { type: 'string' },
    }, required: ['source', 'secret'] },
  },
  {
    name: 'webhook_event_log',
    description: 'Get recent webhook events from log',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
  },
  {
    name: 'webhook_test_signature',
    description: 'Test signature verification',
    inputSchema: { type: 'object', properties: {
      source: { type: 'string' },
      secret: { type: 'string' },
      payload: { type: 'string' },
    }, required: ['source', 'secret', 'payload'] },
  },
  {
    name: 'webhook_health',
    description: 'Get webhook server health status',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function handleTool(name, args = {}) {
  switch (name) {
    case 'webhook_start': {
      const d = new WebhookDispatcher({ port: args.port || 3107, host: args.host || '0.0.0.0' });
      await d.start();
      registeredHandlers.forEach((h, id) => d.on(h.pattern, h.fn, h.options));
      return { status: 'started', port: args.port || 3107 };
    }
    case 'webhook_stop':
      await dispatcher.stop();
      return { status: 'stopped' };
    case 'webhook_stats':
      return { ...dispatcher.stats, handlers: dispatcher.handlers.size, retryQueue: dispatcher.retryQueue.size };
    case 'webhook_register': {
      const name_ = args.name;
      const pattern = args.pattern;
      const id = dispatcher.on(pattern, async (event) => {
        // Store for MCP polling
        dispatcher.emit('mcp_handler_' + name_, event);
      }, { name: name_ });
      registeredHandlers.set(id, { pattern, name: name_, fn: null, options: {} });
      return { handlerId: id, name: name_, pattern };
    }
    case 'webhook_unregister':
      dispatcher.off(args.handlerId);
      registeredHandlers.delete(args.handlerId);
      return { removed: true };
    case 'webhook_list':
      return [...dispatcher.handlers.values()].map(h => ({ id: h.id, pattern: h.pattern, options: { ...h.options, handler: undefined } }));
    case 'webhook_emit': {
      const event = {
        id: crypto.randomUUID?.() || Date.now().toString(36),
        source: args.source || 'custom',
        path: args.path || '/webhook',
        method: 'POST',
        headers: {},
        body: args.body,
        rawBody: JSON.stringify(args.body),
        timestamp: Date.now(),
        eventType: args.eventType || args.body?.event || args.body?.type || 'custom',
        metadata: {},
      };
      const result = await dispatcher.dispatch(event);
      return result;
    }
    case 'webhook_sources':
      return Object.keys(dispatcher.sources);
    case 'webhook_set_secret':
      dispatcher.options.secrets[args.source] = args.secret;
      return { set: true, source: args.source };
    case 'webhook_event_log': {
      if (!dispatcher._logDir) return { error: 'No persistDir configured' };
      const fs = await import('node:fs');
      const path = await import('node:path');
      const date = new Date().toISOString().slice(0, 10);
      const file = path.join(dispatcher._logDir, `events-${date}.jsonl`);
      if (!fs.existsSync(file)) return { events: [] };
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-(args.limit || 20));
      return { events: lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
    }
    case 'webhook_test_signature': {
      const { createHmac } = await import('node:crypto');
      const sig = createHmac('sha256', args.secret).update(args.payload).digest('hex');
      return { signature: `sha256=${sig}`, header: `${args.source === 'github' ? 'x-hub-signature-256' : 'x-signature'}` };
    }
    case 'webhook_health':
      return { status: 'ok', uptime: process.uptime(), ...dispatcher.stats, handlers: dispatcher.handlers.size };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC Server ────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function respond(id, result, error) {
  const resp = { jsonrpc: '2.0', id };
  if (error) resp.error = { code: -32000, message: error.message || String(error) };
  else resp.result = result;
  process.stdout.write(JSON.stringify(resp) + '\n');
}

rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-webhook', version: '1.0.0' } });
  } else if (msg.method === 'tools/list') {
    respond(msg.id, { tools: TOOLS });
  } else if (msg.method === 'tools/call') {
    try {
      const result = await handleTool(msg.params.name, msg.params.arguments || {});
      respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      respond(msg.id, null, err);
    }
  } else if (msg.method === 'notifications/initialized') {
    // no-op
  } else {
    respond(msg.id, null, new Error(`Unknown method: ${msg.method}`));
  }
});

process.stdin.resume();
