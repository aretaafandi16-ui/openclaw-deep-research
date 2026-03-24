#!/usr/bin/env node
/**
 * agent-log CLI
 *
 * Commands:
 *   agent-log log <level> <message> [--context=<name>] [--meta=<json>]
 *   agent-log query [--level=<min>] [--context=<name>] [--search=<text>] [--since=<ts>] [--limit=<n>]
 *   agent-log stats
 *   agent-log tail [-f] [--level=<min>]
 *   agent-log child <name> <level> <message>
 *   agent-log export [--format=json|csv] [--limit=<n>]
 *   agent-log serve [--port=<n>]
 *   agent-log mcp
 *   agent-log demo
 */

import { Logger, ConsoleTransport, FileTransport, LEVELS } from "./index.mjs";

const args = process.argv.slice(2);
const command = args[0] || "help";
const flags = {};
for (const a of args.slice(1)) {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    flags[k] = v === undefined ? true : v;
  }
}

const LOG_FILE = flags.file || process.env.AGENT_LOG_FILE || "./agent-log.jsonl";

function getLogArgs() {
  return args.slice(1).filter(a => !a.startsWith("--"));
}

async function main() {
  switch (command) {
    case "log": {
      const [level = "info", ...msgParts] = getLogArgs();
      const message = msgParts.join(" ");
      if (!message) { console.error("Usage: agent-log log <level> <message>"); process.exit(1); }
      const logger = new Logger({
        name: "cli",
        level: "trace",
        transports: [
          new ConsoleTransport({ level: "trace" }),
          new FileTransport({ path: LOG_FILE, level: "trace" }),
        ],
      });
      const meta = flags.meta ? JSON.parse(flags.meta) : {};
      if (flags.context) logger.context = { name: flags.context };
      logger[level]?.(message, meta);
      logger.flush();
      break;
    }

    case "query": {
      const opts = {};
      if (flags.level) opts.level = flags.level;
      if (flags.context) opts.context = flags.context;
      if (flags.search) opts.search = flags.search;
      if (flags.since) opts.since = flags.since;
      if (flags.until) opts.until = flags.until;
      if (flags.correlationId) opts.correlationId = flags.correlationId;
      opts.limit = parseInt(flags.limit || "50");
      const logs = Logger.readJsonl(LOG_FILE, opts);
      for (const entry of logs) {
        const ts = (entry.timestamp || "").slice(11, 23);
        const lvl = entry.level.toUpperCase().padEnd(5);
        const ctx = entry.context ? ` [${entry.context}]` : "";
        console.log(`${ts} ${lvl}${ctx} ${entry.message}`);
      }
      console.log(`\n(${logs.length} entries)`);
      break;
    }

    case "stats": {
      const stats = Logger.statsJsonl(LOG_FILE);
      console.log("📊 Log Statistics");
      console.log("─".repeat(30));
      console.log(`Total entries: ${stats.total}`);
      console.log(`File size:     ${stats.sizeFormatted || "0 B"}`);
      console.log("\nBy level:");
      for (const [level, count] of Object.entries(stats.byLevel || {})) {
        const bar = "█".repeat(Math.min(30, Math.round((count / stats.total) * 30)));
        console.log(`  ${level.padEnd(6)} ${count.toString().padStart(6)} ${bar}`);
      }
      break;
    }

    case "tail": {
      const { watchFile, readFileSync } = await import("fs");
      const opts = {};
      if (flags.level) opts.level = flags.level;
      opts.limit = parseInt(flags.lines || "20");
      const initial = Logger.readJsonl(LOG_FILE, opts);
      for (const e of initial) {
        const ts = (e.timestamp || "").slice(11, 23);
        console.log(`${ts} ${e.level.toUpperCase().padEnd(5)} [${e.context || e.logger}] ${e.message}`);
      }
      if (flags.f || flags.follow) {
        console.log("\n--- Following (Ctrl+C to stop) ---");
        let lastSize = 0;
        try { lastSize = (await import("fs")).statSync(LOG_FILE).size; } catch {}
        watchFile(LOG_FILE, { interval: 500 }, (curr) => {
          if (curr.size <= lastSize) return;
          try {
            const content = readFileSync(LOG_FILE, "utf8");
            const lines = content.split("\n").filter(Boolean);
            for (const line of lines.slice(-5)) {
              try {
                const e = JSON.parse(line);
                if (flags.level && LEVELS[e.level] < LEVELS[flags.level]) continue;
                const ts = (e.timestamp || "").slice(11, 23);
                console.log(`${ts} ${e.level.toUpperCase().padEnd(5)} [${e.context || e.logger}] ${e.message}`);
              } catch {}
            }
          } catch {}
          lastSize = curr.size;
        });
        // Keep process alive
        await new Promise(() => {});
      }
      break;
    }

    case "child": {
      const [name, level = "info", ...msgParts] = getLogArgs();
      const message = msgParts.join(" ");
      if (!name || !message) { console.error("Usage: agent-log child <name> <level> <message>"); process.exit(1); }
      const logger = new Logger({
        name: "cli",
        level: "trace",
        transports: [new ConsoleTransport({ level: "trace" }), new FileTransport({ path: LOG_FILE })],
      });
      const child = logger.child({ name, context: { name } });
      child[level]?.(message);
      logger.flush();
      break;
    }

    case "export": {
      const opts = {};
      if (flags.level) opts.level = flags.level;
      if (flags.context) opts.context = flags.context;
      opts.limit = parseInt(flags.limit || "10000");
      const logs = Logger.readJsonl(LOG_FILE, opts);
      if (flags.format === "csv") {
        console.log("timestamp,level,context,message");
        for (const e of logs) {
          console.log(`${e.timestamp},${e.level},${e.context || ""},"${(e.message || "").replace(/"/g, '""')}"`);
        }
      } else {
        console.log(JSON.stringify(logs, null, 2));
      }
      break;
    }

    case "serve": {
      await import("./server.mjs");
      break;
    }

    case "mcp": {
      await import("./mcp-server.mjs");
      break;
    }

    case "demo": {
      console.log("🐋 agent-log demo\n");
      const logger = new Logger({
        name: "demo",
        level: "trace",
        transports: [new ConsoleTransport({ level: "trace" })],
      });
      logger.trace("Fine-grained debugging", { detail: "Variable x = 42" });
      logger.debug("Processing request", { endpoint: "/api/users", method: "GET" });
      logger.info("User authenticated", { userId: "u_abc123", role: "admin" });
      logger.warn("Rate limit approaching", { current: 295, limit: 300, resetIn: "45s" });
      logger.error("Database query failed", { error: new Error("Connection timeout"), query: "SELECT * FROM users" });
      logger.fatal("System shutdown initiated", { reason: "Out of memory", heapUsed: "1.8GB" });

      console.log("\n--- Child Logger ---");
      const child = logger.child({ name: "auth", context: { name: "authentication" } });
      child.info("Token validated", { tokenId: "tk_xyz" });
      child.warn("Expired token detected", { userId: "u_def456", expired: "2026-03-20T00:00:00Z" });

      console.log("\n--- Span Tracking ---");
      const span = logger.startSpan("req-789", { endpoint: "/api/data" });
      span.debug("Fetching data from cache");
      span.info("Cache miss, querying database");
      span.info("Data retrieved", { rows: 42, durationMs: 156 });

      console.log("\n--- Timer ---");
      await logger.time("Simulated async work", async () => {
        await new Promise(r => setTimeout(r, 100));
        return "done";
      }, { task: "data-processing" });

      console.log("\n--- Sampling (50%) ---");
      const sampled = new Logger({
        name: "sampled",
        level: "info",
        sampleRate: 0.5,
        transports: [new ConsoleTransport()],
      });
      for (let i = 0; i < 10; i++) sampled.info(`Sample message ${i + 1}`);

      console.log("\n--- Redaction ---");
      const secure = new Logger({ name: "secure", transports: [new ConsoleTransport()] });
      secure.info("User login", { username: "alice", password: "hunter2", apiKey: "sk-abc123" });

      console.log("\n✅ Demo complete!");
      break;
    }

    case "help":
    default: {
      console.log(`
🐋 agent-log — Zero-dependency structured logging for AI agents

Usage: agent-log <command> [options]

Commands:
  log <level> <message>     Log a message (levels: trace,debug,info,warn,error,fatal)
  query                     Search/filter logs
  stats                     Show log file statistics
  tail [-f]                 Show recent logs (-f to follow)
  child <name> <lvl> <msg>  Log with child logger context
  export [--format=json|csv] Export logs
  serve                     Start HTTP dashboard (port 3115)
  mcp                       Start MCP server (JSON-RPC stdio)
  demo                      Run interactive demo
  help                      Show this help

Options:
  --file=<path>         Log file path (default: ./agent-log.jsonl)
  --context=<name>      Logger context name
  --meta=<json>         Additional metadata as JSON
  --level=<min>         Minimum log level filter
  --search=<text>       Full-text search
  --since=<ISO>         Filter: after timestamp
  --until=<ISO>         Filter: before timestamp
  --limit=<n>           Max entries (default: 50)
  --port=<n>            HTTP server port (default: 3115)
  --format=<json|csv>   Export format
  --lines=<n>           Tail lines count
  -f                    Follow mode for tail

Examples:
  agent-log log info "Server started" --context=web --meta='{"port":3000}'
  agent-log query --level=warn --search=timeout --limit=20
  agent-log tail -f --level=info
  agent-log export --format=csv --limit=1000
`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
