#!/usr/bin/env node
/**
 * agent-cost MCP Server
 * 
 * Tools:
 *   cost_record     — Record token usage
 *   cost_estimate   — Estimate cost without recording
 *   cost_cheapest   — Find cheapest model for given tokens
 *   cost_stats      — Get usage statistics
 *   cost_budgets    — Get budget status
 *   cost_set_budget — Set budget limits
 *   cost_recent     — Get recent records
 *   cost_models     — List available models
 *   cost_export     — Export records as CSV
 *   cost_clear      — Clear all records
 */

import { CostTracker } from './index.mjs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.agent-cost');
const tracker = new CostTracker({ dataPath: DATA_DIR });

// ─── JSON-RPC 2.0 over stdio ────────────────────────────────────────

const TOOLS = [
  {
    name: 'cost_record',
    description: 'Record AI model token usage and calculate cost',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider name (openai, anthropic, google, mistral, groq, deepseek, xai, cohere)' },
        model: { type: 'string', description: 'Model name (e.g. gpt-4o, claude-sonnet-4-20250514)' },
        inputTokens: { type: 'number', description: 'Number of input tokens' },
        outputTokens: { type: 'number', description: 'Number of output tokens' },
        metadata: { type: 'object', description: 'Optional metadata to attach' },
      },
      required: ['provider', 'model', 'inputTokens', 'outputTokens'],
    },
  },
  {
    name: 'cost_estimate',
    description: 'Estimate cost for a request without recording it',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string' },
        model: { type: 'string' },
        inputTokens: { type: 'number' },
        outputTokens: { type: 'number' },
      },
      required: ['provider', 'model', 'inputTokens', 'outputTokens'],
    },
  },
  {
    name: 'cost_cheapest',
    description: 'Find cheapest model for given token counts',
    inputSchema: {
      type: 'object',
      properties: {
        inputTokens: { type: 'number', description: 'Estimated input tokens' },
        outputTokens: { type: 'number', description: 'Estimated output tokens' },
        provider: { type: 'string', description: 'Filter to specific provider' },
        maxCost: { type: 'number', description: 'Maximum cost filter (USD)' },
      },
      required: ['inputTokens', 'outputTokens'],
    },
  },
  {
    name: 'cost_stats',
    description: 'Get usage statistics for a time period',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month'], description: 'Time period (omit for all-time)' },
      },
    },
  },
  {
    name: 'cost_budgets',
    description: 'Get current budget configuration and status',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cost_set_budget',
    description: 'Set budget limits',
    inputSchema: {
      type: 'object',
      properties: {
        daily: { type: 'number', description: 'Daily budget in USD' },
        weekly: { type: 'number', description: 'Weekly budget in USD' },
        monthly: { type: 'number', description: 'Monthly budget in USD' },
        perRequest: { type: 'number', description: 'Per-request max in USD' },
        hardLimit: { type: 'boolean', description: 'Throw error on exceed (true) or just warn (false)' },
      },
    },
  },
  {
    name: 'cost_recent',
    description: 'Get recent usage records',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of records (default 20)' },
      },
    },
  },
  {
    name: 'cost_models',
    description: 'List available models per provider with pricing',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Filter to specific provider' },
      },
    },
  },
  {
    name: 'cost_export',
    description: 'Export all records as CSV',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cost_clear',
    description: 'Clear all usage records',
    inputSchema: { type: 'object', properties: {} },
  },
];

function handleTool(name, args) {
  switch (name) {
    case 'cost_record': {
      const r = tracker.record(args.provider, args.model, args.inputTokens, args.outputTokens, args.metadata);
      return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
    }
    case 'cost_estimate': {
      const e = tracker.estimate(args.provider, args.model, args.inputTokens, args.outputTokens);
      return { content: [{ type: 'text', text: JSON.stringify(e, null, 2) }] };
    }
    case 'cost_cheapest': {
      const results = tracker.findCheapest(args.inputTokens, args.outputTokens, { provider: args.provider, maxCost: args.maxCost });
      return { content: [{ type: 'text', text: JSON.stringify(results.slice(0, 10), null, 2) }] };
    }
    case 'cost_stats': {
      const s = tracker.stats(args.period);
      return { content: [{ type: 'text', text: JSON.stringify(s, null, 2) }] };
    }
    case 'cost_budgets': {
      return { content: [{ type: 'text', text: JSON.stringify({ config: tracker.getBudget(), status: tracker.budgetStatus() }, null, 2) }] };
    }
    case 'cost_set_budget': {
      tracker.setBudget(args);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, budget: tracker.getBudget() }, null, 2) }] };
    }
    case 'cost_recent': {
      return { content: [{ type: 'text', text: JSON.stringify(tracker.recent(args.limit || 20), null, 2) }] };
    }
    case 'cost_models': {
      return { content: [{ type: 'text', text: JSON.stringify(tracker.listModels(args.provider), null, 2) }] };
    }
    case 'cost_export': {
      return { content: [{ type: 'text', text: tracker.toCSV() }] };
    }
    case 'cost_clear': {
      tracker.clear();
      return { content: [{ type: 'text', text: '{"ok":true,"cleared":true}' }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Stdin/Stdout JSON-RPC ──────────────────────────────────────────

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;

    let req;
    try { req = JSON.parse(line); } catch { continue; }

    const respond = (result) => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
    };
    const respondError = (msg) => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -1, message: msg } }) + '\n');
    };

    try {
      if (req.method === 'initialize') {
        respond({
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'agent-cost', version: '1.0.0' },
          capabilities: { tools: {} },
        });
      } else if (req.method === 'tools/list') {
        respond({ tools: TOOLS });
      } else if (req.method === 'tools/call') {
        respond(handleTool(req.params.name, req.params.arguments || {}));
      } else if (req.method === 'notifications/initialized') {
        // no-op
      } else {
        respondError(`Unknown method: ${req.method}`);
      }
    } catch (e) {
      respondError(e.message);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
console.error('agent-cost MCP server running on stdio');
