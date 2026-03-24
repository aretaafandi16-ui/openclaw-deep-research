/**
 * agent-embed MCP Server — JSON-RPC stdio interface
 */

import { EmbedStore } from './index.mjs';
import { readFileSync } from 'node:fs';

const store = new EmbedStore({
  dimension: parseInt(process.env.DIMENSION || '0'),
  distance: process.env.DISTANCE || 'cosine',
  persistPath: process.env.PERSIST_PATH || './data/embed.jsonl',
  ivfPartitions: parseInt(process.env.IVF_PARTITIONS || '0'),
  nprobe: parseInt(process.env.NPROBE || '3')
});

const TOOLS = {
  embed_upsert: {
    desc: 'Insert or update a vector',
    schema: { id: 'string (optional, auto-generated if omitted)', vector: 'number[] (required)', metadata: 'object (optional)' },
    fn: async (p) => store.upsert(p.id || Date.now().toString(36), p.vector, p.metadata || {})
  },
  embed_upsert_batch: {
    desc: 'Batch insert vectors',
    schema: { items: 'array of {id?, vector, metadata?}' },
    fn: async (p) => store.upsertBatch(p.items)
  },
  embed_get: {
    desc: 'Get a vector by ID',
    schema: { id: 'string (required)' },
    fn: async (p) => store.get(p.id)
  },
  embed_search: {
    desc: 'K-nearest neighbor search',
    schema: { vector: 'number[] (required)', k: 'number (default 10)', filter: 'object (optional)', threshold: 'number (optional)', includeVectors: 'boolean (optional)' },
    fn: async (p) => store.search(p.vector, p.k || 10, { filter: p.filter, threshold: p.threshold, includeVectors: p.includeVectors })
  },
  embed_delete: {
    desc: 'Delete a vector by ID',
    schema: { id: 'string (required)' },
    fn: async (p) => ({ deleted: store.delete(p.id) })
  },
  embed_update_metadata: {
    desc: 'Update metadata for an existing vector',
    schema: { id: 'string (required)', metadata: 'object (required)' },
    fn: async (p) => ({ updated: store.updateMetadata(p.id, p.metadata) })
  },
  embed_has: {
    desc: 'Check if a vector exists',
    schema: { id: 'string (required)' },
    fn: async (p) => ({ exists: store.has(p.id) })
  },
  embed_clear: {
    desc: 'Clear all vectors',
    schema: {},
    fn: async () => ({ cleared: store.clear() })
  },
  embed_export: {
    desc: 'Export all vectors',
    schema: {},
    fn: async () => store.export()
  },
  embed_import: {
    desc: 'Import vectors from array',
    schema: { items: 'array of {id, vector, metadata?}' },
    fn: async (p) => store.upsertBatch(p.items)
  },
  embed_build_index: {
    desc: 'Build IVF index for faster search',
    schema: { partitions: 'number (optional)' },
    fn: async (p) => { store.buildIndex(p.partitions || 0); return { built: true, trained: store.ivf?.trained || false }; }
  },
  embed_stats: {
    desc: 'Get store statistics',
    schema: {},
    fn: async () => store.getInfo()
  },
  embed_ids: {
    desc: 'List all vector IDs',
    schema: {},
    fn: async () => store.ids()
  }
};

// JSON-RPC stdio
let buf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleRequest(line);
  }
});

async function handleRequest(raw) {
  let req;
  try { req = JSON.parse(raw); } catch {
    return respond({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  }

  if (req.method === 'initialize') {
    return respond({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-embed', version: '1.0.0' }
      }
    });
  }

  if (req.method === 'notifications/initialized') return;

  if (req.method === 'tools/list') {
    return respond({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.desc,
          inputSchema: {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(t.schema).map(([k, v]) => [k, { description: v }])
            )
          }
        }))
      }
    });
  }

  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params || {};
    const tool = TOOLS[name];
    if (!tool) return respond({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    try {
      const result = await tool.fn(args || {});
      return respond({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    } catch (e) {
      return respond({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: e.message } });
    }
  }

  respond({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Unknown method: ${req.method}` } });
}

function respond(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

console.error('agent-embed MCP server ready');
