#!/usr/bin/env node
/**
 * agent-rag CLI
 */

import { AgentRAG } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

const persistPath = process.env.PERSIST_PATH || './data/agent-rag.json';
const rag = new AgentRAG({ persistPath, chunkStrategy: process.env.CHUNK_STRATEGY || 'recursive' });
await rag.load().catch(() => {});

function parseFlags(args, start = 1) {
  const flags = {};
  for (let i = start; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      flags[key] = val;
    }
  }
  return flags;
}

const COMMANDS = {
  'add': 'Add a document (rag add "text" --ns namespace --meta \'{"key":"val"}\')',
  'search': 'Search (rag search "query" --ns namespace --top-k 5)',
  'context': 'Get formatted context (rag context "query" --top-k 5)',
  'get': 'Get document by ID (rag get <docId> --ns namespace)',
  'list': 'List documents (rag list --ns namespace --limit 20)',
  'delete': 'Delete document (rag delete <docId> --ns namespace)',
  'update': 'Update document (rag update <docId> "new text")',
  'stats': 'Show statistics (rag stats --ns namespace)',
  'namespaces': 'List namespaces',
  'export': 'Export data (rag export --ns namespace)',
  'clear': 'Clear index (rag clear --ns namespace)',
  'serve': 'Start HTTP server (rag serve --port 3123)',
  'mcp': 'Start MCP server (stdio)',
  'demo': 'Run demo',
  'help': 'Show this help'
};

async function run() {
  switch (cmd) {
    case 'add': {
      const text = args[1];
      if (!text) { console.error('Usage: rag add "document text" [--ns namespace] [--meta \'{"source":"file.txt"}\']'); process.exit(1); }
      const flags = parseFlags(args, 2);
      let meta = {};
      try { meta = JSON.parse(flags.meta || '{}'); } catch {}
      const docId = rag.addDocument(text, meta, flags.ns);
      console.log(JSON.stringify({ docId }));
      break;
    }

    case 'search': {
      const query = args[1];
      if (!query) { console.error('Usage: rag search "query" [--ns namespace] [--top-k 5] [--min-score 0] [--no-rerank]'); process.exit(1); }
      const flags = parseFlags(args, 2);
      const results = rag.search(query, {
        namespace: flags.ns,
        topK: parseInt(flags['top-k'] || '5'),
        minScore: parseFloat(flags['min-score'] || '0'),
        rerank: !flags['no-rerank']
      });
      console.log(JSON.stringify(results, null, 2));
      break;
    }

    case 'context': {
      const query = args[1];
      if (!query) { console.error('Usage: rag context "query" [--ns namespace] [--top-k 5]'); process.exit(1); }
      const flags = parseFlags(args, 2);
      console.log(rag.contextString(query, parseInt(flags['top-k'] || '5'), { namespace: flags.ns }));
      break;
    }

    case 'get': {
      const docId = args[1];
      if (!docId) { console.error('Usage: rag get <docId> [--ns namespace]'); process.exit(1); }
      const flags = parseFlags(args, 2);
      console.log(JSON.stringify(rag.getDocument(docId, flags.ns), null, 2));
      break;
    }

    case 'list': {
      const flags = parseFlags(args, 1);
      console.log(JSON.stringify(rag.listDocuments(flags.ns, { limit: parseInt(flags.limit || '20'), tag: flags.tag }), null, 2));
      break;
    }

    case 'delete': {
      const docId = args[1];
      if (!docId) { console.error('Usage: rag delete <docId> [--ns namespace]'); process.exit(1); }
      const flags = parseFlags(args, 2);
      console.log(JSON.stringify({ deleted: rag.deleteDocument(docId, flags.ns) }));
      break;
    }

    case 'update': {
      const docId = args[1];
      const text = args[2];
      if (!docId || !text) { console.error('Usage: rag update <docId> "new text" [--ns namespace]'); process.exit(1); }
      const flags = parseFlags(args, 3);
      console.log(JSON.stringify({ docId: rag.updateDocument(docId, text, null, flags.ns) }));
      break;
    }

    case 'stats': {
      const flags = parseFlags(args, 1);
      console.log(JSON.stringify(rag.stats(flags.ns), null, 2));
      break;
    }

    case 'namespaces': {
      console.log(JSON.stringify(rag.namespaces()));
      break;
    }

    case 'export': {
      const flags = parseFlags(args, 1);
      console.log(JSON.stringify(rag.export(flags.ns), null, 2));
      break;
    }

    case 'clear': {
      const flags = parseFlags(args, 1);
      rag.clear(flags.ns);
      console.log(JSON.stringify({ cleared: true }));
      break;
    }

    case 'serve': {
      const flags = parseFlags(args, 1);
      process.env.PORT = flags.port || '3123';
      process.env.PERSIST_PATH = persistPath;
      await import('./server.mjs');
      break;
    }

    case 'mcp': {
      process.env.PERSIST_PATH = persistPath;
      await import('./mcp-server.mjs');
      break;
    }

    case 'demo': {
      console.log('=== agent-rag demo ===\n');
      const ns = 'demo';

      // Add documents
      console.log('Adding 5 documents...');
      const docs = [
        { text: 'JavaScript is a high-level, interpreted programming language that conforms to the ECMAScript specification. It supports event-driven, functional, and imperative programming styles.', metadata: { topic: 'javascript', source: 'wiki' } },
        { text: 'Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation.', metadata: { topic: 'python', source: 'wiki' } },
        { text: 'Rust is a systems programming language focused on safety, speed, and concurrency. It achieves memory safety without garbage collection through its ownership system.', metadata: { topic: 'rust', source: 'wiki' } },
        { text: 'Machine learning is a subset of artificial intelligence that focuses on building systems that learn from data. Common approaches include supervised learning, unsupervised learning, and reinforcement learning.', metadata: { topic: 'ml', source: 'textbook' } },
        { text: 'The Transformer architecture revolutionized natural language processing. It uses self-attention mechanisms to process sequential data in parallel, enabling efficient training on large datasets.', metadata: { topic: 'nlp', source: 'paper' } }
      ];
      const docIds = rag.addDocuments(docs, ns);
      console.log(`Added ${docIds.length} documents\n`);

      // Stats
      console.log('Stats:', JSON.stringify(rag.stats(ns), null, 2));
      console.log();

      // Search
      const queries = ['programming language safety', 'machine learning AI', 'attention mechanism NLP'];
      for (const q of queries) {
        console.log(`Query: "${q}"`);
        const results = rag.search(q, { namespace: ns, topK: 3 });
        for (const r of results) {
          console.log(`  [${r.score.toFixed(4)}] ${r.text.slice(0, 80)}...`);
        }
        console.log();
      }

      // Context string
      console.log('Context for "modern programming languages":');
      console.log(rag.contextString('modern programming languages', 3, { namespace: ns }));
      console.log();

      console.log('✅ Demo complete!');
      break;
    }

    case 'help':
    default:
      console.log('agent-rag — Zero-dep RAG engine for AI agents\n');
      console.log('Commands:');
      for (const [name, desc] of Object.entries(COMMANDS)) {
        console.log(`  ${name.padEnd(14)} ${desc}`);
      }
      break;
  }

  await rag.save();
  rag.destroy();
}

run().catch(e => { console.error(e); process.exit(1); });
