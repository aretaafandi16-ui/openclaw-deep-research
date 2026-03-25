# agent-replay v1.0

Zero-dependency deterministic replay & debugging engine for AI agents.

Content-addressed snapshots, step-through debugging, branching, assertion verification, and execution diffing — all in pure Node.js, no external dependencies.

## Features

- **Content-Addressed Snapshots**: SHA-256 hash-addressed state storage — identical states deduplicated automatically
- **Step-Through Debugging**: `first()`, `last()`, `next()`, `prev()`, `jump(index)` — navigate any execution trace
- **State Diffing**: Automatic diff between consecutive states — see exactly what changed
- **Branching**: Fork execution at any step to explore alternative paths
- **Assertion Engine**: 5 built-in assertion types for verification (state, output, type sequence, no errors, duration)
- **Annotations**: Mark steps with notes and tags for context
- **Search & Filter**: Full-text search, type filtering, tag filtering, time-range queries
- **Session Comparison**: Diff two sessions side-by-side with similarity scoring
- **Session Merge**: Combine sessions by timestamp or append order
- **Export**: JSON and Markdown output
- **HTTP Server**: Dark-theme web dashboard with REST API + SSE live events
- **MCP Server**: 12 tools via JSON-RPC stdio
- **CLI**: Full command-line interface

## Quick Start

```js
import { ReplayEngine } from './index.mjs';

const engine = new ReplayEngine();
const session = engine.createSession('my-agent', { metadata: { task: 'math' } });

// Record steps
session.record('input', { input: { question: 'What is 2+2?' }, state: { tokens: 0 } });
session.record('think', { output: 'Arithmetic', state: { tokens: 20 }, durationMs: 100 });
session.record('output', { output: { answer: 4 }, state: { tokens: 40 }, durationMs: 50 });
session.stop();

// Debug
session.first(); // Step 0
session.next();  // Step 1

// Assertions
const result = session.assertOutput(2, { answer: 4 });
console.log(result.pass); // true

// Branch to explore alternative
const alt = session.branch('different-approach', 1);
alt.record('think', { output: 'Lookup table', durationMs: 20 });
alt.record('output', { output: { answer: 4 }, durationMs: 5 });

// Compare
const s2 = engine.createSession('fast-agent');
s2.record('input', { input: { question: 'What is 2+2?' } });
s2.record('output', { output: { answer: 4 } });
s2.stop();

const diff = engine.diff('my-agent', 'fast-agent');
console.log(diff.similarity); // 0.5
```

## API Reference

### ReplayEngine

```js
const engine = new ReplayEngine({ persistPath: './data' });
```

| Method | Returns | Description |
|--------|---------|-------------|
| `createSession(id, opts)` | `ReplaySession` | Create new session |
| `getSession(id)` | `ReplaySession?` | Get session by ID |
| `listSessions()` | `Array` | List all sessions |
| `deleteSession(id)` | `boolean` | Remove session |
| `replay(sessionId, fn, opts)` | `Promise<Array>` | Replay with callback |
| `diff(idA, idB)` | `Object` | Compare sessions |
| `merge(idA, idB, strategy)` | `ReplaySession` | Merge sessions |
| `stats()` | `Object` | Global stats |
| `save(sessionId)` | `string` | Persist to disk |
| `load(sessionId)` | `ReplaySession` | Load from disk |

### ReplaySession

| Method | Returns | Description |
|--------|---------|-------------|
| `record(type, data)` | `Object` | Record a step |
| `stop()` | `void` | Stop recording |
| `getStep(index)` | `Object?` | Get step by index |
| `getState(index)` | `Object?` | Get state at step |
| `first/last/next/prev/jump()` | `Object` | Navigate steps |
| `filterByType(type)` | `Array` | Filter by step type |
| `filterByTag(tag)` | `Array` | Filter by tag |
| `filterErrors()` | `Array` | Get error steps |
| `searchSteps(query)` | `Array` | Full-text search |
| `branch(name, fromStep)` | `ReplayBranch` | Create branch |
| `assertState(idx, expected)` | `Object` | Assert state |
| `assertOutput(idx, expected)` | `Object` | Assert output |
| `assertTypeSequence(types)` | `Object` | Assert step order |
| `assertNoErrors()` | `Object` | Assert no errors |
| `assertDuration(idx, maxMs)` | `Object` | Assert timing |
| `runAssertions(list)` | `Array` | Batch assertions |
| `annotate(step, text, tags)` | `Object` | Add annotation |
| `timeline()` | `Array` | Timeline view |
| `stats()` | `Object` | Session stats |
| `toJSON()` | `Object` | Export JSON |
| `toMarkdown()` | `string` | Export Markdown |

### ReplayBranch

| Method | Returns | Description |
|--------|---------|-------------|
| `record(type, data)` | `Object` | Record step in branch |
| `getState(index)` | `Object?` | Get branch state |

## HTTP Server

```bash
node server.mjs          # Starts on :3145
# Dashboard: http://localhost:3145
```

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Engine stats |
| `/api/sessions` | GET | List sessions |
| `/api/sessions` | POST | Create session |
| `/api/sessions/:id` | GET | Get session |
| `/api/sessions/:id` | DELETE | Delete session |
| `/api/sessions/:id/stop` | POST | Stop recording |
| `/api/sessions/:id/steps` | POST | Record step |
| `/api/sessions/:id/timeline` | GET | Timeline |
| `/api/sessions/:id/stats` | GET | Session stats |
| `/api/sessions/:id/annotations` | GET | Annotations |
| `/api/sessions/:id/annotate` | POST | Add annotation |
| `/api/sessions/:id/assert` | POST | Run assertion |
| `/api/sessions/:id/branch` | POST | Create branch |
| `/api/sessions/:id/errors` | GET | Error steps |
| `/api/sessions/:id/export` | GET | Export JSON |
| `/api/sessions/:id/markdown` | GET | Export Markdown |
| `/api/diff` | POST | Compare sessions |
| `/api/merge` | POST | Merge sessions |
| `/events` | GET | SSE live stream |

## MCP Server

```bash
node mcp-server.mjs      # JSON-RPC stdio
```

### Tools

| Tool | Description |
|------|-------------|
| `replay_create` | Create session |
| `replay_record` | Record step |
| `replay_stop` | Stop recording |
| `replay_get` | Get session |
| `replay_list` | List sessions |
| `replay_step` | Get step by index |
| `replay_timeline` | Get timeline |
| `replay_assert` | Run assertion |
| `replay_annotate` | Add annotation |
| `replay_branch` | Create branch |
| `replay_diff` | Compare sessions |
| `replay_stats` | Engine stats |

## CLI

```bash
node cli.mjs demo                          # Run demo
node cli.mjs create my-session             # Create session
node cli.mjs record my-session input '{"input":"hello"}'
node cli.mjs list                          # List sessions
node cli.mjs get my-session                # Session details
node cli.mjs timeline my-session           # Timeline
node cli.mjs assert-state my-session 0 '{"count":1}'
node cli.mjs assert-no-errors my-session
node cli.mjs diff session-a session-b      # Compare
node cli.mjs merge session-a session-b     # Merge
node cli.mjs export-json my-session        # Export JSON
node cli.mjs export-md my-session          # Export Markdown
node cli.mjs stats                         # Global stats
node cli.mjs serve                         # HTTP server
node cli.mjs mcp                           # MCP server
```

## Tests

```bash
node test.mjs
# 91 tests passing ✅
```

## License

MIT
