/**
 * agent-secrets MCP Server
 * 12 tools via JSON-RPC stdio
 */

import AgentSecrets from './index.mjs';
import { createInterface } from 'node:readline';

const secrets = new AgentSecrets({
  password: process.env.SECRETS_MASTER_PASSWORD || 'agent-secrets-default',
  persistPath: process.env.SECRETS_PERSIST_PATH || './secrets.enc',
  autoSaveMs: 30000,
});

await secrets.load();

const TOOLS = [
  { name: 'secrets_set', description: 'Store a secret', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, namespace: { type: 'string', default: 'default' }, ttl: { type: 'number', description: 'TTL in seconds' }, tags: { type: 'array', items: { type: 'string' } }, rotationInterval: { type: 'number', description: 'Rotation interval in seconds' } }, required: ['key', 'value'] } },
  { name: 'secrets_get', description: 'Retrieve a secret by key or ID', inputSchema: { type: 'object', properties: { keyOrId: { type: 'string' }, namespace: { type: 'string', default: 'default' } }, required: ['keyOrId'] } },
  { name: 'secrets_delete', description: 'Delete a secret', inputSchema: { type: 'object', properties: { keyOrId: { type: 'string' }, namespace: { type: 'string', default: 'default' } }, required: ['keyOrId'] } },
  { name: 'secrets_has', description: 'Check if secret exists', inputSchema: { type: 'object', properties: { keyOrId: { type: 'string' }, namespace: { type: 'string', default: 'default' } }, required: ['keyOrId'] } },
  { name: 'secrets_list', description: 'List secrets', inputSchema: { type: 'object', properties: { namespace: { type: 'string' }, tag: { type: 'string' } } } },
  { name: 'secrets_search', description: 'Search secrets by query', inputSchema: { type: 'object', properties: { query: { type: 'string' }, namespace: { type: 'string' } }, required: ['query'] } },
  { name: 'secrets_rotate', description: 'Rotate a secret value', inputSchema: { type: 'object', properties: { keyOrId: { type: 'string' }, newValue: { type: 'string' }, namespace: { type: 'string', default: 'default' } }, required: ['keyOrId', 'newValue'] } },
  { name: 'secrets_needs_rotation', description: 'List secrets needing rotation', inputSchema: { type: 'object', properties: { namespace: { type: 'string' } } } },
  { name: 'secrets_to_env', description: 'Export secrets as env vars', inputSchema: { type: 'object', properties: { namespace: { type: 'string' }, prefix: { type: 'string', default: '' } } } },
  { name: 'secrets_stats', description: 'Get secrets stats', inputSchema: { type: 'object', properties: {} } },
  { name: 'secrets_audit', description: 'Get audit log', inputSchema: { type: 'object', properties: { namespace: { type: 'string' }, action: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'secrets_export', description: 'Export encrypted secrets', inputSchema: { type: 'object', properties: { namespace: { type: 'string' } } } },
];

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function error(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
}

const handlers = {
  secrets_set: (p) => secrets.set(p.key, p.value, { namespace: p.namespace, ttl: p.ttl, tags: p.tags, rotationInterval: p.rotationInterval }),
  secrets_get: (p) => secrets.get(p.keyOrId, { namespace: p.namespace }),
  secrets_delete: (p) => secrets.delete(p.keyOrId, { namespace: p.namespace }),
  secrets_has: (p) => secrets.has(p.keyOrId, { namespace: p.namespace }),
  secrets_list: (p) => secrets.list(p),
  secrets_search: (p) => secrets.search(p.query, p),
  secrets_rotate: (p) => secrets.rotate(p.keyOrId, p.newValue, { namespace: p.namespace }),
  secrets_needs_rotation: (p) => secrets.needsRotation(p),
  secrets_to_env: (p) => secrets.toEnv(p.namespace, p.prefix),
  secrets_stats: () => secrets.stats(),
  secrets_audit: (p) => secrets.getAuditLog(p),
  secrets_export: (p) => secrets.exportEncrypted(p.namespace),
};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-secrets', version: '1.0.0' } });
  } else if (msg.method === 'tools/list') {
    respond(msg.id, { tools: TOOLS });
  } else if (msg.method === 'tools/call') {
    try {
      const handler = handlers[msg.params?.name];
      if (!handler) return error(msg.id, `Unknown tool: ${msg.params?.name}`);
      const result = await handler(msg.params?.arguments || {});
      respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      error(msg.id, err.message);
    }
  } else if (msg.method === 'notifications/initialized') {
    // no-op
  }
});
