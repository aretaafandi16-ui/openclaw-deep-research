# agent-eval

Zero-dependency evaluation & benchmarking toolkit for AI agents. Define test cases, score outputs, compare models, run benchmarks.

## Features

- **8 Scoring Functions** — exact, contains, regex, similarity (Dice), JSON schema, numeric, length, not-empty
- **Test Suite Management** — add, remove, filter by tags, import/export JSON
- **Benchmark Runner** — run suites against multiple models, auto-rank
- **A/B Testing** — Welch's t-test for statistical significance
- **Retry & Timeout** — configurable retries with backoff, per-case timeouts
- **Parallel Execution** — run tests concurrently with configurable concurrency
- **EventEmitter** — real-time progress events (case:result, run:complete, etc.)
- **Report Generator** — markdown reports with leaderboard, failures, per-tag stats
- **JSONL Persistence** — run history survives restarts
- **HTTP Dashboard** — web UI at port 3106
- **MCP Server** — 12 tools via Model Context Protocol
- **CLI** — full command-line interface

## Install

```bash
cd agent-eval
# No dependencies needed — zero-dep
```

## Quick Start

```js
import { EvalSuite } from './index.mjs';

const suite = new EvalSuite({ name: 'my-eval' });

suite.add({ name: 'basic match', input: 'hello', expected: 'hello', scorer: 'exact' });
suite.add({ name: 'contains check', input: 'The answer is 42', expected: 'answer', scorer: 'contains' });
suite.add({ name: 'json schema', input: '{"name":"test","v":1}', expected: { type: 'object', required: ['name'] }, scorer: 'json_schema' });

const { results, summary } = await suite.run(async (input) => {
  // Your agent/AI call here
  return input;
});

console.log(`${summary.passed}/${summary.total} passed (${summary.passRate}%)`);
```

## Scoring Functions

| Scorer | Description |
|--------|-------------|
| `exact` | Case-insensitive exact string match (option: `caseSensitive`) |
| `contains` | Output contains expected substring |
| `regex` | Regular expression match (option: `flags`) |
| `similarity` | Dice coefficient on bigrams (option: `threshold`, default 0.7) |
| `json_schema` | Simplified JSON schema validation (type, required, properties, enum, min/max, items) |
| `numeric` | Numeric comparison with tolerance (option: `tolerance`, default 0.01 = 1%) |
| `length` | Length check with operator: eq/gt/gte/lt/lte/between |
| `notEmpty` | Output is not empty or whitespace-only |
| `custom` | Pass a function `(expected, actual) => boolean \| { score, pass, detail }` |

## Benchmark Runner

Compare multiple models/executors against the same suite:

```js
import { BenchmarkRunner } from './index.mjs';

const bench = new BenchmarkRunner();
const suite = bench.addSuite({ name: 'comparison', description: 'Model comparison' });
suite.add({ name: 'test1', input: 'hello', expected: 'hello', scorer: 'exact' });
suite.add({ name: 'test2', input: 'world', expected: 'WORLD', scorer: 'contains' });

bench.addModel('gpt-4', async (input) => callGPT4(input));
bench.addModel('claude', async (input) => callClaude(input));

const { results, comparison } = await bench.runAll('comparison');
// comparison.ranked — sorted leaderboard
// comparison.best — top model by avg score
// comparison.fastest — lowest avg latency
```

## A/B Testing

Statistical significance testing with Welch's t-test:

```js
const ab = bench.abTest(resultsA, resultsB);
// ab.pValue, ab.significant (p < 0.05), ab.confidence, ab.winner
```

## CLI

```bash
# Score a single output
node cli.mjs score "expected output" "actual output" --scorer contains

# Run a suite
node cli.mjs run suite.json --executor executor.mjs --parallel --concurrency 4

# Add test cases
node cli.mjs add suite.json --name "Test 1" --input "hello" --expected "hello" --scorer exact --tags "unit,fast"

# List suite contents
node cli.mjs list suite.json

# Compare results
node cli.mjs compare results-a.json results-b.json

# Interactive demo
node cli.mjs demo

# Web dashboard
node cli.mjs serve --port 3106
```

## MCP Server

```bash
node mcp-server.mjs
```

### Tools

| Tool | Description |
|------|-------------|
| `eval_score` | Score output against expected with a scorer |
| `eval_suite_create` | Create a new eval suite |
| `eval_case_add` | Add a test case to a suite |
| `eval_case_remove` | Remove a test case |
| `eval_run` | Run all cases in a suite |
| `eval_run_case` | Run a single case |
| `eval_list` | List cases in a suite |
| `eval_history` | Get run history |
| `eval_export` | Export suite as JSON |
| `eval_import` | Import cases from JSON |
| `eval_compare` | A/B test two result sets |
| `eval_scorers` | List available scorers |

## HTTP API

```
GET  /                          — Dashboard UI
GET  /api/health                — Health check
GET  /api/scorers               — List scorers
POST /api/score                 — Score output { expected, actual, scorer }
GET  /api/suites                — List suites
POST /api/suites                — Create suite { name, description }
GET  /api/suites/:name          — Get suite cases
POST /api/suites/:name/cases    — Add case { name, input, expected, scorer }
DELETE /api/suites/:name/cases/:id — Remove case
POST /api/suites/:name/run      — Run suite { parallel, concurrency }
GET  /api/suites/:name/history  — Run history
```

## License

MIT
