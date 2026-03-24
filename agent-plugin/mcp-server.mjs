#!/usr/bin/env node
/**
 * agent-plugin MCP Server
 * 
 * Exposes plugin management via Model Context Protocol (JSON-RPC stdio)
 */

import { PluginManager } from './index.mjs';
import { createInterface } from 'readline';

const manager = new PluginManager({ dataDir: process.env.DATA_DIR || './data' });

const TOOLS = {
  plugin_register: {
    name: 'plugin_register',
    description: 'Register a new plugin with manifest. Factory must be a valid JS function string.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        version: { type: 'string', default: '1.0.0' },
        description: { type: 'string' },
        author: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        dependencies: { type: 'array', items: { type: 'string' } },
        hooks: { type: 'array', items: { type: 'string' } },
        provides: { type: 'array', items: { type: 'string' } },
        consumes: { type: 'array', items: { type: 'string' } },
        priority: { type: 'number', default: 100 },
        config: { type: 'object' },
        factoryCode: { type: 'string', description: 'JS code string: (ctx) => ({ ...api })' }
      },
      required: ['name', 'factoryCode']
    }
  },
  plugin_load: {
    name: 'plugin_load',
    description: 'Load a registered plugin (instantiate it)',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  },
  plugin_enable: {
    name: 'plugin_enable',
    description: 'Enable a loaded/disabled plugin',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  },
  plugin_disable: {
    name: 'plugin_disable',
    description: 'Disable an enabled plugin',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  },
  plugin_uninstall: {
    name: 'plugin_uninstall',
    description: 'Uninstall a plugin completely',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  },
  plugin_reload: {
    name: 'plugin_reload',
    description: 'Hot-reload a plugin',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  },
  plugin_call: {
    name: 'plugin_call',
    description: 'Call a method on an enabled plugin',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        method: { type: 'string' },
        args: { type: 'array', items: {} }
      },
      required: ['name', 'method']
    }
  },
  plugin_get: {
    name: 'plugin_get',
    description: 'Get plugin details by name',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  },
  plugin_list: {
    name: 'plugin_list',
    description: 'List all plugins, optionally filtered by state/tag/provides',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['registered', 'loaded', 'enabled', 'disabled', 'error', 'uninstalled'] },
        tag: { type: 'string' },
        provides: { type: 'string' }
      }
    }
  },
  plugin_hook_call: {
    name: 'plugin_hook_call',
    description: 'Call all handlers registered for a hook',
    inputSchema: {
      type: 'object',
      properties: {
        hookName: { type: 'string' },
        data: {},
        sequential: { type: 'boolean', default: true }
      },
      required: ['hookName', 'data']
    }
  },
  plugin_hooks_list: {
    name: 'plugin_hooks_list',
    description: 'List all registered hooks and their handlers',
    inputSchema: { type: 'object', properties: {} }
  },
  plugin_stats: {
    name: 'plugin_stats',
    description: 'Get overall plugin manager statistics',
    inputSchema: { type: 'object', properties: {} }
  }
};

async function handleRequest(req) {
  const { method, params, id } = req;

  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'agent-plugin', version: '1.0.0' }
    };
  }

  if (method === 'notifications/initialized') return null;

  if (method === 'tools/list') {
    return { tools: Object.values(TOOLS) };
  }

  if (method === 'tools/call') {
    const { name: toolName, arguments: args } = params;
    try {
      switch (toolName) {
        case 'plugin_register': {
          const { factoryCode, ...manifest } = args;
          let factory;
          try {
            factory = new Function('return ' + factoryCode)();
          } catch (e) {
            return makeError(id, `Invalid factory code: ${e.message}`);
          }
          const plugin = manager.register(manifest, factory);
          return { content: [{ type: 'text', text: JSON.stringify(plugin.toJSON(), null, 2) }] };
        }
        case 'plugin_load': {
          const plugin = await manager.load(args.name);
          return { content: [{ type: 'text', text: JSON.stringify(plugin.toJSON(), null, 2) }] };
        }
        case 'plugin_enable': {
          const plugin = await manager.enable(args.name);
          return { content: [{ type: 'text', text: JSON.stringify(plugin.toJSON(), null, 2) }] };
        }
        case 'plugin_disable': {
          const plugin = await manager.disable(args.name);
          return { content: [{ type: 'text', text: JSON.stringify(plugin.toJSON(), null, 2) }] };
        }
        case 'plugin_uninstall': {
          await manager.uninstall(args.name);
          return { content: [{ type: 'text', text: `Plugin "${args.name}" uninstalled` }] };
        }
        case 'plugin_reload': {
          const plugin = await manager.reload(args.name);
          return { content: [{ type: 'text', text: JSON.stringify(plugin.toJSON(), null, 2) }] };
        }
        case 'plugin_call': {
          const result = await manager.callPlugin(args.name, args.method, ...(args.args || []));
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'plugin_get': {
          const plugin = manager.get(args.name);
          return { content: [{ type: 'text', text: JSON.stringify(plugin, null, 2) }] };
        }
        case 'plugin_list': {
          const plugins = manager.list(args || {});
          return { content: [{ type: 'text', text: JSON.stringify(plugins, null, 2) }] };
        }
        case 'plugin_hook_call': {
          const result = await manager.callHook(args.hookName, args.data, { sequential: args.sequential !== false });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'plugin_hooks_list': {
          return { content: [{ type: 'text', text: JSON.stringify(manager.listHooks(), null, 2) }] };
        }
        case 'plugin_stats': {
          return { content: [{ type: 'text', text: JSON.stringify(manager.stats(), null, 2) }] };
        }
        default:
          return makeError(id, `Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return makeError(id, err.message);
    }
  }

  return makeError(id, `Unknown method: ${method}`);
}

function makeError(id, message) {
  return {
    error: { code: -32000, message },
    id
  };
}

// ── JSON-RPC stdio loop ──────────────────────────────────────────
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const result = await handleRequest(req);
  if (result !== null) {
    const resp = { jsonrpc: '2.0', ...result };
    if (req.id !== undefined) resp.id = req.id;
    process.stdout.write(JSON.stringify(resp) + '\n');
  }
});

process.stdin.resume();
