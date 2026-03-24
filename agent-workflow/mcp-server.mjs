import { Workflow, WorkflowRegistry, uuid } from './index.mjs';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

const registry = new WorkflowRegistry();
const pending = new Map();

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function error(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
}

const TOOLS = {
  workflow_create: async (params) => {
    const { definition, persistDir, defaultTimeout, defaultRetries, continueOnError } = params;
    const wf = registry.create(definition, { persistDir, defaultTimeout, defaultRetries, continueOnError });
    return { id: wf.id, name: wf.name, steps: wf.steps.length };
  },
  workflow_run: async (params) => {
    const { workflowId, data } = params;
    const result = await registry.run(workflowId, data || {});
    return result;
  },
  workflow_run_async: async (params) => {
    const { workflowId, data } = params;
    const runId = uuid();
    pending.set(runId, registry.run(workflowId, data || {}).catch(e => ({ error: e.message })));
    return { runId, status: 'started' };
  },
  workflow_result: async (params) => {
    const { runId } = params;
    const p = pending.get(runId);
    if (!p) return { error: 'Run not found' };
    const result = await p;
    pending.delete(runId);
    return result;
  },
  workflow_get: async (params) => {
    const { workflowId } = params;
    const wf = registry.get(workflowId);
    if (!wf) throw new Error('Workflow not found');
    return { id: wf.id, name: wf.name, steps: wf.steps.length, definition: wf.toJSON(), stats: wf.stats };
  },
  workflow_list: async () => registry.list(),
  workflow_remove: async (params) => {
    registry.remove(params.workflowId);
    return { removed: true };
  },
  workflow_add_step: async (params) => {
    const { workflowId, step } = params;
    const wf = registry.get(workflowId);
    if (!wf) throw new Error('Workflow not found');
    wf.addStep(step);
    return { steps: wf.steps.length };
  },
  workflow_remove_step: async (params) => {
    const { workflowId, stepId } = params;
    const wf = registry.get(workflowId);
    if (!wf) throw new Error('Workflow not found');
    wf.removeStep(stepId);
    return { steps: wf.steps.length };
  },
  workflow_runs: async (params) => {
    const { workflowId } = params;
    const wf = registry.get(workflowId);
    if (!wf) throw new Error('Workflow not found');
    return { runs: wf.runs, stats: wf.stats };
  },
  workflow_dag: async (params) => {
    const { workflowId, format } = params;
    const wf = registry.get(workflowId);
    if (!wf) throw new Error('Workflow not found');
    return format === 'dot' ? { dot: wf.toDot() } : { mermaid: wf.toMermaid() };
  },
  workflow_stats: async () => registry.globalStats,
};

const SCHEMA = [
  { name: 'workflow_create', description: 'Create a new workflow from definition', inputSchema: { type: 'object', properties: { definition: { type: 'object', description: 'Workflow definition with id, name, steps' }, persistDir: { type: 'string' }, defaultTimeout: { type: 'number' }, defaultRetries: { type: 'number' }, continueOnError: { type: 'boolean' } }, required: ['definition'] } },
  { name: 'workflow_run', description: 'Run a workflow synchronously', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' }, data: { type: 'object' } }, required: ['workflowId'] } },
  { name: 'workflow_run_async', description: 'Start a workflow run asynchronously', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' }, data: { type: 'object' } }, required: ['workflowId'] } },
  { name: 'workflow_result', description: 'Get result of async workflow run', inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] } },
  { name: 'workflow_get', description: 'Get workflow details and stats', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' } }, required: ['workflowId'] } },
  { name: 'workflow_list', description: 'List all workflows', inputSchema: { type: 'object', properties: {} } },
  { name: 'workflow_remove', description: 'Remove a workflow', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' } }, required: ['workflowId'] } },
  { name: 'workflow_add_step', description: 'Add a step to a workflow', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' }, step: { type: 'object' } }, required: ['workflowId', 'step'] } },
  { name: 'workflow_remove_step', description: 'Remove a step from a workflow', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' }, stepId: { type: 'string' } }, required: ['workflowId', 'stepId'] } },
  { name: 'workflow_runs', description: 'Get run history for a workflow', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' } }, required: ['workflowId'] } },
  { name: 'workflow_dag', description: 'Get DAG visualization (mermaid or dot)', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' }, format: { type: 'string', enum: ['mermaid', 'dot'] } }, required: ['workflowId'] } },
  { name: 'workflow_stats', description: 'Get global registry statistics', inputSchema: { type: 'object', properties: {} } },
];

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') return respond(msg.id, { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-workflow', version: '1.0.0' }, capabilities: { tools: {} } });
  if (msg.method === 'tools/list') return respond(msg.id, { tools: SCHEMA });
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    try {
      const result = await TOOLS[name](args || {});
      respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      respond(msg.id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
});

process.stderr.write('agent-workflow MCP server ready\n');
