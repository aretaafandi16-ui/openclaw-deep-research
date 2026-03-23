#!/usr/bin/env node
/**
 * agent-pipeline CLI
 * 
 * Commands:
 *   run <file.json> [--context '{}']  Run a pipeline from JSON definition
 *   demo                              Run a demo pipeline
 *   create <name>                     Create a new pipeline interactively
 *   mcp                               Start MCP server
 *   validate <file.json>              Validate a pipeline definition
 */

import { readFileSync } from 'node:fs';
import { Pipeline, Status, pipeline } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

function usage() {
  console.log(`
agent-pipeline — Pipeline orchestrator for AI agents

Usage:
  agent-pipeline run <pipeline.json> [--context '{}']   Run pipeline from JSON
  agent-pipeline demo                                    Run demo pipeline
  agent-pipeline create <name>                           Create pipeline
  agent-pipeline mcp                                     Start MCP server
  agent-pipeline validate <file.json>                    Validate pipeline definition
  agent-pipeline help                                    Show this help

Pipeline JSON format:
  {
    "name": "my-pipeline",
    "globalTimeoutMs": 30000,
    "steps": [
      { "name": "fetch", "type": "task", "handler": "async (ctx) => ({ data: 'hello' })" },
      { "name": "wait", "type": "delay", "delayMs": 1000 },
      { "name": "log", "type": "log", "message": "Done!" }
    ]
  }
`);
}

async function runPipeline(file, contextArg) {
  const def = JSON.parse(readFileSync(file, 'utf8'));
  const handlers = {};

  // Parse handler strings from step definitions
  for (const step of def.steps) {
    if (step.type === 'task' && step.handler) {
      handlers[step.name] = new Function('ctx', `return (${step.handler})(ctx)`);
    }
  }

  const p = Pipeline.fromJSON(def, handlers);
  
  // Progress output
  p.on('step', (result) => {
    const icon = result.status === Status.SUCCESS ? '✅' :
                 result.status === Status.FAILED ? '❌' :
                 result.status === Status.SKIPPED ? '⏭️' :
                 result.status === Status.TIMEOUT ? '⏰' :
                 result.status === Status.RETRYING ? '🔄' : '⏳';
    console.log(`  ${icon} ${result.name} [${result.status}] ${result.durationMs}ms`);
    if (result.error) console.log(`     Error: ${result.error.message}`);
  });

  let context = {};
  if (contextArg) {
    const ctxIdx = args.indexOf('--context');
    if (ctxIdx !== -1 && args[ctxIdx + 1]) {
      context = JSON.parse(args[ctxIdx + 1]);
    }
  }

  console.log(`\n🚀 Running pipeline: ${def.name}\n`);
  const result = await p.run(context);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Status: ${result.status === Status.SUCCESS ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(`Steps: ${result.steps.length} total, ${result.steps.filter(s => s.status === Status.SUCCESS).length} passed`);
  if (result.error) console.log(`Error: ${result.error.message}`);
  console.log();

  process.exit(result.status === Status.SUCCESS ? 0 : 1);
}

async function runDemo() {
  console.log('🧪 Running demo pipeline...\n');

  const fetch = pipeline('fetch-and-process')
    .log('start', 'Starting data fetch...')
    .transform('prepare', (ctx) => ({ ...ctx, items: [1, 2, 3, 4, 5] }))
    .add('fetch-data', async (ctx) => {
      // Simulate API call with retry
      await new Promise(r => setTimeout(r, 100));
      return { results: ctx.items.map(i => i * 10) };
    }, {
      retry: { maxAttempts: 3, backoffMs: 500 },
      transform: (output, ctx) => ({ fetched: output.results }),
    })
    .add('validate', async (ctx) => {
      if (!ctx.fetched?.length) throw new Error('No data fetched');
      return { valid: true };
    })
    .condition('check-size',
      (ctx) => ctx.fetched.length > 3,
      // True branch: process in parallel
      pipeline('process-large')
        .parallel('batch-process', [
          { name: 'batch-a', type: 'task', handler: (ctx) => ({ processed: 'batch-a' }), opts: {} },
          { name: 'batch-b', type: 'task', handler: (ctx) => ({ processed: 'batch-b' }), opts: {} },
        ])
        .log('done-large', 'Large dataset processed'),
      // False branch: simple processing
      pipeline('process-small')
        .log('done-small', 'Small dataset processed')
    )
    .set('finalize', { completedAt: new Date().toISOString() })
    .log('end', 'Pipeline complete!');

  fetch.on('step', (result) => {
    const icon = result.status === Status.SUCCESS ? '✅' :
                 result.status === Status.FAILED ? '❌' :
                 result.status === Status.SKIPPED ? '⏭️' : '⏳';
    console.log(`  ${icon} ${result.name} [${result.status}] ${result.durationMs}ms`);
    if (result.error) console.log(`     Error: ${result.error.message}`);
  });

  fetch.on('log', (entry) => {
    console.log(`  📝 ${entry.step}: ${entry.message}`);
  });

  const result = await fetch.run({ userId: 'demo-user' });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Status: ${result.status === Status.SUCCESS ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`Duration: ${result.durationMs}ms`);
  const { _stepResults, ...cleanCtx } = result.context;
  console.log(`Context:`, JSON.stringify(cleanCtx, null, 2));
  console.log();
}

async function validatePipeline(file) {
  try {
    const def = JSON.parse(readFileSync(file, 'utf8'));
    const errors = [];

    if (!def.name) errors.push('Missing "name"');
    if (!def.steps || !Array.isArray(def.steps)) errors.push('Missing or invalid "steps" array');

    for (const [i, step] of (def.steps || []).entries()) {
      if (!step.name) errors.push(`Step ${i}: missing "name"`);
      if (!step.type) errors.push(`Step ${i}: missing "type"`);
      if (step.type === 'task' && !step.handler) errors.push(`Step ${i} (${step.name}): task missing "handler"`);
      if (step.type === 'delay' && !step.delayMs) errors.push(`Step ${i} (${step.name}): delay missing "delayMs"`);
    }

    if (errors.length) {
      console.log(`❌ Validation failed for ${file}:`);
      errors.forEach(e => console.log(`   - ${e}`));
      process.exit(1);
    } else {
      console.log(`✅ ${file} is valid (${def.steps.length} steps, "${def.name}")`);
    }
  } catch (err) {
    console.error(`❌ Failed to read/parse ${file}: ${err.message}`);
    process.exit(1);
  }
}

// ── Main ──
switch (cmd) {
  case 'run':
    if (!args[1]) { usage(); process.exit(1); }
    await runPipeline(args[1], args[2]);
    break;
  case 'demo':
    await runDemo();
    break;
  case 'validate':
    if (!args[1]) { usage(); process.exit(1); }
    await validatePipeline(args[1]);
    break;
  case 'mcp':
    await import('./mcp-server.mjs');
    break;
  case 'help':
  case '--help':
  case '-h':
  default:
    usage();
    break;
}
