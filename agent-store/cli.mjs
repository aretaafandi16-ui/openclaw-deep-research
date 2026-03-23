#!/usr/bin/env node
/**
 * agent-store CLI
 * 
 * Usage:
 *   agent-store set myns mykey '{"hello":"world"}'
 *   agent-store get myns mykey
 *   agent-store delete myns mykey
 *   agent-store search myns "key*"
 *   agent-store list myns
 *   agent-store stats
 *   agent-store serve          — Start HTTP server
 *   agent-store mcp            — Start MCP server
 *   agent-store backup /path/to/backup.json
 *   agent-store restore /path/to/backup.json
 * 
 * Options:
 *   --host HOST    API host (default: http://localhost:3096)
 *   --ttl SECS     TTL for set operations
 */

const HOST = process.env.AGENT_STORE_HOST || "http://localhost:3096";

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${HOST}${path}`, opts);
  const data = await res.json();
  if (!res.ok && data.error) {
    console.error(`Error: ${data.error}`);
    process.exit(1);
  }
  return data;
}

const [,, cmd, ...args] = process.argv;

async function main() {
  const ttlIdx = args.indexOf("--ttl");
  let ttl = null;
  if (ttlIdx !== -1) {
    ttl = parseInt(args[ttlIdx + 1]);
    args.splice(ttlIdx, 2);
  }

  switch (cmd) {
    case "get": {
      if (args.length < 2) { console.error("Usage: agent-store get <namespace> <key>"); process.exit(1); }
      const data = await api("GET", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}`);
      if (data.error) { console.log("null"); process.exit(0); }
      console.log(JSON.stringify(data.value, null, 2));
      break;
    }

    case "set": {
      if (args.length < 3) { console.error("Usage: agent-store set <namespace> <key> <json-value> [--ttl secs]"); process.exit(1); }
      const value = JSON.parse(args[2]);
      const data = await api("PUT", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}`, value);
      if (ttl) {
        await api("POST", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}/ttl`, { ttl });
      }
      console.log(JSON.stringify(data));
      break;
    }

    case "delete": {
      if (args.length < 2) { console.error("Usage: agent-store delete <namespace> <key>"); process.exit(1); }
      const data = await api("DELETE", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}`);
      console.log(JSON.stringify(data));
      break;
    }

    case "search": {
      if (args.length < 2) { console.error("Usage: agent-store search <namespace> <pattern>"); process.exit(1); }
      const data = await api("GET", `/ns/${encodeURIComponent(args[0])}/search?pattern=${encodeURIComponent(args[1] || "*")}`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "list": {
      if (args.length < 1) { console.error("Usage: agent-store list <namespace>"); process.exit(1); }
      const data = await api("GET", `/ns/${encodeURIComponent(args[0])}`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "namespaces": {
      const data = await api("GET", "/ns");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "incr":
    case "decr": {
      if (args.length < 2) { console.error(`Usage: agent-store ${cmd} <namespace> <key> [amount]`); process.exit(1); }
      const amount = args[2] ? parseFloat(args[2]) : 1;
      const data = await api("POST", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}/_${cmd}`, { amount });
      console.log(data.value);
      break;
    }

    case "lpush": {
      if (args.length < 3) { console.error("Usage: agent-store lpush <namespace> <key> <value1> [value2...]"); process.exit(1); }
      const values = args.slice(2).map(v => JSON.parse(v));
      const data = await api("POST", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}/_lpush`, { values });
      console.log(JSON.stringify(data));
      break;
    }

    case "lpop": {
      if (args.length < 2) { console.error("Usage: agent-store lpop <namespace> <key>"); process.exit(1); }
      const data = await api("POST", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}/_lpop`);
      console.log(data.found ? JSON.stringify(data.value, null, 2) : "null");
      break;
    }

    case "lrange": {
      if (args.length < 2) { console.error("Usage: agent-store lrange <namespace> <key> [start] [end]"); process.exit(1); }
      const start = args[2] ? parseInt(args[2]) : 0;
      const end = args[3] ? parseInt(args[3]) : -1;
      const data = await api("POST", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}/_lrange`, { start, end });
      console.log(JSON.stringify(data.values, null, 2));
      break;
    }

    case "sadd": {
      if (args.length < 3) { console.error("Usage: agent-store sadd <namespace> <key> <member1> [member2...]"); process.exit(1); }
      const members = args.slice(2).map(v => JSON.parse(v));
      const data = await api("POST", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}/_sadd`, { members });
      console.log(JSON.stringify(data));
      break;
    }

    case "smembers": {
      if (args.length < 2) { console.error("Usage: agent-store smembers <namespace> <key>"); process.exit(1); }
      const data = await api("POST", `/ns/${encodeURIComponent(args[0])}/${encodeURIComponent(args[1])}/_smembers`);
      console.log(JSON.stringify(data.members, null, 2));
      break;
    }

    case "watch": {
      if (args.length < 1) { console.error("Usage: agent-store watch <namespace> [key]"); process.exit(1); }
      const ns = args[0];
      const key = args[1] || "";
      const url = `${HOST}/ns/${encodeURIComponent(ns)}/_watch${key ? `?key=${encodeURIComponent(key)}` : ""}`;
      console.log(`Watching ${ns}${key ? `:${key}` : ":*"} ...`);
      // Use fetch with streaming
      const res = await fetch(url);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ")) {
            console.log(JSON.parse(line.slice(6)));
          }
        }
      }
      break;
    }

    case "stats": {
      const data = await api("GET", "/stats");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "backup": {
      const file = args[0] || `/tmp/agent-store-backup-${Date.now()}.json`;
      const data = await api("POST", "/backup", { file });
      console.log(JSON.stringify(data));
      break;
    }

    case "restore": {
      if (!args[0]) { console.error("Usage: agent-store restore <file>"); process.exit(1); }
      const data = await api("POST", "/restore", { file: args[0] });
      console.log(JSON.stringify(data));
      break;
    }

    case "serve": {
      // Exec the server directly
      const { execFile } = await import("node:child_process");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      execFile("node", [path.join(__dirname, "server.mjs")], { stdio: "inherit" });
      break;
    }

    case "mcp": {
      const { execFile } = await import("node:child_process");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      execFile("node", [path.join(__dirname, "mcp-server.mjs")], { stdio: "inherit" });
      break;
    }

    case "help":
    default:
      console.log(`
agent-store CLI

Commands:
  get <ns> <key>                    Get a value
  set <ns> <key> <json> [--ttl s]   Set a value
  delete <ns> <key>                 Delete a key
  search <ns> <pattern>             Search keys by glob
  list <ns>                         List all keys
  namespaces                        List all namespaces
  stats                             Show store stats
  backup [file]                     Backup to JSON file
  restore <file>                     Restore from backup
  serve                             Start HTTP server
  mcp                               Start MCP server
  help                              Show this help

Options:
  --host HOST   API endpoint (default: http://localhost:3096)
  --ttl SECS    TTL in seconds (for set)
`);
      break;
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
