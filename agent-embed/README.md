# agent-embed

Zero-dependency vector embedding store for AI agents. In-memory vector database with cosine/euclidean/dot-product similarity search, IVF approximate nearest neighbor, metadata filtering, JSONL persistence, and a full MCP server.

## Features

- **In-memory vector store** — fast CRUD operations on Float64 vectors
- **Similarity search** — cosine, euclidean, dot-product distance functions
- **IVF index** — partition-based approximate nearest neighbor (k-means++ clustering)
- **Metadata filtering** — `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$contains`, `$and`, `$or`, `$not`
- **Batch operations** — bulk insert with error collection
- **Persistence** — JSONL event log + periodic snapshots, survives restarts
- **Namespace isolation** — multi-tenant support
- **Max vectors eviction** — automatic oldest-first eviction
- **Events** — `upsert`, `delete`, `clear`, `index-built`, `batch-upsert`, `persist-error`
- **HTTP server** — REST API + dark-theme web dashboard
- **MCP server** — 13 tools via JSON-RPC stdio
- **CLI** — full command-line interface
- **Zero dependencies** — pure Node.js, no external packages

## Quick Start

```js
import { EmbedStore } from './index.mjs';

const store = new EmbedStore({ dimension: 3, distance: 'cosine' });

// Insert vectors with metadata
store.upsert('doc1', [0.9, 0.1, 0], { title: 'Cats', type: 'animal' });
store.upsert('doc2', [0.1, 0.9, 0], { title: 'Dogs', type: 'animal' });
store.upsert('doc3', [0, 0, 1], { title: 'Python', type: 'tech' });

// Search: find top 2 similar to [1, 0, 0]
const results = store.search([1, 0, 0], 2);
// → [{ id: 'doc1', score: 0.994, metadata: { title: 'Cats', ... } }, ...]

// Search with metadata filter
const techOnly = store.search([0, 0, 1], 10, { filter: { type: 'tech' } });
```

## API

### `new EmbedStore(opts)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dimension` | number | `0` (auto) | Vector dimension |
| `distance` | string | `'cosine'` | Distance function: `cosine`, `euclidean`, `dot` |
| `persistPath` | string | `null` | Path to JSONL persistence file |
| `snapshotInterval` | number | `1000` | Auto-snapshot every N mutations |
| `maxVectors` | number | `0` | Max vectors (0 = unlimited) |
| `namespace` | string | `'_default'` | Namespace for isolation |
| `ivfPartitions` | number | `0` | IVF partitions (0 = brute-force) |
| `nprobe` | number | `3` | Partitions to search with IVF |
| `rebuildThreshold` | number | `500` | Rebuild IVF after N mutations |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `upsert(id, vector, metadata?)` | `{ id, created }` | Insert or update |
| `upsertBatch(items)` | `{ inserted, skipped, errors }` | Batch insert |
| `get(id)` | `entry \| null` | Get by ID |
| `has(id)` | `boolean` | Check existence |
| `delete(id)` | `boolean` | Delete vector |
| `updateMetadata(id, meta)` | `boolean` | Update metadata |
| `clear()` | `number` | Clear all, returns count |
| `search(vector, k, opts?)` | `results[]` | KNN search |
| `searchByText(text, embedFn, k, opts?)` | `results[]` | Search by text (bring your own embedder) |
| `buildIndex(partitions?)` | `void` | Build IVF index |
| `export()` | `array` | Export all vectors |
| `import(items)` | `result` | Import vectors |
| `ids()` | `string[]` | List all IDs |
| `getInfo()` | `object` | Store statistics |
| `[Symbol.iterator]` | iterator | Iterate entries |

### Search Options

```js
store.search(queryVector, k, {
  filter: { type: 'animal', score: { $gt: 0.5 } },
  threshold: 0.8,        // minimum similarity score
  includeVectors: true   // include vectors in results
});
```

### Filter Operators

```js
{ field: { $eq: value } }      // equal
{ field: { $ne: value } }      // not equal
{ field: { $gt: value } }      // greater than
{ field: { $gte: value } }     // greater or equal
{ field: { $lt: value } }      // less than
{ field: { $lte: value } }     // less or equal
{ field: { $in: [...] } }      // in array
{ field: { $nin: [...] } }     // not in array
{ field: { $exists: true } }   // field exists
{ field: { $contains: 'str' } } // string/array contains
{ $and: [filter1, filter2] }   // logical AND
{ $or: [filter1, filter2] }    // logical OR
{ $not: filter }               // logical NOT
```

## HTTP Server

```bash
node server.mjs              # Start on :3113
PORT=8080 node server.mjs    # Custom port
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Web dashboard |
| `GET` | `/api/info` | Store statistics |
| `POST` | `/api/upsert` | Insert/update vector |
| `POST` | `/api/upsert-batch` | Batch insert |
| `GET` | `/api/get?id=` | Get vector by ID |
| `POST` | `/api/search` | KNN search |
| `DELETE` | `/api/delete` | Delete vector |
| `POST` | `/api/update-metadata` | Update metadata |
| `GET` | `/api/export` | Export all vectors |
| `POST` | `/api/import` | Import vectors |
| `POST` | `/api/build-index` | Build IVF index |
| `GET` | `/api/ids` | List all IDs |
| `POST` | `/api/clear` | Clear all |

## MCP Server

```bash
node mcp-server.mjs   # Start MCP stdio server
```

### Tools (13)

| Tool | Description |
|------|-------------|
| `embed_upsert` | Insert or update a vector |
| `embed_upsert_batch` | Batch insert vectors |
| `embed_get` | Get vector by ID |
| `embed_search` | KNN search |
| `embed_delete` | Delete vector |
| `embed_update_metadata` | Update metadata |
| `embed_has` | Check existence |
| `embed_clear` | Clear all vectors |
| `embed_export` | Export all vectors |
| `embed_import` | Import vectors |
| `embed_build_index` | Build IVF index |
| `embed_stats` | Get statistics |
| `embed_ids` | List all IDs |

## CLI

```bash
node cli.mjs upsert doc1 '[0.9,0.1,0]' '{"title":"Cats"}'
node cli.mjs search '[1,0,0]' 5 '{"type":"animal"}'
node cli.mjs get doc1
node cli.mjs delete doc1
node cli.mjs stats
node cli.mjs export vectors.json
node cli.mjs import vectors.json
node cli.mjs build-index 10
node cli.mjs serve 3113
node cli.mjs mcp
node cli.mjs demo
```

## Persistence

Vectors are persisted as JSONL events with periodic snapshots:

```
data/embed.jsonl            # Event log (append-only)
data/embed.snapshot.json    # Periodic full snapshot
```

On startup, the store loads from the snapshot (if exists) and replays any events after it. Set `persistPath` to enable.

## IVF Index

For large collections (10k+ vectors), build an IVF (Inverted File) index for faster approximate search:

```js
const store = new EmbedStore({ dimension: 768, ivfPartitions: 64, nprobe: 8 });
// ... insert vectors ...
store.buildIndex(64);  // K-means++ clustering
// searches now use partition-based ANN
```

The index auto-rebuilds after `rebuildThreshold` mutations.

## License

MIT
