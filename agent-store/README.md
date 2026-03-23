# agent-store 🗄️

Zero-dependency persistent key-value store for AI agents. HTTP API. Just Node.js.

## Why?

AI agents need persistent state. Most solutions require databases, external services, or complex setup. This is a single file, zero dependencies, works anywhere Node.js runs.

## Quick Start

```bash
# Start on default port 3096
node server.mjs

# Custom port
PORT=4000 node server.mjs

# Custom data directory
DATA_DIR=/data/store node server.mjs
```

## API

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
| POST | `/backup` | Backup to file (`{file: path}`) |
| POST | `/restore` | Restore from backup (`{file: path}`) |
| GET | `/stats` | Detailed statistics |
| GET | `/` | Web UI dashboard |

## Features

- **Namespaced** — Separate storage per agent/project
- **TTL** — Auto-expiring entries
- **Atomic ops** — `X-If-Absent: true` (set-if-new), `X-If-Newer: date` (optimistic lock)
- **Pattern search** — Glob-style key matching (`agent-*`, `config.?`)
- **Auto-persist** — Debounced disk writes, graceful shutdown
- **Web UI** — Browser dashboard at `/`
- **Backup/restore** — Full data export/import

## Examples

```bash
# Store a value
curl -X PUT localhost:3096/ns/myagent/config \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","temperature":0.7}'

# Get it back
curl localhost:3096/ns/myagent/config

# Set 1-hour TTL
curl -X POST localhost:3096/ns/myagent/config/ttl \
  -d '{"ttl": 3600}'

# Search keys
curl "localhost:3096/ns/myagent/search?pattern=config*"

# Conditional set (only if key doesn't exist)
curl -X PUT localhost:3096/ns/myagent/session \
  -H "X-If-Absent: true" \
  -d '{"id":"abc123"}'

# Backup
curl -X POST localhost:3096/backup \
  -d '{"file":"/tmp/backup.json"}'
```

## Use Cases

- Agent session state persistence
- Cross-run memory (survives restarts)
- Configuration storage
- Task queue metadata
- Rate limiting counters
- Feature flags for agents
