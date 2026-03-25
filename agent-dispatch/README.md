# 🐋 agent-dispatch

Zero-dependency smart event dispatcher & message router for AI agents.

## Features

- **Content-based routing** — match messages by type, field values, regex, glob, custom functions
- **5 routing strategies** — first-match, all-match, best-match, weighted, round-robin
- **Priority queues** — 4 levels (critical/high/normal/low) with FIFO per level
- **Fan-out / Fan-in** — send 1→N or collect N→1
- **Transform pipelines** — set/delete/rename/copy/template/filter/map per route
- **Filter engine** — $eq/$ne/$gt/$lt/$in/$regex/$exists/$and/$or/$not/$between/$type/$custom
- **Dead letter queue** — failed messages stored with retry support
- **Rate limiting** — per-route sliding window
- **Middleware** — before/after/error hooks
- **Message classification** — auto-tag messages by rules
- **Retry** — exponential backoff per route
- **Persistence** — JSONL event log + snapshots
- **HTTP dashboard** — real-time web UI on port 3142
- **MCP server** — 12 tools via JSON-RPC stdio
- **CLI** — full command-line interface

## Quick Start

```js
import { Dispatcher } from './index.mjs';

const d = new Dispatcher();

// Add routes
d.addRoute({
  name: 'order-handler',
  pattern: { type: 'prefix', field: 'type', value: 'order.' },
  handler: (msg) => console.log('Order:', msg),
});

d.addRoute({
  name: 'critical-alerts',
  pattern: { type: 'exact', field: 'severity', value: 'critical' },
  priority: 'high',
  handler: (msg) => sendAlert(msg),
});

// Submit messages
await d.submit({ type: 'order.created', orderId: '123' });
await d.submit({ type: 'system.alert', severity: 'critical' });
```

## Pattern Types

```js
{ type: 'exact', field: 'type', value: 'order.created' }
{ type: 'contains', field: 'type', value: 'order' }
{ type: 'prefix', field: 'type', value: 'order.' }
{ type: 'suffix', field: 'type', value: '.created' }
{ type: 'regex', field: 'type', value: '^order\\.\\d+$' }
{ type: 'glob', field: 'type', value: 'order.*' }
{ type: 'in', field: 'type', values: ['a', 'b', 'c'] }
{ type: 'range', field: 'amount', min: 100, max: 1000 }
{ type: 'custom', value: (msg) => msg.amount > 100 }
(msg) => msg.type === 'test'  // bare function
null  // matches everything
```

## Filter Engine

```js
d.addRoute({
  name: 'high-value-orders',
  pattern: { type: 'prefix', field: 'type', value: 'order.' },
  filters: [
    { amount: { $gt: 100 } },
    { $or: [{ currency: 'USD' }, { currency: 'EUR' }] },
  ],
  handler: (msg) => processOrder(msg),
});
```

## Transforms

```js
d.addRoute({
  name: 'enricher',
  pattern: null,
  transforms: [
    { op: 'set', field: 'processed', value: true },
    { op: 'uppercase', field: 'name' },
    { op: 'set', field: 'label', template: '{{name}} - {{type}}' },
    { op: 'rename', field: 'old_key', value: 'new_key' },
    { op: 'delete', field: 'internal' },
    { op: 'default', field: 'locale', value: 'en' },
  ],
  handler: (msg) => forward(msg),
});
```

## CLI

```bash
# Submit a message
node cli.mjs submit '{"type":"order.created"}'

# Add routes
node cli.mjs add-route 'orders' '{"type":"prefix","field":"type","value":"order."}'

# List routes
node cli.mjs list-routes

# Test pattern matching
node cli.mjs match '{"type":"order.created"}' '{"type":"prefix","field":"type","value":"order."}'

# Run demo
node cli.mjs demo

# Start HTTP server
node cli.mjs serve

# Start MCP server
node cli.mjs mcp
```

## HTTP API

```bash
# Submit message
curl -X POST http://localhost:3142/api/submit -d '{"message":{"type":"order.created"}}'

# Add route
curl -X POST http://localhost:3142/api/routes -d '{"name":"orders","pattern":{"type":"prefix","field":"type","value":"order."}}'

# List routes
curl http://localhost:3142/api/routes

# Fan-out
curl -X POST http://localhost:3142/api/fan-out -d '{"message":{"type":"test"},"routeIds":["id1","id2"]}'

# Stats
curl http://localhost:3142/api/stats

# DLQ
curl http://localhost:3142/api/dlq
curl -X POST http://localhost:3142/api/dlq/retry
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `dispatch_submit` | Submit a message for dispatch |
| `dispatch_add_route` | Add a routing rule |
| `dispatch_remove_route` | Remove a route |
| `dispatch_list_routes` | List all routes with stats |
| `dispatch_enable_route` | Enable a route |
| `dispatch_disable_route` | Disable a route |
| `dispatch_fan_out` | Send to multiple routes |
| `dispatch_process_queue` | Process queued messages |
| `dispatch_dlq_retry` | Retry DLQ entries |
| `dispatch_dlq_list` | List DLQ entries |
| `dispatch_history` | Get dispatch history |
| `dispatch_stats` | Get stats and info |

## License

MIT
