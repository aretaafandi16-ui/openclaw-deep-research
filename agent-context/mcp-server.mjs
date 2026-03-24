#!/usr/bin/env node
/**
 * agent-context MCP Server
 * 10 tools via JSON-RPC stdio
 */

import { ContextManager, MODEL_PRESETS, estimateTokens, estimateMessageTokens } from './index.mjs';
import { readFileSync } from 'fs';

const managers = new Map();
let defaultManager = new ContextManager();

function getManager(id) {
  if (!id) return defaultManager;
  if (!managers.has(id)) managers.set(id, new ContextManager());
  return managers.get(id);
}

const TOOLS = {
  context_add: {
    description: 'Add a message to the context window',
    inputSchema: {
      type: 'object',
      properties: {
        manager_id: { type: 'string', description: 'Context manager ID (default if omitted)' },
        role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'], description: 'Message role' },
        content: { type: 'string', description: 'Message content' },
        name: { type: 'string', description: 'Optional name field' },
        tool_call_id: { type: 'string', description: 'Tool call ID (for tool messages)' },
        priority: { type: 'number', description: 'Priority (0-100, higher = more important)' },
        persistent: { type: 'boolean', description: 'Never auto-remove (default: false)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering' },
      },
      required: ['role', 'content'],
    },
    handler: (args) => {
      const mgr = getManager(args.manager_id);
      const msg = mgr.add({
        role: args.role,
        content: args.content,
        name: args.name,
        tool_call_id: args.tool_call_id,
        priority: args.priority,
        _persistent: args.persistent,
        _tags: args.tags,
      });
      return { id: msg._id, tokens: msg._tokens, totalTokens: mgr.inputTokens };
    },
  },

  context_get: {
    description: 'Get messages fitted to the context window',
    inputSchema: {
      type: 'object',
      properties: {
        manager_id: { type: 'string' },
        strategy: { type: 'string', enum: ['sliding_window', 'priority', 'summarize', 'hybrid'], description: 'Truncation strategy' },
        max_tokens: { type: 'number', description: 'Override max input tokens' },
      },
    },
    handler: (args) => {
      const mgr = getManager(args.manager_id);
      const msgs = mgr.getMessages({ strategy: args.strategy, maxTokens: args.max_tokens });
      return { messages: msgs, count: msgs.length, tokens: mgr._countTokens(msgs) };
    },
  },

  context_configure: {
    description: 'Configure a context manager (model, max tokens, budgets)',
    inputSchema: {
      type: 'object',
      properties: {
        manager_id: { type: 'string' },
        model: { type: 'string', description: 'Model name for preset' },
        max_tokens: { type: 'number', description: 'Max context tokens' },
        reserve_output: { type: 'number', description: 'Tokens reserved for output' },
        budget_system: { type: 'number', description: 'Max tokens for system messages' },
        budget_tools: { type: 'number', description: 'Max tokens for tool definitions' },
        budget_conversation: { type: 'number', description: 'Max tokens for conversation' },
      },
    },
    handler: (args) => {
      const mgr = getManager(args.manager_id);
      if (args.model) {
        const preset = MODEL_PRESETS[args.model];
        if (!preset) throw new Error(`Unknown model: ${args.model}`);
        mgr.model = args.model;
        mgr.maxTokens = preset.maxTokens;
        mgr.reserveOutput = preset.reserveOutput;
      }
      if (args.max_tokens) mgr.maxTokens = args.max_tokens;
      if (args.reserve_output) mgr.reserveOutput = args.reserve_output;
      if (args.budget_system !== undefined || args.budget_tools !== undefined || args.budget_conversation !== undefined) {
        mgr.setBudgets({
          system: args.budget_system,
          tools: args.budget_tools,
          conversation: args.budget_conversation,
        });
      }
      return { configured: true, model: mgr.model, maxTokens: mgr.maxTokens, reserveOutput: mgr.reserveOutput, budgets: mgr.budgets };
    },
  },

  context_stats: {
    description: 'Get context window statistics',
    inputSchema: {
      type: 'object',
      properties: { manager_id: { type: 'string' } },
    },
    handler: (args) => {
      const mgr = getManager(args.manager_id);
      return mgr.getStats();
    },
  },

  context_compress: {
    description: 'Compress context (dedup, merge, strip whitespace)',
    inputSchema: {
      type: 'object',
      properties: {
        manager_id: { type: 'string' },
        strip_whitespace: { type: 'boolean', default: true },
        deduplicate: { type: 'boolean', default: true },
        merge_consecutive: { type: 'boolean', default: false },
      },
    },
    handler: (args) => {
      const mgr = getManager(args.manager_id);
      return mgr.compress({
        stripWhitespace: args.strip_whitespace,
        deduplicate: args.deduplicate,
        mergeConsecutive: args.merge_consecutive,
      });
    },
  },

  context_budget: {
    description: 'Get or enforce token budgets',
    inputSchema: {
      type: 'object',
      properties: {
        manager_id: { type: 'string' },
        enforce: { type: 'boolean', description: 'Enforce budgets by truncating' },
      },
    },
    handler: (args) => {
      const mgr = getManager(args.manager_id);
      if (args.enforce) return mgr.enforceBudgets();
      return mgr.getBudgetBreakdown();
    },
  },

  context_clear: {
    description: 'Clear context messages',
    inputSchema: {
      type: 'object',
      properties: {
        manager_id: { type: 'string' },
        keep_persistent: { type: 'boolean', default: true },
      },
    },
    handler: (args) => {
      const mgr = getManager(args.manager_id);
      mgr.clear(args.keep_persistent !== false);
      return { cleared: true, remaining: mgr.messages.length };
    },
  },

  context_estimate: {
    description: 'Estimate token count for text',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to estimate' },
        messages: { type: 'array', description: 'Messages to estimate', items: { type: 'object' } },
      },
    },
    handler: (args) => {
      if (args.messages) {
        const tokens = args.messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
        return { tokens, messageCount: args.messages.length };
      }
      return { tokens: estimateTokens(args.text || '') };
    },
  },

  context_export: {
    description: 'Export context as JSON',
    inputSchema: {
      type: 'object',
      properties: { manager_id: { type: 'string' } },
    },
    handler: (args) => getManager(args.manager_id).export(),
  },

  context_models: {
    description: 'List available model presets',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({
      models: Object.entries(MODEL_PRESETS).map(([name, p]) => ({
        name,
        maxTokens: p.maxTokens,
        reserveOutput: p.reserveOutput,
      })),
    }),
  },
};

// ─── JSON-RPC stdio server ──────────────────────────────────────────────────

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    handleRequest(line.trim());
  }
});

function handleRequest(raw) {
  let req;
  try { req = JSON.parse(raw); } catch { return; }
  
  const { id, method, params } = req;
  
  if (method === 'tools/list') {
    respond(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  } else if (method === 'tools/call') {
    const tool = TOOLS[params?.name];
    if (!tool) {
      respond(id, null, { code: -32601, message: `Unknown tool: ${params?.name}` });
    } else {
      try {
        const result = tool.handler(params.arguments || {});
        respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        respond(id, null, { code: -32000, message: err.message });
      }
    }
  } else if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'agent-context', version: '1.0.0' },
    });
  } else if (method === 'notifications/initialized') {
    // no response needed
  } else {
    respond(id, null, { code: -32601, message: `Method not found: ${method}` });
  }
}

function respond(id, result, error) {
  const resp = { jsonrpc: '2.0', id };
  if (error) resp.error = error;
  else resp.result = result;
  process.stdout.write(JSON.stringify(resp) + '\n');
}

process.stderr.write('agent-context MCP server ready\n');
