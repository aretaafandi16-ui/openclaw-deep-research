# 🐋 agent-log

Zero-dependency structured logging for AI agents. Context propagation, correlation IDs, redaction, sampling, and multi-transport output.

## Features

- **Structured JSON logging** with levels: trace, debug, info, warn, error, fatal
- **Context propagation** via child loggers (inherit config + correlation IDs)
- **Correlation IDs** for distributed tracing across agent calls
- **Span tracking** with `startSpan()` / `linkSpan()` (agent-trace compatible)
- **PII redaction** — auto-redacts password, token, secret, API key, SSN, CC; custom fields
- **Sampling** — configurable rate (0-1) to reduce log volume
- **Custom filters** — `fn(entry) => boolean` for conditional logging
- **Multiple transports**: console (colored), file (JSONL with rotation), HTTP webhook
- **Buffered file writes** with auto-flush interval
- **Log rotation** by size (configurable max files)
- **Query engine** — search/filter by level, context, correlationId, time range, full-text
- **EventEmitter** — real-time log streaming for dashboards
- **Timer helpers** — `logger.time()` / `logger.timeSync()` for async/sync operation timing
- **Zero dependencies** — pure Node.js, no npm install needed

## Quick Start

```javascript
import { Logger, ConsoleTransport, FileTransport } from "./index.mjs";

// Basic usage
const log = new Logger({
  name: "my-agent",
  level: "info",
  transports: [
    new ConsoleTransport({ level: "info" }),
    new FileTransport({ path: "./logs/agent.jsonl" }),
  ],
});

log.info("Agent started", { version: "1.0" });
log.warn("Rate limit approaching", { current: 290, limit: 300 });
log.error("API call failed", { error: new Error("timeout"), endpoint: "/chat" });
```

## Child Loggers

```javascript
const authLog = log.child({ name: "auth", context: { module: "authentication" } });
authLog.info("User logged in", { userId: "u_abc" });
// Inherits correlation ID, transports, filters — adds module context
```

## Correlation IDs & Spans

```javascript
// Automatic correlation ID on every entry
const corrId = log.correlationId; // "1m2k3x4-abcd5678"

// Span tracking
const span = log.startSpan("req-123", { endpoint: "/api/data" });
span.debug("Fetching cache");
span.info("Data retrieved", { rows: 42 });
// All entries include spanId="req-123"
```

## Redaction

```javascript
log.info("Login", { username: "alice", password: "secret123", apiKey: "sk-abc" });
// Output: { ..., password: "[REDACTED]", apiKey: "[REDACTED]", username: "alice" }

// Custom redact fields
const secureLog = new Logger({ redactFields: ["email", "phone"] });
```

## Sampling

```javascript
// Only log 10% of messages (useful for high-volume debug logging)
const sampled = new Logger({ sampleRate: 0.1 });
```

## Transports

```javascript
import { ConsoleTransport, FileTransport, HttpTransport } from "./index.mjs";

const log = new Logger({
  transports: [
    new ConsoleTransport({ level: "info", colors: true }),
    new FileTransport({ path: "./logs/app.jsonl", maxSize: 50*1024*1024, maxFiles: 5 }),
    new HttpTransport({ url: "https://logs.example.com/ingest", level: "warn" }),
  ],
});
```

## Query Logs

```javascript
import { Logger } from "./index.mjs";

// Read and filter JSONL logs
const errors = Logger.readJsonl("./logs/app.jsonl", {
  level: "error",
  since: "2026-03-24T00:00:00Z",
  search: "timeout",
  limit: 50,
});

// Stats
const stats = Logger.statsJsonl("./logs/app.jsonl");
// { total: 1523, byLevel: { info: 1200, warn: 300, error: 23 }, sizeFormatted: "2.1 MB" }
```

## Timer Helpers

```javascript
// Async
const result = await log.time("API call", async () => {
  return await fetch("https://api.example.com/data");
}, { endpoint: "/data" });

// Sync
const data = log.timeSync("Parse config", () => JSON.parse(raw), { size: raw.length });
```

## HTTP Server + Dashboard

```bash
node server.mjs
# Dashboard: http://localhost:3115
```

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Web dashboard |
| GET | `/health` | Health check |
| POST | `/log` | Write log entry `{ level, message, context?, meta? }` |
| GET | `/logs` | Query logs `?level, context, search, correlationId, since, limit` |
| GET | `/stats` | Log statistics |
| GET | `/stream` | SSE stream of live logs |
| POST | `/child` | Create child logger `{ name, context?, level?, message }` |
| GET | `/export` | Download all logs as JSON |

## MCP Server

```bash
node mcp-server.mjs
```

**10 tools via JSON-RPC stdio:**

| Tool | Description |
|------|-------------|
| `log_trace` | Log at TRACE level |
| `log_debug` | Log at DEBUG level |
| `log_info` | Log at INFO level |
| `log_warn` | Log at WARN level |
| `log_error` | Log at ERROR level |
| `log_fatal` | Log at FATAL level |
| `log_query` | Search/filter logs from file |
| `log_stats` | Get log statistics |
| `log_child` | Create child logger and log |
| `log_export` | Export filtered logs as JSON |

## CLI

```bash
# Log messages
node cli.mjs log info "Server started" --context=web --meta='{"port":3000}'

# Query logs
node cli.mjs query --level=warn --search=timeout --limit=20

# Stats
node cli.mjs stats

# Tail with follow
node cli.mjs tail -f --level=info

# Export as CSV
node cli.mjs export --format=csv --limit=1000

# Child logger
node cli.mjs child auth info "Token validated"

# Start HTTP server
node cli.mjs serve --port=3115

# Start MCP server
node cli.mjs mcp

# Interactive demo
node cli.mjs demo
```

## API Reference

### `new Logger(opts)`
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | "agent-log" | Logger name/context |
| `level` | string | "trace" | Minimum level |
| `context` | object | {} | Default context fields |
| `correlationId` | string | auto | Correlation ID |
| `redactFields` | string[] | [defaults] | Fields to redact |
| `transports` | Transport[] | [Console] | Output transports |
| `sampleRate` | number | 1 | Sampling rate (0-1) |
| `filter` | function | null | Custom filter fn |
| `spanId` | string | null | Span identifier |

### Methods
- `trace/debug/info/warn/error/fatal(msg, meta?)` — Log at specific level
- `child(opts)` — Create child logger inheriting config
- `startSpan(id, meta?)` — Start a traced span
- `linkSpan(id)` — Link to existing span
- `time(label, fn, meta?)` — Time an async operation
- `timeSync(label, fn, meta?)` — Time a sync operation
- `flush()` — Flush all transport buffers
- `destroy()` — Clean up transports and listeners

### Static Methods
- `Logger.readJsonl(path, opts)` — Read and filter JSONL log file
- `Logger.statsJsonl(path)` — Get statistics from log file

### Events (EventEmitter)
- `log` — Fired on every log entry (with the entry object)

## License

MIT
