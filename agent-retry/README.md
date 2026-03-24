# agent-retry 🛡️

Zero-dependency resilience toolkit for AI agents. Circuit breaker, exponential backoff with jitter, bulkhead concurrency control, timeout wrapper, health checks, and a combined orchestrator.

## Features

- **ExponentialBackoff** — Configurable delay with multiplier, max cap, jitter
- **CircuitBreaker** — Closed → Open → Half-Open state machine with failure thresholds
- **Bulkhead** — Concurrency limiter with priority queue and timeout
- **withTimeout** — Promise timeout wrapper
- **retry()** — One-shot retry with backoff, filtering, callbacks
- **RetryOrchestrator** — Combines retry + circuit breaker + bulkhead + timeout + fallback
- **HealthChecker** — Register and run periodic health checks with criticality levels
- **RetryRegistry** — Named component registry for all resilience primitives
- **HTTP Dashboard** — Real-time monitoring UI at port 3103
- **MCP Server** — 12 tools for Model Context Protocol integration

## Quick Start

```js
import { retry, CircuitBreaker, Bulkhead, RetryOrchestrator } from './index.mjs';

// Simple retry with backoff
const result = await retry(async () => {
  const resp = await fetch('https://api.example.com/data');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}, { maxRetries: 5, initialMs: 500, timeoutMs: 10000 });

// Circuit breaker
const breaker = new CircuitBreaker({ name: 'payments', failureThreshold: 5 });
const data = await breaker.execute(() => fetch('/api/pay'));

// Bulkhead (max 5 concurrent)
const bulkhead = new Bulkhead({ name: 'scraper', maxConcurrent: 5 });
const page = await bulkhead.execute(() => scrape(url));

// Full orchestrator (all combined)
const orchestrator = new RetryOrchestrator({
  name: 'critical-api',
  timeoutMs: 30000,
  backoff: { maxRetries: 5, initialMs: 1000, maxMs: 30000 },
  circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 60000 },
  bulkhead: { maxConcurrent: 10 },
  fallback: (err) => ({ cached: true, error: err.message }),
});
const data = await orchestrator.execute(() => fetch('/api/data'));
```

## CLI

```bash
# Run with retry
node cli.mjs retry "curl -s https://httpbin.org/get" --max-retries 5 --timeout-ms 5000

# Circuit breaker demo
node cli.mjs breaker create --name api --threshold 3
node cli.mjs breaker execute --name api --success false
node cli.mjs breaker status --name api
node cli.mjs breaker reset --name api

# Bulkhead
node cli.mjs bulkhead create --name workers --max 5
node cli.mjs bulkhead status --name workers

# Interactive demo
node cli.mjs demo

# Start dashboard
node cli.mjs serve   # → http://localhost:3103

# Start MCP server
node cli.mjs mcp     # → http://localhost:3104
```

## HTTP Dashboard

Start with `node server.mjs` and visit `http://localhost:3103/dashboard`.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Full status of all components |
| POST | `/api/breaker` | Create circuit breaker |
| GET | `/api/breaker/:name` | Get breaker stats |
| POST | `/api/breaker/:name/reset` | Reset breaker |
| POST | `/api/breaker/:name/open` | Force open |
| POST | `/api/breaker/:name/close` | Force close |
| POST | `/api/bulkhead` | Create bulkhead |
| GET | `/api/bulkhead/:name` | Get bulkhead stats |
| GET | `/api/health` | Run all health checks |

## MCP Server

Start with `node mcp-server.mjs`. Provides 12 tools:

| Tool | Description |
|------|-------------|
| `retry_execute` | Execute with retry + backoff |
| `circuit_breaker_create` | Create named breaker |
| `circuit_breaker_execute` | Execute through breaker |
| `circuit_breaker_status` | Get breaker stats |
| `circuit_breaker_reset` | Reset breaker |
| `bulkhead_create` | Create named bulkhead |
| `bulkhead_status` | Get bulkhead stats |
| `orchestrator_create` | Create full orchestrator |
| `orchestrator_execute` | Execute through orchestrator |
| `orchestrator_status` | Get orchestrator stats |
| `health_register` | Register health check |
| `health_status` | Run all checks |

## API Reference

### `ExponentialBackoff`

```js
const bo = new ExponentialBackoff({
  initialMs: 200,     // Starting delay
  maxMs: 30000,       // Max delay cap
  multiplier: 2,      // Exponential multiplier
  jitterFactor: 0.25, // ±25% jitter
  maxRetries: 10,     // Max attempts
});

for await (const delay of bo.delays()) {
  await sleep(delay);
  // try operation...
}

bo.reset();      // Reset attempt counter
bo.exhausted;    // true when maxRetries reached
```

### `CircuitBreaker`

```js
const cb = new CircuitBreaker({
  name: 'api',
  failureThreshold: 5,     // Opens after N failures
  resetTimeoutMs: 30000,   // Time before half-open
  halfOpenMaxAttempts: 1,  // Test requests in half-open
  isFailure: (err) => true // Filter which errors count
});

cb.state;          // 'closed' | 'open' | 'half_open'
cb.canExecute();   // Whether requests are allowed
cb.execute(fn);    // Run through breaker
cb.forceOpen();    // Manual control
cb.forceClose();
cb.reset();
cb.stats;          // Full statistics
```

### `Bulkhead`

```js
const bh = new Bulkhead({
  name: 'workers',
  maxConcurrent: 10,  // Max parallel executions
  maxQueued: 100,     // Max waiting in queue
  timeoutMs: 30000,   // Queue timeout
});

await bh.execute(fn);           // Normal priority
await bh.execute(fn, 10);       // High priority (runs first)
bh.stats;                       // { active, queued, available, ... }
```

### `withTimeout`

```js
const result = await withTimeout(
  () => fetch('https://slow-api.com'),
  5000,           // Timeout ms
  'Custom error'  // Optional error message
);
```

### `retry()`

```js
const result = await retry(fn, {
  maxRetries: 5,
  initialMs: 200,
  maxMs: 30000,
  timeoutMs: 10000,           // Per-attempt timeout
  isRetryable: (err) => true, // Filter retryable errors
  onRetry: ({ attempt, delay, error }) => {},
});
```

### `RetryOrchestrator`

```js
const orch = new RetryOrchestrator({
  name: 'my-service',
  timeoutMs: 30000,
  backoff: { maxRetries: 5, initialMs: 500 },
  circuitBreaker: { failureThreshold: 3 },
  bulkhead: { maxConcurrent: 10 },
  fallback: (err) => defaultResponse,
  isRetryable: (err) => err.code !== 'AUTH_FAILED',
});

const result = await orch.execute(() => callApi());
```

### `HealthChecker`

```js
const hc = new HealthChecker({ intervalMs: 30000 });
hc.register('db', () => pingDb(), { critical: true, timeoutMs: 5000 });
hc.register('cache', () => pingRedis());

await hc.runAll();       // Run all checks
hc.status;               // { healthy, checks: { ... } }
hc.start();              // Auto-run on interval
hc.stop();
```

## Tests

```bash
node test.mjs
# 50 tests, all passing ✅
```

## License

MIT
