# agent-pipeline 🔄

Zero-dependency pipeline orchestrator for AI agents — composable workflows with branching, retries, parallel execution, and error handling.

## Features

- **Composable step chains** — define workflows as a series of typed steps
- **Conditional branching** — if/else based on context
- **Parallel execution** — run independent steps concurrently
- **Retry with exponential backoff** — configurable per-step retry
- **Error handlers & fallbacks** — graceful failure recovery
- **Timeouts** — per-step and global pipeline timeouts
- **Middleware hooks** — before/after/finally/error interceptors
- **Pipeline composition** — nest pipelines as steps
- **Dependency management** — declare step dependencies
- **Event-driven** — EventEmitter for progress tracking
- **JSON-serializable** — save/load pipeline definitions
- **MCP server** — Model Context Protocol integration
- **CLI** — run pipelines from JSON files
- **Dry-run mode** — test without executing

## Quick Start

```javascript
import { pipeline } from './index.mjs';

const result = await pipeline('data-processing')
  .log('start', 'Beginning processing...')
  .transform('prepare', (ctx) => ({ ...ctx, items: [1, 2, 3] }))
  .add('fetch', async (ctx) => {
    const data = await fetchAPI(ctx.items);
    return { results: data };
  }, {
    retry: { maxAttempts: 3, backoffMs: 1000 },
    timeoutMs: 5000,
    transform: (output) => ({ fetched: output.results }),
  })
  .condition('check-size',
    (ctx) => ctx.fetched.length > 2,
    pipeline('large-batch').parallel('process', [...]),
    pipeline('small-batch').add('single', async (ctx) => process(ctx.fetched))
  )
  .set('done', { completedAt: new Date().toISOString() })
  .log('end', 'Processing complete!')
  .run({ userId: 'user-123' });

console.log(result.status); // 'success' or 'failed'
console.log(result.durationMs);
console.log(result.context);
```

## Step Types

| Type | Description | Example |
|------|-------------|---------|
| `task` | Run an async function | `.add('step', async (ctx) => result)` |
| `transform` | Map context data | `.transform('step', (ctx) => newCtx)` |
| `condition` | Branch based on predicate | `.condition('check', predicate, trueBranch, falseBranch)` |
| `parallel` | Run steps concurrently | `.parallel('batch', [step1, step2, step3])` |
| `pipeline` | Nest a sub-pipeline | `.pipeline('sub', subPipeline)` |
| `delay` | Wait N ms | `.delay('wait', 1000)` |
| `log` | Log a message | `.log('info', 'Hello')` |
| `set` | Set context values | `.set('config', { key: 'value' })` |
| `assert` | Assert condition or fail | `.assert('check', (ctx) => ctx.ok)` |

## Step Options

```javascript
p.add('step', handler, {
  timeoutMs: 5000,           // Step timeout
  retry: {                   // Retry configuration
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    jitter: true,
  },
  onError: (err, ctx) => fallback,  // Fallback handler
  skipIf: (ctx) => ctx.skip,        // Skip condition
  transform: (output, ctx) => newCtx,  // Post-step transform
  dependsOn: ['previous-step'],    // Step dependencies
});
```

## Events

```javascript
const p = pipeline('my-pipeline');

p.on('stepStart', (step) => console.log(`Starting: ${step.name}`));
p.on('step', (result) => console.log(`Done: ${result.name} → ${result.status}`));
p.on('log', (entry) => console.log(`Log: ${entry.message}`));
p.on('done', (result) => console.log(`Pipeline: ${result.status}`));
p.on('error', (err) => console.error(`Error: ${err.message}`));
```

## Middleware

```javascript
p.before((ctx) => console.log('Pipeline starting'))
 .after((result, ctx) => console.log(`Completed in ${result.durationMs}ms`))
 .finally((result) => saveToLog(result))
 .onError((stepResult, ctx) => alertOnFailure(stepResult));
```

## Pipeline Composition

```javascript
const fetchPipeline = pipeline('fetch').add('get', fetchData);
const processPipeline = pipeline('process').add('transform', transformData);

const main = Pipeline.compose('full-flow', [fetchPipeline, processPipeline]);
// Or inline:
const main = pipeline('main')
  .pipeline('fetch', fetchPipeline)
  .pipeline('process', processPipeline);
```

## CLI

```bash
# Run from JSON file
agent-pipeline run pipeline.json --context '{"user":"alice"}'

# Run demo
agent-pipeline demo

# Validate definition
agent-pipeline validate pipeline.json

# Start MCP server
agent-pipeline mcp
```

### Pipeline JSON Format

```json
{
  "name": "my-pipeline",
  "globalTimeoutMs": 30000,
  "steps": [
    { "name": "fetch", "type": "task", "handler": "async (ctx) => ({ data: 'hello' })" },
    { "name": "wait", "type": "delay", "delayMs": 1000 },
    { "name": "log", "type": "log", "message": "Done!" }
  ]
}
```

## MCP Server

Start the MCP server for integration with AI agent frameworks:

```bash
agent-pipeline mcp
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `pipeline_create` | Create a new pipeline |
| `pipeline_add_task` | Add a task step |
| `pipeline_add_parallel` | Add a parallel execution step |
| `pipeline_add_delay` | Add a delay step |
| `pipeline_add_set` | Add a step that sets context values |
| `pipeline_run` | Run a pipeline with context |
| `pipeline_serialize` | Get pipeline JSON definition |
| `pipeline_compose` | Compose multiple pipelines |
| `pipeline_list` | List all pipelines |
| `pipeline_runs` | Get run history |

## API Reference

### `pipeline(name, opts?)`
Create a new pipeline builder.

### `Pipeline.fromJSON(def, handlers?)`
Create a pipeline from a JSON definition.

### `Pipeline.compose(name, pipelines, opts?)`
Compose multiple pipelines into one.

### `withRetry(fn, opts?)`
Retry an async function with exponential backoff.

### `withTimeout(promise, ms, name?)`
Wrap a promise with a timeout.

## Error Types

- **`PipelineError`** — general pipeline failure
- **`StepTimeoutError`** — step exceeded timeout
- **`RetryExhaustedError`** — all retry attempts failed

## License

MIT
