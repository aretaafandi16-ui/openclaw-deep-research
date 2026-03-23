#!/usr/bin/env node
/**
 * agent-cost CLI
 * 
 * Usage:
 *   node cli.mjs record <provider> <model> <input> <output> [--metadata JSON]
 *   node cli.mjs estimate <provider> <model> <input> <output>
 *   node cli.mjs cheapest <input> <output> [--provider P] [--max-cost N]
 *   node cli.mjs stats [--period day|week|month]
 *   node cli.mjs budgets
 *   node cli.mjs budget [--daily N] [--weekly N] [--monthly N] [--hard]
 *   node cli.mjs recent [--limit N]
 *   node cli.mjs models [--provider P]
 *   node cli.mjs export
 *   node cli.mjs clear
 *   node cli.mjs serve [--port N]
 *   node cli.mjs mcp
 *   node cli.mjs demo
 */

import { CostTracker } from './index.mjs';
import { join } from 'path';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.agent-cost');

function flag(name) {
  const idx = args.indexOf('--' + name);
  return idx >= 0 ? args[idx + 1] : null;
}

function hasFlag(name) {
  return args.includes('--' + name);
}

const tracker = new CostTracker({ dataPath: DATA_DIR });

function fmt(n) { return '$' + (n || 0).toFixed(6); }
function fmtD(n) { return '$' + (n || 0).toFixed(2); }

try {
  switch (cmd) {
    case 'record': {
      const [, provider, model, inputStr, outputStr] = args;
      if (!provider || !model || !inputStr || !outputStr) {
        console.error('Usage: cost record <provider> <model> <inputTokens> <outputTokens>');
        process.exit(1);
      }
      let metadata;
      const metaIdx = args.indexOf('--metadata');
      if (metaIdx >= 0) metadata = JSON.parse(args[metaIdx + 1]);
      const r = tracker.record(provider, model, parseInt(inputStr), parseInt(outputStr), metadata);
      console.log(`✅ Recorded: ${r.provider}/${r.model} — ${r.inputTokens}+${r.outputTokens} tokens = ${fmt(r.totalCost)}`);
      break;
    }

    case 'estimate': {
      const [, provider, model, inputStr, outputStr] = args;
      if (!provider || !model || !inputStr || !outputStr) {
        console.error('Usage: cost estimate <provider> <model> <inputTokens> <outputTokens>');
        process.exit(1);
      }
      const e = tracker.estimate(provider, model, parseInt(inputStr), parseInt(outputStr));
      console.log(`Estimate: ${e.provider}/${e.model}`);
      console.log(`  Input:  ${e.inputTokens.toLocaleString()} tokens = ${fmt(e.inputCost)}`);
      console.log(`  Output: ${e.outputTokens.toLocaleString()} tokens = ${fmt(e.outputCost)}`);
      console.log(`  Total:  ${fmt(e.totalCost)}`);
      break;
    }

    case 'cheapest': {
      const inputTokens = parseInt(args[1] || '1000');
      const outputTokens = parseInt(args[2] || '500');
      const provider = flag('provider');
      const maxCost = flag('max-cost') ? parseFloat(flag('max-cost')) : undefined;
      const results = tracker.findCheapest(inputTokens, outputTokens, { provider, maxCost }).slice(0, 10);
      console.log(`Cheapest for ${inputTokens}+${outputTokens} tokens:\n`);
      for (const r of results) {
        console.log(`  ${r.provider}/${r.model} — ${fmt(r.totalCost)}`);
      }
      break;
    }

    case 'stats': {
      const period = flag('period') || undefined;
      const s = tracker.stats(period);
      console.log(`📊 Usage Stats${period ? ` (${period})` : ' (all-time)'}\n`);
      console.log(`  Requests:    ${s.totalRequests.toLocaleString()}`);
      console.log(`  Input tokens: ${s.totalInputTokens.toLocaleString()}`);
      console.log(`  Output tokens: ${s.totalOutputTokens.toLocaleString()}`);
      console.log(`  Total cost:  ${fmtD(s.totalCost)}`);
      console.log(`  Avg/request: ${fmt(s.avgCostPerRequest)}`);
      if (Object.keys(s.byProvider).length) {
        console.log('\n  By Provider:');
        for (const [p, v] of Object.entries(s.byProvider)) {
          console.log(`    ${p}: ${v.requests} reqs, ${fmtD(v.cost)}`);
        }
      }
      if (Object.keys(s.byModel).length) {
        console.log('\n  By Model:');
        for (const [m, v] of Object.entries(s.byModel)) {
          console.log(`    ${m}: ${v.requests} reqs, ${fmtD(v.cost)}`);
        }
      }
      break;
    }

    case 'budgets': {
      const config = tracker.getBudget();
      const statuses = tracker.budgetStatus();
      console.log('📊 Budget Status\n');
      if (statuses.length === 0) {
        console.log('  No budgets configured. Use: cost budget --daily 10 --monthly 100');
        break;
      }
      for (const s of statuses) {
        const icon = s.exceeded ? '🔴' : s.percentUsed > 75 ? '🟡' : '🟢';
        console.log(`  ${icon} ${s.period}: ${fmtD(s.spent)} / ${fmtD(s.limit)} (${s.percentUsed}%) — projected: ${fmtD(s.projectedEnd)}`);
      }
      if (config.hardLimit) console.log('\n  ⚠️  Hard limit enabled — requests will be rejected when exceeded');
      break;
    }

    case 'budget': {
      const budget = {};
      if (flag('daily')) budget.daily = parseFloat(flag('daily'));
      if (flag('weekly')) budget.weekly = parseFloat(flag('weekly'));
      if (flag('monthly')) budget.monthly = parseFloat(flag('monthly'));
      if (flag('per-request')) budget.perRequest = parseFloat(flag('per-request'));
      if (hasFlag('hard')) budget.hardLimit = true;
      if (hasFlag('soft')) budget.hardLimit = false;
      tracker.setBudget(budget);
      console.log('✅ Budget updated:', JSON.stringify(tracker.getBudget(), null, 2));
      break;
    }

    case 'recent': {
      const limit = parseInt(flag('limit') || '20');
      const records = tracker.recent(limit);
      if (!records.length) { console.log('No records yet.'); break; }
      console.log(`📝 Last ${records.length} records:\n`);
      for (const r of records) {
        const ago = ((Date.now() - r.timestamp) / 60000).toFixed(0);
        console.log(`  ${ago}m ago | ${r.provider}/${r.model} | ${r.inputTokens}+${r.outputTokens} tok | ${fmt(r.totalCost)}`);
      }
      break;
    }

    case 'models': {
      const provider = flag('provider');
      const models = tracker.listModels(provider);
      console.log('📋 Available Models:\n');
      for (const [p, ms] of Object.entries(models)) {
        console.log(`  ${p}:`);
        for (const m of ms) console.log(`    - ${m}`);
      }
      break;
    }

    case 'export': {
      console.log(tracker.toCSV());
      break;
    }

    case 'clear': {
      tracker.clear();
      console.log('✅ All records cleared.');
      break;
    }

    case 'serve': {
      const port = flag('port') || '3100';
      process.env.PORT = port;
      await import('./server.mjs');
      break;
    }

    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }

    case 'demo': {
      console.log('🎬 Running demo...\n');
      
      // Record some usage
      tracker.record('openai', 'gpt-4o', 1500, 800);
      tracker.record('anthropic', 'claude-sonnet-4-20250514', 2000, 1200);
      tracker.record('google', 'gemini-2.0-flash', 5000, 3000);
      tracker.record('openai', 'gpt-4o-mini', 10000, 5000);
      tracker.record('deepseek', 'deepseek-chat', 8000, 4000);
      tracker.record('groq', 'llama-3.1-8b-instant', 15000, 8000);

      console.log('📊 Stats:');
      const s = tracker.stats();
      console.log(`  Total: ${s.totalRequests} requests, ${fmtD(s.totalCost)}\n`);

      console.log('💰 Cheapest for 1K+500 tokens:');
      for (const c of tracker.findCheapest(1000, 500).slice(0, 5)) {
        console.log(`  ${c.provider}/${c.model} — ${fmt(c.totalCost)}`);
      }

      console.log('\n📝 Recent:');
      for (const r of tracker.recent(3)) {
        console.log(`  ${r.provider}/${r.model} — ${fmt(r.totalCost)}`);
      }

      tracker.clear();
      console.log('\n✅ Demo complete, records cleared.');
      break;
    }

    case 'help':
    default: {
      console.log(`
💰 agent-cost CLI — AI Cost Tracker

Commands:
  record <provider> <model> <input> <output>  Record usage
  estimate <provider> <model> <in> <out>      Estimate cost
  cheapest <input> <output>                   Find cheapest model
  stats [--period day|week|month]             Usage statistics
  budgets                                     Budget status
  budget [--daily N] [--weekly N] [--monthly N] [--hard]  Set budgets
  recent [--limit N]                          Recent records
  models [--provider P]                       List models
  export                                      Export CSV
  clear                                       Clear records
  serve [--port N]                            Start HTTP server
  mcp                                         Start MCP server
  demo                                        Run demo

Options:
  --provider P    Filter to provider
  --max-cost N    Max cost filter
  --limit N       Record limit
  --period P      Time period
  --port N        Server port
  --hard          Enable hard budget limits
  --metadata JSON Metadata for record

Providers: openai, anthropic, google, mistral, groq, deepseek, xai, cohere
      `);
    }
  }
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
