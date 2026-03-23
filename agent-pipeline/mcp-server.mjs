/**
 * agent-pipeline MCP Server
 * 
 * Exposes pipeline orchestration via Model Context Protocol.
 * Tools: create, run, add_step, serialize, compose, list, status
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline, Status } from './index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = join(__dirname, '.pipelines');
if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });

// In-memory pipeline registry
const pipelines = new Map();
const runHistory = new Map();

// Load persisted pipelines
function loadPipelines() {
  try {
    const files = require('node:fs').readdirSync(STORE_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const def = JSON.parse(readFileSync(join(STORE_DIR, file), 'utf8'));
      const p = new Pipeline(def.name, { globalTimeoutMs: def.globalTimeoutMs });
      for (const step of (def.steps || [])) {
        // Rehydrate with stub handlers — real handlers must be registered via MCP
        p.add(step.name, (ctx) => ctx, { ...step.opts, type: step.type });
      }
      pipelines.set(def.name, { pipeline: p, definition: def });
    }
  } catch {}
}

function savePipeline(name, def) {
  writeFileSync(join(STORE_DIR, `${name}.json`), JSON.stringify(def, null, 2));
}

// ── MCP Protocol Implementation ──
const TOOLS = [
  {
    name: 'pipeline_create',
    description: 'Create a new pipeline with a name and optional global timeout',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Pipeline name' },
        globalTimeoutMs: { type: 'number', description: 'Global timeout in ms (0 = none)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'pipeline_add_task',
    description: 'Add a task step to a pipeline. The handler is a JS function string or predefined name.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline: { type: 'string', description: 'Pipeline name' },
        stepName: { type: 'string', description: 'Step name' },
        handler: { type: 'string', description: 'Handler function (JS string) or handler name' },
        timeoutMs: { type: 'number', description: 'Step timeout in ms' },
        retryMax: { type: 'number', description: 'Max retry attempts' },
        retryBackoffMs: { type: 'number', description: 'Initial backoff in ms' },
        skipIf: { type: 'string', description: 'Skip condition (JS expression on ctx)' },
      },
      required: ['pipeline', 'stepName', 'handler'],
    },
  },
  {
    name: 'pipeline_add_parallel',
    description: 'Add a parallel step that runs sub-steps concurrently',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline: { type: 'string' },
        stepName: { type: 'string' },
        subSteps: { type: 'array', items: { type: 'string' }, description: 'Names of steps to run in parallel' },
        allowPartialFailure: { type: 'boolean' },
      },
      required: ['pipeline', 'stepName', 'subSteps'],
    },
  },
  {
    name: 'pipeline_add_delay',
    description: 'Add a delay/wait step',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline: { type: 'string' },
        stepName: { type: 'string' },
        delayMs: { type: 'number' },
      },
      required: ['pipeline', 'stepName', 'delayMs'],
    },
  },
  {
    name: 'pipeline_add_set',
    description: 'Add a step that sets context values',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline: { type: 'string' },
        stepName: { type: 'string' },
        values: { type: 'object', description: 'Key-value pairs to set in context' },
      },
      required: ['pipeline', 'stepName', 'values'],
    },
  },
  {
    name: 'pipeline_run',
    description: 'Run a pipeline with optional initial context',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline: { type: 'string', description: 'Pipeline name' },
        context: { type: 'object', description: 'Initial context' },
        dryRun: { type: 'boolean', description: 'Dry-run mode' },
      },
      required: ['pipeline'],
    },
  },
  {
    name: 'pipeline_serialize',
    description: 'Get the JSON definition of a pipeline',
    inputSchema: {
      type: 'object',
      properties: { pipeline: { type: 'string' } },
      required: ['pipeline'],
    },
  },
  {
    name: 'pipeline_compose',
    description: 'Compose multiple pipelines into one',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        pipelines: { type: 'array', items: { type: 'string' }, description: 'Pipeline names to compose' },
      },
      required: ['name', 'pipelines'],
    },
  },
  {
    name: 'pipeline_list',
    description: 'List all registered pipelines',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'pipeline_runs',
    description: 'Get run history for a pipeline',
    inputSchema: {
      type: 'object',
      properties: { pipeline: { type: 'string' } },
      required: ['pipeline'],
    },
  },
];

// ── Tool handlers ──
function handleTool(name, args) {
  switch (name) {
    case 'pipeline_create': {
      const p = new Pipeline(args.name, { globalTimeoutMs: args.globalTimeoutMs || 0 });
      const def = { name: args.name, steps: [], globalTimeoutMs: args.globalTimeoutMs || 0 };
      pipelines.set(args.name, { pipeline: p, definition: def });
      savePipeline(args.name, def);
      return { ok: true, pipeline: args.name };
    }

    case 'pipeline_add_task': {
      const entry = pipelines.get(args.pipeline);
      if (!entry) throw new Error(`Pipeline "${args.pipeline}" not found`);
      const handler = new Function('ctx', `return (${args.handler})(ctx)`);
      const opts = { timeoutMs: args.timeoutMs || 0 };
      if (args.retryMax) {
        opts.retry = { maxAttempts: args.retryMax, backoffMs: args.retryBackoffMs || 1000 };
      }
      if (args.skipIf) {
        opts.skipIf = new Function('ctx', `return (${args.skipIf})`);
      }
      entry.pipeline.add(args.stepName, handler, opts);
      entry.definition.steps.push({ name: args.stepName, type: 'task', opts });
      savePipeline(args.pipeline, entry.definition);
      return { ok: true, step: args.stepName };
    }

    case 'pipeline_add_parallel': {
      const entry = pipelines.get(args.pipeline);
      if (!entry) throw new Error(`Pipeline "${args.pipeline}" not found`);
      // Build sub-steps from existing step definitions
      const subSteps = args.subSteps.map(name => {
        const stepDef = entry.definition.steps.find(s => s.name === name);
        if (!stepDef) throw new Error(`Step "${name}" not found in pipeline`);
        return { name, type: stepDef.type, handler: (ctx) => ctx, opts: stepDef.opts || {} };
      });
      entry.pipeline.parallel(args.stepName, subSteps, { allowPartialFailure: args.allowPartialFailure });
      entry.definition.steps.push({ name: args.stepName, type: 'parallel', subSteps: args.subSteps });
      savePipeline(args.pipeline, entry.definition);
      return { ok: true, step: args.stepName };
    }

    case 'pipeline_add_delay': {
      const entry = pipelines.get(args.pipeline);
      if (!entry) throw new Error(`Pipeline "${args.pipeline}" not found`);
      entry.pipeline.delay(args.stepName, args.delayMs);
      entry.definition.steps.push({ name: args.stepName, type: 'delay', delayMs: args.delayMs });
      savePipeline(args.pipeline, entry.definition);
      return { ok: true, step: args.stepName };
    }

    case 'pipeline_add_set': {
      const entry = pipelines.get(args.pipeline);
      if (!entry) throw new Error(`Pipeline "${args.pipeline}" not found`);
      entry.pipeline.set(args.stepName, args.values);
      entry.definition.steps.push({ name: args.stepName, type: 'set', values: args.values });
      savePipeline(args.pipeline, entry.definition);
      return { ok: true, step: args.stepName };
    }

    case 'pipeline_run': {
      const entry = pipelines.get(args.pipeline);
      if (!entry) throw new Error(`Pipeline "${args.pipeline}" not found`);
      if (args.dryRun) entry.pipeline.dryRun = true;
      // Run async but MCP needs sync response — we'll use a trick
      const resultPromise = entry.pipeline.run(args.context || {});
      // Store promise for polling
      const runId = `${args.pipeline}_${Date.now()}`;
      const history = runHistory.get(args.pipeline) || [];
      runHistory.set(args.pipeline, history);
      
      // For MCP, we wait synchronously-ish (this is a blocking call)
      return resultPromise.then(result => {
        history.push(result);
        if (history.length > 50) history.shift();
        return {
          runId,
          status: result.status,
          durationMs: result.durationMs,
          steps: result.steps.map(s => ({
            name: s.name,
            status: s.status,
            durationMs: s.durationMs,
            error: s.error,
          })),
          error: result.error,
        };
      });
    }

    case 'pipeline_serialize': {
      const entry = pipelines.get(args.pipeline);
      if (!entry) throw new Error(`Pipeline "${args.pipeline}" not found`);
      return entry.definition;
    }

    case 'pipeline_compose': {
      const subs = args.pipelines.map(name => {
        const entry = pipelines.get(name);
        if (!entry) throw new Error(`Pipeline "${name}" not found`);
        return entry.pipeline;
      });
      const composed = Pipeline.compose(args.name, subs);
      const def = composed.toJSON();
      pipelines.set(args.name, { pipeline: composed, definition: def });
      savePipeline(args.name, def);
      return { ok: true, pipeline: args.name, steps: def.steps.length };
    }

    case 'pipeline_list': {
      const list = [];
      for (const [name, entry] of pipelines) {
        list.push({
          name,
          steps: entry.definition.steps.length,
          runs: (runHistory.get(name) || []).length,
        });
      }
      return { pipelines: list };
    }

    case 'pipeline_runs': {
      const history = runHistory.get(args.pipeline) || [];
      return { pipeline: args.pipeline, runs: history.map(r => ({
        status: r.status,
        durationMs: r.durationMs,
        steps: r.steps.length,
        error: r.error,
      }))};
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── stdin/stdout JSON-RPC (MCP stdio transport) ──
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

function respond(id, result, error) {
  const resp = { jsonrpc: '2.0', id };
  if (error) resp.error = { code: -32000, message: error.message || String(error) };
  else resp.result = result;
  process.stdout.write(JSON.stringify(resp) + '\n');
}

async function handleRequest(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  if (req.method === 'initialize') {
    return respond(req.id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'agent-pipeline', version: '1.0.0' },
      capabilities: { tools: {} },
    });
  }

  if (req.method === 'notifications/initialized') return;

  if (req.method === 'tools/list') {
    return respond(req.id, { tools: TOOLS });
  }

  if (req.method === 'tools/call') {
    try {
      const result = await handleTool(req.params.name, req.params.arguments || {});
      respond(req.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      respond(req.id, null, err);
    }
    return;
  }

  respond(req.id, null, new Error(`Unknown method: ${req.method}`));
}

loadPipelines();
console.error('[agent-pipeline MCP] Ready — listening on stdin');
