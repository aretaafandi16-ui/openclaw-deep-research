#!/usr/bin/env node
/**
 * agent-sync MCP Server — JSON-RPC stdio
 */

import { AgentSync } from './index.mjs';
import { createInterface } from 'readline';

const sync = new AgentSync({
  peerId: process.env.SYNC_PEER_ID || 'mcp-peer',
  namespace: process.env.SYNC_NAMESPACE || 'default',
  persistPath: process.env.SYNC_PERSIST || null
});

const tools = {
  sync_set: (p) => {
    sync.set(p.key, p.value, { type: p.type || 'lww', timestamp: p.timestamp, namespace: p.namespace, increment: p.increment, decrement: p.decrement, mapKey: p.mapKey });
    return { ok: true, key: p.key };
  },
  sync_get: (p) => {
    const val = sync.get(p.key);
    return { key: p.key, value: val, exists: val !== undefined };
  },
  sync_get_entry: (p) => {
    return sync.getEntry(p.key) || { error: 'not found' };
  },
  sync_delete: (p) => {
    return { key: p.key, deleted: sync.delete(p.key) };
  },
  sync_keys: (p) => {
    return { keys: sync.keys(p.namespace) };
  },
  sync_entries: (p) => {
    return { entries: sync.entries(p.namespace) };
  },
  sync_increment: (p) => {
    sync.increment(p.key, p.amount || 1);
    return { key: p.key, value: sync.get(p.key) };
  },
  sync_decrement: (p) => {
    sync.decrement(p.key, p.amount || 1);
    return { key: p.key, value: sync.get(p.key) };
  },
  sync_add_to_set: (p) => {
    sync.addToSet(p.key, p.value);
    return { key: p.key, value: sync.getEntry(p.key).value };
  },
  sync_remove_from_set: (p) => {
    sync.removeFromSet(p.key, p.value);
    return { key: p.key, value: sync.getEntry(p.key)?.value || [] };
  },
  sync_snapshot: () => {
    return sync.createSnapshot();
  },
  sync_load_snapshot: (p) => {
    sync.loadSnapshot(p.snapshot);
    return { ok: true };
  },
  sync_delta: (p) => {
    return sync.getDelta(p.peerId);
  },
  sync_apply_delta: (p) => {
    return sync.applyDelta(p.delta);
  },
  sync_full_sync: (p) => {
    return sync.sync(p.snapshot);
  },
  sync_register_peer: (p) => {
    sync.registerPeer(p.peerId, p.clock);
    return { ok: true };
  },
  sync_unregister_peer: (p) => {
    sync.unregisterPeer(p.peerId);
    return { ok: true };
  },
  sync_peers: () => {
    return { peers: sync.listPeers() };
  },
  sync_conflicts: () => {
    return { conflicts: sync.getConflicts() };
  },
  sync_resolve_conflict: (p) => {
    return { resolved: sync.resolveConflict(p.key, p.resolution) };
  },
  sync_log: (p) => {
    return { log: sync.getLog(p.since, p.limit) };
  },
  sync_stats: () => {
    return sync.stats();
  },
  sync_clear: () => {
    sync.clear();
    return { ok: true };
  },
  sync_save: () => {
    sync.save();
    return { ok: true };
  }
};

const toolDefs = [
  { name: 'sync_set', description: 'Set a key with CRDT type (lww, g-counter, pn-counter, or-set, lww-map)', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: {}, type: { type: 'string', enum: ['lww', 'g-counter', 'pn-counter', 'or-set', 'lww-map'] }, timestamp: { type: 'number' }, namespace: { type: 'string' }, increment: { type: 'number' }, decrement: { type: 'number' }, mapKey: { type: 'string' } }, required: ['key'] } },
  { name: 'sync_get', description: 'Get value by key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'sync_get_entry', description: 'Get full entry with metadata and CRDT state', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'sync_delete', description: 'Delete a key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'sync_keys', description: 'List keys (optional namespace filter)', inputSchema: { type: 'object', properties: { namespace: { type: 'string' } } } },
  { name: 'sync_entries', description: 'Get all entries (optional namespace filter)', inputSchema: { type: 'object', properties: { namespace: { type: 'string' } } } },
  { name: 'sync_increment', description: 'Increment a G-counter', inputSchema: { type: 'object', properties: { key: { type: 'string' }, amount: { type: 'number' } }, required: ['key'] } },
  { name: 'sync_decrement', description: 'Decrement a PN-counter', inputSchema: { type: 'object', properties: { key: { type: 'string' }, amount: { type: 'number' } }, required: ['key'] } },
  { name: 'sync_add_to_set', description: 'Add value to OR-set', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] } },
  { name: 'sync_remove_from_set', description: 'Remove value from OR-set', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] } },
  { name: 'sync_snapshot', description: 'Create a full state snapshot for replication', inputSchema: { type: 'object', properties: {} } },
  { name: 'sync_load_snapshot', description: 'Load/merge a remote snapshot', inputSchema: { type: 'object', properties: { snapshot: { type: 'object' } }, required: ['snapshot'] } },
  { name: 'sync_delta', description: 'Get delta changes since last sync with peer', inputSchema: { type: 'object', properties: { peerId: { type: 'string' } }, required: ['peerId'] } },
  { name: 'sync_apply_delta', description: 'Apply a delta from a peer', inputSchema: { type: 'object', properties: { delta: { type: 'object' } }, required: ['delta'] } },
  { name: 'sync_full_sync', description: 'Full bidirectional sync with remote snapshot', inputSchema: { type: 'object', properties: { snapshot: { type: 'object' } }, required: ['snapshot'] } },
  { name: 'sync_register_peer', description: 'Register a peer for sync tracking', inputSchema: { type: 'object', properties: { peerId: { type: 'string' }, clock: { type: 'object' } }, required: ['peerId'] } },
  { name: 'sync_unregister_peer', description: 'Unregister a peer', inputSchema: { type: 'object', properties: { peerId: { type: 'string' } }, required: ['peerId'] } },
  { name: 'sync_peers', description: 'List registered peers', inputSchema: { type: 'object', properties: {} } },
  { name: 'sync_conflicts', description: 'List unresolved conflicts', inputSchema: { type: 'object', properties: {} } },
  { name: 'sync_resolve_conflict', description: 'Resolve a conflict (keep-local or keep-remote)', inputSchema: { type: 'object', properties: { key: { type: 'string' }, resolution: { type: 'string', enum: ['keep-local', 'keep-remote'] } }, required: ['key', 'resolution'] } },
  { name: 'sync_log', description: 'Get sync log entries', inputSchema: { type: 'object', properties: { since: { type: 'number' }, limit: { type: 'number' } } } },
  { name: 'sync_stats', description: 'Get sync statistics', inputSchema: { type: 'object', properties: {} } },
  { name: 'sync_clear', description: 'Clear all data', inputSchema: { type: 'object', properties: {} } },
  { name: 'sync_save', description: 'Force persist to disk', inputSchema: { type: 'object', properties: {} } }
];

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const respond = (result) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
  };
  const error = (code, message) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }) + '\n');
  };

  try {
    if (msg.method === 'initialize') {
      respond({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-sync', version: '1.0.0' } });
    } else if (msg.method === 'tools/list') {
      respond({ tools: toolDefs });
    } else if (msg.method === 'tools/call') {
      const fn = tools[msg.params?.name];
      if (!fn) { error(-32601, `Unknown tool: ${msg.params?.name}`); return; }
      const result = fn(msg.params?.arguments || {});
      respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }
  } catch (e) {
    error(-32000, e.message);
  }
});
