#!/usr/bin/env node
/**
 * agent-lock MCP Server — 10 tools via JSON-RPC stdio
 */

import { AgentLock } from './index.mjs';

const lock = new AgentLock({ persistDir: process.env.PERSIST_DIR || './data' });

let id = 0;
function respond(result, error = null) {
  const msg = { jsonrpc: '2.0', id: ++id, result: error ? undefined : result, error: error ? { code: -32000, message: error } : undefined };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const TOOLS = [
  { name: 'lock_acquire', description: 'Acquire an exclusive mutex lock', inputSchema: { type: 'object', properties: { name: { type: 'string' }, holder: { type: 'string', default: 'default' }, timeout: { type: 'number', default: 0 } }, required: ['name'] } },
  { name: 'lock_release', description: 'Release an exclusive mutex lock', inputSchema: { type: 'object', properties: { name: { type: 'string' }, holder: { type: 'string', default: 'default' } }, required: ['name'] } },
  { name: 'lock_force_release', description: 'Force-release a mutex (emergency)', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'rwlock_read_lock', description: 'Acquire a read lock', inputSchema: { type: 'object', properties: { name: { type: 'string' }, holder: { type: 'string', default: 'default' }, timeout: { type: 'number', default: 0 } }, required: ['name'] } },
  { name: 'rwlock_write_lock', description: 'Acquire a write lock', inputSchema: { type: 'object', properties: { name: { type: 'string' }, holder: { type: 'string', default: 'default' }, timeout: { type: 'number', default: 0 } }, required: ['name'] } },
  { name: 'rwlock_read_unlock', description: 'Release a read lock', inputSchema: { type: 'object', properties: { name: { type: 'string' }, holder: { type: 'string', default: 'default' } }, required: ['name'] } },
  { name: 'rwlock_write_unlock', description: 'Release a write lock', inputSchema: { type: 'object', properties: { name: { type: 'string' }, holder: { type: 'string', default: 'default' } }, required: ['name'] } },
  { name: 'semaphore_acquire', description: 'Acquire semaphore permits', inputSchema: { type: 'object', properties: { name: { type: 'string' }, holder: { type: 'string', default: 'default' }, count: { type: 'number', default: 1 }, timeout: { type: 'number', default: 0 }, maxPermits: { type: 'number', default: 1 } }, required: ['name'] } },
  { name: 'semaphore_release', description: 'Release semaphore permits', inputSchema: { type: 'object', properties: { name: { type: 'string' }, holder: { type: 'string', default: 'default' }, count: { type: 'number', default: 1 } }, required: ['name'] } },
  { name: 'lock_status', description: 'Get lock stats, lists, and deadlock detection', inputSchema: { type: 'object', properties: {} } },
];

async function handleTool(name, args) {
  switch (name) {
    case 'lock_acquire': await lock.lock(args.name, args.holder || 'default', args.timeout || 0); return { ok: true, name: args.name };
    case 'lock_release': return { ok: lock.unlock(args.name, args.holder || 'default') };
    case 'lock_force_release': return { ok: true, previousOwner: lock.forceUnlock(args.name) };
    case 'rwlock_read_lock': await lock.readLock(args.name, args.holder || 'default', args.timeout || 0); return { ok: true };
    case 'rwlock_write_lock': await lock.writeLock(args.name, args.holder || 'default', args.timeout || 0); return { ok: true };
    case 'rwlock_read_unlock': return { ok: lock.readUnlock(args.name, args.holder || 'default') };
    case 'rwlock_write_unlock': return { ok: lock.writeUnlock(args.name, args.holder || 'default') };
    case 'semaphore_acquire': lock.semaphore(args.name, args.maxPermits || 1); await lock.acquirePermit(args.name, args.holder || 'default', args.count || 1, args.timeout || 0); return { ok: true };
    case 'semaphore_release': return { ok: lock.releasePermit(args.name, args.holder || 'default', args.count || 1) };
    case 'lock_status': return { stats: lock.stats, locks: lock.listLocks(), barriers: lock.listBarriers(), elections: lock.listElections(), deadlocks: lock.detectDeadlocks() };
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC stdio loop
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      respond({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-lock', version: '1.0.0' } });
    } else if (msg.method === 'tools/list') {
      respond({ tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      handleTool(msg.params.name, msg.params.arguments || {})
        .then(result => respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }))
        .catch(err => respond(null, err.message));
    } else if (msg.method === 'notifications/initialized') {
      // skip
    } else {
      respond(null, `Unknown method: ${msg.method}`);
    }
  }
});

process.stdin.resume();
console.error('agent-lock MCP server ready');
