#!/usr/bin/env node
/**
 * agent-store MCP Server
 * 
 * Model Context Protocol server for agent-store.
 * Provides AI agents with persistent key-value storage via MCP tools.
 * 
 * Usage:
 *   node mcp-server.mjs
 * 
 * Tools exposed:
 *   - store_get: Get a value by namespace + key
 *   - store_set: Set a value (JSON) with optional TTL
 *   - store_delete: Delete a key
 *   - store_search: Search keys by glob pattern
 *   - store_list: List all keys in a namespace
 *   - store_mget: Batch get multiple keys
 *   - store_mset: Batch set multiple entries
 *   - store_backup: Backup all data to file
 *   - store_stats: Get store statistics
 * 
 * Config via env:
 *   AGENT_STORE_DATA_DIR — Data directory (default: ~/.agent-store)
 */

import { AgentStore } from "./index.mjs";
import { join } from "node:path";

const store = new AgentStore({
  dataDir: process.env.AGENT_STORE_DATA_DIR || join(process.env.HOME || "/tmp", ".agent-store"),
});

// MCP protocol implementation
const tools = {
  store_get: {
    description: "Get a value from the store by namespace and key",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Storage namespace" },
        key: { type: "string", description: "Key to retrieve" },
      },
      required: ["namespace", "key"],
    },
    handler: async ({ namespace, key }) => {
      const value = await store.get(namespace, key);
      if (value === undefined) return { found: false, key };
      return { found: true, key, value };
    },
  },

  store_set: {
    description: "Set a value in the store. Value must be JSON.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Storage namespace" },
        key: { type: "string", description: "Key to set" },
        value: { type: "object", description: "JSON value to store" },
        ttl: { type: "number", description: "Optional TTL in seconds" },
      },
      required: ["namespace", "key", "value"],
    },
    handler: async ({ namespace, key, value, ttl }) => {
      const result = await store.set(namespace, key, value, { ttl });
      return { ...result, key, namespace };
    },
  },

  store_delete: {
    description: "Delete a key from the store",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Storage namespace" },
        key: { type: "string", description: "Key to delete" },
      },
      required: ["namespace", "key"],
    },
    handler: async ({ namespace, key }) => {
      const existed = await store.delete(namespace, key);
      return { deleted: existed, key, namespace };
    },
  },

  store_search: {
    description: "Search keys by glob pattern (e.g., 'config*', 'user-?')",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Storage namespace" },
        pattern: { type: "string", description: "Glob pattern (default: *)" },
      },
      required: ["namespace"],
    },
    handler: async ({ namespace, pattern = "*" }) => {
      const results = store.search(namespace, pattern);
      return { namespace, pattern, count: results.length, results };
    },
  },

  store_list: {
    description: "List all keys in a namespace",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Storage namespace" },
      },
      required: ["namespace"],
    },
    handler: async ({ namespace }) => {
      const keys = store.listKeys(namespace);
      return { namespace, count: keys.length, keys };
    },
  },

  store_mget: {
    description: "Get multiple values at once",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Storage namespace" },
        keys: { type: "array", items: { type: "string" }, description: "Keys to retrieve" },
      },
      required: ["namespace", "keys"],
    },
    handler: async ({ namespace, keys }) => {
      return await store.mget(namespace, keys);
    },
  },

  store_mset: {
    description: "Set multiple values at once",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Storage namespace" },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              value: { type: "object" },
              ttl: { type: "number" },
            },
            required: ["key", "value"],
          },
        },
      },
      required: ["namespace", "entries"],
    },
    handler: async ({ namespace, entries }) => {
      const results = await store.mset(namespace, entries);
      return { namespace, count: results.length, results };
    },
  },

  store_backup: {
    description: "Backup all store data to a JSON file",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Backup file path" },
      },
    },
    handler: async ({ file }) => {
      const backupFile = file || `/tmp/agent-store-backup-${Date.now()}.json`;
      return await store.backup(backupFile);
    },
  },

  store_stats: {
    description: "Get store statistics (keys, namespaces, operations)",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return store.getStats();
    },
  },
};

// ── MCP JSON-RPC Protocol ─────────────────────────────────────────

async function handleRequest(req) {
  const { method, params, id } = req;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-store", version: "1.0.0" },
      },
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: Object.entries(tools).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    const tool = tools[name];
    if (!tool) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      };
    }
    try {
      const result = await tool.handler(args || {});
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: err.message },
      };
    }
  }

  // Notifications don't get responses
  if (method === "notifications/initialized") return null;

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

// ── Stdin/Stdout Transport ─────────────────────────────────────────

async function main() {
  await store.init();
  console.error("agent-store MCP server started");

  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop(); // Keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line);
        const resp = await handleRequest(req);
        if (resp) {
          process.stdout.write(JSON.stringify(resp) + "\n");
        }
      } catch (err) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          }) + "\n"
        );
      }
    }
  });

  process.stdin.on("end", async () => {
    await store.destroy();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    await store.destroy();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await store.destroy();
    process.exit(0);
  });

  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

main();
