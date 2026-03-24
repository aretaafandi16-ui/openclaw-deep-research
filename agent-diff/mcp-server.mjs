#!/usr/bin/env node
// agent-diff MCP Server — 10 tools via JSON-RPC stdio
import { AgentDiff } from './index.mjs';
import { readFileSync } from 'node:fs';

const diff = new AgentDiff();

const tools = {
  diff_diff: {
    desc: 'Deep diff two JSON objects',
    params: { old: 'object (required)', new: 'object (required)' },
    run: ({ old, new: nu }) => diff.diff(old, nu)
  },
  diff_patch: {
    desc: 'Generate JSON patch (RFC 6902) between two objects',
    params: { old: 'object (required)', new: 'object (required)' },
    run: ({ old, new: nu }) => diff.patch(old, nu)
  },
  diff_apply_patch: {
    desc: 'Apply JSON patches to a document',
    params: { doc: 'object (required)', patches: 'array (required)' },
    run: ({ doc, patches }) => diff.applyPatch(doc, patches)
  },
  diff_merge: {
    desc: 'Deep merge two objects with strategy',
    params: { base: 'object (required)', override: 'object (required)', strategy: 'string (override|base|shallow|concat|deep|array_union)' },
    run: ({ base, override, strategy }) => diff.merge(base, override, strategy || 'override')
  },
  diff_three_way: {
    desc: 'Three-way merge with conflict detection',
    params: { base: 'object (required)', ours: 'object (required)', theirs: 'object (required)', strategy: 'string (override|ours|theirs|manual)' },
    run: ({ base, ours, theirs, strategy }) => diff.threeWay(base, ours, theirs, strategy || 'override')
  },
  diff_text_diff: {
    desc: 'Line-level text diff',
    params: { old: 'string (required)', new: 'string (required)' },
    run: ({ old, new: nu }) => diff.textDiff(old, nu)
  },
  diff_unified: {
    desc: 'Generate unified diff format',
    params: { filename: 'string', old: 'string (required)', new: 'string (required)' },
    run: ({ filename, old, new: nu }) => diff.unifiedDiff(filename || 'file', old, nu)
  },
  diff_stats: {
    desc: 'Get diff statistics between two objects',
    params: { old: 'object (required)', new: 'object (required)' },
    run: ({ old, new: nu }) => diff.stats(old, nu)
  },
  diff_is_equal: {
    desc: 'Check deep equality of two objects',
    params: { a: 'any (required)', b: 'any (required)' },
    run: ({ a, b }) => ({ equal: diff.isEqual(a, b) })
  },
  diff_changed_keys: {
    desc: 'Get list of changed keys between two objects',
    params: { old: 'object (required)', new: 'object (required)' },
    run: ({ old, new: nu }) => ({ keys: diff.changedKeys(old, nu) })
  }
};

// JSON-RPC stdio
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleRequest(line);
  }
});

async function handleRequest(line) {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;

  if (method === 'initialize') {
    return respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-diff', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'ping') return respond(id, {});
  if (method === 'tools/list') {
    return respond(id, {
      tools: Object.entries(tools).map(([name, t]) => ({
        name,
        description: t.desc,
        inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, { description: v }])) }
      }))
    });
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    const tool = tools[name];
    if (!tool) return respond(id, { error: { code: -32601, message: `Unknown tool: ${name}` } });
    try {
      const result = await tool.run(args || {});
      return respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return respond(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
  respond(id, { error: { code: -32601, message: `Unknown method: ${method}` } });
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
