#!/usr/bin/env node
/**
 * agent-memory test suite
 */

import { AgentMemory } from "./index.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;
const errors = [];

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; errors.push(msg); console.error(`  ✗ ${msg}`); }
}

async function test(name, fn) {
  process.stdout.write(`  ${name}...`);
  try {
    await fn();
    console.log(" ✓");
  } catch (e) {
    failed++;
    errors.push(`${name}: ${e.message}`);
    console.error(` ✗ ${e.message}`);
  }
}

async function main() {
  const tmpDir = await mkdtemp(join(tmpdir(), "agent-memory-test-"));
  const mem = new AgentMemory({ dataDir: tmpDir, maxMemories: 100, snapshotIntervalMs: 999999 });

  console.log("agent-memory tests\n");

  await test("init", async () => {
    await mem.init();
    assert(mem.ready, "should be ready");
  });

  let storedId;
  await test("store", async () => {
    const entry = mem.store("test memory content", { tags: ["test", "demo"], importance: 0.7, session: "test-session" });
    assert(entry.id, "should have id");
    assert(entry.content === "test memory content", "content should match");
    assert(entry.tags.length === 2, "should have 2 tags");
    assert(entry.importance === 0.7, "importance should be 0.7");
    assert(entry.session === "test-session", "session should match");
    storedId = entry.id;
  });

  await test("get", async () => {
    const entry = mem.get(storedId);
    assert(entry !== null, "should exist");
    assert(entry.accessCount === 1, "access count should be 1");
    const entry2 = mem.get(storedId);
    assert(entry2.accessCount === 2, "access count should be 2");
  });

  await test("get nonexistent", async () => {
    assert(mem.get("nonexistent") === null, "should return null");
  });

  await test("update", async () => {
    const updated = mem.update(storedId, { importance: 0.9, tags: ["updated"] });
    assert(updated.importance === 0.9, "importance should update");
    assert(updated.tags[0] === "updated", "tags should update");
  });

  await test("update nonexistent", async () => {
    assert(mem.update("nonexistent", {}) === null, "should return null");
  });

  await test("delete", async () => {
    const tempEntry = mem.store("temporary", { session: "test-session" });
    assert(mem.delete(tempEntry.id), "should delete");
    assert(mem.get(tempEntry.id) === null, "should be gone");
  });

  await test("delete nonexistent", async () => {
    assert(!mem.delete("nonexistent"), "should return false");
  });

  await test("search - exact match", async () => {
    mem.store("PostgreSQL database connection settings", { tags: ["db"], importance: 0.8, session: "infra" });
    mem.store("Redis cache configuration for sessions", { tags: ["cache"], importance: 0.6, session: "infra" });
    mem.store("User prefers dark mode UI theme", { tags: ["ui"], importance: 0.5, session: "prefs" });
    const results = mem.search("database connection", { limit: 5 });
    assert(results.length > 0, "should have results");
    assert(results[0].entry.content.includes("PostgreSQL"), "top result should be about PostgreSQL");
  });

  await test("search - with session filter", async () => {
    const results = mem.search("configuration", { session: "infra" });
    assert(results.every((r) => r.entry.session === "infra"), "all results should be from infra session");
  });

  await test("search - with tags filter", async () => {
    const results = mem.search("database", { tags: ["db"] });
    assert(results.every((r) => r.entry.tags.includes("db")), "all results should have db tag");
  });

  await test("search - with min importance", async () => {
    const results = mem.search("database", { minImportance: 0.7 });
    assert(results.every((r) => r.entry.importance >= 0.7), "all results should have importance >= 0.7");
  });

  await test("search - empty query", async () => {
    const results = mem.search("");
    assert(results.length === 0, "empty query should return empty");
  });

  await test("context", async () => {
    const ctx = mem.getContext("infra");
    assert(ctx.length >= 2, "should have at least 2 entries");
    assert(ctx[0].updatedAt >= ctx[1].updatedAt, "should be sorted by recency");
  });

  await test("listSessions", async () => {
    const sessions = mem.listSessions();
    assert(sessions.includes("test-session"), "should include test-session");
    assert(sessions.includes("infra"), "should include infra");
    assert(sessions.includes("prefs"), "should include prefs");
  });

  await test("consolidate", async () => {
    mem.store("database connection uses PostgreSQL on port 5432", { tags: ["db"], session: "merge-test" });
    mem.store("database connection PostgreSQL port 5432 settings", { tags: ["infra"], session: "merge-test" });
    const merged = mem.consolidate("merge-test", 0.3);
    assert(merged > 0, `should merge at least 1 (got ${merged})`);
  });

  await test("forget - decay and purge", async () => {
    mem.store("low importance memory", { importance: 0.03, session: "forget-test" });
    const result = mem.forget();
    assert(typeof result.decayed === "number", "should report decayed count");
    assert(typeof result.forgotten === "number", "should report forgotten count");
  });

  await test("reinforce", async () => {
    const entry = mem.store("important", { importance: 0.5, session: "reinforce-test" });
    const reinforced = mem.reinforce(entry.id, 0.3);
    assert(reinforced.importance === 0.8, "importance should be 0.8");
    assert(reinforced.accessCount === 1, "access count should increment");
  });

  await test("reinforce nonexistent", async () => {
    assert(mem.reinforce("nonexistent") === null, "should return null");
  });

  await test("stats", async () => {
    const stats = mem.stats();
    assert(typeof stats.total === "number", "should have total");
    assert(typeof stats.sessions === "number", "should have sessions");
    assert(typeof stats.avgImportance === "number", "should have avgImportance");
    assert(stats.total > 0, "should have memories");
  });

  await test("export/import", async () => {
    const exported = mem.export("test-session");
    assert(Array.isArray(exported), "export should return array");
    const mem2 = new AgentMemory({ dataDir: await mkdtemp(join(tmpdir(), "import-test-")) });
    await mem2.init();
    const imported = mem2.import(exported);
    assert(imported > 0, `should import entries (got ${imported})`);
    await mem2.destroy();
  });

  await test("session move via update", async () => {
    const entry = mem.store("move me", { session: "old-session" });
    mem.update(entry.id, { session: "new-session" });
    assert(!mem.getContext("old-session").find((e) => e.id === entry.id), "should be removed from old session");
    assert(mem.getContext("new-session").find((e) => e.id === entry.id), "should be in new session");
  });

  await test("custom id", async () => {
    const entry = mem.store("custom id test", { id: "my-custom-id" });
    assert(entry.id === "my-custom-id", "should use custom id");
    assert(mem.get("my-custom-id") !== null, "should be retrievable by custom id");
  });

  await test("metadata", async () => {
    const entry = mem.store("meta test", { metadata: { source: "cli", priority: 1 } });
    assert(entry.metadata.source === "cli", "metadata should be stored");
    mem.update(entry.id, { metadata: { extra: "field" } });
    const updated = mem.get(entry.id);
    assert(updated.metadata.source === "cli", "existing metadata should persist");
    assert(updated.metadata.extra === "field", "new metadata should merge");
  });

  await test("importance bounds", async () => {
    const e1 = mem.store("high", { importance: 2.0 });
    assert(e1.importance === 1, "should clamp to 1");
    const e2 = mem.store("low", { importance: -1 });
    assert(e2.importance === 0, "should clamp to 0");
  });

  await test("auto-cleanup on maxMemories", async () => {
    const smallMem = new AgentMemory({ dataDir: await mkdtemp(join(tmpdir(), "small-")), maxMemories: 5, snapshotIntervalMs: 999999 });
    await smallMem.init();
    for (let i = 0; i < 10; i++) {
      smallMem.store(`memory ${i}`, { importance: i * 0.1 });
    }
    assert(smallMem.memories.size <= 5, `should be <= 5, got ${smallMem.memories.size}`);
    await smallMem.destroy();
  });

  await test("destroy", async () => {
    await mem.destroy();
    assert(!mem.ready, "should not be ready");
  });

  await test("persistence across restart", async () => {
    const persistDir = await mkdtemp(join(tmpdir(), "persist-"));
    const mem1 = new AgentMemory({ dataDir: persistDir, snapshotIntervalMs: 999999 });
    await mem1.init();
    const entry = mem1.store("persist me", { tags: ["persist"], session: "persist-test" });
    await mem1._snapshot();
    await mem1.destroy();

    const mem2 = new AgentMemory({ dataDir: persistDir, snapshotIntervalMs: 999999 });
    await mem2.init();
    const loaded = mem2.get(entry.id);
    assert(loaded !== null, "memory should persist across restart");
    assert(loaded.content === "persist me", "content should persist");
    await mem2.destroy();
  });

  // Cleanup
  await rm(tmpDir, { recursive: true, force: true });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (errors.length) {
    console.error("\nFailures:");
    errors.forEach((e) => console.error(`  - ${e}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
