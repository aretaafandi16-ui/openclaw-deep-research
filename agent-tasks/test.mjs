#!/usr/bin/env node
/**
 * agent-tasks test suite
 * Run: node test.mjs
 */

import { TaskQueue, STATES } from "./index.mjs";
import { mkdirSync, rmSync, existsSync } from "fs";

const TEST_DIR = "/tmp/agent-tasks-test-" + Date.now();
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; throw new Error(msg); }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

// Cleanup
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("\n🧪 agent-tasks tests\n");

await test("enqueue returns task with id", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t1" });
  const t = q.enqueue({ type: "test", payload: { x: 1 } });
  assert(t.id, "has id");
  assert(t.status === STATES.PENDING, "status pending");
  assert(t.type === "test", "type correct");
  assert(t.priority === "normal", "default priority");
});

await test("priority ordering", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t2" });
  q.enqueue({ type: "low", priority: "low" });
  q.enqueue({ type: "critical", priority: "critical" });
  q.enqueue({ type: "normal" });
  q.enqueue({ type: "high", priority: "high" });
  const types = q.queue.map(t => t.type);
  assert(types[0] === "critical", "critical first");
  assert(types[1] === "high", "high second");
  assert(types[2] === "normal", "normal third");
  assert(types[3] === "low", "low last");
});

await test("task dependencies resolve", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t3", pollMs: 50 });
  q.executor = async () => { await new Promise(r => setTimeout(r, 20)); return "done"; };
  const a = q.enqueue({ type: "a" });
  const b = q.enqueue({ type: "b", waitFor: [a.id] });
  assert(b.status === STATES.WAITING_DEPS, "b waiting for deps");

  q.start();
  await new Promise(r => setTimeout(r, 300));
  q.stop();

  const bFinal = q.get(b.id);
  assert(bFinal.status === STATES.COMPLETED, "b completed after a");
});

await test("concurrency limit", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t4", concurrency: 2, pollMs: 50 });
  let maxRunning = 0;
  q.executor = async () => {
    maxRunning = Math.max(maxRunning, q.running.size);
    await new Promise(r => setTimeout(r, 100));
    return "done";
  };
  for (let i = 0; i < 5; i++) q.enqueue({ type: `t${i}` });
  q.start();
  await new Promise(r => setTimeout(r, 500));
  q.stop();
  assert(maxRunning <= 2, `max concurrent was ${maxRunning} (limit 2)`);
});

await test("retry with backoff", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t5", pollMs: 50 });
  let calls = 0;
  q.executor = async (task) => {
    calls++;
    if (calls < 3) throw new Error("fail");
    return "ok";
  };
  const t = q.enqueue({ type: "flaky", maxRetries: 3, retryDelayMs: 50 });
  q.start();
  await new Promise(r => setTimeout(r, 1000));
  q.stop();
  assert(calls >= 3, `called ${calls} times`);
  const final = q.get(t.id);
  assert(final.status === STATES.COMPLETED, "eventually completed");
});

await test("dead letter after max retries", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t6", pollMs: 50 });
  q.executor = async () => { throw new Error("always fail"); };
  const t = q.enqueue({ type: "doomed", maxRetries: 2, retryDelayMs: 30 });
  q.start();
  await new Promise(r => setTimeout(r, 500));
  q.stop();
  const final = q.get(t.id);
  assert(final.status === STATES.DEAD_LETTER, "in dead letter");
  assert(q.deadLetter.length === 1, "dead letter queue has 1");
});

await test("cancel pending task", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t7" });
  const t = q.enqueue({ type: "cancel-me" });
  const cancelled = q.cancel(t.id);
  assert(cancelled.status === STATES.CANCELLED, "cancelled");
  assert(q.queue.length === 0, "queue empty");
});

await test("delayed execution", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t8-" + Date.now(), pollMs: 50 });
  let execTs = null;
  q.executor = async () => { execTs = Date.now(); return "ok"; };
  const enqTs = Date.now();
  q.enqueue({ type: "delayed", runAt: Date.now() + 400 });
  q.start();
  await new Promise(r => setTimeout(r, 600));
  q.stop();
  assert(execTs !== null, "task was executed");
  assert(execTs - enqTs >= 350, `executed at ${execTs - enqTs}ms (expected >=350ms)`);
});

await test("timeout kills task", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t9", pollMs: 50 });
  q.executor = async () => { await new Promise(r => setTimeout(r, 500)); return "slow"; };
  const t = q.enqueue({ type: "slow", timeoutMs: 100, maxRetries: 0 });
  q.start();
  await new Promise(r => setTimeout(r, 300));
  q.stop();
  const final = q.get(t.id);
  assert(final.status === STATES.DEAD_LETTER, "dead after timeout");
});

await test("stats returns correct counts", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t10", pollMs: 50 });
  q.executor = async () => "ok";
  for (let i = 0; i < 3; i++) q.enqueue({ type: `t${i}` });
  q.start();
  await new Promise(r => setTimeout(r, 300));
  q.stop();
  const s = q.stats();
  assert(s.completed === 3, `completed=${s.completed}`);
  assert(s.totalProcessed === 3, `total=${s.totalProcessed}`);
});

await test("prune removes old tasks", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t11", pollMs: 50 });
  q.executor = async () => "ok";
  q.enqueue({ type: "old" });
  q.start();
  await new Promise(r => setTimeout(r, 200));
  q.stop();
  // artificially age the completed task
  for (const t of q.tasks.values()) {
    if (t.status === STATES.COMPLETED) t.completedAt = Date.now() - 100000;
  }
  const removed = q.prune(50000);
  assert(removed === 1, `pruned ${removed}`);
});

await test("list with filters", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t12" });
  q.enqueue({ type: "a", priority: "high" });
  q.enqueue({ type: "b", priority: "low" });
  q.enqueue({ type: "a", priority: "normal" });
  const high = q.list({ priority: "high" });
  assert(high.length === 1, "1 high priority");
  const typeA = q.list({ type: "a" });
  assert(typeA.length === 2, "2 type=a");
});

await test("clear completed", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t13", pollMs: 50 });
  q.executor = async () => "ok";
  for (let i = 0; i < 3; i++) q.enqueue({ type: `t${i}` });
  q.start();
  await new Promise(r => setTimeout(r, 300));
  q.stop();
  const removed = q.clearCompleted();
  assert(removed === 3, `cleared ${removed}`);
  assert(q.tasks.size === 0, "no tasks left");
});

await test("retry dead letter", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t14", pollMs: 50 });
  let calls = 0;
  q.executor = async () => { calls++; if (calls <= 3) throw new Error("fail"); return "ok"; };
  const t = q.enqueue({ type: "retry-me", maxRetries: 1, retryDelayMs: 30 });
  q.start();
  await new Promise(r => setTimeout(r, 300));
  q.stop();
  assert(q.get(t.id).status === STATES.DEAD_LETTER, "in dead letter");
  const retried = q.retryDeadLetter(t.id);
  assert(retried.status === STATES.PENDING, "back to pending");
  assert(retried.retries === 0, "retries reset");
});

await test("events fire correctly", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t15", pollMs: 50 });
  q.executor = async () => "ok";
  const events = [];
  q.on("enqueue", () => events.push("enqueue"));
  q.on("start", () => events.push("start"));
  q.on("complete", () => events.push("complete"));
  q.enqueue({ type: "evt" });
  q.start();
  await new Promise(r => setTimeout(r, 200));
  q.stop();
  assert(events.includes("enqueue"), "enqueue fired");
  assert(events.includes("start"), "start fired");
  assert(events.includes("complete"), "complete fired");
});

await test("export state", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t16", pollMs: 50 });
  q.executor = async () => "ok";
  q.enqueue({ type: "a" });
  q.enqueue({ type: "b" });
  q.start();
  await new Promise(r => setTimeout(r, 200));
  q.stop();
  const state = q.exportState();
  assert(Array.isArray(state.tasks), "tasks is array");
  assert(state.stats, "has stats");
  assert(state.tasks.length === 2, "2 tasks in export");
});

await test("recurring task spawns", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t17", pollMs: 50 });
  let execCount = 0;
  q.executor = async () => { execCount++; return "ok"; };
  q.enqueue({ type: "recurring", recurring: { everyMs: 150 } });
  q.start();
  await new Promise(r => setTimeout(r, 500));
  q.stop();
  assert(execCount >= 2, `executed ${execCount} times (recurring)`);
});

await test("tick() for manual execution", async () => {
  const q = new TaskQueue({ dataDir: TEST_DIR + "/t18" });
  let ran = false;
  q.executor = async () => { ran = true; return "ok"; };
  q.enqueue({ type: "manual" });
  await q.tick();
  await new Promise(r => setTimeout(r, 50));
  assert(ran, "manual tick executed");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(40)}\n`);

// Cleanup
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });

process.exit(failed > 0 ? 1 : 0);
