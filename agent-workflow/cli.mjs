#!/usr/bin/env node
import { Workflow, WorkflowRegistry, uuid } from './index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const cmd = args[0];
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const k = args[i].slice(2);
    flags[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  }
}

const registry = new WorkflowRegistry();

async function main() {
  switch (cmd) {
    case 'run': {
      const file = args.find(a => !a.startsWith('--') && a !== 'run');
      if (!file) { console.error('Usage: agent-workflow run <workflow.json> [--data \'{...}\']'); process.exit(1); }
      const def = JSON.parse(readFileSync(file, 'utf8'));
      const wf = registry.create(def, { persistDir: flags['persist-dir'] });
      wf.on('step:start', e => console.log(`  ⏳ ${e.step} (${e.type})...`));
      wf.on('step:success', e => console.log(`  ✅ ${e.step} done`));
      wf.on('step:fail', e => console.log(`  ❌ ${e.step} failed: ${e.result.error}`));
      wf.on('step:skipped', e => console.log(`  ⏭️  ${e.step} skipped`));
      const data = flags.data ? JSON.parse(flags.data) : {};
      const result = await wf.run(data);
      console.log(`\n${result.status === 'completed' ? '✅' : '❌'} Workflow ${result.status} in ${result.duration}ms`);
      if (result.error) console.error(`Error: ${result.error}`);
      console.log('\nOutputs:', JSON.stringify(result.outputs, null, 2));
      break;
    }
    case 'validate': {
      const file = args.find(a => !a.startsWith('--') && a !== 'validate');
      if (!file) { console.error('Usage: agent-workflow validate <workflow.json>'); process.exit(1); }
      const def = JSON.parse(readFileSync(file, 'utf8'));
      const wf = new Workflow(def);
      console.log(`✅ Valid workflow: "${wf.name}" with ${wf.steps.length} steps`);
      console.log('\nDAG (Mermaid):\n' + wf.toMermaid());
      break;
    }
    case 'dag': {
      const file = args.find(a => !a.startsWith('--') && a !== 'dag');
      if (!file) { console.error('Usage: agent-workflow dag <workflow.json> [--format dot|mermaid]'); process.exit(1); }
      const def = JSON.parse(readFileSync(file, 'utf8'));
      const wf = new Workflow(def);
      const format = flags.format || 'mermaid';
      console.log(format === 'dot' ? wf.toDot() : wf.toMermaid());
      break;
    }
    case 'demo': {
      console.log('🚀 Running demo workflow...\n');
      const wf = registry.create({
        name: 'ETL Pipeline Demo',
        steps: [
          { id: 'extract', name: 'Extract', type: 'task', run: async () => { await sleep(150); return { rows: [{ id: 1, val: 10 }, { id: 2, val: 20 }, { id: 3, val: 30 }] }; } },
          { id: 'validate', name: 'Validate', type: 'task', dependsOn: ['extract'], run: async (ctx) => { const d = ctx.outputs.get('extract'); if (!d?.rows?.length) throw new Error('No data'); return { valid: true, count: d.rows.length }; } },
          { id: 'transform', name: 'Transform', type: 'transform', dependsOn: ['validate'], input: 'extract', transform: async (input) => ({ processed: input.rows.map(r => ({ ...r, val: r.val * 2 })) }) },
          { id: 'enrich', name: 'Enrich', type: 'task', dependsOn: ['transform'], run: async (ctx) => { const d = ctx.outputs.get('transform'); return { enriched: d.result.processed.map(r => ({ ...r, label: `item_${r.id}` })) }; } },
          { id: 'check_size', name: 'Check Size', type: 'condition', dependsOn: ['enrich'], condition: async (ctx) => ctx.outputs.get('enrich')?.result?.enriched?.length >= 3 },
          { id: 'load', name: 'Load', type: 'task', dependsOn: ['check_size'], run: async (ctx) => { await sleep(100); return { loaded: true, count: ctx.outputs.get('enrich')?.result?.enriched?.length }; } },
          { id: 'report', name: 'Report', type: 'log', dependsOn: ['load'], message: (ctx) => `Loaded ${ctx.outputs.get('load')?.result?.count || 0} records` },
        ],
      });

      wf.on('step:start', e => console.log(`  ⏳ ${e.step}...`));
      wf.on('step:success', e => console.log(`  ✅ ${e.step} done`));
      wf.on('step:fail', e => console.log(`  ❌ ${e.step} failed`));
      wf.on('log', e => console.log(`  📝 ${e.message}`);

      const result = await wf.run();
      console.log(`\n${result.status === 'completed' ? '✅' : '❌'} ${result.status} in ${result.duration}ms`);
      console.log('\nStep Results:');
      for (const [k, v] of Object.entries(result.results)) {
        console.log(`  ${k}: ${v.success ? '✅' : '❌'} ${v.success ? '' : v.error}`);
      }
      console.log('\nDAG:\n' + wf.toMermaid());
      break;
    }
    case 'serve': {
      const { default: start } = await import('./server.mjs');
      break;
    }
    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }
    default:
      console.log(`agent-workflow — DAG-based workflow engine for AI agents

Usage:
  agent-workflow run <workflow.json> [--data '{...}'] [--persist-dir ./runs]
  agent-workflow validate <workflow.json>
  agent-workflow dag <workflow.json> [--format dot|mermaid]
  agent-workflow demo
  agent-workflow serve [--port 3112]
  agent-workflow mcp

Step types:
  task       — async function execution
  transform  — data transformation with input mapping
  condition  — conditional branching
  parallel   — parallel sub-tasks
  loop       — iterative execution with condition
  workflow   — nested sub-workflow
  log        — logging/message step
  set        — set context variable
  delay      — timed delay
  assert     — assertion check
  switch     — multi-branch based on value

Features:
  • DAG with topological sort + parallel execution
  • Automatic retry with exponential backoff
  • Step timeouts and fallback handlers
  • Conditional execution (when predicate)
  • Sub-workflow composition
  • Mermaid/DOT visualization
  • JSONL persistence
  • Web dashboard on port 3112
  • MCP server (12 tools)`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e.message); process.exit(1); });
