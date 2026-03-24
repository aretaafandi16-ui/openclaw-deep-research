#!/usr/bin/env node
/**
 * agent-chain MCP Server — 12 tools via JSON-RPC stdio
 */
import { ChainManager, PRESETS } from './index.mjs';

const manager = new ChainManager();
const tools = {
  chain_create: {
    desc: 'Create a reasoning chain',
    params: { name: 'string', strategy: 'string', maxDepth: 'number', confidenceThreshold: 'number' },
    fn: (p) => {
      const preset = PRESETS[p.strategy] || {};
      const c = manager.create({ name: p.name || 'chain', strategy: p.strategy || 'chain-of-thought',
        maxDepth: p.maxDepth || preset.maxDepth, confidenceThreshold: p.confidenceThreshold ?? preset.confidenceThreshold });
      return c.stats();
    }
  },
  chain_add_step: {
    desc: 'Add a reasoning step to a chain',
    params: { chainId: 'string', label: 'string', thought: 'string', result: 'any', confidence: 'number', parentId: 'string', tags: 'array' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      const step = c.addStep({ label: p.label, thought: p.thought, result: p.result,
        confidence: p.confidence, parentId: p.parentId, tags: p.tags });
      manager.save(p.chainId);
      return step.toJSON();
    }
  },
  chain_react: {
    desc: 'Add a ReAct pattern step (thought/action/observation)',
    params: { chainId: 'string', thought: 'string', action: 'string', observation: 'string', confidence: 'number' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      const step = c.reactStep(p);
      manager.save(p.chainId);
      return step.toJSON();
    }
  },
  chain_backtrack: {
    desc: 'Backtrack to a previous step, removing all descendants',
    params: { chainId: 'string', stepId: 'string' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      c.backtrack(p.stepId);
      manager.save(p.chainId);
      return c.stats();
    }
  },
  chain_evaluate: {
    desc: 'Evaluate and score a step',
    params: { chainId: 'string', stepId: 'string', score: 'number', notes: 'string' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      c.evaluate(p.stepId, p.score, p.notes);
      manager.save(p.chainId);
      return c.steps.get(p.stepId).toJSON();
    }
  },
  chain_conclude: {
    desc: 'Set a conclusion for the chain',
    params: { chainId: 'string', text: 'string', confidence: 'number' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      c.conclude(p.text, p.confidence);
      manager.save(p.chainId);
      return { conclusion: c.conclusion, confidence: c.conclusionConfidence };
    }
  },
  chain_search: {
    desc: 'Find best reasoning path through the chain (branch-and-bound)',
    params: { chainId: 'string', maxBranches: 'number', scoreThreshold: 'number', maxDepth: 'number' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      const results = c.branchAndBound({ maxBranches: p.maxBranches, scoreThreshold: p.scoreThreshold, maxDepth: p.maxDepth });
      return results.slice(0, 5);
    }
  },
  chain_get_path: {
    desc: 'Get reasoning path to a specific step',
    params: { chainId: 'string', stepId: 'string' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      return c.getPath(p.stepId);
    }
  },
  chain_get_tree: {
    desc: 'Get full reasoning tree as nested JSON',
    params: { chainId: 'string' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      return c.getTree();
    }
  },
  chain_list: {
    desc: 'List all chains with stats',
    params: {},
    fn: () => manager.list()
  },
  chain_stats: {
    desc: 'Get stats for a chain',
    params: { chainId: 'string' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      return c.stats();
    }
  },
  chain_export: {
    desc: 'Export chain as JSON or Markdown',
    params: { chainId: 'string', format: 'string' },
    fn: (p) => {
      const c = manager.get(p.chainId);
      if (!c) throw new Error('Chain not found');
      return p.format === 'markdown' ? c.toMarkdown() : c.toJSON();
    }
  }
};

// ── JSON-RPC stdio server ──────────────────────────────────────────
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handle(line);
  }
});

function handle(raw) {
  let req;
  try { req = JSON.parse(raw); } catch { return; }
  const { id, method, params } = req;
  const tool = tools[method];
  if (!tool) { respond(id, null, { code: -32601, message: `Unknown tool: ${method}` }); return; }
  try {
    const result = tool.fn(params || {});
    respond(id, result);
  } catch (e) {
    respond(id, null, { code: -32000, message: e.message });
  }
}

function respond(id, result, error) {
  const resp = { jsonrpc: '2.0', id, ...(error ? { error } : { result }) };
  process.stdout.write(JSON.stringify(resp) + '\n');
}

// List tools for MCP discovery
if (process.argv.includes('--list')) {
  console.log(JSON.stringify(Object.entries(tools).map(([name, t]) => ({
    name, description: t.desc, inputSchema: { type: 'object', properties: t.params }
  })), null, 2));
  process.exit(0);
}

process.stdin.resume();
