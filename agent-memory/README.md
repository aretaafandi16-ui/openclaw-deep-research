# agent-memory 🧠

Zero-dependency persistent memory system for AI agents. Keyword-based search with BM25 scoring, importance decay, session isolation, and consolidation.

## Features

- **Persistent storage** — JSONL event log + periodic snapshots, survives restarts
- **BM25 search** — keyword relevance scoring with importance, recency, and access frequency boosts
- **Session isolation** — organize memories by conversation/task/session
- **Importance scoring** — 0-1 with auto-decay and reinforcement
- **Memory consolidation** — merge similar memories (Jaccard similarity)
- **Auto-forget** — decay importance over time, purge low-value entries
- **HTTP API** — full REST API with web dashboard
- **MCP Server** — 12 tools via Model Context Protocol
- **CLI** — command-line interface for all operations
- **Zero dependencies** — pure Node.js, no npm install needed

## Quick Start

```bash
# Run demo
node cli.mjs demo

# Start HTTP server on port 3101
node cli.mjs serve --port 3101

# Start MCP server (stdio)
node cli.mjs mcp

# Run tests
node test.mjs
```

## CLI Usage

```bash
# Store a memory
node cli.mjs store "User prefers dark mode" --tags preference,ui --importance 0.8 --session user-prefs

# Search
node cli.mjs search "dark mode" --session user-prefs --limit 5

# Get by id
node cli.mjs get <id>

# Update
node cli.mjs update <id> --importance 0.9 --tags updated,tags

# Delete
node cli.mjs delete <id>

# Session context
node cli.mjs context user-prefs

# Consolidate similar memories
node cli.mjs consolidate user-prefs --threshold 0.6

# Decay & forget low-value memories
node cli.mjs forget

# Reinforce (boost importance)
node cli.mjs reinforce <id> --boost 0.2

# Stats
node cli.mjs stats

# List sessions
node cli.mjs sessions

# Export
node cli.mjs export --session user-prefs > memories.json

# Import
node cli.mjs import memories.json
```

## HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Web dashboard |
| GET | `/stats` | System statistics |
| POST | `/store` | Store memory `{content, tags?, importance?, session?, metadata?}` |
| GET | `/memory/:id` | Get memory by id |
| PUT | `/memory/:id` | Update memory |
| DELETE | `/memory/:id` | Delete memory |
| GET | `/search?q=...&session=...&limit=...&tags=...&min_importance=...` | Search |
| GET | `/context/:session?limit=50` | Session context |
| POST | `/consolidate` | Merge `{session, threshold?}` |
| POST | `/forget` | Decay & purge |
| POST | `/reinforce/:id` | Boost `{boost?}` |
| GET | `/sessions` | List sessions |
| GET | `/export?session=...` | Export JSON |
| POST | `/import` | Import array of entries |

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory |
| `memory_get` | Get memory by id |
| `memory_search` | Search by keyword relevance |
| `memory_update` | Update memory fields |
| `memory_delete` | Delete a memory |
| `memory_context` | Get session context |
| `memory_consolidate` | Merge similar memories |
| `memory_forget` | Decay & purge low-value memories |
| `memory_reinforce` | Boost importance |
| `memory_stats` | System statistics |
| `memory_sessions` | List all sessions |
| `memory_export` | Export memories as JSON |

## Library API

```javascript
import { AgentMemory } from "./index.mjs";

const mem = new AgentMemory({
  dataDir: "./data",
  maxMemories: 10000,
  importanceDecay: 0.01,     // per day
  forgetThreshold: 0.05,     // forget below this
  snapshotIntervalMs: 60000,
  port: 3101,                // optional HTTP server
});

await mem.init();

// Store
const entry = mem.store("Important fact", {
  tags: ["fact", "important"],
  importance: 0.9,
  session: "project-alpha",
  metadata: { source: "user" },
});

// Search
const results = mem.search("important fact", {
  session: "project-alpha",
  limit: 10,
  tags: ["fact"],
  minImportance: 0.5,
});
// results: [{ entry, score }, ...]

// Session context
const context = mem.getContext("project-alpha", 50);

// Consolidate (merge similar memories)
mem.consolidate("project-alpha", 0.6);

// Decay & forget
const { decayed, forgotten } = mem.forget();

// Reinforce
mem.reinforce(entry.id, 0.1);

// Events
mem.on("store", (entry) => console.log("stored:", entry.id));
mem.on("forget", ({ decayed, forgotten }) => console.log("forgot:", forgotten));

await mem.destroy(); // saves snapshot
```

## Search Scoring

BM25-inspired scoring with adjustments:
- **BM25 base** — term frequency × inverse document frequency
- **Importance boost** — higher importance = higher score (up to 50% boost)
- **Recency boost** — memories from last 24h get up to 20% boost
- **Access boost** — frequently accessed memories score higher (1% per access, max 20%)

## Memory Lifecycle

1. **Store** — memory created with importance (default 0.5)
2. **Access** — each access increments counter, boosts future searches
3. **Reinforce** — manually boost importance for key memories
4. **Decay** — importance decreases over time (default 0.01/day)
5. **Forget** — memories below threshold (default 0.05) are purged
6. **Consolidate** — similar memories are merged to reduce noise

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | Persistence directory |
| `PORT` | `3101` | HTTP server port |

## License

MIT
