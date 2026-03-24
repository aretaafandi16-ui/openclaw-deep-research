#!/usr/bin/env node
/**
 * agent-memory CLI
 *
 * Usage:
 *   agent-memory store <content> [--tags t1,t2] [--importance 0.8] [--session s1] [--metadata '{"k":"v"}']
 *   agent-memory get <id>
 *   agent-memory search <query> [--session s1] [--limit 10] [--tags t1] [--min-importance 0.3]
 *   agent-memory update <id> [--content "new"] [--importance 0.9] [--tags t1,t2]
 *   agent-memory delete <id>
 *   agent-memory context <session> [--limit 50]
 *   agent-memory consolidate <session> [--threshold 0.6]
 *   agent-memory forget
 *   agent-memory reinforce <id> [--boost 0.1]
 *   agent-memory sessions
 *   agent-memory stats
 *   agent-memory export [--session s1]
 *   agent-memory import <file.json>
 *   agent-memory serve [--port 3101]
 *   agent-memory mcp
 *   agent-memory demo
 */

import { AgentMemory } from "./index.mjs";
import { writeFile, readFile } from "node:fs/promises";

const DATA_DIR = process.env.DATA_DIR || "./data";

function flag(args, name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function parseList(v) {
  return v ? v.split(",") : undefined;
}

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(`
agent-memory — Persistent memory for AI agents

Commands:
  store <content>          Store a memory
    --tags t1,t2           Tags
    --importance 0.5       Importance 0-1
    --session s1           Session id
    --metadata '{"k":"v"}' JSON metadata

  get <id>                 Get a memory by id
  search <query>           Search by keyword relevance
    --session s1           Filter session
    --limit 10             Max results
    --tags t1,t2           Filter tags (AND)
    --min-importance 0.3   Min importance

  update <id>              Update a memory
    --content "new"        New content
    --importance 0.9       New importance
    --tags t1,t2           New tags

  delete <id>              Delete a memory
  context <session>        Get session context
  consolidate <session>    Merge similar memories
    --threshold 0.6        Similarity threshold

  forget                   Decay & purge low-value memories
  reinforce <id>           Boost importance
    --boost 0.1            Boost amount

  sessions                 List sessions
  stats                    Show statistics
  export                   Export memories as JSON
    --session s1           Filter by session

  import <file.json>       Import memories from JSON
  serve                    Start HTTP server (--port 3101)
  mcp                      Start MCP server (stdio)
  demo                     Run interactive demo
`);
    process.exit(0);
  }

  const mem = new AgentMemory({ dataDir: DATA_DIR });
  await mem.init();

  switch (cmd) {
    case "store": {
      const content = args.filter((a) => !a.startsWith("--"))[0] || args[0];
      if (!content) { console.error("Error: content required"); process.exit(1); }
      const entry = mem.store(content, {
        tags: parseList(flag(args, "tags")),
        importance: flag(args, "importance") ? +flag(args, "importance") : undefined,
        session: flag(args, "session"),
        metadata: flag(args, "metadata") ? JSON.parse(flag(args, "metadata")) : undefined,
      });
      console.log(JSON.stringify(entry, null, 2));
      break;
    }
    case "get": {
      const entry = mem.get(args[0]);
      if (!entry) { console.error("Not found"); process.exit(1); }
      console.log(JSON.stringify(entry, null, 2));
      break;
    }
    case "search": {
      const query = args.filter((a) => !a.startsWith("--"))[0] || args[0];
      const opts = {};
      if (flag(args, "session")) opts.session = flag(args, "session");
      if (flag(args, "limit")) opts.limit = +flag(args, "limit");
      if (flag(args, "tags")) opts.tags = parseList(flag(args, "tags"));
      if (flag(args, "min-importance")) opts.minImportance = +flag(args, "min-importance");
      const results = mem.search(query, opts);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case "update": {
      const id = args[0];
      const patch = {};
      if (flag(args, "content")) patch.content = flag(args, "content");
      if (flag(args, "importance")) patch.importance = +flag(args, "importance");
      if (flag(args, "tags")) patch.tags = parseList(flag(args, "tags"));
      const entry = mem.update(id, patch);
      if (!entry) { console.error("Not found"); process.exit(1); }
      console.log(JSON.stringify(entry, null, 2));
      break;
    }
    case "delete": {
      const ok = mem.delete(args[0]);
      console.log(JSON.stringify({ deleted: ok }));
      break;
    }
    case "context": {
      const entries = mem.getContext(args[0], +(flag(args, "limit") || 50));
      console.log(JSON.stringify(entries, null, 2));
      break;
    }
    case "consolidate": {
      const merged = mem.consolidate(args[0] || "default", +(flag(args, "threshold") || 0.6));
      console.log(JSON.stringify({ merged }));
      break;
    }
    case "forget": {
      const result = mem.forget();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "reinforce": {
      const entry = mem.reinforce(args[0], +(flag(args, "boost") || 0.1));
      if (!entry) { console.error("Not found"); process.exit(1); }
      console.log(JSON.stringify(entry, null, 2));
      break;
    }
    case "sessions": {
      console.log(JSON.stringify({ sessions: mem.listSessions(), bySession: mem.stats().bySession }, null, 2));
      break;
    }
    case "stats": {
      console.log(JSON.stringify(mem.stats(), null, 2));
      break;
    }
    case "export": {
      const session = flag(args, "session");
      console.log(JSON.stringify(mem.export(session), null, 2));
      break;
    }
    case "import": {
      const raw = await readFile(args[0], "utf8");
      const entries = JSON.parse(raw);
      const count = mem.import(entries);
      console.log(JSON.stringify({ imported: count }));
      break;
    }
    case "serve": {
      const port = +(flag(args, "port") || 3101);
      const srv = new AgentMemory({ port, dataDir: DATA_DIR });
      srv.on("ready", () => console.log(`🧠 agent-memory HTTP on :${port}`));
      await srv.init();
      return; // keep running
    }
    case "mcp": {
      // Re-exec this file as MCP server
      const { spawn } = await import("node:child_process");
      const child = spawn(process.execPath, [new URL("mcp-server.mjs", import.meta.url).pathname], {
        stdio: "inherit",
        env: { ...process.env, DATA_DIR },
      });
      child.on("exit", (code) => process.exit(code));
      return;
    }
    case "demo": {
      console.log("🧠 agent-memory demo\n");

      console.log("1. Storing memories...");
      const m1 = mem.store("The user prefers dark mode in all applications", {
        tags: ["preference", "ui"], importance: 0.8, session: "user-prefs",
      });
      const m2 = mem.store("Project deadline is March 30th for the API migration", {
        tags: ["deadline", "project"], importance: 0.9, session: "project-alpha",
      });
      const m3 = mem.store("Database connection uses PostgreSQL on port 5432", {
        tags: ["infrastructure", "database"], importance: 0.7, session: "project-alpha",
      });
      const m4 = mem.store("User wants weekly progress reports on Fridays", {
        tags: ["preference", "communication"], importance: 0.6, session: "user-prefs",
      });
      const m5 = mem.store("API rate limit is 100 requests per minute per client", {
        tags: ["api", "infrastructure"], importance: 0.75, session: "project-alpha",
      });
      console.log(`   Stored 5 memories across 2 sessions\n`);

      console.log("2. Search for 'deadline project':");
      const results = mem.search("deadline project", { limit: 5 });
      for (const r of results) {
        console.log(`   [${r.score.toFixed(2)}] ${r.entry.content.substring(0, 60)}...`);
      }

      console.log("\n3. Search for 'database connection':");
      const results2 = mem.search("database connection", { limit: 3 });
      for (const r of results2) {
        console.log(`   [${r.score.toFixed(2)}] ${r.entry.content.substring(0, 60)}...`);
      }

      console.log("\n4. Session context for 'project-alpha':");
      const ctx = mem.getContext("project-alpha");
      for (const e of ctx) {
        console.log(`   [${e.tags.join(",")}] ${e.content.substring(0, 60)}...`);
      }

      console.log("\n5. Stats:");
      console.log(JSON.stringify(mem.stats(), null, 2));

      console.log("\n6. Forget cycle:");
      const forgot = mem.forget();
      console.log(JSON.stringify(forgot));

      console.log("\n✅ Demo complete!");
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}. Try --help`);
      process.exit(1);
  }

  await mem.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
