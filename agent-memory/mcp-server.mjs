#!/usr/bin/env node
/**
 * agent-memory MCP Server
 *
 * Exposes agent-memory as Model Context Protocol tools.
 * Zero dependencies. Node 18+.
 *
 * Tools:
 *   memory_store      — Store a new memory
 *   memory_get        — Get a memory by id
 *   memory_search     — Search memories by keyword relevance
 *   memory_update     — Update memory fields
 *   memory_delete     — Delete a memory
 *   memory_context    — Get session context (all memories for a session)
 *   memory_consolidate — Merge similar memories in a session
 *   memory_forget     — Decay importance & purge low-value memories
 *   memory_reinforce  — Boost a memory's importance
 *   memory_stats      — Get memory system statistics
 *   memory_sessions   — List all sessions
 *   memory_export     — Export memories as JSON
 */

import { AgentMemory } from "./index.mjs";

const DATA_DIR = process.env.DATA_DIR || "./data";
const mem = new AgentMemory({ dataDir: DATA_DIR });

// ─── Tool Definitions ─────────────────────────────────────────────
const TOOLS = [
  {
    name: "memory_store",
    description: "Store a new memory with optional tags, importance, metadata, and session",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory content" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        importance: { type: "number", description: "Importance 0-1 (default 0.5)" },
        metadata: { type: "object", description: "Arbitrary metadata" },
        session: { type: "string", description: "Session/conversation id (default: 'default')" },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_get",
    description: "Get a memory by its id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Memory id" } },
      required: ["id"],
    },
  },
  {
    name: "memory_search",
    description: "Search memories by keyword relevance (BM25 scoring)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 10)" },
        session: { type: "string", description: "Filter by session" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags (AND)" },
        min_importance: { type: "number", description: "Minimum importance filter" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_update",
    description: "Update fields on an existing memory",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory id" },
        content: { type: "string", description: "New content" },
        tags: { type: "array", items: { type: "string" }, description: "New tags" },
        importance: { type: "number", description: "New importance" },
        metadata: { type: "object", description: "Merge metadata" },
        session: { type: "string", description: "Move to session" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_delete",
    description: "Delete a memory by id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Memory id" } },
      required: ["id"],
    },
  },
  {
    name: "memory_context",
    description: "Get all memories for a session, sorted by recency",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session id" },
        limit: { type: "number", description: "Max entries (default 50)" },
      },
      required: ["session"],
    },
  },
  {
    name: "memory_consolidate",
    description: "Merge similar memories within a session to reduce duplication",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session to consolidate" },
        threshold: { type: "number", description: "Similarity threshold 0-1 (default 0.6)" },
      },
      required: ["session"],
    },
  },
  {
    name: "memory_forget",
    description: "Decay importance over time and purge low-value memories",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memory_reinforce",
    description: "Boost a memory's importance (reinforce learning)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory id" },
        boost: { type: "number", description: "Importance boost amount (default 0.1)" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_stats",
    description: "Get memory system statistics",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memory_sessions",
    description: "List all sessions with memory counts",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memory_export",
    description: "Export memories as JSON (optionally filtered by session)",
    inputSchema: {
      type: "object",
      properties: { session: { type: "string", description: "Filter by session (omit for all)" } },
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────
const HANDLERS = {
  memory_store: (args) => mem.store(args.content, args),
  memory_get: (args) => mem.get(args.id),
  memory_search: (args) => {
    const opts = {};
    if (args.limit) opts.limit = args.limit;
    if (args.session) opts.session = args.session;
    if (args.tags) opts.tags = args.tags;
    if (args.min_importance) opts.minImportance = args.min_importance;
    return mem.search(args.query, opts);
  },
  memory_update: (args) => {
    const { id, ...patch } = args;
    return mem.update(id, patch);
  },
  memory_delete: (args) => ({ deleted: mem.delete(args.id) }),
  memory_context: (args) => mem.getContext(args.session, args.limit),
  memory_consolidate: (args) => ({ merged: mem.consolidate(args.session || "default", args.threshold) }),
  memory_forget: () => mem.forget(),
  memory_reinforce: (args) => mem.reinforce(args.id, args.boost),
  memory_stats: () => mem.stats(),
  memory_sessions: () => ({ sessions: mem.listSessions(), stats: mem.stats().bySession }),
  memory_export: (args) => mem.export(args.session),
};

// ─── JSON-RPC 2.0 MCP Server ─────────────────────────────────────
function respond(id, result) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(msg + "\n");
}

function respondError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(msg + "\n");
}

async function handleRequest(req) {
  const { id, method, params } = req;
  try {
    if (method === "initialize") {
      return respond(id, { protocolVersion: "2024-11-05", serverInfo: { name: "agent-memory", version: "1.0.0" }, capabilities: { tools: {} } });
    }
    if (method === "notifications/initialized") return;
    if (method === "tools/list") return respond(id, { tools: TOOLS });
    if (method === "tools/call") {
      const { name, arguments: args } = params;
      const handler = HANDLERS[name];
      if (!handler) return respondError(id, -32601, `Unknown tool: ${name}`);
      const result = handler(args || {});
      return respond(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }
    respondError(id, -32601, `Unknown method: ${method}`);
  } catch (e) {
    respondError(id, -32603, e.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleRequest(JSON.parse(line));
    } catch {}
  }
});

mem.init().then(() => {
  console.error("🧠 agent-memory MCP server ready");
});
