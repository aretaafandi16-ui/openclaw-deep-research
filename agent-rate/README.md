# agent-rate

Zero-dependency rate limiting toolkit for AI agents.

## Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `fixed_window` | Count per time window, resets at boundary | Simple API rate limits |
| `sliding_window_log` | Exact timestamps, precise but memory-heavy | Accurate limiting |
| `sliding_window_counter` | Hybrid: previous + current window weighted | Balanced accuracy/performance |
| `token_bucket` | Tokens refill at steady rate, burst allowed | Bursty traffic, APIs |
| `leaky_bucket` | Queue drains at constant rate | Smooth traffic shaping |

## Features

- **5 strategies** — fixed window, sliding window log, sliding window counter, token bucket, leaky bucket
- **Named limiters** — multiple independent limiters (e.g. `default`, `strict`, `api`)
- **Per-key** — separate tracking per user/IP/API key
- **checkAll()** — check multiple limiters, returns worst result
- **consume(n)** — consume N tokens at once
- **HTTP middleware** — Express/Koa compatible with 429 responses
- **Burst allowance** — token bucket supports burst capacity
- **Events** — check, rejected, limiter:added, reset
- **Stats** — global + per-limiter counters
- **JSONL persistence** — optional audit trail
- **Web dashboard** — real-time monitoring at `/dashboard`
- **MCP server** — 10 tools for AI agent integration
- **CLI** — check, burst test, demo, serve

## Quick Start

```js
import { AgentRate } from './index.mjs';

const rate = new AgentRate();
rate.addLimiter('api', { strategy: 'token_bucket', limit: 100, windowMs: 60000, burst: 20 });

const result = rate.check('user-123', 'api');
// { allowed: true, remaining: 119, limit: 120, resetAt: ..., retryAfter: 0, strategy: 'token_bucket' }
```

## API

### `new AgentRate(opts?)`

- `opts.defaultLimiter` — `{ strategy, limit, windowMs, burst }` auto-creates a `default` limiter
- `opts.persistenceFile` — JSONL file path for audit logging

### Methods

| Method | Description |
|--------|-------------|
| `addLimiter(name, opts)` | Add named limiter |
| `removeLimiter(name)` | Remove limiter |
| `check(key, limiter?)` | Check rate limit → `{ allowed, remaining, limit, resetAt, retryAfter, strategy }` |
| `isAllowed(key, limiter?)` | Returns boolean |
| `checkAll(key, [names])` | Check multiple limiters, returns worst result |
| `consume(key, n, limiter?)` | Consume N tokens |
| `reset(key, limiter?)` | Reset specific key |
| `resetAll(limiter?)` | Reset all keys |
| `getStats(limiter?)` | Global + per-limiter stats |
| `getState(limiter?)` | Current state of all keys |
| `listLimiters()` | List all limiters with stats |
| `middleware(limiter?, keyFn?)` | Express/HTTP middleware (returns 429) |

### Events

```js
rate.on('check', ({ key, limiter, allowed, remaining }) => { ... });
rate.on('rejected', ({ key, limiter, retryAfter }) => { ... });
rate.on('limiter:added', ({ name, strategy, limit, windowMs }) => { ... });
rate.on('reset', ({ key, limiter }) => { ... });
```

## CLI

```bash
node cli.mjs check user-123 --limiter=api
node cli.mjs is-allowed user-123
node cli.mjs consume user-123 5 --limiter=api
node cli.mjs burst user-123 10 --limiter=api
node cli.mjs reset user-123 --limiter=api
node cli.mjs list
node cli.mjs stats [limiter]
node cli.mjs add-limiter strict --strategy=sliding_window_log --limit=20 --window=60000
node cli.mjs demo
node cli.mjs serve --port=3126
node cli.mjs mcp
```

## MCP Server

10 tools for AI agent integration:

| Tool | Description |
|------|-------------|
| `rate_check` | Check rate limit for a key |
| `rate_is_allowed` | Boolean check |
| `rate_consume` | Consume N tokens |
| `rate_reset` | Reset key |
| `rate_reset_all` | Reset all keys for limiter |
| `rate_add_limiter` | Add named limiter |
| `rate_remove_limiter` | Remove limiter |
| `rate_list_limiters` | List all limiters |
| `rate_stats` | Get stats |
| `rate_state` | Get current state |

```bash
node mcp-server.mjs  # JSON-RPC stdio
```

## HTTP Server

```bash
PORT=3126 node server.mjs
# Dashboard: http://localhost:3126/dashboard
# API: /api/stats, /api/check?key=xxx&limiter=yyy, /api/reset, /api/limiters, /api/recent
```

## HTTP Middleware

```js
import express from 'express';
import { AgentRate } from './index.mjs';

const app = express();
const rate = new AgentRate();
rate.addLimiter('api', { strategy: 'token_bucket', limit: 100, windowMs: 60000, burst: 20 });

app.use(rate.middleware('api', req => req.ip));

app.get('/api/data', (req, res) => res.json({ ok: true }));
// Returns 429 with Retry-After header when limited
```

## License

MIT
