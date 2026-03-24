# agent-chain 🐋

Zero-dep reasoning chain engine for AI agents — multi-step reasoning, branching, backtracking, and confidence scoring.

## Features

- **Chain-of-Thought**: Linear step-by-step reasoning with confidence tracking
- **Tree-of-Thought**: Branching exploration of multiple reasoning paths
- **Self-Consistency**: Run multiple chains, pick the best conclusion
- **ReAct**: Thought → Action → Observation pattern support
- **Branch & Bound**: Pruned search for optimal reasoning paths
- **Backtracking**: Undo reasoning steps, explore alternatives
- **Confidence Scoring**: Per-step confidence (0-1) with auto-scoring heuristics
- **Step Evaluation**: Score steps post-hoc with notes
- **Chain Templates**: 6 presets (chain-of-thought, tree-of-thought, self-consistency, react, decompose, verify)
- **Visualization**: Markdown export, tree view, path tracing
- **Persistence**: JSON serialization + JSONL event log
- **HTTP Dashboard**: Dark-theme web UI on port 3124
- **MCP Server**: 12 tools via JSON-RPC stdio
- **CLI**: Full command-line interface

## Quick Start

```bash
# Demo
node cli.mjs demo

# Create a chain
node cli.mjs create --name "Weather Analysis" --strategy chain-of-thought

# Add steps
node cli.mjs add-step --chain <ID> --label "Observe" --thought "Dark clouds" --confidence 0.8

# Run HTTP server
node cli.mjs serve --port 3124

# Run MCP server
node cli.mjs mcp
```

## Library Usage

```javascript
import { ReasoningChain, ChainManager, PRESETS } from './index.mjs';

// Create a chain
const chain = new ReasoningChain({
  name: 'Problem Analysis',
  strategy: 'chain-of-thought',
  maxDepth: 15,
  confidenceThreshold: 0.7
});

// Add reasoning steps
const step1 = chain.addStep({
  label: 'Observe',
  thought: 'The server response time increased from 50ms to 500ms',
  result: 'latency_increase',
  confidence: 0.9
});

const step2 = chain.addStep({
  label: 'Hypothesize',
  thought: 'Possible causes: database overload, network issues, memory leak',
  result: ['db_overload', 'network', 'memory_leak'],
  confidence: 0.6
});

// Branch for alternative hypotheses
chain.branch(step2.id, 'db_hypothesis');
chain.addStep({
  label: 'Check DB',
  thought: 'Query logs show slow queries on user_sessions table',
  result: 'db_overload_confirmed',
  confidence: 0.8
});

chain.branch(step2.id, 'memory_hypothesis');
chain.addStep({
  label: 'Check Memory',
  thought: 'Heap usage at 92%, GC pauses increasing',
  result: 'memory_leak_likely',
  confidence: 0.7
});

// Evaluate branches
chain.evaluate(chain.history[2], 0.8, 'Strong evidence from logs');
chain.evaluate(chain.history[3], 0.6, 'Possible but less direct');

// Conclude
chain.conclude('Database overload is primary cause. Optimize queries on user_sessions.', 0.8);

// Find best path
const best = chain.branchAndBound();
console.log('Best path:', best[0].path);

// Export as markdown
console.log(chain.toMarkdown());
```

## ReAct Pattern

```javascript
const chain = new ReasoningChain({ name: 'Research', strategy: 'react' });

chain.reactStep({
  thought: 'I need to find information about the API error',
  action: 'search("API error code 429")',
  observation: 'Rate limit exceeded — max 100 requests per minute',
  confidence: 0.9
});

chain.reactStep({
  thought: 'Need to check current rate limit usage',
  action: 'GET /api/rate-limit/status',
  observation: 'Currently at 98/100 requests this minute',
  confidence: 0.95
});

chain.conclude('Implement request queuing with 600ms spacing between requests', 0.85);
```

## Self-Consistency

```javascript
import { ReasoningChain } from './index.mjs';

// Run multiple chains on same problem
const chains = [];
for (let i = 0; i < 5; i++) {
  const c = new ReasoningChain({ name: `Consistency ${i}` });
  // ... each chain reasons independently ...
  chains.push(c);
}

// Pick the most confident conclusion
const best = ReasoningChain.selfConsistency(chains);
console.log('Best conclusion:', best.conclusion);
```

## ChainManager

```javascript
import { ChainManager } from './index.mjs';

const manager = new ChainManager({ dataDir: './data/chains' });

// Create chains
const c1 = manager.create({ name: 'Analysis 1', strategy: 'chain-of-thought' });
const c2 = manager.create({ name: 'Analysis 2', strategy: 'tree-of-thought' });

// List all
console.log(manager.list());

// Search
console.log(manager.search('analysis'));

// Global stats
console.log(manager.globalStats());

// Events
manager.on('step', (e) => console.log('New step:', e));
manager.on('conclude', (e) => console.log('Chain concluded:', e));
```

## API

### `new ReasoningChain(opts)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | 'Unnamed' | Chain name |
| `strategy` | string | 'chain-of-thought' | Reasoning strategy |
| `maxDepth` | number | 20 | Maximum chain depth |
| `confidenceThreshold` | number | 0.7 | Minimum confidence for auto-scoring |
| `autoscore` | boolean | true | Auto-adjust confidence on step add |

### Chain Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `addStep({label, thought, result, confidence, parentId, tags})` | Step | Add a reasoning step |
| `reactStep({thought, action, observation, confidence})` | Step | Add ReAct pattern step |
| `branch(stepId, name)` | this | Create branch from step |
| `backtrack(stepId)` | this | Remove all descendants, return to step |
| `evaluate(stepId, score, notes)` | this | Score a step (-1 to 1) |
| `conclude(text, confidence)` | this | Set chain conclusion |
| `searchBestPath(stepId, scorer)` | {path, score} | Find best path via DFS |
| `branchAndBound(opts)` | [{path, score}] | Pruned tree search |
| `getPath(stepId)` | Step[] | Get ancestor path to step |
| `getTree(rootId)` | object | Get nested tree structure |
| `merge(chain, strategy)` | this | Merge another chain |
| `stats()` | object | Chain statistics |
| `toMarkdown()` | string | Export as markdown |
| `toJSON()` | object | Serialize to JSON |

### Presets

| Preset | Strategy | Max Depth | Threshold |
|--------|----------|-----------|-----------|
| `chain-of-thought` | chain-of-thought | 15 | 0.7 |
| `tree-of-thought` | tree-of-thought | 10 | 0.5 |
| `self-consistency` | self-consistency | 8 | 0.8 |
| `react` | react | 20 | 0.6 |
| `decompose` | chain-of-thought | 25 | 0.5 |
| `verify` | chain-of-thought | 5 | 0.9 |

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard` | GET | Web UI |
| `/api/chains` | GET/POST | List/create chains |
| `/api/chains/:id` | GET/DELETE | Get/delete chain |
| `/api/chains/:id/tree` | GET | Reasoning tree |
| `/api/chains/:id/steps` | POST | Add step |
| `/api/chains/:id/path` | GET | Reasoning path |
| `/api/chains/:id/search` | GET | Best path search |
| `/api/chains/:id/conclude` | POST | Set conclusion |
| `/api/chains/:id/evaluate` | POST | Evaluate step |
| `/api/chains/:id/backtrack` | POST | Backtrack |
| `/api/chains/:id/export` | GET | Export JSON/Markdown |
| `/api/global-stats` | GET | Global statistics |

## MCP Tools

`chain_create` · `chain_add_step` · `chain_react` · `chain_backtrack` · `chain_evaluate` · `chain_conclude` · `chain_search` · `chain_get_path` · `chain_get_tree` · `chain_list` · `chain_stats` · `chain_export`

## Tests

```bash
node test.mjs
# 76 passed, 0 failed
```

## License

MIT
