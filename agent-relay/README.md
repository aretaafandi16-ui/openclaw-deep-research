# agent-relay

Zero-dependency cross-agent pub/sub messaging for AI agents.

## Features

- **Pub/Sub** — topic-based messaging with wildcard patterns (`topic/*`, `*/event`)
- **Direct Messaging** — point-to-point between named agents
- **Broadcast** — send to all connected agents at once
- **Request/Reply** — RPC-style with timeout and correlation IDs
- **Message Queues** — priority FIFO with retry and dead letter queue
- **Routes** — custom topic pattern handlers
- **Replay** — deliver historical messages to late subscribers
- **SSE** — real-time event streaming via Server-Sent Events
- **Dedup** — automatic message deduplication per agent
- **JSONL persistence** — optional event log for durability
- **HTTP Server** — dark-theme web dashboard + REST API
- **MCP Server** — 12 tools for AI agent integration
- **CLI** — full command-line interface

## Quick Start

```js
import { AgentRelay } from './index.mjs';

const relay = new AgentRelay();

// Register agents
relay.registerAgent('coordinator', { role: 'orchestrator' });
relay.registerAgent('worker-1', { role: 'compute' });
relay.registerAgent('worker-2', { role: 'storage' });

// Subscribe to topics
relay.subscribe('worker-1', 'tasks/*');
relay.subscribe('worker-2', 'tasks/*');
relay.subscribe('coordinator', 'results');

// Publish
relay.publish('tasks/compute', { jobId: 'j1', data: [1,2,3] }, 'coordinator');

// Direct messaging
relay.send('worker-1', { instruction: 'process batch' }, 'coordinator');

// Broadcast
relay.broadcast({ alert: 'maintenance in 5 min' });

// Request/Reply
const result = await relay.request('worker-1', { query: 'status' }, 'coordinator', { timeout: 5000 });
console.log(result.payload); // { status: 'idle' }

// Message queue
relay.enqueue('work-queue', { job: 'transform' }, { priority: 10 });
const item = relay.dequeue('work-queue');
```

## API

### Agent Management
- `relay.registerAgent(id, metadata)` — register an agent
- `relay.unregisterAgent(id)` — mark agent disconnected
- `relay.listAgents(connectedOnly)` — list all agents
- `relay.getAgent(id)` — get agent details

### Pub/Sub
- `relay.subscribe(agentId, topic)` — subscribe (supports `*` wildcards)
- `relay.unsubscribe(agentId, topic)` — unsubscribe
- `relay.publish(topic, payload, from, opts)` — publish message

### Direct Messaging
- `relay.send(toAgentId, payload, from, opts)` — direct message

### Broadcast
- `relay.broadcast(payload, from, opts)` — send to all agents

### Request/Reply
- `relay.request(toAgentId, payload, from, { timeout })` — RPC call
- `relay.reply(correlationId, payload, from)` — send reply

### Queues
- `relay.enqueue(queueName, payload, opts)` — add to priority queue
- `relay.dequeue(queueName)` — get next item
- `relay.requeue(queueName, entry, delayMs)` — retry with backoff
- `relay.queueStats(queueName)` — queue statistics

### Routes
- `relay.addRoute(pattern, handler, name)` — add custom route
- `relay.removeRoute(name)` — remove route

### History
- `relay.getHistory({ topic, from, type, limit, since })` — filter messages
- `relay.replay(agentId, topic, since)` — deliver historical messages

### Other
- `relay.drain(agentId, limit)` — get queued messages
- `relay.stats()` — full statistics

## HTTP Server

```bash
node server.mjs  # starts on :3125
```

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Relay statistics |
| POST | `/api/agents/register` | Register agent |
| POST | `/api/agents/unregister` | Unregister agent |
| GET | `/api/agents` | List agents |
| POST | `/api/subscribe` | Subscribe to topic |
| POST | `/api/unsubscribe` | Unsubscribe |
| POST | `/api/publish` | Publish message |
| POST | `/api/send` | Direct message |
| POST | `/api/broadcast` | Broadcast |
| POST | `/api/request` | Request/reply |
| POST | `/api/reply` | Send reply |
| POST | `/api/queue/enqueue` | Enqueue message |
| GET | `/api/queue/dequeue` | Dequeue message |
| GET | `/api/history` | Message history |
| GET | `/api/dlq` | Dead letter queue |
| GET | `/api/queues` | Queue stats |
| GET | `/api/subscriptions` | All subscriptions |
| GET | `/api/_watch` | SSE live stream |

## MCP Server

```bash
node mcp-server.mjs  # JSON-RPC stdio
```

### Tools

| Tool | Description |
|------|-------------|
| `relay_register` | Register an agent |
| `relay_unregister` | Unregister an agent |
| `relay_subscribe` | Subscribe to topic |
| `relay_unsubscribe` | Unsubscribe from topic |
| `relay_publish` | Publish message to topic |
| `relay_send` | Direct message to agent |
| `relay_broadcast` | Broadcast to all agents |
| `relay_request` | Request-reply with timeout |
| `relay_drain` | Drain queued messages |
| `relay_history` | Get message history |
| `relay_stats` | Get statistics |
| `relay_agents` | List registered agents |

## CLI

```bash
node cli.mjs register my-agent --meta '{"role":"worker"}'
node cli.mjs subscribe my-agent "events/*"
node cli.mjs publish events/update '{"data":123}' --from my-agent
node cli.mjs send target-agent '{"hello":"world"}'
node cli.mjs broadcast '{"notice":"hello all"}'
node cli.mjs drain my-agent --limit 10
node cli.mjs history --topic events --limit 50
node cli.mjs agents
node cli.mjs stats
node cli.mjs demo
node cli.mjs serve --port 3125
node cli.mjs mcp
```

## Tests

```bash
node test.mjs
```

## License

MIT
