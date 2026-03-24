# agent-batch — Zero-Dep Batch Processing Engine for AI Agents

A zero-dependency batch processing engine with concurrency control, retry logic, progress tracking, rate limiting, and pause/resume — built for AI agent workflows.

## Features

- **Parallel execution** with configurable concurrency limits
- **Per-item retry** with exponential backoff
- **Progress tracking** — processed/succeeded/failed/skipped with real-time events
- **Timeouts** — per-item and global timeout support
- **Rate limiting** — token bucket algorithm for items/sec control
- **Batch filtering** — skip items matching a predicate
- **Before/after hooks** — per-item lifecycle callbacks
- **Chunked processing** — batch of batches with sequential chunks
- **Pause/resume/cancel** — control running batches mid-flight
- **Error aggregation** — partial results + detailed error collection
- **Map/Filter/Reduce** — functional batch operations
- **EventEmitter** — real-time progress events (start, complete, item-start, item-complete, retry, skip, etc.)
- **JSONL persistence** — batch run history survives restarts
- **HTTP dashboard** — dark-theme web UI with SSE live events
- **MCP server** — 10 tools via JSON-RPC stdio
- **CLI** — full command-line interface

## Quick Start

```javascript
import { BatchProcessor } from './index.mjs';

const bp = new BatchProcessor();

// Basic parallel execution
const result = await bp.execute([1, 2, 3, 4, 5], async (item) => {
  await someAsyncWork(item);
  return item * 2;
}, { concurrency: 3, retries: 2 });

console.log(result.stats); // { total: 5, succeeded: 5, failed: 0, ... }

// Map
const mapped = await bp.map([1, 2, 3], (item) => item * 10);

// Filter (keep items where predicate returns true)
const filtered = await bp.filter([1, 2, 3, 4, 5], (item) => item > 3);

// Reduce (sequential by default)
const sum = await bp.reduce([1, 2, 3, 4, 5], (acc, item) => acc + item, 0);

// Retry a single function
const result = await bp.retry(() => flakyApiCall(), { retries: 3, delay: 1000 });
```

## API Reference

### `BatchProcessor(options?)`

```javascript
const bp = new BatchProcessor({
  dataDir: './data',      // JSONL persistence directory
  persistRuns: true       // auto-persist completed runs
});
```

### `bp.execute(items, processor, options?)`

Execute a batch of items with full control.

```javascript
const result = await bp.execute(
  urls,
  async (url, index) => fetch(url).then(r => r.json()),
  {
    concurrency: 5,        // max parallel workers
    retries: 2,            // retry count per item
    retryDelay: 1000,      // initial retry delay (ms)
    retryBackoff: 2,       // exponential backoff multiplier
    itemTimeout: 30000,    // per-item timeout (ms)
    globalTimeout: 60000,  // total batch timeout (ms)
    rateLimit: 10,         // items/sec (0=unlimited)
    chunkSize: 0,          // process in sequential chunks (0=parallel)
    filter: (item) => item.skip === true, // skip predicate (return true to SKIP)
    beforeEach: (item, idx) => console.log('Starting:', idx),
    afterEach: (item, idx, result) => console.log('Done:', idx),
    collectResults: true   // collect per-item results
  }
);
```

**Result:**
```javascript
{
  batchId: 'abc123',
  state: 'completed',      // completed | cancelled
  duration: 1234,
  total: 100,
  processed: 100,
  succeeded: 95,
  failed: 5,
  skipped: 0,
  retries: 8,
  results: [{ index: 0, item: ..., result: ... }, ...],
  errors: [{ index: 42, item: ..., error: 'timeout', attempts: 3 }]
}
```

### `bp.map(items, fn, options?)`
Transform each item. Returns results array with `{ index, item, result }`.

### `bp.filter(items, predicate, options?)`
Keep items where predicate returns `true`. Returns `result.filtered` (array of kept items).

### `bp.reduce(items, reducer, initial, options?)`
Sequential reduce. Returns `result.accumulator`.

### `bp.retry(fn, options?)`
Retry a single async function.

```javascript
const result = await bp.retry(
  (attempt) => apiCall(),
  { retries: 3, delay: 1000, backoff: 2 }
);
```

### `bp.chunk(items, size)`
Split array into chunks. Returns array of arrays.

### `bp.create(items, processor, options?)`
Create a `BatchRun` without executing. Returns a controllable run object.

```javascript
const run = bp.create(items, processor, { concurrency: 3 });
run.pause();   // pause workers
run.resume();  // resume workers
run.cancel();  // abort execution
const progress = run.getProgress(); // { percent, state, elapsed, ... }
const promise = run.run(); // start execution
```

### Events

```javascript
bp.on('start', (data) => { /* batchId, total */ });
bp.on('complete', (summary) => { /* full result */ });
bp.on('item-start', (data) => { /* batchId, index, item, attempt */ });
bp.on('item-complete', (data) => { /* batchId, index, result */ });
bp.on('item-fail', (data) => { /* batchId, index, error */ });
bp.on('item-retry', (data) => { /* batchId, index, attempt, delay */ });
bp.on('skip', (data) => { /* batchId, index, item */ });
bp.on('pause', (data) => { /* batchId */ });
bp.on('resume', (data) => { /* batchId */ });
bp.on('cancel', (data) => { /* batchId */ });
bp.on('chunk-start', (data) => { /* chunk index, total */ });
bp.on('*', ({ event, data }) => { /* all events */ });
```

### Stats & History

```javascript
bp.getStats();      // { totalBatches, totalItems, totalSucceeded, totalFailed, avgDurationMs, successRate }
bp.getRuns();       // array of { id, state, stats, options }
bp.getHistory();    // array of completed batch summaries
bp.getRun(batchId); // specific BatchRun instance
```

## HTTP Server

```bash
node server.mjs           # starts on port 3113
# or
node cli.mjs serve
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Web dashboard |
| GET | `/health` | Health check |
| GET | `/api/stats` | Aggregate statistics |
| GET | `/api/runs` | All batch runs |
| GET | `/api/history` | Completed batch history |
| GET | `/api/events` | SSE live event stream |
| POST | `/api/execute` | Execute batch `{ items, fn, options }` |
| POST | `/api/retry` | Retry function `{ fn, options }` |

## MCP Server

```bash
node mcp-server.mjs       # JSON-RPC stdio
# or
node cli.mjs mcp
```

### Tools

| Tool | Description |
|------|-------------|
| `batch_execute` | Execute batch with processor function |
| `batch_map` | Transform each item |
| `batch_filter` | Filter items with predicate |
| `batch_reduce` | Reduce to accumulator |
| `batch_retry` | Retry function with backoff |
| `batch_chunk` | Split array into chunks |
| `batch_progress` | Get running batch progress |
| `batch_cancel` | Cancel a running batch |
| `batch_runs` | List all batch runs |
| `batch_stats` | Get aggregate statistics |

## CLI

```bash
# Execute batch
node cli.mjs execute '[1,2,3,4,5]' 'return item * 2' --concurrency 3 --retries 2

# Map
node cli.mjs map '[1,2,3,4,5]' 'return item * 10'

# Filter
node cli.mjs filter '[1,2,3,4,5]' 'item > 3'

# Reduce
node cli.mjs reduce '[1,2,3,4,5]' 'return acc + item' 0

# Retry
node cli.mjs retry 'if(Math.random()<0.5)throw new Error("flaky");return "ok"' --retries 3

# Chunk
node cli.mjs chunk '[1,2,3,4,5,6,7]' 3

# Demo
node cli.mjs demo

# Server
node cli.mjs serve

# MCP
node cli.mjs mcp
```

## Testing

```bash
node test.mjs
# ✅ 53 passed, ❌ 0 failed
```

## Zero Dependencies

Uses only Node.js built-ins: `node:events`, `node:fs`, `node:path`, `node:http`, `node:util`.

## License

MIT
