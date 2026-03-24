# agent-diff

Zero-dependency deep diff, patch & merge engine for AI agents.

## Features

- **Deep Diff** — recursive object/array comparison with detailed change tracking
- **JSON Patch (RFC 6902)** — generate and apply standard patches
- **Merge Strategies** — 6 strategies: override, shallow, deep, concat, array_union, base
- **Three-Way Merge** — detect and resolve conflicts with ours/theirs/manual strategies
- **Text Diff** — LCS-based line-level diff with change statistics
- **Word Diff** — word-level diff for fine-grained text comparison
- **Unified Diff** — standard unified diff format output
- **Change Tracker** — track changes over time with snapshots
- **Patch Queue** — enqueue patches with rollback support
- **Zero dependencies** — pure Node.js, no npm packages

## Quick Start

```js
import { AgentDiff } from './index.mjs';

const diff = new AgentDiff();

// Deep diff
const changes = diff.diff(
  { name: 'Alice', age: 30, skills: ['js'] },
  { name: 'Alice', age: 31, skills: ['js', 'rust'] }
);
// [{ op: 'replace', path: '.age', old: 30, value: 31 },
//  { op: 'add', path: '.skills[1]', value: 'rust' }]

// JSON Patch
const patches = diff.patch(oldObj, newObj);
const restored = diff.applyPatch(oldObj, patches);

// Merge
const merged = diff.merge(base, override, 'deep');

// Three-way merge with conflict detection
const result = diff.threeWay(base, mine, yours, 'ours');
// { merged: {...}, conflicts: [...], hasConflicts: true/false }

// Text diff
const textResult = diff.textDiff('hello\nworld', 'hello\nearth');
// { hunks: [...], stats: { added: 1, removed: 1, ... }, changes: [...] }

// Unified diff
const unified = diff.unifiedDiff('config.json', oldText, newText);
```

## API

### `new AgentDiff(opts?)`

Create an instance. Options: `maxHistory`, `persistPath`.

### `diff.diff(old, new)` → `DiffOp[]`

Deep diff two values. Returns array of operations:
- `{ op: 'add', path, value }` — key/index added
- `{ op: 'remove', path, old }` — key/index removed
- `{ op: 'replace', path, old, value }` — value changed

### `diff.patch(old, new)` → `RFC6902Patch[]`

Generate RFC 6902 JSON patches.

### `diff.applyPatch(doc, patches)` → `any`

Apply JSON patches to a document.

### `diff.merge(base, override, strategy?)` → `any`

Merge two objects. Strategies:
- `override` (default) — override wins on conflict
- `shallow` — one-level merge
- `deep` — recursive merge, keeps both sides' additions
- `concat` — concatenate arrays
- `array_union` — deduplicate array elements
- `base` — keep base, ignore override

### `diff.threeWay(base, ours, theirs, strategy?)` → `{ merged, conflicts, hasConflicts }`

Three-way merge. Conflict strategies: `override`, `ours`, `theirs`, `manual`.

### `diff.textDiff(old, newText)` → `{ hunks, stats, changes }`

Line-level diff using LCS algorithm.

### `diff.wordDiff(old, newText)` → `WordChange[]`

Word-level diff for fine-grained comparison.

### `diff.unifiedDiff(filename, old, newText)` → `{ unified, stats }`

Standard unified diff format.

### `diff.isEqual(a, b)` → `boolean`

Deep equality check via JSON serialization.

### `diff.changedKeys(old, new)` → `string[]`

Get list of changed property paths.

### `diff.stats(old, new)` → `DiffStats`

Get diff statistics: `{ total, adds, removes, replaces, paths }`.

### Change Tracker

```js
const tracker = diff.tracker;
tracker.track('user1', oldState, newState);  // Record change
tracker.snapshot('v1', state);               // Save snapshot
tracker.diffSnapshots('v1', 'v2');           // Compare snapshots
tracker.getHistory('user1');                 // Get change history
```

### Patch Queue

```js
const queue = diff.createPatchQueue(doc);
queue.enqueue(patches, 'label');
queue.apply();      // Apply next patch
queue.applyAll();   // Apply all queued
queue.rollback();   // Undo last apply
queue.status();     // { queued, applied, rolledBack }
```

## CLI

```bash
# Diff two JSON files
agent-diff diff old.json new.json

# Generate JSON patch
agent-diff patch old.json new.json

# Apply patch
agent-diff apply doc.json patches.json

# Merge with strategy
agent-diff merge base.json override.json deep

# Three-way merge
agent-diff three-way base.json ours.json theirs.json ours

# Text diff
agent-diff text file1.txt file2.txt

# Unified diff
agent-diff unified file1.txt file2.txt

# Stats
agent-diff stats old.json new.json

# Equality check
agent-diff equal a.json b.json

# Start HTTP server
agent-diff serve

# Start MCP server
agent-diff mcp

# Run demo
agent-diff demo
```

## MCP Server

10 tools available via JSON-RPC stdio:

| Tool | Description |
|------|-------------|
| `diff_diff` | Deep diff two objects |
| `diff_patch` | Generate RFC 6902 patches |
| `diff_apply_patch` | Apply patches to document |
| `diff_merge` | Merge with strategy |
| `diff_three_way` | Three-way merge |
| `diff_text_diff` | Line-level text diff |
| `diff_unified` | Unified diff format |
| `diff_stats` | Diff statistics |
| `diff_is_equal` | Deep equality |
| `diff_changed_keys` | Changed key paths |

## HTTP Server

Start: `agent-diff serve` (port 3124)

Dashboard at `http://localhost:3124` with live diff/merge/patch UI.

### Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/diff` | `{ old, new }` | Deep diff |
| POST | `/api/patch` | `{ old, new }` | Generate patches |
| POST | `/api/apply` | `{ doc, patches }` | Apply patches |
| POST | `/api/merge` | `{ base, override, strategy }` | Merge |
| POST | `/api/three-way` | `{ base, ours, theirs, strategy }` | Three-way merge |
| POST | `/api/text-diff` | `{ old, new }` | Text diff |
| POST | `/api/unified` | `{ filename, old, new }` | Unified diff |
| POST | `/api/equal` | `{ a, b }` | Equality check |
| POST | `/api/changed-keys` | `{ old, new }` | Changed keys |
| GET | `/api/stats` | — | Server stats |

## Tests

```bash
node test.mjs
```

60 tests covering all features, edge cases, and roundtrip operations.

## License

MIT
