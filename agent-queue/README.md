# agent-queue 📨

Zero-dependency message queue for AI agents. Topic-based pub/sub with wildcards, priority messages, consumer groups, dead-letter queue, request-reply, and persistence.

## Features

- **Topic-based pub/sub** with wildcard patterns (`foo.*`, `foo.bar.**`)
- **At-least-once delivery** with explicit ack/nack
- **Priority messages** (low/normal/high/critical) — higher priority delivered first
- **Consumer groups** — round-robin distribution across subscribers
- **Dead-letter queue** — failed messages after max retries, with replay support
- **Message TTL** — auto-expiry of stale messages
- **Request-reply** — built-in correlation and timeout
- **Backpressure** — configurable queue depth with automatic eviction
- **Persistence** — JSONL event log + snapshots for crash recovery
- **SSE streaming** — real-time event feed for dashboards
- **EventEmitter** — published, acked, nacked, dead_lettered, expired events
- **Zero dependencies** — no npm packages required

## Quick Start

```js
import { AgentQueue } from './index.mjs';

const q = new AgentQueue({ dataDir: './queue-data' });

// Subscribe with wildcards
q.subscribe('orders.*', (msg, { ack, nack }) => {
  console.log(msg.topic, msg.payload);
  ack(); // or nack({ requeue: true })
});

// Publish
q.publish('orders.new', { id: '001', item: 'widget' });
q.publish('orders.shipped', { tracking: 'TRK-123' }, { priority: 'high' });
```

## API

### `new AgentQueue(config)`

| Option | Default | Description |
|--------|---------|-------------|
| `maxDepth` | 10000 | Max messages before backpressure eviction |
| `defaultTTL` | 0 | Default TTL in ms (0 = no expiry) |
| `maxRetries` | 3 | Max redeliveries before dead-letter |
| `retryDelay` | 1000 | Base retry delay (exponential backoff) |
| `ackTimeout` | 30000 | Auto-nack after ms without ack |
| `dataDir` | `./.agent-queue-data` | Persistence directory |

### Publishing

```js
q.publish(topic, payload, options?)
// options: priority, ttl, headers, correlationId, replyTo

// Request-reply
const reply = await q.request('echo', 'hello', { timeout: 5000 });

// Reply to a request
q.subscribe('echo', (msg, { ack }) => {
  q.reply(msg, { result: msg.payload });
  ack();
});
```

### Subscribing

```js
const subId = q.subscribe(pattern, handler, options?)
// options: group, maxInflight, filter

// Consumer group (round-robin)
q.subscribeGroup('workers', 'tasks.*', handler);

// Ack/Nack
q.subscribe('topic', (msg, { ack, nack }) => {
  if (processOk(msg)) ack();
  else nack({ requeue: true, reason: 'processing failed' });
});
```

### Queries

```js
q.getMessages(topic, { since, limit, includeAcked })
q.getTopics()       // [{ topic, pending, total, lastPublished }]
q.getSubscribers()  // [{ id, pattern, group, inflight, acked }]
q.getDeadLetter()   // failed messages
q.stats             // { published, delivered, acked, nacked, ... }
```

### Dead Letter

```js
q.getDeadLetter({ limit })
q.replayDeadLetter(msgId)  // re-inject into queue
```

### Maintenance

```js
q.purge('topic')    // purge specific topic
q.purge()           // purge all
q.snapshot()        // force persistence snapshot
q.destroy()         // cleanup timers + snapshot
```

## MCP Server

```bash
node mcp-server.mjs
```

**Tools:** `queue_publish`, `queue_subscribe`, `queue_ack`, `queue_nack`, `queue_request`, `queue_messages`, `queue_topics`, `queue_subscribers`, `queue_dead_letter`, `queue_purge`, `queue_snapshot`, `queue_stats`

## HTTP Server

```bash
node server.mjs  # http://localhost:3116
```

**Endpoints:**
- `POST /publish` — Publish message
- `POST /subscribe` — Subscribe to pattern
- `POST /ack`, `POST /nack` — Ack/Nack
- `POST /request` — Request-reply
- `GET /messages/:topic` — Query messages
- `GET /topics`, `GET /subscribers` — List
- `GET /dead-letter` — Dead letter queue
- `POST /purge` — Purge
- `GET /stats` — Statistics
- `GET /sse` — Server-Sent Events stream
- `GET /` — Web dashboard

## CLI

```bash
node cli.mjs publish orders.new '{"id":"001"}'
node cli.mjs subscribe 'orders.*'
node cli.mjs topics
node cli.mjs messages orders.new
node cli.mjs dead-letter
node cli.mjs replay orders.new
node cli.mjs purge orders.new
node cli.mjs stats
node cli.mjs demo
node cli.mjs serve    # HTTP server
node cli.mjs mcp      # MCP server
```

## Topic Patterns

| Pattern | Matches |
|---------|---------|
| `orders.new` | Exact match |
| `orders.*` | Single segment wildcard |
| `orders.**` | Multi-segment wildcard |
| `*.alerts.*` | Mixed wildcards |

## Tests

```bash
node test.mjs  # 62 tests
```

## License

MIT
