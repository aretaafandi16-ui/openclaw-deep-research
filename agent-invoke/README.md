# AgentInvoke 🐋

Zero-dependency tool execution engine for AI agents — register, validate, call, compose, cache, and monitor tools with full MCP compatibility.

## Features

- **Tool Registry** — register tools with JSON Schema validation, tags, versioning
- **Type-Safe Execution** — input/output schema validation with detailed error paths
- **Automatic Retry** — exponential backoff retry with configurable attempts
- **Result Caching** — TTL-based result caching with SHA-256 keys
- **Tool Composition** — chain, pipeline, parallel, conditional, fallback, race
- **Rate Limiting** — per-tool sliding window rate limiting
- **Middleware** — before/after/error hooks for intercepting execution
- **Execution History** — full call history with filtering (tool, success, time)
- **Statistics** — per-tool call counts, success rates, avg duration
- **MCP Compatibility** — `toMCPTools()` + `callMCP()` for Model Context Protocol
- **HTTP Server** — dark-theme web dashboard + REST API (port 3141)
- **CLI** — full command-line interface
- **JSONL Persistence** — event logging with periodic snapshots
- **Zero Dependencies** — pure Node.js, no npm installs needed

## Quick Start

```js
import { AgentInvoke } from './index.mjs';

const engine = new AgentInvoke();

// Register a tool
engine.register('greet', async ({ name }) => ({
  message: `Hello, ${name}!`
}), {
  description: 'Greet someone',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name']
  },
  tags: ['demo'],
  retries: 2,
  cacheTTL: 60000
});

// Call it
const result = await engine.call('greet', { name: 'World' });
console.log(result);
// { callId: '...', name: 'greet', output: { message: 'Hello, World!' }, success: true, ... }
```

## Tool Composition

### Chain
```js
const result = await engine.chain([
  { tool: 'fetch_data', input: { url: '...' } },
  { tool: 'parse_json', transform: prev => ({ text: prev.output.body }) },
  { tool: 'extract_field', transform: prev => ({ data: prev.output, path: 'results' }) }
]);
```

### Parallel
```js
const results = await engine.parallel([
  { tool: 'api_a', input: { query: 'x' } },
  { tool: 'api_b', input: { query: 'y' } },
  { tool: 'api_c', input: { query: 'z' } }
]);
```

### Conditional
```js
const result = await engine.conditional(
  (input) => input.priority === 'high',
  'fast_tool',
  'normal_tool',
  { priority: 'high' }
);
```

### Fallback
```js
const result = await engine.fallback([
  { tool: 'primary_api' },
  { tool: 'backup_api' },
  { tool: 'local_cache' }
]);
```

### Race
```js
const fastest = await engine.race([
  { tool: 'provider_a' },
  { tool: 'provider_b' }
]);
```

## Schema Validation

```js
engine.register('create_user', async ({ name, email, age }) => {
  // guaranteed: name is string, email matches pattern, age is 0-150
  return { id: crypto.randomUUID(), name, email, age };
}, {
  inputSchema: {
    type: 'object',
    required: ['name', 'email'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
      age: { type: 'integer', minimum: 0, maximum: 150 }
    }
  }
});
```

## Middleware

```js
// Logging
engine.before(ctx => console.log(`→ ${ctx.name}`));
engine.after((ctx, result) => console.log(`← ${ctx.name} (${result.duration}ms)`));
engine.onError((ctx, entry, err) => console.error(`✗ ${ctx.name}: ${err.message}`));

// Auth
engine.before(ctx => {
  if (!ctx.opts.token) throw new Error('Unauthorized');
});

// Metrics
engine.after((ctx, result) => {
  metrics.record(`tool.${ctx.name}.duration`, result.duration);
});
```

## Rate Limiting

```js
engine.register('api_call', handler, {
  rateLimit: { max: 100, windowMs: 60000 } // 100 calls per minute
});
```

## Events

```js
engine.on('tool:registered', ({ name }) => console.log(`Registered: ${name}`));
engine.on('tool:success', (entry) => console.log(`Success: ${entry.name}`));
engine.on('tool:error', (entry) => console.error(`Error: ${entry.name}`));
engine.on('tool:retry', ({ name, attempt, delay }) => console.log(`Retry ${name} #${attempt}`));
engine.on('tool:cache_hit', ({ name }) => console.log(`Cache hit: ${name}`));
engine.on('tool:deprecated', ({ name }) => console.warn(`Deprecated: ${name}`));
engine.on('tool:fallback', ({ tool, error }) => console.log(`Fallback from ${tool}`));
```

## MCP Compatibility

```js
// Export tools in MCP format
const mcpTools = engine.toMCPTools();
// [ { name: 'greet', description: '...', inputSchema: { ... } }, ... ]

// Call via MCP interface
const result = await engine.callMCP('greet', { name: 'World' });
```

## HTTP Server

```bash
node server.mjs
# Dashboard: http://localhost:3141
# API: http://localhost:3141/api/*
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tools` | List tools (supports `?tag=X&search=X`) |
| GET | `/api/stats` | Execution statistics |
| GET | `/api/history` | Call history (supports `?tool=X&success=X&limit=N`) |
| POST | `/api/call` | Call a tool (`{name, input, opts}`) |
| POST | `/api/chain` | Chain calls (`{steps, initialInput}`) |
| POST | `/api/parallel` | Parallel calls (`{calls}`) |
| POST | `/api/register` | Register tool (`{name, handler_js, ...}`) |
| DELETE | `/api/unregister/:name` | Unregister tool |
| POST | `/api/validate` | Validate data (`{data, schema}`) |
| POST | `/api/cache/clear` | Clear cache (`{tool?}`) |
| GET | `/api/mcp-tools` | MCP-format tool list |

## CLI

```bash
node cli.mjs call greet '{"name":"World"}'
node cli.mjs chain '[{"tool":"add","input":{"a":1,"b":2}},{"tool":"double"}]'
node cli.mjs parallel '[{"tool":"a"},{"tool":"b"}]'
node cli.mjs list --tag=math
node cli.mjs validate '{"x":5}' '{"type":"object","properties":{"x":{"type":"number"}}}'
node cli.mjs history --tool=greet --limit=10
node cli.mjs stats
node cli.mjs clear-cache --tool=greet
node cli.mjs serve    # HTTP server
node cli.mjs mcp      # MCP server
node cli.mjs demo     # Run demo
```

## API Reference

### `new AgentInvoke(opts?)`

Options:
- `dataDir` — persistence directory (null = no persistence)
- `defaultTimeout` — default call timeout in ms (30000)
- `defaultRetries` — default retry count (0)
- `defaultCacheTTL` — default cache TTL in ms (0 = disabled)
- `maxHistory` — max history entries (10000)

### `engine.register(name, handler, opts?)`

Register a tool. Handler is `async (input) => output`.

Options: `description`, `inputSchema`, `outputSchema`, `tags`, `version`, `timeout`, `retries`, `cacheTTL`, `rateLimit`, `deprecated`, `metadata`

### `engine.call(name, input?, opts?)`

Call a tool. Returns `{ callId, name, input, output, duration, attempt, success, ts, cached? }`.

### `engine.chain(steps, initialInput?)`

Sequential composition with `transform` and `extract` functions per step.

### `engine.parallel(calls)`, `engine.race(calls)`, `engine.fallback(calls)`

Concurrent composition patterns.

### `engine.conditional(condition, trueTool, falseTool, input?)`

Branch execution based on condition.

### `engine.validate(data, schema)`

Returns `{ valid: boolean, errors: string[] }`.

### `engine.getHistory(opts?)`, `engine.getStats()`, `engine.getToolStats(name)`

Query execution data.

### `engine.toMCPTools()`, `engine.callMCP(name, args)`

MCP protocol compatibility.

## License

MIT
