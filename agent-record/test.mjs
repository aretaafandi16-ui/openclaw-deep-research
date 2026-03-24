/**
 * agent-record test suite
 */

import { SessionRecorder, RECORD_TYPES } from './index.mjs';
import { strict as assert } from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function atest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

const dataDir = await mkdtemp(join(tmpdir(), 'agent-record-test-'));

console.log('\n🐋 agent-record tests\n');

// ── Record types ─────────────────────────────────────────────────────────────
console.log('Record Types');
test('RECORD_TYPES contains expected types', () => {
  assert.ok(RECORD_TYPES.includes('input'));
  assert.ok(RECORD_TYPES.includes('output'));
  assert.ok(RECORD_TYPES.includes('tool_call'));
  assert.ok(RECORD_TYPES.includes('tool_result'));
  assert.ok(RECORD_TYPES.includes('decision'));
  assert.ok(RECORD_TYPES.includes('error'));
  assert.ok(RECORD_TYPES.includes('annotation'));
  assert.ok(RECORD_TYPES.includes('metric'));
  assert.ok(RECORD_TYPES.includes('custom'));
  assert.equal(RECORD_TYPES.length, 10);
});

// ── Session lifecycle ────────────────────────────────────────────────────────
console.log('\nSession Lifecycle');
const r = new SessionRecorder({ dataDir, autoPersist: false });

test('startSession creates session', () => {
  const s = r.startSession('test-1', { agent: 'gpt-4', tags: ['demo'] });
  assert.equal(s.id, 'test-1');
  assert.equal(s.state, 'recording');
  assert.equal(s.meta.agent, 'gpt-4');
});

test('startSession auto-generates ID', () => {
  const s = r.startSession();
  assert.ok(s.id.startsWith('sess_'));
});

test('startSession throws on duplicate', () => {
  assert.throws(() => r.startSession('test-1'), /already exists/);
});

test('pauseSession sets state', () => {
  const s = r.pauseSession('test-1');
  assert.equal(s.state, 'paused');
});

test('resumeSession sets state', () => {
  const s = r.resumeSession('test-1');
  assert.equal(s.state, 'recording');
});

test('resumeSession throws if not paused', () => {
  assert.throws(() => r.resumeSession('test-1'), /not paused/);
});

test('stopSession sets state and endedAt', () => {
  const s = r.stopSession('test-1');
  assert.equal(s.state, 'stopped');
  assert.ok(s.endedAt);
  assert.ok(s.stats.duration >= 0);
});

// ── Recording ────────────────────────────────────────────────────────────────
console.log('\nRecording');
const r2 = new SessionRecorder({ autoPersist: false });
r2.startSession('rec-1');

test('recordInput', () => {
  const e = r2.recordInput('rec-1', 'Hello world');
  assert.equal(e.type, 'input');
  assert.equal(e.seq, 0);
  assert.equal(e.data.input, 'Hello world');
});

test('recordOutput', () => {
  const e = r2.recordOutput('rec-1', 'Hi there!');
  assert.equal(e.type, 'output');
  assert.equal(e.seq, 1);
});

test('recordToolCall', () => {
  const e = r2.recordToolCall('rec-1', 'search', { q: 'test' });
  assert.equal(e.type, 'tool_call');
  assert.equal(e.data.tool, 'search');
  assert.deepEqual(e.data.args, { q: 'test' });
});

test('recordToolResult', () => {
  const e = r2.recordToolResult('rec-1', 'search', { results: [] });
  assert.equal(e.type, 'tool_result');
  assert.equal(e.data.tool, 'search');
});

test('recordDecision', () => {
  const e = r2.recordDecision('rec-1', 'Use search', 'Need info', 0.85);
  assert.equal(e.type, 'decision');
  assert.equal(e.data.confidence, 0.85);
});

test('recordError', () => {
  const e = r2.recordError('rec-1', new Error('fail'), { tool: 'x' });
  assert.equal(e.type, 'error');
  assert.equal(e.data.error.message, 'fail');
  assert.ok(e.data.error.stack);
});

test('recordError with string', () => {
  const e = r2.recordError('rec-1', 'oops');
  assert.equal(e.data.error.message, 'oops');
});

test('recordMetric', () => {
  const e = r2.recordMetric('rec-1', 'latency', 123, 'ms');
  assert.equal(e.type, 'metric');
  assert.equal(e.data.value, 123);
});

test('recordCustom', () => {
  const e = r2.recordCustom('rec-1', 'my-tag', { foo: 1 });
  assert.equal(e.type, 'custom');
  assert.equal(e.data.tag, 'my-tag');
});

test('record rejects invalid type', () => {
  assert.throws(() => r2.record('rec-1', 'invalid', {}), /Invalid record type/);
});

test('record rejects paused session', () => {
  r2.pauseSession('rec-1');
  assert.throws(() => r2.recordInput('rec-1', 'x'), /not recording/);
  r2.resumeSession('rec-1');
});

// ── Bookmarks & Annotations ──────────────────────────────────────────────────
console.log('\nBookmarks & Annotations');

test('bookmark at current seq', () => {
  const bm = r2.bookmark('rec-1', 'important');
  assert.equal(bm.label, 'important');
  assert.ok(bm.seq >= 0);
});

test('bookmark at specific seq', () => {
  const bm = r2.bookmark('rec-1', 'first', 0);
  assert.equal(bm.seq, 0);
});

test('annotate record', () => {
  const e = r2.annotate('rec-1', 0, 'This is a note', ['review']);
  assert.equal(e.type, 'annotation');
  assert.equal(e.data.note, 'This is a note');
  assert.deepEqual(e.data.tags, ['review']);
});

// ── Querying ─────────────────────────────────────────────────────────────────
console.log('\nQuerying');

test('getSession', () => {
  const s = r2.getSession('rec-1');
  assert.equal(s.id, 'rec-1');
});

test('getSession throws on missing', () => {
  assert.throws(() => r2.getSession('nonexistent'), /not found/);
});

test('getRecords all', () => {
  const records = r2.getRecords('rec-1');
  assert.ok(records.length >= 10);
});

test('getRecords by type', () => {
  const inputs = r2.getRecords('rec-1', { type: 'input' });
  assert.ok(inputs.every(r => r.type === 'input'));
});

test('getRecords by search', () => {
  const results = r2.getRecords('rec-1', { search: 'Hello' });
  assert.ok(results.length >= 1);
});

test('getRecords with limit', () => {
  const records = r2.getRecords('rec-1', { limit: 3 });
  assert.equal(records.length, 3);
});

test('getRecord by seq', () => {
  const rec = r2.getRecord('rec-1', 0);
  assert.equal(rec.seq, 0);
  assert.equal(rec.type, 'input');
});

test('listSessions', () => {
  const sessions = r2.listSessions();
  assert.ok(sessions.length >= 1);
});

test('listSessions by state', () => {
  const active = r2.listSessions({ state: 'recording' });
  assert.ok(active.length >= 1);
});

test('deleteSession', () => {
  const r3 = new SessionRecorder({ autoPersist: false });
  r3.startSession('del-1');
  assert.ok(r3.deleteSession('del-1'));
  assert.ok(!r3.deleteSession('del-1'));
});

// ── Playback ─────────────────────────────────────────────────────────────────
console.log('\nPlayback');

test('playback yields all records', async () => {
  const r4 = new SessionRecorder({ autoPersist: false });
  r4.startSession('pb-1');
  r4.recordInput('pb-1', 'a');
  r4.recordOutput('pb-1', 'b');
  r4.recordInput('pb-1', 'c');
  const items = [];
  for await (const item of r4.playback('pb-1', { speed: 0 })) {
    items.push(item);
  }
  assert.equal(items.filter(i => i.type === 'record').length, 3);
  assert.equal(items[items.length - 1].type, 'end');
});

test('playback with type filter', async () => {
  const r4 = new SessionRecorder({ autoPersist: false });
  r4.startSession('pb-2');
  r4.recordInput('pb-2', 'a');
  r4.recordOutput('pb-2', 'b');
  r4.recordInput('pb-2', 'c');
  const items = [];
  for await (const item of r4.playback('pb-2', { speed: 0, types: ['input'] })) {
    if (item.type === 'record') items.push(item);
  }
  assert.equal(items.length, 2);
});

test('stepForward', () => {
  const rec = r2.stepForward('rec-1', 0);
  assert.equal(rec.seq, 1);
});

test('stepForward at end returns null', () => {
  const s = r2.getSession('rec-1');
  const rec = r2.stepForward('rec-1', s.records.length - 1);
  assert.equal(rec, null);
});

test('stepBackward', () => {
  const rec = r2.stepBackward('rec-1', 1);
  assert.equal(rec.seq, 0);
});

test('stepBackward at start returns null', () => {
  const rec = r2.stepBackward('rec-1', 0);
  assert.equal(rec, null);
});

// ── Diff ─────────────────────────────────────────────────────────────────────
console.log('\nDiff');

test('diff identical sessions', () => {
  const r5 = new SessionRecorder({ autoPersist: false });
  r5.startSession('d1');
  r5.startSession('d2');
  r5.recordInput('d1', 'hello');
  r5.recordOutput('d1', 'hi');
  r5.recordInput('d2', 'hello');
  r5.recordOutput('d2', 'hi');
  const d = r5.diff('d1', 'd2');
  assert.equal(d.identical, 2);
  assert.equal(d.similarity, 1);
});

test('diff different sessions', () => {
  const r5 = new SessionRecorder({ autoPersist: false });
  r5.startSession('d3');
  r5.startSession('d4');
  r5.recordInput('d3', 'hello');
  r5.recordInput('d4', 'world');
  const d = r5.diff('d3', 'd4');
  assert.equal(d.identical, 0);
  assert.equal(d.different.length, 1);
});

test('diff with onlyInA/onlyInB', () => {
  const r5 = new SessionRecorder({ autoPersist: false });
  r5.startSession('d5');
  r5.startSession('d6');
  r5.recordInput('d5', 'a');
  r5.recordOutput('d5', 'b');
  r5.recordInput('d6', 'a');
  const d = r5.diff('d5', 'd6');
  assert.equal(d.onlyInA.length, 1);
});

// ── Merge ────────────────────────────────────────────────────────────────────
console.log('\nMerge');

test('merge appends and re-indexes', () => {
  const r6 = new SessionRecorder({ autoPersist: false });
  r6.startSession('m1');
  r6.startSession('m2');
  r6.recordInput('m1', 'a');
  r6.recordInput('m2', 'b');
  r6.recordInput('m2', 'c');
  r6.merge('m1', 'm2');
  const s = r6.getSession('m1');
  assert.equal(s.records.length, 3);
  assert.equal(s.records[0].data.input, 'a');
});

// ── Search ───────────────────────────────────────────────────────────────────
console.log('\nSearch');

test('search across sessions', () => {
  const r7 = new SessionRecorder({ autoPersist: false });
  r7.startSession('s1');
  r7.startSession('s2');
  r7.recordInput('s1', 'findme please');
  r7.recordInput('s2', 'nothing here');
  const results = r7.search('findme');
  assert.equal(results.length, 1);
  assert.equal(results[0].sessionId, 's1');
});

test('search with session filter', () => {
  const results = r2.search('search', { sessionId: 'rec-1' });
  assert.ok(results.every(r => r.sessionId === 'rec-1'));
});

// ── Export ────────────────────────────────────────────────────────────────────
console.log('\nExport');

test('toJSON returns full session', () => {
  const j = r2.toJSON('rec-1');
  assert.equal(j.id, 'rec-1');
  assert.ok(Array.isArray(j.records));
});

test('toMarkdown returns string', () => {
  const md = r2.toMarkdown('rec-1');
  assert.ok(md.includes('# Session:'));
  assert.ok(md.includes('📥'));
  assert.ok(md.includes('🔧'));
});

test('toReplayScript returns JS code', () => {
  const script = r2.toReplayScript('rec-1');
  assert.ok(script.includes('async function replay'));
  assert.ok(script.includes('records'));
});

// ── Stats ────────────────────────────────────────────────────────────────────
console.log('\nStats');

test('getStats returns correct counts', () => {
  const stats = r2.getStats('rec-1');
  assert.equal(stats.sessionId, 'rec-1');
  assert.ok(stats.totalRecords > 0);
  assert.ok(stats.byType.input > 0);
  assert.ok(stats.byType.tool_call > 0);
  assert.ok(stats.duration >= 0);
});

test('getGlobalStats', () => {
  const gs = r2.getGlobalStats();
  assert.ok(gs.totalSessions >= 1);
  assert.ok(gs.totalRecords > 0);
});

// ── Persistence ──────────────────────────────────────────────────────────────
console.log('\nPersistence');

atest('save and load session', async () => {
  const persistDir = await mkdtemp(join(tmpdir(), 'ar-persist-'));
  const r8 = new SessionRecorder({ dataDir: persistDir, autoPersist: false });
  r8.startSession('persist-1', { agent: 'test' });
  r8.recordInput('persist-1', 'hello');
  r8.recordOutput('persist-1', 'world');
  await r8.save('persist-1');

  const r9 = new SessionRecorder({ dataDir: persistDir, autoPersist: false });
  const loaded = await r9.load('persist-1');
  assert.equal(loaded.id, 'persist-1');
  assert.equal(loaded.meta.agent, 'test');
  const records = r9.getRecords('persist-1');
  assert.equal(records.length, 2);
  assert.equal(records[0].data.input, 'hello');
  await rm(persistDir, { recursive: true, force: true }).catch(() => {});
});

atest('loadAll loads multiple sessions', async () => {
  const allDir = await mkdtemp(join(tmpdir(), 'ar-all-'));
  const r10 = new SessionRecorder({ dataDir: allDir, autoPersist: false });
  r10.startSession('all-1');
  r10.startSession('all-2');
  r10.recordInput('all-1', 'x');
  r10.recordInput('all-2', 'y');
  await r10.saveAll();

  const r11 = new SessionRecorder({ dataDir: allDir, autoPersist: false });
  const count = await r11.loadAll();
  assert.equal(count, 2);
  await rm(allDir, { recursive: true, force: true }).catch(() => {});
});

// ── Events ───────────────────────────────────────────────────────────────────
console.log('\nEvents');

test('emits session:started', () => {
  const r12 = new SessionRecorder({ autoPersist: false });
  let fired = false;
  r12.on('session:started', () => { fired = true; });
  r12.startSession('evt-1');
  assert.ok(fired);
});

test('emits record events', () => {
  const r12 = new SessionRecorder({ autoPersist: false });
  r12.startSession('evt-2');
  let fired = false;
  r12.on('record:input', () => { fired = true; });
  r12.recordInput('evt-2', 'test');
  assert.ok(fired);
});

test('emits bookmark', () => {
  const r12 = new SessionRecorder({ autoPersist: false });
  r12.startSession('evt-3');
  r12.recordInput('evt-3', 'test');
  let fired = false;
  r12.on('bookmark', () => { fired = true; });
  r12.bookmark('evt-3', 'mark');
  assert.ok(fired);
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
await rm(dataDir, { recursive: true, force: true }).catch(() => {});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(40)}\n`);

if (failed > 0) process.exit(1);
