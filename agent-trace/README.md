# agent-trace 🐋

Zero-dependency distributed tracing & observability for AI agents.

Track LLM calls, tool executions, agent decisions, and errors. Timeline view, span trees, performance metrics, and search — all with zero external dependencies.

## Features

- **Span-based tracing** — nested spans with parent-child relationships
- **Typed spans** — `llm`, `tool`, `decision`, `span`, `error`, `custom`
- **Span events** — attach timestamped events to active spans
- **Error recording** — fatal/non-fatal errors with stack traces
- **Trace trees** — build hierarchical span trees per trace
- **Timeline view** — text-based timeline visualization
- **Performance stats** — avg, min, max, P50, P90, P99, error rate, per-type breakdown
- **Query engine** — filter by type, service, status, name, tags, date range, duration
- **Async helpers** — `trace()`, `traceLLM()`, `traceTool()` for easy wrapping
- **JSONL persistence** — survives restarts, append-only log
- **HTTP dashboard** — dark-theme web UI with real-time updates
- **MCP server** — 12 tools via Model Context Protocol
- **CLI** — full command-line interface
- **EventEmitter** — real-time span lifecycle events
- **Zero dependencies** — pure Node.js, no npm install needed

## Quick Start

```bash
# Run demo
node index.mjs demo

# Start dashboard
node index.mjs serve --port=3105

# List recent spans
node cli.mjs list --limit=20

# Show trace timeline
node cli.mjs trace --id=<traceId>

# Performance stats
node cli.mjs perf

# Run tests
node test.mjs
```

## Library API

```javascript
import { TraceStore } from './index.mjs';

const store = new TraceStore({ dir: './data', persist: true });

// Start a span
const span = store.startSpan('my-operation', {
  type: 'tool',
  service: 'trading-bot',
  attributes: { symbol: 'BTC' },
  tags: ['important'],
});

// ... do work ...

// End the span
store.endSpan(span.id, { attributes: { result: 'ok' } });

// Add event to active span
store.addEvent(span.id, 'order_placed', { orderId: 'abc123' });

// Record error
store.recordError(span.id, new Error('API timeout'), true); // true = fatal

// Async tracing
const result = await store.trace('llm:call', async (span) => {
  const response = await callLLM();
  return response;
}, { type: 'llm', attributes: { model: 'gpt-4o' } });

// Query spans
const errors = store.query({ error: true, since: Date.now() - 3600000 });
const llmSpans = store.query({ type: 'llm', limit: 100 });

// Get trace
const trace = store.getTrace(traceId);
const tree = store.buildTree(traceId);
const timeline = store.timeline(traceId);

// Performance stats
const stats = store.perfStats({ type: 'llm' });
// { count, avgDuration, p50, p90, p99, errorRate, byType }

// Events
store.on('span:start', span => console.log('Started:', span.name));
store.on('span:end', span => console.log('Ended:', span.name, span.duration + 'ms'));
store.on('span:error', ({ spanId, error }) => console.error('Error:', error.message));
```

## CLI Commands

```
serve [--port=3105]       Start HTTP dashboard
list [--type=llm] [--limit=20] [--errors] [--name=<q>] [--trace=<id>]
trace --id=<traceId>      Show timeline for a trace
perf [--type=llm]         Performance statistics
active                    List active (unfinished) spans
stats                     Store statistics
export                    Export all spans as JSONL
demo                      Run demo trace
mcp                       Start MCP server (stdio)
```

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard` | GET | Web UI |
| `/api/stats` | GET | Store statistics |
| `/api/active` | GET | Active spans |
| `/api/spans` | GET | Query spans (query params: type, service, status, name, traceId, tag, error, limit, since, minDuration) |
| `/api/traces/:id` | GET | Trace with tree and timeline |
| `/api/perf` | GET | Performance stats |
| `/api/export` | GET | Export JSONL |
| `/api/clear` | POST | Clear all data |
| `/health` | GET | Health check |

## MCP Tools (12)

| Tool | Description |
|------|-------------|
| `trace_start` | Start a new span |
| `trace_end` | End an active span |
| `trace_event` | Add event to active span |
| `trace_error` | Record error on span |
| `trace_query` | Query spans with filters |
| `trace_get` | Get all spans for a trace |
| `trace_timeline` | Get text timeline |
| `trace_tree` | Get span tree |
| `trace_perf` | Performance statistics |
| `trace_active` | List active spans |
| `trace_export` | Export as JSONL |
| `trace_stats` | Store statistics |

## Configuration

```javascript
const store = new TraceStore({
  dir: './data',       // Persistence directory (default: ./data)
  maxSpans: 10000,     // Max spans in memory (default: 10000)
  persist: true,       // JSONL persistence (default: true)
});
```

## Use Cases

- **Debug agent workflows** — see exactly which LLM calls and tool executions happened
- **Performance monitoring** — identify slow operations with P99 latency
- **Error tracking** — find which step failed and why
- **Cost analysis** — correlate LLM spans with token counts
- **Audit trail** — full timeline of agent decisions
- **A/B testing** — compare traces across different agent configurations

## License

MIT
