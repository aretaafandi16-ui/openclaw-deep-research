# agent-store 🗄️

Zero-dependency persistent key-value store for AI agents. HTTP API + MCP server + CLI.

## Why?

AI agents need persistent state. Most solutions require databases, external services, or complex setup. This is a few files, zero dependencies, works anywhere Node.js runs.

## Quick Start

```bash
# Install
npm install -g agent-store

# Start HTTP server
agent-store serve

# Or use as MCP server (for Claude, etc.)
agent-store mcp
```

## Three Ways to Use

### 1. HTTP API

```bash
# Start server
PORT=3096 node server.mjs

# Use curl / fetch
curl -X PUT localhost:3096/ns/myagent/config \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","temperature":0.7}'
```

### 2. MCP Server (Model Context Protocol)

```json
// Add to Claude Desktop / OpenClaw config
{
  "mcpServers": {
    "agent-store": {
      "command": "node",
      "args": ["/path/to/agent-store/mcp-server.mjs"]
    }
  }
}
```

Available MCP tools: `store_get`, `store_set`, `store_delete`, `store_search`, `store_list`, `store_mget`, `store_mset`, `store_backup`, `store_stats`

### 3. CLI

```bash
agent-store set myns mykey '{"hello":"world"}'
agent-store get myns mykey
agent-store search myns "key*"
agent-store stats
```

### 4. Library (programmatic)

```js
import { AgentStore } from "./index.mjs";
const store = new AgentStore({ dataDir: "./data" });
await store.init();
await store.set("ns", "key", { hello: "world" });
const val = await store.get("ns", "key");
```

## HTTP API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + stats |
| GET | `/ns` | List all namespaces |
| GET | `/ns/:namespace` | List keys in namespace |
| GET | `/ns/:namespace/:key` | Get value |
| PUT | `/ns/:namespace/:key` | Set value (JSON body) |
| DELETE | `/ns/:namespace/:key` | Delete key |
| POST | `/ns/:namespace/:key/ttl` | Set expiration (`{ttl: seconds}`) |
| GET | `/ns/:namespace/search?pattern=*` | Search keys by glob pattern |
| POST | `/ns/:namespace/_mget` | Batch get (`{keys: [...]}`) |
| PUT | `/ns/:namespace/_mset` | Batch set (`{entries: [{key, value, ttl?}]}`) |
| POST | `/ns/:namespace/_mdelete` | Batch delete (`{keys: [...]}`) |
| POST | `/backup` | Backup to file (`{file: path}`) |
| POST | `/restore` | Restore from backup (`{file: path}`) |
| GET | `/stats` | Detailed statistics |
| GET | `/` | Web UI dashboard |

## Features

- **Namespaced** — Separate storage per agent/project
- **TTL** — Auto-expiring entries
- **Atomic ops** — `X-If-Absent: true` (set-if-new), `X-If-Newer: date` (optimistic lock)
- **Batch ops** — `mget`, `mset`, `mdelete` for bulk operations
- **Rate limiting** — Configurable per-IP rate limits (300 req/min default)
- **Pattern search** — Glob-style key matching (`agent-*`, `config.?`)
- **Auto-persist** — Debounced disk writes, graceful shutdown
- **Web UI** — Browser dashboard at `/`
- **MCP server** — Native Model Context Protocol support
- **CLI** — Full command-line interface
- **Library** — Import as ES module in your code
- **Backup/restore** — Full data export/import
- **Zero dependencies** — Pure Node.js

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `PORT` | `3096` | HTTP server port |
| `DATA_DIR` | `~/.agent-store` | Data directory |
| `RATE_LIMIT` | `true` | Enable rate limiting |
| `RATE_LIMIT_MAX` | `300` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `AGENT_STORE_DATA_DIR` | `~/.agent-store` | MCP server data dir |

## Examples

```bash
# Conditional set (only if key doesn't exist)
curl -X PUT localhost:3096/ns/myagent/session \
  -H "X-If-Absent: true" \
  -d '{"id":"abc123"}'

# Set 1-hour TTL
curl -X POST localhost:3096/ns/myagent/config/ttl \
  -d '{"ttl": 3600}'

# Batch set
curl -X PUT localhost:3096/ns/myagent/_mset \
  -d '{"entries":[{"key":"a","value":1},{"key":"b","value":2}]}'

# Batch get
curl -X POST localhost:3096/ns/myagent/_mget \
  -d '{"keys":["a","b","c"]}'
```

## Use Cases

- Agent session state persistence
- Cross-run memory (survives restarts)
- Configuration storage
- Task queue metadata
- Rate limiting counters
- Feature flags for agents
- Shared state between multiple AI agents
