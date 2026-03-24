# agent-workflow

Zero-dependency DAG-based workflow engine for AI agents. Compose complex multi-step workflows with conditional branching, parallel execution, sub-workflows, retry, timeouts, and visualization.

## Features

- **DAG execution** — topological sort with automatic parallelization within levels
- **11 step types** — task, transform, condition, parallel, loop, workflow (nested), log, set, delay, assert, switch
- **Conditional execution** — `when` predicate on any step
- **Retry with backoff** — configurable per-step with exponential delay
- **Timeouts** — per-step timeout with AbortController
- **Fallback handlers** — graceful degradation on failure
- **Visualization** — Mermaid and Graphviz DOT export
- **Persistence** — JSONL event log for runs and step results
- **Web dashboard** — dark-theme real-time monitoring UI
- **MCP server** — 12 tools for AI agent integration
- **CLI** — run, validate, visualize, demo workflows from JSON files
- **Zero dependencies** — pure Node.js, nothing to install

## Quick Start

```bash
# Run demo
node cli.mjs demo

# Start web dashboard
node cli.mjs serve --port 3112

# Run a workflow from file
node cli.mjs run workflow.json --data '{"input": 42}'

# Validate workflow definition
node cli.mjs validate workflow.json

# Export DAG
node cli.mjs dag workflow.json --format dot
```

## Workflow Definition

```json
{
  "name": "Data Pipeline",
  "steps": [
    { "id": "fetch", "name": "Fetch Data", "type": "task" },
    { "id": "validate", "name": "Validate", "type": "task", "dependsOn": ["fetch"] },
    { "id": "transform", "name": "Transform", "type": "transform", "dependsOn": ["validate"], "input": "fetch" },
    { "id": "save", "name": "Save", "type": "task", "dependsOn": ["transform"] }
  ]
}
```

## Step Types

| Type | Description | Key Properties |
|------|-------------|----------------|
| `task` | Run async function | `run(ctx, signal)` |
| `transform` | Transform data from another step | `input`, `transform(data, ctx)` |
| `condition` | Boolean branch gate | `condition(ctx) → bool` |
| `parallel` | Run sub-tasks in parallel | `tasks[]` |
| `loop` | Iterate with condition | `condition(ctx, i, results)`, `run(ctx, i, results)`, `maxIterations` |
| `workflow` | Nested sub-workflow | `workflow` (definition) |
| `log` | Emit log message | `message` (string or function) |
| `set` | Set context variable | `key`, `value` |
| `delay` | Wait N milliseconds | `ms` |
| `assert` | Fail if condition false | `assert(ctx) → bool`, `message` |
| `switch` | Multi-branch by value | `value`, `cases{}` |

## Step Properties

All steps support:

- `id` — unique identifier (required)
- `name` — display name
- `type` — step type (default: `task`)
- `dependsOn` — array of step IDs (dependencies)
- `retries` — retry count (default: 0)
- `timeout` — timeout in ms (default: 30000)
- `fallback` — async function called on failure
- `when` — async predicate, step skipped if returns false

## Programmatic API

```javascript
import { Workflow, WorkflowRegistry } from './index.mjs';

// Create workflow
const wf = new Workflow({
  name: 'my-pipeline',
  steps: [
    { id: 'fetch', type: 'task', run: async (ctx) => ({ data: [1,2,3] }) },
    { id: 'process', type: 'transform', dependsOn: ['fetch'], input: 'fetch',
      transform: async (input) => input.data.map(x => x * 2) },
    { id: 'save', type: 'task', dependsOn: ['process'],
      run: async (ctx) => { console.log(ctx.outputs.get('process')); return true; } },
  ],
});

// Events
wf.on('step:start', e => console.log(`Running ${e.step}...`));
wf.on('complete', e => console.log(`Done in ${e.duration}ms`));

// Run
const result = await wf.run({ initialData: 'value' });
console.log(result.status, result.outputs);

// Visualization
console.log(wf.toMermaid());
console.log(wf.toDot());

// Registry (multi-workflow)
const reg = new WorkflowRegistry({ persistDir: './runs' });
const w = reg.create({ name: 'w', steps: [...] });
await reg.run(w.id);
console.log(reg.globalStats);
```

## MCP Server

12 tools for AI agent integration:

| Tool | Description |
|------|-------------|
| `workflow_create` | Create workflow from definition |
| `workflow_run` | Run workflow synchronously |
| `workflow_run_async` | Start async run |
| `workflow_result` | Get async result |
| `workflow_get` | Get workflow details |
| `workflow_list` | List all workflows |
| `workflow_remove` | Remove workflow |
| `workflow_add_step` | Add step to workflow |
| `workflow_remove_step` | Remove step |
| `workflow_runs` | Get run history |
| `workflow_dag` | Get Mermaid/DOT visualization |
| `workflow_stats` | Global stats |

```bash
node mcp-server.mjs  # Start MCP server (stdio)
```

## Web Dashboard

```bash
PORT=3112 node server.mjs
```

- Real-time stats cards (workflows, runs, success rate)
- Workflow table with run/dag buttons
- DAG visualization viewer
- Workflow creation form
- Auto-refresh every 5 seconds

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Global stats |
| `/api/workflows` | GET | List workflows |
| `/api/workflows` | POST | Create workflow |
| `/api/workflows/:id` | GET | Get workflow |
| `/api/workflows/:id` | DELETE | Remove workflow |
| `/api/workflows/:id/run` | POST | Run workflow |
| `/api/workflows/:id/dag` | GET | Get DAG visualization |
| `/api/workflows/:id/runs` | GET | Get run history |
| `/api/workflows/:id/steps` | POST | Add step |

## License

MIT
