#!/usr/bin/env node
/**
 * agent-tasks CLI
 * Usage: node cli.mjs <command> [options]
 */

import { TaskQueue, STATES } from "./index.mjs";
import { writeFileSync, readFileSync } from "fs";

const args = process.argv.slice(2);
const command = args[0];
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
    flags[key] = val;
  }
}

const dataDir = flags.dataDir || "./agent-tasks-data";
const concurrency = parseInt(flags.concurrency || "4");

function fmt(ms) {
  if (!ms) return "-";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

function printTask(t) {
  const pri = { critical: "🔴", high: "🟠", normal: "🟢", low: "⚪" }[t.priority] || "🟢";
  const age = fmt(Date.now() - t.createdAt);
  console.log(`${pri} ${t.id}  [${t.status}]  ${t.type}  retries:${t.retries}  age:${age}`);
  if (t.error) console.log(`   ⚠ ${t.error}`);
  if (t.result) console.log(`   ✓ ${JSON.stringify(t.result).slice(0, 120)}`);
}

async function main() {
  const queue = new TaskQueue({ dataDir, concurrency, executor: async (task) => {
    console.log(`  ⚙ Executing: ${task.type} (${task.id})`);
    // Default executor just returns the payload
    return { executed: true, payload: task.payload, ts: Date.now() };
  }});

  switch (command) {
    case "enqueue":
    case "add": {
      const task = queue.enqueue({
        type: flags.type || "cli-task",
        payload: flags.payload ? JSON.parse(flags.payload) : {},
        priority: flags.priority || "normal",
        runAt: flags.runAt ? Date.now() + parseInt(flags.runAt) : undefined,
        waitFor: flags.waitFor ? flags.waitFor.split(",") : undefined,
        maxRetries: flags.maxRetries ? parseInt(flags.maxRetries) : undefined,
        timeoutMs: flags.timeoutMs ? parseInt(flags.timeoutMs) : undefined,
        webhookUrl: flags.webhook,
        recurring: flags.recurring ? { everyMs: parseInt(flags.recurring) } : undefined,
        meta: flags.meta ? JSON.parse(flags.meta) : undefined,
      });
      console.log(`✅ Task enqueued: ${task.id}`);
      printTask(task);
      break;
    }

    case "run":
    case "serve": {
      if (flags.executor) {
        // Load custom executor from file
        const mod = await import(flags.executor);
        queue.executor = mod.default || mod.execute || mod.executor || queue.executor;
      }
      queue.start();
      console.log(`🚀 Task queue running (concurrency: ${concurrency}, data: ${dataDir})`);
      console.log("   Press Ctrl+C to stop\n");

      // live status
      const iv = setInterval(() => {
        const s = queue.stats();
        process.stdout.write(`\r  📋 pending:${s.pending}  running:${s.running}  done:${s.completed}  failed:${s.failed}  queue:${s.queueDepth}  `);
      }, 2000);

      queue.on("complete", (t) => console.log(`\n  ✅ ${t.id} ${t.type} completed`));
      queue.on("dead_letter", (t) => console.log(`\n  💀 ${t.id} ${t.type} dead: ${t.error}`));

      process.on("SIGINT", () => { clearInterval(iv); queue.stop(); console.log("\n✋ Stopped"); process.exit(0); });
      // keep alive
      await new Promise(() => {});
      break;
    }

    case "list":
    case "ls": {
      const tasks = queue.list({
        status: flags.status,
        type: flags.type,
        priority: flags.priority,
        limit: flags.limit ? parseInt(flags.limit) : undefined,
      });
      if (tasks.length === 0) { console.log("No tasks found."); break; }
      console.log(`\n  ${tasks.length} task(s):\n`);
      tasks.forEach(printTask);
      break;
    }

    case "get": {
      const id = args[1] || flags.id;
      if (!id) { console.error("Usage: tasks get <id>"); process.exit(1); }
      const task = queue.get(id);
      if (!task) { console.error(`Task ${id} not found`); process.exit(1); }
      console.log(JSON.stringify(task, null, 2));
      break;
    }

    case "cancel": {
      const id = args[1] || flags.id;
      if (!id) { console.error("Usage: tasks cancel <id>"); process.exit(1); }
      const task = queue.cancel(id);
      console.log(`🚫 Cancelled: ${task.id}`);
      break;
    }

    case "stats": {
      const s = queue.stats();
      console.log("\n  📊 Task Queue Stats");
      console.log("  ─────────────────────────────");
      console.log(`  Pending:       ${s.pending}`);
      console.log(`  Waiting deps:  ${s.waitingDeps}`);
      console.log(`  Running:       ${s.running}`);
      console.log(`  Retrying:      ${s.retrying}`);
      console.log(`  Completed:     ${s.completed}`);
      console.log(`  Failed:        ${s.failed}`);
      console.log(`  Dead letter:   ${s.deadLetter}`);
      console.log(`  Total:         ${s.totalProcessed}`);
      console.log(`  Recurring:     ${s.recurring}`);
      console.log(`  Queue depth:   ${s.queueDepth}`);
      console.log(`  Concurrency:   ${s.concurrency}`);
      console.log(`  Uptime:        ${fmt(s.uptime)}`);
      break;
    }

    case "dead":
    case "dead-letter": {
      const dl = queue.getDeadLetter();
      if (dl.length === 0) { console.log("Dead letter queue is empty."); break; }
      console.log(`\n  💀 ${dl.length} dead-letter task(s):\n`);
      dl.forEach(printTask);
      break;
    }

    case "retry-dead": {
      const id = args[1] || flags.id;
      if (!id) { console.error("Usage: tasks retry-dead <id>"); process.exit(1); }
      const task = queue.retryDeadLetter(id);
      console.log(`🔄 Re-enqueued: ${task.id}`);
      break;
    }

    case "prune": {
      const removed = queue.prune(flags.maxAge ? parseInt(flags.maxAge) : 86400000);
      console.log(`🧹 Pruned ${removed} old tasks`);
      break;
    }

    case "clear": {
      const removed = queue.clearCompleted();
      console.log(`🧹 Cleared ${removed} completed tasks`);
      break;
    }

    case "export": {
      const state = queue.exportState();
      const out = flags.output || "/dev/stdout";
      writeFileSync(out, JSON.stringify(state, null, 2));
      if (out !== "/dev/stdout") console.log(`📤 Exported to ${out}`);
      break;
    }

    case "demo": {
      console.log("🎬 Running demo...\n");
      queue.executor = async (task) => {
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
        if (task.type === "flaky" && task.retries < 2) throw new Error("Random failure");
        return { done: true, ts: Date.now() };
      };

      // chain: task_a → task_b → task_c
      const a = queue.enqueue({ type: "fetch-data", priority: "high", payload: { url: "https://api.example.com" } });
      const b = queue.enqueue({ type: "transform", waitFor: [a.id], payload: { format: "csv" } });
      const c = queue.enqueue({ type: "upload", waitFor: [b.id], priority: "critical", payload: { dest: "s3://bucket" } });

      // parallel independent tasks
      queue.enqueue({ type: "notify", priority: "low", payload: { channel: "slack" } });
      queue.enqueue({ type: "flaky", maxRetries: 3, payload: { attempt: "unreliable-api" } });
      queue.enqueue({ type: "delayed", runAt: Date.now() + 1000, payload: { msg: "I run in 1s" } });

      console.log("Tasks enqueued. Running scheduler...\n");
      queue.on("complete", (t) => console.log(`  ✅ ${t.type} (${t.id.slice(0, 12)}) → ${JSON.stringify(t.result)}`));
      queue.on("retry", (t) => console.log(`  🔄 ${t.type} retry #${t.retries}`));
      queue.on("dead_letter", (t) => console.log(`  💀 ${t.type} dead: ${t.error}`));

      queue.start();
      // auto-stop after 5s
      setTimeout(() => {
        queue.stop();
        console.log("\n📊 Final stats:", JSON.stringify(queue.stats()));
        process.exit(0);
      }, 5000);
      break;
    }

    case "mcp": {
      const { spawn } = await import("child_process");
      const child = spawn("node", [new URL("./mcp-server.mjs", import.meta.url).pathname], {
        stdio: "inherit",
        env: { ...process.env, TASKS_DATA_DIR: dataDir, TASKS_CONCURRENCY: String(concurrency) },
      });
      child.on("exit", (code) => process.exit(code || 0));
      break;
    }

    case "help":
    default: {
      console.log(`
agent-tasks v1.0 — Task queue & scheduler for AI agents

COMMANDS:
  enqueue|add    Enqueue a task
    --type <label>          Task type (required)
    --payload <json>        Task payload
    --priority <level>      critical|high|normal|low
    --runAt <ms>            Delay execution by N ms
    --waitFor <id,id,...>   Dependency task IDs
    --maxRetries <n>        Retry count (default 3)
    --timeoutMs <n>         Execution timeout
    --webhook <url>         POST on completion
    --recurring <ms>        Repeat every N ms

  run|serve      Start the scheduler
    --executor <file>       Custom executor module
    --concurrency <n>       Max parallel tasks (default 4)

  list|ls        List tasks
    --status|type|priority  Filters
    --limit <n>

  get <id>       Get task details
  cancel <id>    Cancel a pending task
  kill <id>      Kill a running task

  stats          Queue statistics
  dead|dead-letter   Show dead-letter queue
  retry-dead <id>    Re-enqueue dead-letter task
  prune          Remove old tasks (default 24h)
  clear          Remove all completed tasks
  export         Export state as JSON
  demo           Run interactive demo
  mcp            Start MCP server
  help           This message

ENVIRONMENT:
  TASKS_DATA_DIR     Data directory (default ./agent-tasks-data)
  TASKS_CONCURRENCY  Default concurrency (default 4)
`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
