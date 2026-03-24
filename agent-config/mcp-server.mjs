/**
 * agent-config MCP Server — JSON-RPC stdio transport
 * 10 tools: config_set, config_get, config_delete, config_has, config_keys,
 *           config_validate, config_snapshot, config_rollback, config_stats, config_history
 */

import { AgentConfig } from './index.mjs';
import { readFileSync } from 'fs';

const config = new AgentConfig({ dataDir: process.env.DATA_DIR || './data' });
config.loadEnv();

// Load initial config if exists
try { config.load(); } catch {}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function error(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
}

const TOOLS = {
  config_set: (args) => { config.set(args.key, args.value, { source: args.source || 'mcp' }); return { ok: true, key: args.key }; },
  config_get: (args) => {
    const val = args.masked ? config.getMasked(args.key) : config.get(args.key, args.default);
    return { key: args.key, value: val, exists: config.has(args.key) };
  },
  config_delete: (args) => { config.delete(args.key); return { ok: true, key: args.key }; },
  config_has: (args) => ({ key: args.key, exists: config.has(args.key) }),
  config_keys: (args) => ({ prefix: args.prefix || '', keys: config.keys(args.prefix) }),
  config_get_all: (args) => (args.masked ? config.getAllMasked() : config.getAll()),
  config_validate: () => config.validate(),
  config_snapshot: (args) => { config.snapshot(args.name); return { ok: true, name: args.name }; },
  config_rollback: (args) => { config.rollback(args.name); return { ok: true, name: args.name }; },
  config_stats: () => config.stats(),
  config_history: (args) => ({ items: config.history(args.limit || 20) }),
  config_load_file: (args) => { config.loadFile(args.path); return { ok: true, path: args.path }; },
  config_export: () => ({ json: config.exportJSON() }),
  config_interpolate: (args) => ({ result: config.interpolate(args.template) }),
};

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') {
        respond(msg.id, { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-config', version: '1.0.0' }, capabilities: { tools: {} } });
      } else if (msg.method === 'tools/list') {
        respond(msg.id, { tools: [
          { name: 'config_set', description: 'Set a config value by dotted path', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: {}, source: { type: 'string' } }, required: ['key', 'value'] } },
          { name: 'config_get', description: 'Get a config value by dotted path', inputSchema: { type: 'object', properties: { key: { type: 'string' }, default: {}, masked: { type: 'boolean' } }, required: ['key'] } },
          { name: 'config_delete', description: 'Delete a config key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
          { name: 'config_has', description: 'Check if a config key exists', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
          { name: 'config_keys', description: 'List keys under a prefix', inputSchema: { type: 'object', properties: { prefix: { type: 'string' } } } },
          { name: 'config_get_all', description: 'Get entire config (optionally masked)', inputSchema: { type: 'object', properties: { masked: { type: 'boolean' } } } },
          { name: 'config_validate', description: 'Validate config against schema', inputSchema: { type: 'object', properties: {} } },
          { name: 'config_snapshot', description: 'Create a named snapshot', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
          { name: 'config_rollback', description: 'Rollback to a named snapshot', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
          { name: 'config_stats', description: 'Get config statistics', inputSchema: { type: 'object', properties: {} } },
          { name: 'config_history', description: 'Get change history', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
          { name: 'config_load_file', description: 'Load config from JSON file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
          { name: 'config_export', description: 'Export config as JSON (masked)', inputSchema: { type: 'object', properties: {} } },
          { name: 'config_interpolate', description: 'Interpolate {{key}} templates in a string', inputSchema: { type: 'object', properties: { template: { type: 'string' } }, required: ['template'] } },
        ] });
      } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        const handler = TOOLS[name];
        if (!handler) { error(msg.id, `Unknown tool: ${name}`); continue; }
        try {
          const result = handler(args || {});
          respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (e) { error(msg.id, e.message); }
      } else if (msg.method === 'notifications/initialized') {
        // no-op
      }
    } catch {}
  }
});

process.stdin.on('end', () => process.exit(0));
