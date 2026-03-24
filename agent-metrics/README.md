# agent-metrics

Zero-dependency metrics collection & performance monitoring for AI agents.

## Features

- **Counter** — monotonically increasing values (requests, errors, events)
- **Gauge** — values that go up and down (connections, memory, temperature)
- **Histogram** — distributions with configurable buckets (latency, sizes)
- **Timer** — automatic duration tracking with start/stop API
- **Sliding Window Rate Counter** — per-second rates over configurable windows
- **Percentile calculations** — P50, P90, P95, P99 with custom aggregation
- **Tagged metrics** — dimensional metrics with tag-based querying
- **Prometheus export** — `/api/prometheus` endpoint for scraping
- **HTTP Dashboard** — real-time web UI with auto-refresh
- **MCP Server** — 10 tools via JSON-RPC stdio
- **CLI** — full command-line interface
- **JSONL persistence** — survives restarts
- **EventEmitter** — programmetric event integration

## Quick Start

```js
import { MetricsStore } from './index.mjs';

const store = new MetricsStore();

// Counter
store.counter('http_requests_total', { method: 'GET' }).inc();
store.counter('http_requests_total', { method: 'POST' }).inc(3);

// Gauge
store.gauge('active_connections').set(42);
store.gauge('memory_mb').inc(128);

// Histogram
store.histogram('response_time_ms').observe(45);
store.histogram('response_time_ms').observe(120);

// Timer
const t = store.timer('db_query');
const r = t.start();
// ... do work ...
r.stop(); // records duration automatically

// Stats
console.log(store.histogram('response_time_ms').stats());
// → { count: 2, mean: 82.5, p50: 45, p90: 120, p95: 120, p99: 120 }

// Prometheus export
console.log(store.prometheus());
```

## HTTP Server

```bash
node server.mjs          # starts on :3114
PORT=8080 node server.mjs  # custom port
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard` | GET | Web UI |
| `/api/snapshot` | GET | Full metrics snapshot (JSON) |
| `/api/list` | GET | List all metrics |
| `/api/prometheus` | GET | Prometheus text format |
| `/api/record` | POST | Record a metric `{type, name, value, tags}` |
| `/api/reset` | POST | Clear all metrics |

### Record API

```bash
curl -X POST http://localhost:3114/api/record \
  -H 'Content-Type: application/json' \
  -d '{"type":"counter","name":"api_calls","value":1,"tags":{"endpoint":"/users"}}'
```

## MCP Server

```bash
node mcp-server.mjs    # JSON-RPC stdio
```

### Tools

| Tool | Description |
|------|-------------|
| `metrics_counter` | Increment/decrement a counter |
| `metrics_gauge` | Set/increment/decrement a gauge |
| `metrics_histogram` | Record histogram observation |
| `metrics_timer` | Record timing value in ms |
| `metrics_snapshot` | Full metrics snapshot |
| `metrics_list` | List all metrics |
| `metrics_prometheus` | Export Prometheus format |
| `metrics_get` | Get specific metric |
| `metrics_reset` | Clear all metrics |
| `metrics_stats` | Get histogram/timer stats |

## CLI

```bash
# Record metrics
node cli.mjs counter http_requests --value 5 --tags method=GET
node cli.mjs gauge memory_mb --value 256
node cli.mjs histogram latency_ms 45
node cli.mjs timer db_query 23

# Query
node cli.mjs list
node cli.mjs get "http_requests{method=GET}"
node cli.mjs stats latency_ms
node cli.mjs snapshot
node cli.mjs prometheus

# Server
node cli.mjs serve --port 3114
node cli.mjs mcp
node cli.mjs demo
```

## API Reference

### MetricsStore

```js
const store = new MetricsStore({
  persistDir: './data',      // optional: auto-persist to JSON
  persistInterval: 30000,    // persist every 30s
  rateWindowMs: 60000,       // sliding window for rates
});
```

**Methods:**
- `counter(name, tags?)` → Counter
- `gauge(name, tags?)` → Gauge
- `histogram(name, tags?, opts?)` → Histogram
- `timer(name, tags?)` → Timer
- `rate(name, tags?)` → SlidingWindowCounter
- `get(name)` → metric or null
- `has(name)` → boolean
- `list()` → array of metric JSONs
- `snapshot()` → full state object
- `prometheus()` → Prometheus text
- `clear()` → void
- `close()` → void (persist + cleanup)
- `time(name, asyncFn, tags?)` → auto-timed execution

### Counter

- `inc(n = 1)` → value
- `dec(n = 1)` → value
- `reset()`
- `.value` → current value

### Gauge

- `set(v)` → void
- `inc(n = 1)` → void
- `dec(n = 1)` → void
- `.value` → current value

### Histogram

- `observe(v)` → void
- `.count`, `.sum`, `.min`, `.max`
- `stats()` → `{count, sum, min, max, mean, stddev, p50, p90, p95, p99}`
- `buckets()` → `[{le, count}, ...]`

### Timer

- `start()` → `{stop() → durationMs}`
- `record(ms)` → void
- `.count` → total recordings
- `stats()` → histogram stats
