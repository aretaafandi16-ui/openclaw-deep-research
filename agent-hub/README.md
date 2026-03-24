# agent-hub v1.0

Zero-dependency capability registry & service mesh for AI agents.

Agents register their skills. Other agents discover and route tasks to the best match. Health checking, circuit breaking, load balancing — all built in.

## Features

- **Agent Registration** — register with capabilities, tags, metadata, version, endpoint
- **Capability Discovery** — find agents by capability + tag/metadata/version/status filtering
- **Task Routing** — 5 strategies: round-robin, random, least-loaded, weighted, best-match
- **Health Checking** — heartbeat tracking, auto-deregister stale agents
- **Circuit Breaking** — per-agent circuit breaker (closed → open → half-open → closed)
- **Named Routes** — reusable route configs with fallback capability
- **Groups/Namespaces** — multi-tenant agent isolation
- **Capability Versioning** — semver-compatible version matching
- **SSE Events** — real-time event stream for dashboards
- **HTTP API** — full REST API + dark-theme web dashboard
- **MCP Server** — 12 tools via JSON-RPC stdio
- **CLI** — full command-line interface
- **Persistence** — JSONL event log + periodic snapshots

## Quick Start

```js
import { AgentHub } from './index.mjs';

const hub = new AgentHub();

// Register agents
hub.register({ name: 'translator-es', capabilities: ['translate'], tags: ['spanish', 'fast'] });
hub.register({ name: 'translator-fr', capabilities: ['translate'], tags: ['french'] });
hub.register({ name: 'coder', capabilities: ['code'], tags: ['python', 'fast'] });

// Discover
const translators = hub.discover({ capability: 'translate', tags: ['fast'] });

// Route a task
const agent = hub.route('translate', { strategy: 'least_loaded' });
console.log(`Routed to: ${agent.name}`);

// Complete the task
hub.routeComplete(agent.routeId, { success: true, latencyMs: 150 });
```

## Routing Strategies

| Strategy | Description |
|----------|-------------|
| `round_robin` | Cycle through agents evenly |
| `random` | Random selection |
| `least_loaded` | Pick agent with lowest current load |
| `weighted` | Weighted random (metadata.weight) |
| `best_match` | Score-based: load, success rate, latency, tag matches |

## Discovery Filters

```js
hub.discover({
  capability: 'translate',      // required capability
  group: 'production',          // namespace/group
  tags: ['fast', 'premium'],    // must have ALL tags
  version: '^1.0.0',           // semver range
  status: 'online',            // agent status
  metadata: { quality: { $gte: 8 } },  // metadata filter
  sort: 'load',                // sort: load, success_rate, latency
  limit: 5,                    // max results
});
```

## Metadata Filters

`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$contains`

## Circuit Breaker

After N consecutive failures (default: 5), the agent's circuit opens and routing skips it. After 60s, it transitions to half-open for one test request. On success, circuit closes.

```js
// Check circuit status
hub.getCircuitStatus(agentId); // { failures: 0, state: 'closed', lastFailure: 0 }

// Listen for circuit events
hub.on('circuit:open', ({ agentId }) => console.log(`Circuit open: ${agentId}`));
```

## Named Routes

```js
hub.addRoute('translation', {
  capability: 'translate',
  strategy: 'best_match',
  fallback: 'general-translate',  // fallback capability if no candidates
  tags: ['fast'],
});

// Execute route
const agent = hub.executeRoute('translation');
```

## Health Checking

Agents must send heartbeats. If no heartbeat within timeout (default: 90s), agent is auto-deregistered or marked offline.

```js
hub.heartbeat(agentId, { load: 3, status: 'online' });
```

## HTTP API

```bash
node server.mjs  # http://localhost:3136
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | Discover agents (?capability=&tags=&group=) |
| `/api/agents` | POST | Register agent |
| `/api/agents/:id` | GET | Get agent details |
| `/api/agents/:id` | DELETE | Unregister agent |
| `/api/route` | POST | Route task to agent |
| `/api/route/complete` | POST | Mark route complete |
| `/api/heartbeat` | POST | Send heartbeat |
| `/api/routes` | GET/POST | List/add named routes |
| `/api/routes/:name` | DELETE | Remove named route |
| `/api/capabilities` | GET | List capabilities |
| `/api/groups` | GET | List groups |
| `/api/stats` | GET | Hub statistics |
| `/api/circuit` | GET | Circuit breaker status |
| `/api/history` | GET | Recent routing decisions |
| `/events` | GET | SSE event stream |

## MCP Server

```bash
node mcp-server.mjs  # JSON-RPC stdio
```

12 tools: `hub_register`, `hub_unregister`, `hub_heartbeat`, `hub_discover`, `hub_route`, `hub_route_complete`, `hub_add_route`, `hub_remove_route`, `hub_execute_route`, `hub_list_capabilities`, `hub_stats`, `hub_agents`

## CLI

```bash
# Register
node cli.mjs register --name my-agent --caps "translate,summarize" --tags "fast,premium" --version 1.0.0

# Discover
node cli.mjs discover --capability translate --tags fast --sort load

# Route
node cli.mjs route --capability translate --strategy best_match

# List
node cli.mjs agents
node cli.mjs capabilities
node cli.mjs stats

# Named routes
node cli.mjs add-route --name my-route --capability translate --strategy round_robin
node cli.mjs execute-route --name my-route

# Server
node cli.mjs serve    # HTTP on :3136
node cli.mjs mcp      # MCP stdio

# Demo
node cli.mjs demo
```

## Events

```js
hub.on('agent:registered', (agent) => { ... });
hub.on('agent:unregistered', (agent) => { ... });
hub.on('agent:heartbeat', ({ id, load }) => { ... });
hub.on('agent:stale', ({ id, reason }) => { ... });
hub.on('route:selected', (decision) => { ... });
hub.on('route:completed', (decision) => { ... });
hub.on('route:failed', ({ capability, reason }) => { ... });
hub.on('circuit:open', ({ agentId, failures }) => { ... });
hub.on('circuit:closed', ({ agentId }) => { ... });
```

## License

MIT
