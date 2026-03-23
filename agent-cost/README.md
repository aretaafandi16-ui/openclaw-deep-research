# 💰 agent-cost

Zero-dependency cost tracker for AI agents. Track token usage, calculate costs across 9 providers and 40+ models, enforce budgets, and get real-time analytics.

## Features

- **Cost recording** — track every API call with automatic cost calculation
- **Cost estimation** — predict costs before making requests
- **Model comparison** — find the cheapest model for your token needs
- **Budget enforcement** — soft warnings or hard limits (daily/weekly/monthly)
- **Usage analytics** — breakdown by provider, model, and time period
- **Custom pricing** — add your own models and negotiated rates
- **JSONL persistence** — durable storage, survives restarts
- **Event-driven** — EventEmitter for budget warnings, records, etc.
- **Multiple interfaces** — Library, HTTP API, MCP server, CLI

## Supported Providers

| Provider | Models |
|----------|--------|
| OpenAI | gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4, gpt-3.5-turbo, o1, o1-mini, o3-mini |
| Anthropic | claude-sonnet-4, claude-3-7-sonnet, claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus, claude-3-haiku |
| Google | gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash, gemini-2.5-pro, gemini-2.5-flash |
| Mistral | mistral-large, mistral-medium, mistral-small, codestral |
| Groq | llama-3.1-70b, llama-3.1-8b, mixtral-8x7b |
| DeepSeek | deepseek-chat, deepseek-coder, deepseek-r1 |
| xAI | grok-2, grok-2-mini |
| Cohere | command-r-plus, command-r |

## Quick Start

```bash
# Demo
node cli.mjs demo

# Record usage
node cli.mjs record openai gpt-4o 1500 800

# Estimate cost
node cli.mjs estimate anthropic claude-sonnet-4-20250514 2000 1000

# Find cheapest model
node cli.mjs cheapest 1000 500

# View stats
node cli.mjs stats
node cli.mjs stats --period day

# Set budget
node cli.mjs budget --daily 10 --monthly 100 --hard

# Start HTTP server
node cli.mjs serve --port 3100

# Start MCP server
node cli.mjs mcp
```

## Library API

```js
import { CostTracker } from './index.mjs';

const tracker = new CostTracker({
  dataPath: './my-cost-data',
  budgets: { daily: 10, monthly: 100 },
});

// Record usage
const record = tracker.record('openai', 'gpt-4o', 1500, 800);
console.log(record.totalCost); // 0.01175

// Estimate without recording
const est = tracker.estimate('anthropic', 'claude-sonnet-4-20250514', 2000, 1000);

// Find cheapest
const cheapest = tracker.findCheapest(1000, 500);
console.log(cheapest[0]); // { provider: 'deepseek', model: 'deepseek-chat', totalCost: 0.00028 }

// Stats
const stats = tracker.stats('day');
console.log(stats.totalCost, stats.byProvider);

// Budget alerts
tracker.on('budget:warning', (info) => {
  console.log(`⚠️ ${info.period} budget at ${info.percentUsed}%`);
});

// Hard budget (throws on exceed)
tracker.setBudget({ daily: 0.01, hardLimit: true });

// Custom pricing
tracker.addPricing('my-provider', 'my-model', 0.001, 0.002);
```

## HTTP API

Start server: `node server.mjs` (or `node cli.mjs serve --port 3100`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Dashboard UI |
| GET | `/health` | Health check |
| POST | `/record` | Record usage |
| GET | `/estimate` | Estimate cost |
| GET | `/cheapest` | Find cheapest model |
| GET | `/stats` | Usage statistics |
| GET | `/budgets` | Budget status |
| POST | `/budget` | Set budget |
| GET | `/recent` | Recent records |
| POST | `/pricing` | Add custom pricing |
| GET | `/models` | List models |
| GET | `/export` | Export CSV |
| DELETE | `/records` | Clear records |

### Examples

```bash
# Record usage
curl -X POST http://localhost:3100/record \
  -H 'Content-Type: application/json' \
  -d '{"provider":"openai","model":"gpt-4o","inputTokens":1500,"outputTokens":800}'

# Find cheapest
curl 'http://localhost:3100/cheapest?inputTokens=1000&outputTokens=500'

# Set budget
curl -X POST http://localhost:3100/budget \
  -H 'Content-Type: application/json' \
  -d '{"daily":10,"monthly":100}'
```

## MCP Server

Start: `node mcp-server.mjs`

### Tools

| Tool | Description |
|------|-------------|
| `cost_record` | Record token usage |
| `cost_estimate` | Estimate cost |
| `cost_cheapest` | Find cheapest model |
| `cost_stats` | Usage statistics |
| `cost_budgets` | Budget status |
| `cost_set_budget` | Set budget |
| `cost_recent` | Recent records |
| `cost_models` | List models |
| `cost_export` | Export CSV |
| `cost_clear` | Clear records |

### MCP Config

```json
{
  "mcpServers": {
    "agent-cost": {
      "command": "node",
      "args": ["/path/to/agent-cost/mcp-server.mjs"]
    }
  }
}
```

## CLI Reference

```
Commands:
  record <provider> <model> <input> <output>  Record usage
  estimate <provider> <model> <in> <out>      Estimate cost
  cheapest <input> <output>                   Find cheapest model
  stats [--period day|week|month]             Usage statistics
  budgets                                     Budget status
  budget [--daily N] [--weekly N] [--monthly N] [--hard]
  recent [--limit N]                          Recent records
  models [--provider P]                       List models
  export                                      Export CSV
  clear                                       Clear records
  serve [--port N]                            Start HTTP server
  mcp                                         Start MCP server
  demo                                        Run demo
```

## Events

```js
tracker.on('record', (record) => { /* new usage recorded */ });
tracker.on('budget:warning', (info) => { /* threshold crossed */ });
tracker.on('budget:update', (budgets) => { /* budget changed */ });
tracker.on('clear', () => { /* records cleared */ });
tracker.on('error', (err) => { /* persistence error */ });
```

## Data Storage

Records stored as JSONL in `{dataPath}/records.jsonl`. Config (budgets, custom pricing) in `{dataPath}/config.json`.

## License

MIT
