# agent-rag

Zero-dependency RAG (Retrieval-Augmented Generation) engine for AI agents. Everything runs in pure Node.js — no external packages, no vector database, no Python.

## Features

- **Document chunking**: fixed-size (with overlap), sentence, paragraph, recursive (heading-aware)
- **TF-IDF indexing** with cosine similarity
- **BM25 scoring** (configurable k1, b parameters)
- **Hybrid search**: weighted combination of TF-IDF and BM25
- **Cross-encoder style re-ranking**: exact phrase boost, term proximity, query coverage, field boosting
- **Query expansion**: automatic bigram extraction, stopword removal
- **Metadata filtering**: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$contains`
- **Namespace isolation** with cross-namespace search
- **JSONL persistence** with periodic snapshots
- **EventEmitter** for documentAdded/documentDeleted/indexRebuilt events
- **HTTP server** with dark-theme web dashboard
- **MCP server** with 12 tools
- **CLI** with 14 commands

## Quick Start

```js
import { AgentRAG } from './index.mjs';

const rag = new AgentRAG();

// Add documents
rag.addDocument('JavaScript is a programming language for the web', { topic: 'js' });
rag.addDocument('Python excels at data science and ML', { topic: 'python' });
rag.addDocument('Rust focuses on memory safety and performance', { topic: 'rust' });

// Search
const results = rag.search('programming language', { topK: 3 });
console.log(results);

// Get formatted context for prompt injection
const context = rag.contextString('best language for web development', 3);
console.log(context);
```

## Search Options

```js
rag.search('query', {
  topK: 5,           // number of results
  namespace: 'docs', // search specific namespace
  minScore: 0.1,     // minimum relevance score
  rerank: true,      // enable re-ranking
  filters: {         // metadata filters
    topic: 'javascript',
    year: { $gte: 2020 }
  }
});
```

## Chunking Strategies

```js
const rag = new AgentRAG({
  chunkStrategy: 'recursive', // 'fixed' | 'sentence' | 'paragraph' | 'recursive'
  chunkSize: 500,             // max chunk size (chars)
  chunkOverlap: 50            // overlap between chunks
});
```

## HTTP Server

```bash
node server.mjs            # starts on :3123
PORT=8080 node server.mjs  # custom port
```

**Endpoints:**
- `GET /` — Web dashboard
- `GET /api/stats` — Index statistics
- `GET /api/namespaces` — List namespaces
- `GET /api/documents?namespace=ns&limit=100` — List documents
- `POST /api/documents` — Add document `{ text, metadata?, namespace? }`
- `GET /api/documents/:id?namespace=ns` — Get document
- `DELETE /api/documents/:id?namespace=ns` — Delete document
- `POST /api/search` — Search `{ query, namespace?, topK?, minScore?, rerank?, filters? }`
- `POST /api/context` — Get formatted context `{ query, topK?, namespace? }`
- `GET /api/export?namespace=ns` — Export data
- `POST /api/clear` — Clear index `{ namespace? }`

## MCP Server

Starts a stdio JSON-RPC server with 12 tools:

```bash
node mcp-server.mjs
```

**Tools:** `rag_add_document`, `rag_add_documents`, `rag_search`, `rag_context`, `rag_get_document`, `rag_list_documents`, `rag_delete_document`, `rag_update_document`, `rag_stats`, `rag_namespaces`, `rag_export`, `rag_clear`

## CLI

```bash
node cli.mjs add "document text" --ns my-ns --meta '{"source":"file.txt"}'
node cli.mjs search "query" --ns my-ns --top-k 5
node cli.mjs context "query" --top-k 3
node cli.mjs get <docId> --ns my-ns
node cli.mjs list --ns my-ns --limit 20
node cli.mjs delete <docId> --ns my-ns
node cli.mjs stats --ns my-ns
node cli.mjs namespaces
node cli.mjs export --ns my-ns
node cli.mjs clear --ns my-ns
node cli.mjs serve --port 3123
node cli.mjs mcp
node cli.mjs demo
```

## Metadata Filtering

```js
// Exact match
rag.search('query', { filters: { topic: 'javascript' } });

// Comparison operators
rag.search('query', { filters: { year: { $gte: 2020 } } });

// Array membership
rag.search('query', { filters: { tag: { $in: ['ai', 'ml'] } } });

// Existence
rag.search('query', { filters: { summary: { $exists: true } } });

// Combined (AND)
rag.search('query', { filters: { topic: 'js', level: { $in: ['beginner', 'intermediate'] } } });
```

## How It Works

1. **Chunking**: Documents are split into chunks using the configured strategy
2. **Tokenization**: Each chunk is tokenized (lowercased, stopwords removed, punctuation stripped)
3. **Indexing**: TF-IDF vectors and BM25 document frequencies are computed
4. **Search**: Query is tokenized and scored against all chunks using hybrid TF-IDF × BM25
5. **Re-ranking**: Top candidates are re-ranked using exact phrase matching, term proximity, query coverage, and field boosting
6. **Results**: Scored chunks with source document tracking and metadata

## License

MIT
