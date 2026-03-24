# agent-sandbox

> Zero-dependency isolated code execution sandbox for AI agents

Safely run untrusted, user-provided, or LLM-generated JavaScript in a sandboxed VM context with timeout enforcement, context injection, state snapshots, and full output capture.

## Features

- **VM-based isolation** — Node.js `vm` module, no child processes needed
- **Timeout enforcement** — configurable per-execution timeout (default 5s)
- **Output capture** — intercepts `console.log/error/warn/info`
- **Context injection** — pass variables into the sandbox via `globals`
- **Module mocking** — stub any object/API inside the sandbox
- **Persistent snapshots** — create named contexts that persist state across runs
- **Batch execution** — run multiple snippets concurrently with configurable parallelism
- **Async support** — handles Promises and async/await natively
- **Restricted globals** — no `process`, `require`, `fs` by default
- **Execution history** — JSONL-persisted logs with duration metrics
- **EventEmitter** — `success`, `execution-error`, `timeout`, `snapshot` events

## Quick Start

```js
import { AgentSandbox } from './index.mjs';

const sb = new AgentSandbox();

// Basic execution
const r = sb.run('1 + 2 + 3');
// { success: true, value: 6, stdout: '', stderr: '', durationMs: 2 }

// With context injection
sb.run('name + " is " + age', { globals: { name: 'Laboon', age: 1 } });
// → 'Laboon is 1'

// Function execution
sb.runFunction((a, b) => a * b, [6, 7]);
// → 42

// Expression evaluation
sb.runExpression('users.filter(u => u.active).length', {
  users: [{ active: true }, { active: false }]
});
// → 1
```

## Snapshots

Create persistent VM contexts that maintain state across executions:

```js
sb.snapshot('counter', 'let count = 0; function inc() { return ++count; }');

sb.runInSnapshot('counter', 'inc()'); // → 1
sb.runInSnapshot('counter', 'inc()'); // → 2
sb.runInSnapshot('counter', 'count'); // → 2
```

## Batch Execution

```js
const results = await sb.runBatch([
  '1 + 1',
  '"hello".length',
  'Math.PI',
], { concurrency: 3 });
```

## HTTP Server

```bash
node server.mjs
# Dashboard at http://localhost:3121
```

**Endpoints:**
- `POST /run` — execute code (`{ code, timeout?, globals? }`)
- `GET /stats` — execution statistics
- `GET /history` — execution history (with `?limit=N&success=true`)
- `GET /snapshots` — list snapshots
- `POST /snapshot` — create snapshot
- `POST /snapshot/:name` — run in snapshot
- `DELETE /snapshot/:name` — delete snapshot

## MCP Server

```bash
node mcp-server.mjs
# 10 tools via JSON-RPC stdio
```

**Tools:** `sandbox_run`, `sandbox_run_function`, `sandbox_run_expression`, `sandbox_run_batch`, `sandbox_snapshot`, `sandbox_run_in_snapshot`, `sandbox_list_snapshots`, `sandbox_delete_snapshot`, `sandbox_stats`, `sandbox_history`

## CLI

```bash
# Run code
node cli.mjs run 'Math.sqrt(144)'

# Evaluate expression
node cli.mjs eval 'users.length'

# Run from file (one code block per line)
node cli.mjs batch snippets.txt

# Snapshots
node cli.mjs snapshot myctx 'let x = 0;'
node cli.mjs exec-snap myctx '++x'

# Stats & history
node cli.mjs stats
node cli.mjs history 10

# Servers
node cli.mjs serve --port 3121
node cli.mjs mcp

# Demo
node cli.mjs demo
```

## Tests

```bash
node test.mjs
# 43 tests, all passing ✅
```

## License

MIT
