#!/usr/bin/env node
/**
 * agent-tasks MCP Server
 * Exposes task queue operations as MCP tools.
 */

import { TaskQueue, STATES } from "./index.mjs";
import { readFileSync } from "fs";

const queue = new TaskQueue({
  dataDir: process.env.TASKS_DATA_DIR || "./agent-tasks-data",
  concurrency: parseInt(process.env.TASKS_CONCURRENCY || "4"),
});

queue.on("complete", (t) => process.stderr.write(`[task complete] ${t.id} ${t.type}\n`));
queue.on("dead_letter", (t) => process.stderr.write(`[dead letter] ${t.id} ${t.type}: ${t.error}\n`));
queue.start();

// ── MCP Protocol ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "tasks_enqueue",
    description: "Enqueue a new task with priority, delay, dependencies, retries, and optional recurring schedule.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Task type label" },
        payload: { type: "object", description: "Arbitrary data for the executor" },
        priority: { type: "string", enum: ["critical", "high", "normal", "low"], default: "normal" },
        runAt: { type: "number", description: "Epoch ms: delay execution until this time" },
        waitFor: { type: "array", items: { type: "string" }, description: "Task IDs that must complete first" },
        maxRetries: { type: "number", default: 3 },
        retryDelayMs: { type: "number", default: 1000 },
        webhookUrl: { type: "string", description: "POST URL on completion" },
        timeoutMs: { type: "number", description: "Kill if running longer than this" },
        recurringEveryMs: { type: "number", description: "Repeat interval in ms" },
        meta: { type: "object" },
      },
      required: ["type"],
    },
  },
  {
    name: "tasks_get",
    description: "Get a task by ID.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "tasks_list",
    description: "List tasks with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: Object.values(STATES) },
        type: { type: "string" },
        priority: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "tasks_cancel",
    description: "Cancel a pending or waiting task.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "tasks_kill",
    description: "Kill a running task.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "tasks_stats",
    description: "Get queue statistics (pending, running, completed, failed, etc.).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tasks_dead_letter",
    description: "Get the dead-letter queue (permanently failed tasks).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tasks_retry_dead",
    description: "Re-enqueue a dead-letter task (reset retries).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "tasks_prune",
    description: "Remove completed/failed tasks older than maxAgeMs (default 24h).",
    inputSchema: { type: "object", properties: { maxAgeMs: { type: "number", default: 86400000 } } },
  },
  {
    name: "tasks_clear_completed",
    description: "Remove all completed tasks from memory.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tasks_export",
    description: "Export full queue state as JSON.",
    inputSchema: { type: "object", properties: {} },
  },
];

function handleRequest(req) {
  const { method, id, params } = req;

  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "agent-tasks", version: "1.0.0" },
    };
  }

  if (method === "tools/list") {
    return { tools: TOOLS };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    try {
      const result = callTool(name, args || {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  return { error: { code: -32601, message: `Unknown method: ${method}` } };
}

function callTool(name, args) {
  switch (name) {
    case "tasks_enqueue": {
      const spec = { ...args };
      if (spec.recurringEveryMs) { spec.recurring = { everyMs: spec.recurringEveryMs }; delete spec.recurringEveryMs; }
      return queue.enqueue(spec);
    }
    case "tasks_get": return queue.get(args.id);
    case "tasks_list": return queue.list(args);
    case "tasks_cancel": return queue.cancel(args.id);
    case "tasks_kill": throw new Error("Kill requires async; use CLI");
    case "tasks_stats": return queue.stats();
    case "tasks_dead_letter": return queue.getDeadLetter();
    case "tasks_retry_dead": return queue.retryDeadLetter(args.id);
    case "tasks_prune": return { removed: queue.prune(args.maxAgeMs) };
    case "tasks_clear_completed": return { removed: queue.clearCompleted() };
    case "tasks_export": return queue.exportState();
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── stdin/stdout JSON-RPC ────────────────────────────────────────────────────

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      const result = handleRequest(req);
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: e.message } }) + "\n");
    }
  }
});

process.stderr.write("agent-tasks MCP server ready\n");
