#!/usr/bin/env node
/**
 * agent-log test suite
 */

import { Logger, ConsoleTransport, FileTransport, LEVELS, genCorrelationId, genId } from "./index.mjs";
import { unlinkSync, existsSync, readFileSync } from "fs";

const TEST_FILE = "/tmp/agent-log-test.jsonl";
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function assertEq(a, b, msg) {
  assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function section(name) { console.log(`\n▸ ${name}`); }

// Clean up
try { unlinkSync(TEST_FILE); } catch {}

// ── Tests ──────────────────────────────────────────────────────────

section("Logger levels");
const logger = new Logger({ name: "test", level: "trace", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
logger.trace("trace msg");
logger.debug("debug msg");
logger.info("info msg");
logger.warn("warn msg");
logger.error("error msg");
logger.fatal("fatal msg");
logger.flush();

const logs = Logger.readJsonl(TEST_FILE);
assertEq(logs.length, 6, "All 6 levels logged");
assertEq(logs[0].level, "trace", "First entry is trace");
assertEq(logs[5].level, "fatal", "Last entry is fatal");
assertEq(logs[0].message, "trace msg", "Message preserved");
assertEq(logs[0].logger, "test", "Logger name set");

section("Level filtering");
try { unlinkSync(TEST_FILE); } catch {}
const warnLogger = new Logger({ name: "warn-test", level: "warn", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
warnLogger.trace("should not appear");
warnLogger.debug("should not appear");
warnLogger.info("should not appear");
warnLogger.warn("this is warn");
warnLogger.error("this is error");
warnLogger.flush();
const warnLogs = Logger.readJsonl(TEST_FILE);
assertEq(warnLogs.length, 2, "Only warn and above logged");
assertEq(warnLogs[0].level, "warn", "First is warn");
assertEq(warnLogs[1].level, "error", "Second is error");

section("Context and metadata");
try { unlinkSync(TEST_FILE); } catch {}
const ctxLogger = new Logger({ name: "ctx-test", context: { app: "myapp" }, transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
ctxLogger.info("with meta", { userId: 42, action: "login" });
ctxLogger.flush();
const ctxLogs = Logger.readJsonl(TEST_FILE);
assertEq(ctxLogs[0].userId, 42, "Meta field userId preserved");
assertEq(ctxLogs[0].action, "login", "Meta field action preserved");

section("Child loggers");
try { unlinkSync(TEST_FILE); } catch {}
const parent = new Logger({ name: "parent", correlationId: "corr-123", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
const child = parent.child({ name: "child-a", context: { module: "auth" } });
child.info("child message");
child.flush();
const childLogs = Logger.readJsonl(TEST_FILE);
assertEq(childLogs[0].correlationId, "corr-123", "Correlation ID inherited");
assertEq(childLogs[0].message, "child message", "Child message logged");

section("Correlation IDs");
const corrId = genCorrelationId();
assert(typeof corrId === "string" && corrId.length > 10, "Correlation ID is a valid string");
assert(corrId.includes("-"), "Correlation ID contains separator");

section("Span tracking");
try { unlinkSync(TEST_FILE); } catch {}
const spanParent = new Logger({ name: "span-test", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
const span = spanParent.startSpan("span-001", { operation: "fetch" });
span.info("inside span");
spanParent.flush();
const spanLogs = Logger.readJsonl(TEST_FILE);
assert(spanLogs.some(e => e.spanId === "span-001"), "Span ID logged");
assert(spanLogs.some(e => e.message.includes("Span started")), "Span start message logged");

section("Redaction");
try { unlinkSync(TEST_FILE); } catch {}
const redactLogger = new Logger({ name: "redact", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
redactLogger.info("user login", { username: "alice", password: "secret123", apiKey: "sk-abc" });
redactLogger.flush();
const redactLogs = Logger.readJsonl(TEST_FILE);
assertEq(redactLogs[0].password, "[REDACTED]", "Password redacted");
assertEq(redactLogs[0].apiKey, "[REDACTED]", "API key redacted");
assertEq(redactLogs[0].username, "alice", "Non-sensitive field preserved");

section("Custom redact fields");
try { unlinkSync(TEST_FILE); } catch {}
const customRedact = new Logger({ name: "custom-redact", redactFields: ["email"], transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
customRedact.info("profile", { email: "a@b.com", name: "Alice" });
customRedact.flush();
const crLogs = Logger.readJsonl(TEST_FILE);
assertEq(crLogs[0].email, "[REDACTED]", "Custom field redacted");
assertEq(crLogs[0].name, "Alice", "Non-custom field preserved");

section("Error serialization");
try { unlinkSync(TEST_FILE); } catch {}
const errLogger = new Logger({ name: "err", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
const testErr = new Error("test error");
testErr.code = "ERR_TEST";
errLogger.error("Something failed", { error: testErr });
errLogger.flush();
const errLogs = Logger.readJsonl(TEST_FILE);
assert(errLogs[0].error, "Error field present");
assertEq(errLogs[0].error.message, "test error", "Error message serialized");

section("Query filters");
try { unlinkSync(TEST_FILE); } catch {}
const qLogger = new Logger({ name: "query-test", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
const childA = qLogger.child({ name: "service-a" });
const childB = qLogger.child({ name: "service-b" });
childA.info("msg from A");
childB.warn("msg from B");
qLogger.error("msg from root");
qLogger.flush();

const allLogs = Logger.readJsonl(TEST_FILE);
assertEq(allLogs.length, 3, "3 log entries written");

const warnOnly = Logger.readJsonl(TEST_FILE, { level: "warn" });
assertEq(warnOnly.length, 2, "warn filter returns 2 entries");

const ctxFilter = Logger.readJsonl(TEST_FILE, { context: "service-a" });
assertEq(ctxFilter.length, 1, "context filter returns 1 entry");

const searchFilter = Logger.readJsonl(TEST_FILE, { search: "root" });
assertEq(searchFilter.length, 1, "search filter finds root message");

section("Stats");
const stats = Logger.statsJsonl(TEST_FILE);
assert(stats.total >= 3, "Stats total >= 3");
assert(stats.byLevel, "Stats has byLevel");
assert(stats.sizeBytes > 0, "Stats has size");

section("Sampling");
try { unlinkSync(TEST_FILE); } catch {}
const sampled = new Logger({ name: "sample", level: "info", sampleRate: 0, transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
for (let i = 0; i < 100; i++) sampled.info("sampled");
sampled.flush();
const sampledLogs = Logger.readJsonl(TEST_FILE);
assertEq(sampledLogs.length, 0, "0% sample rate logs nothing");

section("ID generation");
const id1 = genId(16);
assertEq(id1.length, 16, "genId produces correct length");
const id2 = genId();
assertEq(id2.length, 12, "genId default length is 12");

section("Timestamp format");
try { unlinkSync(TEST_FILE); } catch {}
const tsLogger = new Logger({ name: "ts", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
tsLogger.info("ts test");
tsLogger.flush();
const tsLogs = Logger.readJsonl(TEST_FILE);
assert(tsLogs[0].timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/), "Timestamp is ISO format");

section("Sequence numbers");
try { unlinkSync(TEST_FILE); } catch {}
const seqLogger = new Logger({ name: "seq", transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })] });
seqLogger.info("first");
seqLogger.info("second");
seqLogger.info("third");
seqLogger.flush();
const seqLogs = Logger.readJsonl(TEST_FILE);
assertEq(seqLogs[0].seq, 1, "First seq is 1");
assertEq(seqLogs[1].seq, 2, "Second seq is 2");
assertEq(seqLogs[2].seq, 3, "Third seq is 3");

section("Logger event emitter");
const evtLogger = new Logger({ name: "evt", transports: [] });
let evtCount = 0;
evtLogger.on("log", () => evtCount++);
evtLogger.info("event test");
evtLogger.warn("event test 2");
assertEq(evtCount, 2, "Event emitter fires on each log");

section("Custom filter");
try { unlinkSync(TEST_FILE); } catch {}
const filterLogger = new Logger({
  name: "filter",
  filter: (entry) => entry.level !== "debug",
  transports: [new FileTransport({ path: TEST_FILE, bufferSize: 1 })],
});
filterLogger.debug("filtered out");
filterLogger.info("kept");
filterLogger.flush();
const filterLogs = Logger.readJsonl(TEST_FILE);
assertEq(filterLogs.length, 1, "Custom filter works");
assertEq(filterLogs[0].level, "info", "Only info passed filter");

// Clean up
try { unlinkSync(TEST_FILE); } catch {}

// ── Summary ────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("❌ Some tests failed!");
  process.exit(1);
} else {
  console.log("✅ All tests passed!");
}
