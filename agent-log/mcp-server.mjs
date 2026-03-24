#!/usr/bin/env node
/**
 * agent-log MCP Server
 *
 * Exposes 10 logging tools via Model Context Protocol (JSON-RPC stdio):
 * - log_trace / log_debug / log_info / log_warn / log_error / log_fatal
 * - log_query — search logs from file
 * - log_stats — get log statistics
 * - log_child — create child logger with context
 * - log_export — export filtered logs as JSON
 */

import { readFileSync, existsSync } from "fs";
import { Logger, ConsoleTransport, FileTransport, LEVELS } from "./index.mjs";

const LOG_FILE = process.env.AGENT_LOG_FILE || "./agent-log.jsonl";

// Persistent logger instance
const logger = new Logger({
  name: "mcp",
  level: process.env.AGENT_LOG_LEVEL || "trace",
  transports: [
    new FileTransport({ path: LOG_FILE, level: "trace" }),
  ],
});

// ── MCP Protocol ──────────────────────────────────────────────────

const TOOLS = [
  {
    name: "log_trace",
    description: "Log a message at TRACE level (most verbose, fine-grained debugging)",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Log message" },
        context: { type: "string", description: "Logger context name" },
        meta: { type: "object", description: "Additional metadata (JSON object)" },
      },
      required: ["message"],
    },
  },
  {
    name: "log_debug",
    description: "Log a message at DEBUG level (development/debugging info)",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        context: { type: "string" },
        meta: { type: "object" },
      },
      required: ["message"],
    },
  },
  {
    name: "log_info",
    description: "Log a message at INFO level (general operational information)",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        context: { type: "string" },
        meta: { type: "object" },
      },
      required: ["message"],
    },
  },
  {
    name: "log_warn",
    description: "Log a message at WARN level (potentially harmful situations)",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        context: { type: "string" },
        meta: { type: "object" },
      },
      required: ["message"],
    },
  },
  {
    name: "log_error",
    description: "Log a message at ERROR level (error events, may still allow continuation)",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        context: { type: "string" },
        meta: { type: "object" },
        error: { type: "string", description: "Error message to include" },
      },
      required: ["message"],
    },
  },
  {
    name: "log_fatal",
    description: "Log a message at FATAL level (severe errors causing shutdown)",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        context: { type: "string" },
        meta: { type: "object" },
        error: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "log_query",
    description: "Search and filter logs from the JSONL log file",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["trace", "debug", "info", "warn", "error", "fatal"], description: "Minimum level filter" },
        context: { type: "string", description: "Filter by context/logger name" },
        correlationId: { type: "string", description: "Filter by correlation ID" },
        search: { type: "string", description: "Full-text search across all fields" },
        since: { type: "string", description: "ISO timestamp — only logs after this time" },
        until: { type: "string", description: "ISO timestamp — only logs before this time" },
        limit: { type: "number", description: "Max entries to return (default 100)" },
      },
    },
  },
  {
    name: "log_stats",
    description: "Get log file statistics (count by level, file size)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "log_child",
    description: "Create a child logger with additional context and log a message",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Child logger name" },
        context: { type: "string", description: "Additional context label" },
        level: { type: "string", enum: ["trace", "debug", "info", "warn", "error", "fatal"] },
        message: { type: "string", description: "Message to log immediately" },
        correlationId: { type: "string", description: "Override correlation ID" },
      },
      required: ["name", "message"],
    },
  },
  {
    name: "log_export",
    description: "Export filtered logs as a JSON array",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string" },
        context: { type: "string" },
        search: { type: "string" },
        since: { type: "string" },
        limit: { type: "number", default: 500 },
      },
    },
  },
];

// ── Tool handlers ──────────────────────────────────────────────────

function handleLogTool(level, args) {
  const child = args.context ? logger.child({ name: args.context, context: { name: args.context } }) : logger;
  const meta = args.meta || {};
  if (args.error) meta.error = args.error;
  child[level](args.message, meta);
  return { level, message: args.message, context: args.context || logger.name, timestamp: new Date().toISOString(), logged: true };
}

// ── JSON-RPC Server ────────────────────────────────────────────────

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let req;
    try { req = JSON.parse(line); } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }) + "\n");
      continue;
    }
    handleRequest(req);
  }
});

function respond(id, result, error) {
  const resp = { jsonrpc: "2.0", id };
  if (error) resp.error = error;
  else resp.result = result;
  process.stdout.write(JSON.stringify(resp) + "\n");
}

function handleRequest(req) {
  if (req.method === "initialize") {
    respond(req.id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "agent-log", version: "1.0.0" },
      capabilities: { tools: {} },
    });
    return;
  }
  if (req.method === "notifications/initialized") return;
  if (req.method === "ping") { respond(req.id, {}); return; }

  if (req.method === "tools/list") {
    respond(req.id, { tools: TOOLS });
    return;
  }

  if (req.method === "tools/call") {
    const { name, arguments: args } = req.params;
    try {
      let result;
      if (name === "log_trace") result = handleLogTool("trace", args);
      else if (name === "log_debug") result = handleLogTool("debug", args);
      else if (name === "log_info") result = handleLogTool("info", args);
      else if (name === "log_warn") result = handleLogTool("warn", args);
      else if (name === "log_error") result = handleLogTool("error", args);
      else if (name === "log_fatal") result = handleLogTool("fatal", args);
      else if (name === "log_query") {
        result = Logger.readJsonl(LOG_FILE, args || {});
      } else if (name === "log_stats") {
        result = Logger.statsJsonl(LOG_FILE);
      } else if (name === "log_child") {
        const child = logger.child({ name: args.name, context: { name: args.name }, correlationId: args.correlationId });
        if (args.level && LEVELS[args.level]) {
          child[args.level](args.message);
        } else {
          child.info(args.message);
        }
        result = { name: args.name, logged: true };
      } else if (name === "log_export") {
        result = Logger.readJsonl(LOG_FILE, args || {});
      } else {
        respond(req.id, null, { code: -32601, message: `Unknown tool: ${name}` });
        return;
      }
      respond(req.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      respond(req.id, null, { code: -32603, message: err.message });
    }
    return;
  }

  respond(req.id, null, { code: -32601, message: `Unknown method: ${req.method}` });
}

process.stderr.write(JSON.stringify({
  type: "info",
  message: "agent-log MCP server ready (JSON-RPC stdio)",
  tools: TOOLS.length,
  logFile: LOG_FILE,
  timestamp: new Date().toISOString(),
}) + "\n");
