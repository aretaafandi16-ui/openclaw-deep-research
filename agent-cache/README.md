# agent-cache — Zero-dependency caching layer for AI agents

A lightweight, persistent caching system designed for AI agent workflows. Cache expensive API calls, LLM responses, computed results, and HTTP endpoints with TTL, tag-based invalidation, and hit-rate tracking.

## Features

- **LRU eviction** with configurable max size
- **TTL** (time-to-live) per entry or global default
- **Tag-based invalidation** — invalidate groups of related entries
- **Hit/miss statistics** — track cache effectiveness
- **Persistence** — JSONL event log + periodic snapshots
- **Cache decorators** — wrap any async function with caching
- **HTTP middleware** — cache Express/HTTP server responses
- **Namespace isolation** — separate caches per context/session
- **Pattern invalidation** — glob-style key invalidation
- **EventEmitter** — cache_hit, cache_miss, cache_evict, cache_expire events
- **Zero dependencies** — pure Node.js, no npm install needed
- **HTTP API** — REST server for remote cache access
- **MCP Server** — 10 tools for Model Context Protocol
- **CLI** — command-line interface for scripting

## Quick Start

### Library

```js
import { AgentCache } from './index.mjs';

const cache = new AgentCache({ defaultTTL: 300000, maxSize: 1000 });

// Set with tags
await cache.set('user:123', { name: 'Reza', role: 'admin' }, {
  tags: ['users', 'admins'],
  ttl: 600000
});

// Get
const user = await cache.get('user:123');

// Invalidate by tag
await cache.invalidateTag('users');

// Stats
console.log(cache.stats());
```

### HTTP Server

```bash
node server.mjs              # starts on :3102
node server.mjs --port 4000  # custom port
```

### MCP Server

```bash
node mcp-server.mjs
```

### CLI

```bash
node cli.mjs set key value --ttl 60000 --tags "tag1,tag2"
node cli.mjs get key
node cli.mjs delete key
node cli.mjs invalidate-tag tag1
node cli.mjs stats
node cli.mjs serve --port 3102
node cli.mjs mcp
```

## API Reference

### AgentCache Class

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultTTL` | number | 300000 | Default TTL in ms (5 min) |
| `maxSize` | number | 10000 | Max entries before LRU eviction |
| `namespace` | string | 'default' | Cache namespace |
| `persistPath` | string | null | Path for persistence file |
| `persistInterval` | number | 30000 | Snapshot interval in ms |
| `enableStats` | boolean | true | Track hit/miss stats |

#### Methods

- `get(key)` — Retrieve cached value (returns null on miss/expiry)
- `set(key, value, opts?)` — Store value with optional TTL and tags
- `delete(key)` — Remove single entry
- `has(key)` — Check existence without side effects
- `invalidateTag(tag)` — Remove all entries with a tag
- `invalidatePattern(pattern)` — Glob-style key deletion
- `clear()` — Clear entire cache
- `stats()` — Get hit/miss/size statistics
- `keys(pattern?)` — List keys (optional glob filter)
- `touch(key, ttl?)` — Extend TTL without changing value
- `mget(keys[])` — Batch get
- `mset(entries[])` — Batch set
- `wrap(key, fn, opts?)` — Cache result of async function
- `getOrSet(key, fn, opts?)` — Get cached or compute + cache

## License

MIT
