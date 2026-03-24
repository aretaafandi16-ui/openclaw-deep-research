# agent-transform

> Zero-dependency data transformation engine for AI agents

A composable pipeline engine for transforming, mapping, validating, and reshaping data — built for agent workflows.

## Features

- **JSON Schema Mapping** — flatten, nest, rename, pick, omit, filter fields
- **CSV/TSV ↔ JSON** — parse and stringify with configurable delimiters
- **Template Transforms** — `{{field}}` interpolation for computed values
- **Composable Pipelines** — chain steps with conditional branching
- **Type Coercion** — string, number, boolean, date, array, object
- **Data Validation** — schema rules with error collection
- **Batch Processing** — transform arrays with concurrency control
- **25+ Built-in Transforms** — uppercase, camelCase, round, unique, default, pick, etc.
- **Custom Transforms** — register your own functions
- **JSONL Logging** — persist transform history
- **EventEmitter** — progress and error events

## Quick Start

```js
import { AgentTransform } from './index.mjs';

const t = new AgentTransform();

// Simple transform
t.transform({ name: 'john doe', age: '25' }, [
  { op: 'rename', from: 'name', to: 'fullName' },
  { op: 'coerce', field: 'age', type: 'number' },
]);
// → { fullName: 'john doe', age: 25 }

// Pipeline
t.definePipeline('normalizeUser', [
  { op: 'pick', fields: ['name', 'email', 'age'] },
  { op: 'rename', from: 'name', to: 'displayName' },
  { op: 'template', field: 'slug', template: '{{displayName}}-{{email}}' },
  { op: 'coerce', field: 'age', type: 'number' },
  { op: 'default', field: 'age', value: 0 },
]);

const result = t.runPipeline('normalizeUser', rawData);
```

## Operations

| Op | Description | Example |
|----|-------------|---------|
| `pick` | Keep only listed fields | `{ op: 'pick', fields: ['a', 'b'] }` |
| `omit` | Remove listed fields | `{ op: 'omit', fields: ['x'] }` |
| `rename` | Rename a field | `{ op: 'rename', from: 'a', to: 'b' }` |
| `flatten` | Flatten nested object | `{ op: 'flatten' }` |
| `nest` | Group fields under key | `{ op: 'nest', key: 'meta', fields: ['a', 'b'] }` |
| `coerce` | Type conversion | `{ op: 'coerce', field: 'age', type: 'number' }` |
| `template` | Computed value | `{ op: 'template', field: 'id', template: '{{name}}-{{seq}}' }` |
| `default` | Set default value | `{ op: 'default', field: 'x', value: 0 }` |
| `filter` | Keep items matching predicate | `{ op: 'filter', field: 'items', predicate: { field: 'active', op: 'eq', value: true } }` |
| `map` | Transform each array item | `{ op: 'map', field: 'items', steps: [...] }` |
| `spread` | Spread array of objects | `{ op: 'spread', field: 'tags' }` |
| `chunk` | Split array into chunks | `{ op: 'chunk', field: 'items', size: 10 }` |
| `sample` | Take first N items | `{ op: 'sample', field: 'items', count: 5 }` |
| `branch` | Conditional execution | `{ op: 'branch', condition: {...}, then: [...], else: [...] }` |
| `validate` | Schema validation | `{ op: 'validate', rules: { email: { required: true, type: 'string' } } }` |
| `upper` | Uppercase | `{ op: 'upper', field: 'name' }` |
| `lower` | Lowercase | `{ op: 'lower', field: 'name' }` |
| `trim` | Trim whitespace | `{ op: 'trim', field: 'name' }` |
| `slug` | URL-safe slug | `{ op: 'slug', field: 'title' }` |
| `camel` | camelCase | `{ op: 'camel', field: 'key_name' }` |
| `snake` | snake_case | `{ op: 'snake', field: 'KeyName' }` |
| `kebab` | kebab-case | `{ op: 'kebab', field: 'KeyName' }` |
| `round` | Round number | `{ op: 'round', field: 'price', precision: 2 }` |
| `unique` | Deduplicate array | `{ op: 'unique', field: 'tags' }` |

## CLI

```bash
# Run a pipeline
node cli.mjs run --pipeline normalizeUser --input data.json

# Demo all features
node cli.mjs demo

# Start HTTP server
node cli.mjs serve --port 3120

# Start MCP server
node cli.mjs mcp
```

## HTTP Server

```bash
node server.mjs
# Dashboard at http://localhost:3120
```

**Endpoints:**
- `POST /transform` — apply steps to data
- `POST /pipeline/define` — register a pipeline
- `POST /pipeline/run` — run a pipeline
- `POST /csv/parse` — CSV → JSON
- `POST /csv/stringify` — JSON → CSV
- `GET /stats` — transformation stats

## MCP Server

```bash
node mcp-server.mjs
# 10 tools via JSON-RPC stdio
```

**Tools:** `transform_data`, `transform_define_pipeline`, `transform_run_pipeline`, `transform_flatten`, `transform_csv_parse`, `transform_csv_stringify`, `transform_validate`, `transform_stats`, `transform_list_pipelines`, `transform_register`

## Tests

```bash
node test.mjs
# 101 tests, all passing ✅
```

## License

MIT
