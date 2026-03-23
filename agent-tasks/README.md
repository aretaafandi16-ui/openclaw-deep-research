# agent-tasks

Zero-dependency persistent task queue & scheduler for AI agents.

## Features

- **Priority Queue** — critical → high → normal → low, FIFO within priority
- **Task Chains** — `waitFor` dependencies auto-resolve when parents complete
- **Retry with Backoff** — exponential backoff, configurable max retries
- **Concurrency Control** — limit parallel execution
- **Delayed Tasks** — `runAt` for future execution
- **Recurring Tasks** — auto-respawn on interval
- **Dead Letter Queue** — permanently failed tasks, re-enqueue on demand
- **Timeouts** — kill tasks exceeding execution time
- **Webhooks** — POST results to URL on completion
- **Persistence** — JSONL event log + periodic snapshots, survives restarts
- **Real-time Events** — EventEmitter for programmatic observation
- **MCP Server** — 11 tools via Model Context Protocol
- **CLI** — full command-line interface
- **Zero Dependencies** — just Node.js

## Quick Start

```js
import { TaskQueue } from "./index.mjs";

const queue = new TaskQueue({
  dataDir: "./my-tasks",
  concurrency: 4,
  executor: async (task) => {
    // your logic here
    console.log(`Processing: ${task.type}`, task.payload);
    return { result: "done" };
  },
});

// Enqueue tasks
const a = queue.enqueue({ type: "fetch", priority: "high", payload: { url: "..." } });
const b = queue.enqueue({ type: "process", waitFor: [a.id], payload: { format: "csv" } });
queue.enqueue({ type: "notify", priority: "low", runAt: Date.now() + 60000 });

// Start scheduler
queue.start();
```

## Task Lifecycle

```
pending ──→ running ──→ completed
    │           │
    │           ├──→ retrying ──→ pending (exponential backoff)
    │           │
    │           └──→ dead_letter (after maxRetries)
    │
    ├──→ waiting_deps ──→ pending (when deps complete)
    │
    └──→ cancelled
```

## API

### `new TaskQueue(opts)`

| Option | Default | Description |
|--------|---------|-------------|
| `dataDir` | `./agent-tasks-data` | Persistence directory |
| `concurrency` | `4` | Max parallel tasks |
| `pollMs` | `500` | Scheduler interval |
| `snapshotEvery` | `50` | Snapshot frequency |
| `executor` | no-op | `async (task) => result` |

### `queue.enqueue(spec)`

| Field | Default | Description |
|-------|---------|-------------|
| `type` | `"generic"` | Task type label |
| `payload` | `{}` | Data for executor |
| `priority` | `"normal"` | critical/high/normal/low |
| `runAt` | `now()` | Delay execution (epoch ms) |
| `waitFor` | `[]` | Dependency task IDs |
| `maxRetries` | `3` | Retry count |
| `retryDelayMs` | `1000` | Base retry delay |
| `webhookUrl` | null | POST URL on completion |
| `timeoutMs` | null | Execution timeout |
| `recurring` | null | `{ everyMs: N }` |
| `meta` | `{}` | User metadata |

### Other Methods

- `get(id)` — get task by ID
- `list(opts)` — list with filters (status, type, priority, limit)
- `cancel(id)` — cancel pending task
- `kill(id)` — kill running task
- `stats()` — queue statistics
- `getDeadLetter()` — view dead-letter queue
- `retryDeadLetter(id)` — re-enqueue dead task
- `prune(maxAgeMs)` — remove old tasks
- `clearCompleted()` — remove all completed
- `exportState()` — full state as JSON
- `start()` / `stop()` — scheduler control
- `tick()` — single scheduler tick (manual mode)

### Events

```js
queue.on("enqueue", (task) => { ... });
queue.on("start", (task) => { ... });
queue.on("complete", (task) => { ... });
queue.on("retry", (task) => { ... });
queue.on("dead_letter", (task) => { ... });
queue.on("cancel", (task) => { ... });
queue.on("deps_resolved", (task) => { ... });
```

## CLI

```bash
# Enqueue tasks
node cli.mjs add --type fetch --priority high --payload '{"url":"..."}'
node cli.mjs add --type process --waitFor "task-id-1,task-id-2" --timeoutMs 5000
node cli.mjs add --type recurring --recurring 60000

# Run scheduler
node cli.mjs serve --concurrency 8

# Manage tasks
node cli.mjs list --status pending
node cli.mjs get <task-id>
node cli.mjs cancel <task-id>
node cli.mjs stats
node cli.mjs dead-letter
node cli.mjs retry-dead <task-id>
node cli.mjs prune
node cli.mjs clear

# Demo
node cli.mjs demo

# MCP server
node cli.mjs mcp
```

## MCP Server

Start: `node mcp-server.mjs` (or `node cli.mjs mcp`)

### Tools

| Tool | Description |
|------|-------------|
| `tasks_enqueue` | Enqueue a new task |
| `tasks_get` | Get task by ID |
| `tasks_list` | List tasks with filters |
| `tasks_cancel` | Cancel pending task |
| `tasks_kill` | Kill running task |
| `tasks_stats` | Queue statistics |
| `tasks_dead_letter` | View dead-letter queue |
| `tasks_retry_dead` | Re-enqueue dead task |
| `tasks_prune` | Remove old tasks |
| `tasks_clear_completed` | Clear completed tasks |
| `tasks_export` | Export state as JSON |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TASKS_DATA_DIR` | `./agent-tasks-data` | Data directory |
| `TASKS_CONCURRENCY` | `4` | Default concurrency |

## License

MIT
