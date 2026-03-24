# agent-events v1.0

Zero-dependency **event sourcing & saga engine** for AI agents. Append-only event store, aggregate roots, projections (materialized views), sagas with compensation, event versioning/upcasting, CQRS read models, and temporal queries.

## Features

- **Event Store** — Append-only event log per stream, global sequence numbers, stream listing, deletion
- **Aggregate Roots** — Build state from event streams with reducers, snapshot fast-rebuild
- **Projections** — Materialized views that rebuild from events, auto-updating, resettable
- **Sagas** — Multi-step workflows with automatic compensation on failure (backward rollback)
- **Event Upcasting** — Schema version migration (v1 → v2 → vN) with registered transform functions
- **CQRS Read Models** — Separate read side with query interface
- **Correlation/Causation** — Track related events across streams
- **Subscriptions** — Pattern-matching subscriptions (`Order.*`, exact type, wildcard `*`)
- **Temporal Queries** — Get state/events at a specific timestamp
- **Persistence** — JSONL event logs + JSON snapshots, survives restarts
- **HTTP Dashboard** — Real-time dark-theme web UI with stats, stream browser, event table
- **MCP Server** — 12 tools via JSON-RPC stdio for agent integration
- **CLI** — Full command-line interface for scripting and automation

## Quick Start

```javascript
import { EventStore, SagaEngine, ProjectionEngine } from './index.mjs';

// Create store
const store = new EventStore({ dir: '.my-events' });

// Append events
store.append('order-1', 'OrderCreated', { items: ['widget'], total: 100 });
store.append('order-1', 'OrderPaid', { amount: 100 });
store.append('order-1', 'OrderShipped', { tracking: 'UPS-123' });

// Read stream
const events = store.getStream('order-1');

// Aggregate state with reducer
const state = store.getAggregateState('order-1', (state, event) => {
  if (event.type === 'OrderCreated') return { ...state, status: 'created' };
  if (event.type === 'OrderPaid') return { ...state, status: 'paid' };
  if (event.type === 'OrderShipped') return { ...state, status: 'shipped' };
  return state;
}, {});

// Projections
const proj = new ProjectionEngine(store);
proj.define('revenue', { total: 0 }, {
  'OrderPaid': (s, e) => ({ total: s.total + e.payload.amount })
});
console.log(proj.getState('revenue')); // { total: 100 }

// Saga with compensation
const saga = new SagaEngine(store);
saga.define('checkout', {
  steps: [
    { id: 'validate', action: async () => ({ valid: true }) },
    { id: 'charge', action: async () => ({ charged: true }),
      compensate: async () => console.log('Refunded!') },
    { id: 'ship', action: async () => ({ shipped: true }) }
  ]
});
const instance = await saga.start('checkout', { orderId: 'o1' });
// If 'charge' fails → 'validate' compensation runs
```

## CLI

```bash
# Append event
node cli.mjs append order-1 OrderCreated '{"items":["widget"],"total":100}'

# Read stream
node cli.mjs get order-1

# All events
node cli.mjs all

# By type
node cli.mjs by-type OrderCreated

# By correlation
node cli.mjs by-correlation corr-123

# Snapshots
node cli.mjs snapshot agg-1 '{"value":42}' 5
node cli.mjs get-snapshot agg-1

# Streams & stats
node cli.mjs streams
node cli.mjs stats

# Delete stream
node cli.mjs delete-stream temp-stream

# HTTP dashboard
node cli.mjs serve --port 3131

# MCP server
node cli.mjs mcp

# Demo
node cli.mjs demo
```

## HTTP API

```
GET  /api/stats          → { streams, totalEvents, snapshots, subscriptions, byType }
GET  /api/streams         → ["stream-1", "stream-2", ...]
GET  /api/stream/:id      → [{ event }, ...]
GET  /api/events          → [{ event }, ...] (all events, sorted by seq)
POST /api/append          → { streamId, eventType, payload, correlationId? }
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `events_append` | Append event to stream |
| `events_get_stream` | Get events from a stream |
| `events_get_all` | Get all events across streams |
| `events_by_type` | Get events by type |
| `events_by_correlation` | Get events by correlation ID |
| `events_snapshot` | Save aggregate snapshot |
| `events_get_snapshot` | Get aggregate snapshot |
| `events_projection_define` | Define a projection |
| `events_projection_state` | Get projection state |
| `events_saga_define` | Define a saga |
| `events_saga_start` | Start a saga instance |
| `events_stats` | Get event store statistics |
| `events_streams` | List all streams |

## Concepts

### Event Sourcing
Instead of storing current state, store the sequence of events that led to it. Rebuild state by replaying events.

### Aggregate Root
A domain object that owns a stream of events. Apply events to build state incrementally. Save snapshots to avoid replaying entire history.

### Projections (Materialized Views)
Read models built from event streams. Subscribe to event types, transform state. Multiple projections can read the same events for different purposes.

### Sagas
Long-running processes across multiple steps. Each step has an action and optional compensation function. If any step fails, completed steps are compensated in reverse order.

### Event Upcasting
When event schemas change, register upcaster functions to transform old events to new format. Run `upcaster.upcast(event)` to get the latest version.

## Tests

```bash
node test.mjs
```

48 tests covering all components.

## License

MIT
