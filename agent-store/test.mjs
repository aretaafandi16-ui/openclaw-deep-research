#!/usr/bin/env node
/**
 * agent-store test suite
 */

import { AgentStore } from "./index.mjs";
import { unlink, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const TEST_DIR = "/tmp/agent-store-test-" + Date.now();
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}

async function main() {
  console.log("🧪 agent-store tests\n");

  const store = new AgentStore({ dataDir: TEST_DIR, autoSaveMs: 100 });
  await store.init();

  // ── Basic CRUD ───────────────────────────────────────────────
  console.log("Basic CRUD:");
  await store.set("test", "key1", { hello: "world" });
  const val = await store.get("test", "key1");
  assert(val?.hello === "world", "set + get returns value");

  const missing = await store.get("test", "nonexistent");
  assert(missing === undefined, "get missing returns undefined");

  await store.delete("test", "key1");
  const deleted = await store.get("test", "key1");
  assert(deleted === undefined, "delete removes key");

  // ── TTL ─────────────────────────────────────────────────────
  console.log("TTL:");
  await store.set("test", "ttl-key", { temp: true }, { ttl: 1 });
  const beforeExpiry = await store.get("test", "ttl-key");
  assert(beforeExpiry?.temp === true, "key exists before TTL");
  
  await new Promise(r => setTimeout(r, 1200));
  store._checkExpired();
  const afterExpiry = await store.get("test", "ttl-key");
  assert(afterExpiry === undefined, "key expired after TTL");

  // ── Batch Operations ───────────────────────────────────────
  console.log("Batch Operations:");
  await store.mset("batch", [
    { key: "a", value: 1 },
    { key: "b", value: 2 },
    { key: "c", value: 3 },
  ]);
  const batchGet = await store.mget("batch", ["a", "b", "c", "d"]);
  assert(batchGet.a === 1 && batchGet.b === 2 && batchGet.c === 3 && batchGet.d === undefined,
    "mget returns correct values");

  const mdeleted = await store.mdelete("batch", ["a", "b"]);
  assert(mdeleted === 2, "mdelete removes correct count");

  // ── Search ──────────────────────────────────────────────────
  console.log("Search:");
  await store.set("search", "user-1", { name: "alice" });
  await store.set("search", "user-2", { name: "bob" });
  await store.set("search", "config-db", { host: "localhost" });

  const userResults = store.search("search", "user-*");
  assert(userResults.length === 2, "search finds correct matches");

  const allResults = store.search("search", "*");
  assert(allResults.length === 3, "search * returns all");

  // ── Atomic Operations ───────────────────────────────────────
  console.log("Atomic Operations:");
  await store.set("atomic", "lock", { v: 1 });
  const skip = await store.set("atomic", "lock", { v: 2 }, { ifAbsent: true });
  assert(skip.skipped === true, "ifAbsent skips existing key");

  const val2 = await store.get("atomic", "lock");
  assert(val2.v === 1, "original value preserved after ifAbsent");

  // ── List ────────────────────────────────────────────────────
  console.log("List:");
  const namespaces = store.listNamespaces();
  assert(namespaces.some(n => n.name === "search"), "listNamespaces works");
  
  const keys = store.listKeys("search");
  assert(keys.includes("user-1") && keys.includes("config-db"), "listKeys works");

  // ── Backup/Restore ─────────────────────────────────────────
  console.log("Backup/Restore:");
  const backupFile = TEST_DIR + "/backup.json";
  await store.backup(backupFile);
  assert(existsSync(backupFile), "backup file created");

  const store2 = new AgentStore({ dataDir: TEST_DIR + "-restored" });
  await store2.init();
  await store2.restore(backupFile);
  const restored = await store2.get("search", "user-1");
  assert(restored?.name === "alice", "restore loads backup data");
  await store2.destroy();

  // ── Stats ───────────────────────────────────────────────────
  console.log("Stats:");
  const st = store.getStats();
  assert(st.totalGets > 0, "stats tracks gets");
  assert(st.totalSets > 0, "stats tracks sets");
  assert(st.totalDeletes > 0, "stats tracks deletes");

  // ── Cleanup ─────────────────────────────────────────────────
  await store.destroy();
  await rm(TEST_DIR, { recursive: true, force: true });
  await rm(TEST_DIR + "-restored", { recursive: true, force: true });

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
