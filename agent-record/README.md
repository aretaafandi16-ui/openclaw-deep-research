# 🐋 agent-record

Zero-dependency session recording & playback engine for AI agents. Capture agent interactions for debugging, training, compliance, and replay.

## Features

- **10 record types**: input, output, tool_call, tool_result, decision, error, annotation, snapshot, metric, custom
- **Playback**: async iterator with speed control, type filtering, breakpoints
- **Step-through**: forward/backward stepping through recorded sessions
- **Diff**: compare two sessions side-by-side (similarity score, identical/different/only-in-X)
- **Merge**: combine multiple sessions into one
- **Bookmarks & Annotations**: mark important moments, add notes with tags
- **Full-text search**: find records across all sessions
- **Export**: JSON, Markdown, replay script (standalone JS)
- **Persistence**: JSONL event log + periodic snapshots, survives restarts
- **Events**: EventEmitter for real-time streaming (session, record, bookmark events)
- **HTTP Dashboard**: dark-theme web UI on port 3133 with session management, record viewer, search, diff
- **MCP Server**: 12 tools via JSON-RPC stdio
- **CLI**: full command-line interface

## Quick Start

```js
import { SessionRecorder } from './index.mjs';

const recorder = new SessionRecorder({ dataDir: './recordings' });

// Start session
const session = recorder.startSession('my-agent-run', { agent: 'gpt-4', tags: ['research'] });

// Record interactions
recorder.recordInput('my-agent-run', 'What is the capital of France?');
recorder.recordDecision('my-agent-run', 'Search web', 'Knowledge lookup needed', 0.9);
recorder.recordToolCall('my-agent-run', 'web_search', { query: 'capital of France' });
recorder.recordToolResult('my-agent-run', 'web_search', { results: ['Paris'] });
recorder.recordOutput('my-agent-run', 'The capital of France is Paris.');
recorder.recordMetric('my-agent-run', 'latency_ms', 1250, 'ms');

// Bookmark important moments
recorder.bookmark('my-agent-run', 'answer-found', 4);

// Annotate with notes
recorder.annotate('my-agent-run', 2, 'Search was slow', ['performance']);

// Stop
recorder.stopSession('my-agent-run');

// Playback
for await (const item of recorder.playback('my-agent-run', { speed: 2 })) {
  if (item.type === 'record') console.log(item.record.type, item.record.data);
}

// Stats
console.log(recorder.getStats('my-agent-run'));

// Export
console.log(recorder.toMarkdown('my-agent-run'));

// Search
const results = recorder.search('Paris');

// Diff
const diff = recorder.diff('session-a', 'session-b');
```

## HTTP Server

```bash
PORT=3133 node server.mjs
# → http://localhost:3133
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions` | Start session (`{id?, meta?}`) |
| GET | `/api/sessions` | List sessions (`?state=&tag=`) |
| GET | `/api/sessions/:id` | Get session |
| DELETE | `/api/sessions/:id` | Stop session |
| POST | `/api/sessions/:id/record` | Record entry (`{type, data, meta?}`) |
| GET | `/api/sessions/:id/records` | Get records (`?type=&search=&limit=`) |
| GET | `/api/sessions/:id/records/:seq` | Get single record |
| POST | `/api/sessions/:id/bookmark` | Add bookmark (`{label, seq?}`) |
| POST | `/api/sessions/:id/annotate` | Annotate record (`{seq, note, tags?}`) |
| GET | `/api/sessions/:id/stats` | Session stats |
| GET | `/api/sessions/:id/export?format=` | Export (json/markdown/replay) |
| POST | `/api/sessions/:id/pause` | Pause session |
| POST | `/api/sessions/:id/resume` | Resume session |
| POST | `/api/diff` | Diff sessions (`{sessionA, sessionB}`) |
| POST | `/api/merge` | Merge sessions (`{target, source}`) |
| GET | `/api/search?q=` | Full-text search |
| GET | `/api/stats` | Global stats |

## MCP Server

```bash
node mcp-server.mjs
```

### Tools (12)

| Tool | Description |
|------|-------------|
| `record_start_session` | Start a new recording session |
| `record_stop_session` | Stop a session |
| `record_entry` | Record an entry (any type) |
| `record_get_session` | Get session details |
| `record_list_sessions` | List all sessions |
| `record_get_records` | Get records with filters |
| `record_bookmark` | Add bookmark |
| `record_annotate` | Annotate a record |
| `record_diff` | Diff two sessions |
| `record_search` | Search across sessions |
| `record_export` | Export session (json/markdown/replay) |
| `record_stats` | Session or global statistics |

## CLI

```bash
node cli.mjs start my-session --meta '{"agent":"gpt-4"}'
node cli.mjs record my-session input '{"input":"hello"}'
node cli.mjs record my-session output '{"output":"hi"}'
node cli.mjs records my-session --type input
node cli.mjs bookmark my-session "important"
node cli.mjs diff session-a session-b
node cli.mjs search "hello"
node cli.mjs export my-session --format markdown
node cli.mjs stats my-session
node cli.mjs demo
node cli.mjs serve --port 3133
```

## Record Types

| Type | Purpose | Data Fields |
|------|---------|-------------|
| `input` | User/agent input | `{input}` |
| `output` | Agent response | `{output}` |
| `tool_call` | Tool invocation | `{tool, args}` |
| `tool_result` | Tool response | `{tool, result}` |
| `decision` | Agent decision point | `{decision, reasoning, confidence}` |
| `error` | Error occurrence | `{error: {message, stack}, context}` |
| `annotation` | Human note on record | `{targetSeq, note, tags}` |
| `snapshot` | State snapshot | custom |
| `metric` | Performance metric | `{name, value, unit}` |
| `custom` | Arbitrary data | `{tag, data}` |

## Use Cases

- **Debugging**: Record agent runs, replay to find where things went wrong
- **Training**: Capture successful sessions as examples
- **Compliance**: Full audit trail of agent actions and decisions
- **Testing**: Diff actual vs expected session flows
- **Monitoring**: Stream events in real-time via EventEmitter
- **Documentation**: Export sessions as Markdown for docs

## License

MIT
