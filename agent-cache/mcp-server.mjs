#!/usr/bin/env node
// agent-cache MCP Server — expose cache operations as MCP tools
import { AgentCache } from './index.mjs';
import { createServer } from 'http';

const cache = new AgentCache({
  defaultTTL: +(process.env.CACHE_DEFAULT_TTL ?? 300000),
  maxSize: +(process.env.CACHE_MAX_SIZE ?? 10000),
  namespace: process.env.CACHE_NAMESPACE ?? 'default',
  persistPath: process.env.CACHE_PERSIST ?? null,
});

// MCP uses stdin/stdout JSON-RPC 2.0
const TOOLS = {
  cache_set: {
    description: 'Set a cache entry with optional TTL and tags',
    parameters: {
      key: { type: 'string', required: true },
      value: { type: 'any', required: true },
      ttl: { type: 'number', description: 'TTL in ms (default: server default)' },
      tags: { type: 'array', items: 'string', description: 'Tags for group invalidation' },
    },
    handler: async (p) => {
      await cache.set(p.key, p.value, { ttl: p.ttl, tags: p.tags });
      return { success: true, key: p.key };
    },
  },
  cache_get: {
    description: 'Get a cached value by key',
    parameters: { key: { type: 'string', required: true } },
    handler: async (p) => {
      const val = await cache.get(p.key);
      return { found: val !== null, value: val };
    },
  },
  cache_delete: {
    description: 'Delete a cache entry',
    parameters: { key: { type: 'string', required: true } },
    handler: async (p) => {
      const deleted = await cache.delete(p.key);
      return { deleted };
    },
  },
  cache_has: {
    description: 'Check if a key exists in cache',
    parameters: { key: { type: 'string', required: true } },
    handler: (p) => ({ exists: cache.has(p.key) }),
  },
  cache_invalidate_tag: {
    description: 'Invalidate all entries with a specific tag',
    parameters: { tag: { type: 'string', required: true } },
    handler: async (p) => {
      const count = await cache.invalidateTag(p.tag);
      return { invalidated: count };
    },
  },
  cache_invalidate_pattern: {
    description: 'Invalidate entries matching a glob pattern',
    parameters: { pattern: { type: 'string', required: true } },
    handler: async (p) => {
      const count = await cache.invalidatePattern(p.pattern);
      return { invalidated: count };
    },
  },
  cache_mget: {
    description: 'Batch get multiple keys',
    parameters: { keys: { type: 'array', items: 'string', required: true } },
    handler: async (p) => {
      const result = await cache.mget(p.keys);
      return { values: result };
    },
  },
  cache_mset: {
    description: 'Batch set multiple entries',
    parameters: { entries: { type: 'array', items: 'object', required: true } },
    handler: async (p) => {
      const result = await cache.mset(p.entries);
      return { results: result };
    },
  },
  cache_stats: {
    description: 'Get cache statistics (hit rate, size, etc.)',
    parameters: {},
    handler: () => cache.stats(),
  },
  cache_clear: {
    description: 'Clear entire cache',
    parameters: {},
    handler: async () => {
      const count = await cache.clear();
      return { cleared: count };
    },
  },
  cache_keys: {
    description: 'List cache keys with optional pattern',
    parameters: { pattern: { type: 'string' } },
    handler: (p) => ({ keys: cache.keys(p.pattern) }),
  },
  cache_tags: {
    description: 'List tags and their entry counts',
    parameters: {},
    handler: () => ({ tags: cache.tags() }),
  },
};

// ── JSON-RPC over stdin/stdout ─────────────────────────────────────
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleRequest(line);
  }
});

async function handleRequest(raw) {
  let req;
  try { req = JSON.parse(raw); } catch {
    return respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  const { id, method, params } = req;

  if (method === 'initialize') {
    return respond({ jsonrpc: '2.0', id, result: { capabilities: { tools: {} } } });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    const tools = Object.entries(TOOLS).map(([name, t]) => ({
      name, description: t.description,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])
        ),
        required: Object.entries(t.parameters).filter(([, v]) => v.required).map(([k]) => k),
      },
    }));
    return respond({ jsonrpc: '2.0', id, result: { tools } });
  }
  if (method === 'tools/call') {
    const tool = TOOLS[params?.name];
    if (!tool) return respond({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params?.name}` } });
    try {
      const result = await tool.handler(params.arguments ?? {});
      return respond({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    } catch (err) {
      return respond({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
    }
  }

  return respond({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

function respond(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

console.error('[agent-cache] MCP server ready');
