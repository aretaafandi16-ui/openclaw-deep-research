# agent-context

Zero-dependency context window manager for AI agents. Token counting, smart truncation, budgeting, and compression — all in one module.

## Why?

Every AI agent needs to manage context windows. Most do it badly — naive truncation, no token awareness, no budgeting. `agent-context` gives you production-grade context management with zero dependencies.

## Features

- **Token estimation** — character + word boundary heuristic (no tiktoken needed)
- **4 truncation strategies** — sliding_window, priority, summarize, hybrid
- **Context budgeting** — allocate tokens to system/tools/conversation sections
- **Compression** — deduplication, whitespace stripping, consecutive message merging
- **19 model presets** — GPT-4o, Claude 3.5, Gemini 1.5, Llama 3.1, Mistral, etc.
- **Priority handling** — system > tool > assistant > user, with custom overrides
- **Persistent messages** — mark system prompts as never-auto-remove
- **Context templates** — chat, coding, analysis, creative, agent, summarizer
- **JSONL persistence** — survives restarts
- **EventEmitter** — real-time events for add/remove/truncate/compress
- **HTTP dashboard** — dark-theme web UI on port 3116
- **MCP server** — 10 tools via JSON-RPC stdio
- **CLI** — full command-line interface

## Quick Start

```js
import { ContextManager, createContextForModel } from './index.mjs';

// Create for a specific model
const ctx = createContextForModel('gpt-4o');
// → 128k tokens, 16k reserved for output

// Add messages
ctx.addSystem('You are a helpful coding assistant.');
ctx.addUser('Write a Python quicksort.');
ctx.addAssistant('```python\ndef quicksort(arr): ...');
ctx.addToolResult('call_123', '{"result": [1,2,3]}');

// Check budget
console.log(ctx.inputTokens);        // current usage
console.log(ctx.availableTokens);    // input budget
console.log(ctx.utilizationPercent); // % used

// Get fitted messages (auto-truncates if over budget)
const msgs = ctx.getMessages({ strategy: 'hybrid' });

// Compress to save tokens
ctx.compress({ stripWhitespace: true, deduplicate: true });
```

## Truncation Strategies

### sliding_window
Keeps system messages + last N messages that fit. Simple, effective for most use cases.

### priority
Keeps highest priority messages regardless of position. System prompts and tool results survive; low-priority user messages get dropped first.

### summarize
Creates a `[Context Summary]` placeholder describing dropped messages, keeps recent ones. Best for long conversations where you need some context about earlier exchanges.

### hybrid (default)
60% recent messages + 40% high-priority messages, system always preserved. Best balance of recency and importance.

## Context Budgeting

Allocate token budgets per section:

```js
ctx.setBudgets({
  system: 2000,        // max 2k tokens for system prompts
  tools: 5000,         // max 5k for tool definitions + results
  conversation: 50000, // max 50k for conversation
});

// Check budget usage
const breakdown = ctx.getBudgetBreakdown();
// → { system: { used: 500, budget: 2000, over: false }, ... }

// Enforce budgets (truncates conversation to fit)
ctx.enforceBudgets();
```

## Compression

Reduce token usage without losing critical information:

```js
ctx.compress({
  stripWhitespace: true,    // collapse newlines, trim spaces
  deduplicate: true,        // remove consecutive duplicates
  mergeConsecutive: false,  // merge adjacent same-role messages
});
```

## Model Presets

```js
import { MODEL_PRESETS } from './index.mjs';

// 19 models supported:
// gpt-4o, gpt-4-turbo, gpt-4, gpt-4-32k, gpt-3.5-turbo
// claude-3-opus, claude-3-sonnet, claude-3-haiku, claude-3.5-sonnet
// gemini-pro, gemini-1.5-pro, gemini-1.5-flash
// llama-3-70b, llama-3.1-70b, llama-3.1-405b
// mistral-large, mixtral-8x7b, command-r-plus
```

## Templates

```js
ctx.applyTemplate('agent', { systemPrompt: 'Custom agent instructions' });
// Available: chat, coding, analysis, creative, agent, summarizer
```

## API

### `new ContextManager(opts)`
- `maxTokens` — max context window (default: 128000)
- `reserveOutput` — tokens reserved for output (default: 4096)
- `model` — model name (sets maxTokens/reserveOutput from preset)
- `persistencePath` — directory for JSONL persistence

### Methods

| Method | Description |
|--------|-------------|
| `add(msg)` | Add message `{role, content, priority, _persistent, _tags}` |
| `addSystem(content)` | Add persistent system message (priority 100) |
| `addUser(content)` | Add user message |
| `addAssistant(content)` | Add assistant message |
| `addToolResult(id, content)` | Add tool result |
| `setToolDefinitions(tools)` | Set tool defs (counted against budget) |
| `remove(id)` | Remove message by ID |
| `clear(keepPersistent)` | Clear messages |
| `getMessages({strategy, maxTokens})` | Get fitted messages |
| `last(n)` | Last N messages |
| `find(role\|predicate)` | Find messages |
| `compress(opts)` | Compress context |
| `setBudgets({system, tools, conversation})` | Set budgets |
| `getBudgetBreakdown()` | Budget usage report |
| `enforceBudgets()` | Truncate to fit budgets |
| `getStats()` | Full statistics |
| `getTokenBreakdown()` | Per-message token counts |
| `applyTemplate(name, vars)` | Apply template |
| `export()` | Export as JSON |
| `import(data)` | Import from JSON |
| `clone()` | Deep clone |

### Events

| Event | Payload |
|-------|---------|
| `message:added` | message object |
| `message:removed` | message object |
| `truncated` | `{strategy, original, result, dropped}` |
| `compressed` | `{before, after, saved, ratio}` |
| `budget:enforced` | `{section, truncated}` |
| `tools:updated` | tools array |
| `template:applied` | `{template, vars}` |

## CLI

```bash
# Add messages
node cli.mjs add system "You are helpful"
node cli.mjs add user "Hello world"

# Get fitted messages
node cli.mjs get --strategy hybrid

# Stats
node cli.mjs stats

# Compress
node cli.mjs compress

# Configure model
node cli.mjs configure --model claude-3.5-sonnet

# Token estimation
node cli.mjs estimate "How many tokens is this?"

# List models
node cli.mjs models

# Demo
node cli.mjs demo
```

## MCP Server

```bash
node mcp-server.mjs
```

**10 tools:** context_add, context_get, context_configure, context_stats, context_compress, context_budget, context_clear, context_estimate, context_export, context_models

## HTTP Server

```bash
node server.mjs  # http://localhost:3116
```

REST API: `/api/add`, `/api/get`, `/api/stats`, `/api/budget`, `/api/compress`, `/api/clear`, `/api/breakdown`, `/api/models`, `/api/estimate`, `/api/configure`, `/api/last`, `/api/export`

## Tests

```bash
node test.mjs
# 53 tests, all passing ✅
```

## License

MIT
