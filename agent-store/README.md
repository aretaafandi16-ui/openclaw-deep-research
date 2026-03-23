# agent-store 🗄️

Zero-dependency persistent key-value store for AI agents. HTTP API + MCP server + CLI.

**v1.1** — SSE watch, atomic counters, lists, sets, events.

## Why?

AI agents need persistent state. Most solutions require databases, external services, or complex setup. This is a few files, zero dependencies, works anywhere Node.js runs.

## Features

- **Namespaced storage** — separate namespaces per agent/project
- **TTL** — auto-expiring entries
- **Atomic counters** — increment/decrement with atomicity guarantee
- **Lists** — push/pop/range operations
- **Sets** — add/remove/members with uniqueness
- **SSE Watch** — real-time subscriptions to namespace changes
- **Event emitter** — programmatic change notifications
- **Pattern search** — glob-style key matching
- **Batch operations** — mget, mset, mdelete
- **Rate limiting** — per-IP configurable
- **Auto-persistence** — debounced disk writes
- **Backup/restore** — full JSON export/import
- **Web UI** — built-in dashboard

## Quick Start

```bash
# Install
npm install -g agent-store

# Start HTTP server
agent-store serve

# Or use as MCP server (for Claude, etc.)
agent-store mcp
```

## Four Ways to Use

### 1. HTTP API

```bash
# Start server
PORT=3096 node server.mjs

# Basic CRUD
curl -X PUT localhost:3096/ns/myagent/config \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","temperature":0.7}'

curl localhost:3096/ns/myagent/config

# Atomic counters
curl -X POST localhost:3096/ns/stats/api_calls/_incr \
  -H "Content-Type: application/json" -d '{"amount":1}'

# Lists
curl -X POST localhost:3096/ns/tasks/queue/_lpush \
  -H "Content-Type: application/json" -d '{"values":["task1","task2"]}'

# Sets
curl -X POST localhost:3096/ns/tags/seen/_sadd \
  -H "Content-Type: application/json" -d '{"members":["node","python"]}'

# SSE Watch (real-time subscriptions)
curl localhost:3096/ns/myagent/_watch
curl localhost:3096/ns/myagent/_watch?key=config
```

### 2. MCP Server (Model Context Protocol)

```json
{
  "mcpServers": {
    "agent-store": {
      "command": "node",
      "args": ["/path/to/agent-store/mcp-server.mjs"]
    }
  }
}
```

MCP tools: `store_get`, `store_set`, `store_delete`, `store_search`, `store_list`, `store_mget`, `store_mset`, `store_backup`, `store_stats`, `store_incr`, `store_decr`, `store_lpush`, `store_lpop`, `store_lrange`, `store_sadd`, `store_smembers`

### 3. CLI

```bash
agent-store set myns mykey '{"hello":"world"}'
agent-store get myns mykey
agent-store incr myns counter        # +1
agent-store incr myns counter 5      # +5
agent-store lpush myns list "a" "b"
agent-store watch myns               # real-time subscriptions
```

### 4. Library API

```js
import { AgentStore } from "./index.mjs";

const store = new AgentStore({ dataDir: "./data" });
await store.init();

// CRUD
await store.set("ns", "key", { hello: "world" });
const val = await store.get("ns", "key");

// Counters
await store.incr("stats", "calls", 1);
await store.decr("stats", "quota", 5);

// Lists
await store.lpush("tasks", "queue", "task1", "task2");
const task = await store.lpop("tasks", "queue");

// Sets
await store.sadd("tags", "seen", "node", "python");
const isSeen = await store.sismember("tags", "seen", "node");

// Events
store.on("change", (evt) => {
  console.log(`${evt.type}: ${evt.namespace}:${evt.key}`);
});
```

## HTTP API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + stats |
| GET | `/ns` | List namespaces |
| GET | `/ns/:ns` | List keys in namespace |
| GET | `/ns/:ns/:key` | Get value |
| PUT | `/ns/:ns/:key` | Set value (JSON body) |
| DELETE | `/ns/:ns/:key` | Delete key |
| POST | `/ns/:ns/:key/ttl` | Set TTL (body: `{ttl: seconds}`) |
| GET | `/ns/:ns/search?pattern=*` | Search keys by glob |
| POST | `/ns/:ns/:key/_incr` | Increment counter |
| POST | `/ns/:ns/:key/_decr` | Decrement counter |
| POST | `/ns/:ns/:key/_lpush` | Push to list |
| POST | `/ns/:ns/:key/_lpop` | Pop from list |
| POST | `/ns/:ns/:key/_lrange` | List range |
| POST | `/ns/:ns/:key/_sadd` | Add to set |
| POST | `/ns/:ns/:key/_smembers` | Get set members |
| GET | `/ns/:ns/_watch` | SSE subscription |
| POST | `/ns/:ns/_mget` | Batch get |
| PUT | `/ns/:ns/_mset` | Batch set |
| POST | `/ns/:ns/_mdelete` | Batch delete |
| POST | `/backup` | Backup to file |
| POST | `/restore` | Restore from file |
| GET | `/stats` | Detailed statistics |

## SSE Watch

Subscribe to real-time changes:

```
GET /ns/:namespace/_watch           # Watch all keys
GET /ns/:namespace/_watch?key=foo   # Watch specific key
```

Events: `connected`, `set`, `delete`, `counter`

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `PORT` | `3096` | HTTP server port |
| `DATA_DIR` | `~/.agent-store` | Data directory |
| `RATE_LIMIT` | `true` | Enable rate limiting |
| `RATE_LIMIT_MAX` | `300` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |

## License

MIT
