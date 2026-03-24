#!/usr/bin/env node
/**
 * agent-rag MCP Server — 12 tools via JSON-RPC stdio
 */

import { AgentRAG } from './index.mjs';
import { createInterface } from 'readline';

const rag = new AgentRAG({ persistPath: process.env.PERSIST_PATH || null });
await rag.load().catch(() => {});

const TOOLS = {
  rag_add_document: {
    description: 'Add a document to the RAG index',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Document text content' },
        metadata: { type: 'object', description: 'Optional metadata (source, tag, etc.)' },
        namespace: { type: 'string', description: 'Namespace for isolation' }
      },
      required: ['text']
    },
    handler: async (args) => ({ docId: rag.addDocument(args.text, args.metadata || {}, args.namespace) })
  },

  rag_add_documents: {
    description: 'Add multiple documents at once',
    inputSchema: {
      type: 'object',
      properties: {
        documents: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, metadata: { type: 'object' } } } },
        namespace: { type: 'string' }
      },
      required: ['documents']
    },
    handler: async (args) => ({ docIds: rag.addDocuments(args.documents, args.namespace) })
  },

  rag_search: {
    description: 'Search the RAG index with hybrid TF-IDF + BM25 scoring and re-ranking',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'number', default: 5 },
        namespace: { type: 'string' },
        minScore: { type: 'number', default: 0 },
        rerank: { type: 'boolean', default: true },
        filters: { type: 'object', description: 'Metadata filters' }
      },
      required: ['query']
    },
    handler: async (args) => rag.search(args.query, { topK: args.topK || 5, namespace: args.namespace, minScore: args.minScore || 0, rerank: args.rerank !== false, filters: args.filters })
  },

  rag_context: {
    description: 'Get formatted context string for a query (for prompt injection)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        topK: { type: 'number', default: 5 },
        namespace: { type: 'string' }
      },
      required: ['query']
    },
    handler: async (args) => ({ context: rag.contextString(args.query, args.topK || 5, { namespace: args.namespace }) })
  },

  rag_get_document: {
    description: 'Get a document by ID',
    inputSchema: {
      type: 'object',
      properties: { docId: { type: 'string' }, namespace: { type: 'string' } },
      required: ['docId']
    },
    handler: async (args) => rag.getDocument(args.docId, args.namespace) || { error: 'not found' }
  },

  rag_list_documents: {
    description: 'List documents in a namespace',
    inputSchema: {
      type: 'object',
      properties: { namespace: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'number' } }
    },
    handler: async (args) => rag.listDocuments(args.namespace, { tag: args.tag, limit: args.limit })
  },

  rag_delete_document: {
    description: 'Delete a document by ID',
    inputSchema: {
      type: 'object',
      properties: { docId: { type: 'string' }, namespace: { type: 'string' } },
      required: ['docId']
    },
    handler: async (args) => ({ deleted: rag.deleteDocument(args.docId, args.namespace) })
  },

  rag_update_document: {
    description: 'Update a document (re-index)',
    inputSchema: {
      type: 'object',
      properties: { docId: { type: 'string' }, text: { type: 'string' }, metadata: { type: 'object' }, namespace: { type: 'string' } },
      required: ['docId', 'text']
    },
    handler: async (args) => ({ docId: rag.updateDocument(args.docId, args.text, args.metadata, args.namespace) })
  },

  rag_stats: {
    description: 'Get RAG index statistics',
    inputSchema: {
      type: 'object',
      properties: { namespace: { type: 'string' } }
    },
    handler: async (args) => rag.stats(args.namespace)
  },

  rag_namespaces: {
    description: 'List all namespaces',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => rag.namespaces()
  },

  rag_export: {
    description: 'Export RAG data',
    inputSchema: {
      type: 'object',
      properties: { namespace: { type: 'string' } }
    },
    handler: async (args) => rag.export(args.namespace)
  },

  rag_clear: {
    description: 'Clear RAG index (all or specific namespace)',
    inputSchema: {
      type: 'object',
      properties: { namespace: { type: 'string' } }
    },
    handler: async (args) => { rag.clear(args.namespace); return { cleared: true }; }
  }
};

// ─── JSON-RPC stdio ──────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    write({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-rag', version: '1.0.0' } } });
  } else if (msg.method === 'tools/list') {
    const tools = Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema }));
    write({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    const tool = TOOLS[name];
    if (!tool) {
      write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    } else {
      try {
        const result = await tool.handler(args || {});
        write({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
      } catch (e) {
        write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } });
      }
    }
  } else if (msg.method === 'notifications/initialized') {
    // ignore
  }
});

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

process.on('SIGTERM', async () => { await rag.save(); process.exit(0); });
process.on('SIGINT', async () => { await rag.save(); process.exit(0); });
