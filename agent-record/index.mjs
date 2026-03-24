/**
 * agent-record — Zero-dep session recording & playback engine for AI agents
 *
 * Features:
 * - Record agent interactions: inputs, outputs, tool calls, decisions, errors
 * - Playback with speed control, step-through, breakpoints
 * - Session diffing (compare two recordings)
 * - Session merging (combine related sessions)
 * - Annotations & bookmarks
 * - Full-text search across recordings
 * - Statistics & analytics
 * - Export: JSON, Markdown, replay script
 * - JSONL persistence + periodic snapshots
 * - EventEmitter for real-time streaming
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';

// ─── Record types ────────────────────────────────────────────────────────────

const RECORD_TYPES = ['input', 'output', 'tool_call', 'tool_result', 'decision', 'error', 'annotation', 'snapshot', 'metric', 'custom'];

// ─── Session Recorder ────────────────────────────────────────────────────────

export class SessionRecorder extends EventEmitter {
  #sessions = new Map();
  #dataDir;
  #autoPersist;
  #persistTimer;
  #persistInterval;

  constructor(opts = {}) {
    super();
    this.#dataDir = opts.dataDir || '.agent-record';
    this.#autoPersist = opts.autoPersist !== false;
    this.#persistInterval = opts.persistInterval || 30000;
    if (this.#autoPersist) {
      this.#persistTimer = setInterval(() => this.saveAll(), this.#persistInterval);
      if (this.#persistTimer.unref) this.#persistTimer.unref();
    }
  }

  // ── Session lifecycle ───────────────────────────────────────────────────

  startSession(sessionId, meta = {}) {
    if (!sessionId) sessionId = `sess_${randomUUID().slice(0, 12)}`;
    if (this.#sessions.has(sessionId)) throw new Error(`Session ${sessionId} already exists`);
    const session = {
      id: sessionId,
      meta: { ...meta },
      records: [],
      bookmarks: [],
      state: 'recording',
      startedAt: Date.now(),
      endedAt: null,
      stats: { total: 0, byType: {}, duration: 0 }
    };
    this.#sessions.set(sessionId, session);
    this.emit('session:started', { sessionId, meta });
    return session;
  }

  pauseSession(sessionId) {
    const s = this.#get(sessionId);
    s.state = 'paused';
    this.emit('session:paused', { sessionId });
    return s;
  }

  resumeSession(sessionId) {
    const s = this.#get(sessionId);
    if (s.state !== 'paused') throw new Error('Session not paused');
    s.state = 'recording';
    this.emit('session:resumed', { sessionId });
    return s;
  }

  stopSession(sessionId) {
    const s = this.#get(sessionId);
    s.state = 'stopped';
    s.endedAt = Date.now();
    s.stats.duration = s.endedAt - s.startedAt;
    this.emit('session:stopped', { sessionId, duration: s.stats.duration });
    return s;
  }

  // ── Recording ───────────────────────────────────────────────────────────

  record(sessionId, type, data, meta = {}) {
    if (!RECORD_TYPES.includes(type)) throw new Error(`Invalid record type: ${type}`);
    const s = this.#get(sessionId);
    if (s.state !== 'recording') throw new Error(`Session ${sessionId} is ${s.state}, not recording`);
    const entry = {
      seq: s.records.length,
      type,
      data: JSON.parse(JSON.stringify(data)),
      meta: { ...meta },
      timestamp: Date.now()
    };
    s.records.push(entry);
    s.stats.total++;
    s.stats.byType[type] = (s.stats.byType[type] || 0) + 1;
    this.emit('record', { sessionId, entry });
    this.emit(`record:${type}`, { sessionId, entry });
    return entry;
  }

  recordInput(sessionId, input, meta = {}) {
    return this.record(sessionId, 'input', { input }, meta);
  }

  recordOutput(sessionId, output, meta = {}) {
    return this.record(sessionId, 'output', { output }, meta);
  }

  recordToolCall(sessionId, tool, args, meta = {}) {
    return this.record(sessionId, 'tool_call', { tool, args }, meta);
  }

  recordToolResult(sessionId, tool, result, meta = {}) {
    return this.record(sessionId, 'tool_result', { tool, result }, meta);
  }

  recordDecision(sessionId, decision, reasoning, confidence, meta = {}) {
    return this.record(sessionId, 'decision', { decision, reasoning, confidence }, meta);
  }

  recordError(sessionId, error, context = {}, meta = {}) {
    const err = typeof error === 'string' ? { message: error } : { message: error.message, stack: error.stack };
    return this.record(sessionId, 'error', { error: err, context }, meta);
  }

  recordMetric(sessionId, name, value, unit = '', meta = {}) {
    return this.record(sessionId, 'metric', { name, value, unit }, meta);
  }

  recordCustom(sessionId, tag, data, meta = {}) {
    return this.record(sessionId, 'custom', { tag, data }, meta);
  }

  // ── Bookmarks & annotations ─────────────────────────────────────────────

  bookmark(sessionId, label, seq = null) {
    const s = this.#get(sessionId);
    const rec = seq !== null ? seq : s.records.length - 1;
    const bm = { label, seq: rec, timestamp: Date.now() };
    s.bookmarks.push(bm);
    this.emit('bookmark', { sessionId, bookmark: bm });
    return bm;
  }

  annotate(sessionId, seq, note, tags = []) {
    return this.record(sessionId, 'annotation', { targetSeq: seq, note, tags }, { autoGenerated: false });
  }

  // ── Querying ────────────────────────────────────────────────────────────

  getSession(sessionId) { return this.#get(sessionId); }

  getRecords(sessionId, opts = {}) {
    const s = this.#get(sessionId);
    let records = s.records;
    if (opts.type) records = records.filter(r => r.type === opts.type);
    if (opts.after) records = records.filter(r => r.timestamp > opts.after);
    if (opts.before) records = records.filter(r => r.timestamp < opts.before);
    if (opts.fromSeq !== undefined) records = records.filter(r => r.seq >= opts.fromSeq);
    if (opts.toSeq !== undefined) records = records.filter(r => r.seq <= opts.toSeq);
    if (opts.limit) records = records.slice(-opts.limit);
    if (opts.offset) records = records.slice(opts.offset);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      records = records.filter(r => JSON.stringify(r.data).toLowerCase().includes(q));
    }
    return records;
  }

  getRecord(sessionId, seq) {
    const s = this.#get(sessionId);
    const rec = s.records[seq];
    if (!rec) throw new Error(`Record ${seq} not found in session ${sessionId}`);
    return rec;
  }

  listSessions(filter = {}) {
    let sessions = [...this.#sessions.values()];
    if (filter.state) sessions = sessions.filter(s => s.state === filter.state);
    if (filter.tag) sessions = sessions.filter(s => s.meta.tags?.includes(filter.tag));
    if (filter.since) sessions = sessions.filter(s => s.startedAt >= filter.since);
    return sessions;
  }

  deleteSession(sessionId) {
    const existed = this.#sessions.delete(sessionId);
    if (existed) this.emit('session:deleted', { sessionId });
    return existed;
  }

  // ── Playback ────────────────────────────────────────────────────────────

  async *playback(sessionId, opts = {}) {
    const s = this.#get(sessionId);
    const speed = opts.speed || 1;
    const types = opts.types || null;
    const fromSeq = opts.fromSeq || 0;
    const toSeq = opts.toSeq ?? s.records.length - 1;
    const breakpoints = new Set(opts.breakpoints || []);

    let prevTs = null;
    for (const rec of s.records) {
      if (rec.seq < fromSeq || rec.seq > toSeq) continue;
      if (types && !types.includes(rec.type)) continue;

      // Timing
      if (prevTs !== null && speed > 0) {
        const gap = (rec.timestamp - prevTs) / speed;
        if (gap > 0 && gap < 60000) await sleep(gap);
      }
      prevTs = rec.timestamp;

      // Breakpoints
      if (breakpoints.has(rec.seq) || breakpoints.has(rec.type)) {
        yield { type: 'breakpoint', record: rec };
      }

      yield { type: 'record', record: rec };
    }
    yield { type: 'end', sessionId };
  }

  stepForward(sessionId, fromSeq = 0) {
    const s = this.#get(sessionId);
    if (fromSeq >= s.records.length - 1) return null;
    return s.records[fromSeq + 1];
  }

  stepBackward(sessionId, fromSeq) {
    const s = this.#get(sessionId);
    if (fromSeq <= 0) return null;
    return s.records[fromSeq - 1];
  }

  // ── Diff ────────────────────────────────────────────────────────────────

  diff(sessionIdA, sessionIdB, opts = {}) {
    const a = this.#get(sessionIdA);
    const b = this.#get(sessionIdB);
    const compareField = opts.compareField || 'type';

    const result = {
      sessionA: sessionIdA,
      sessionB: sessionIdB,
      onlyInA: [],
      onlyInB: [],
      different: [],
      identical: 0,
      similarity: 0
    };

    const bMap = new Map();
    for (const rec of b.records) {
      const key = this.#diffKey(rec, compareField);
      if (!bMap.has(key)) bMap.set(key, []);
      bMap.get(key).push(rec);
    }

    const matched = new Set();
    for (const recA of a.records) {
      const key = this.#diffKey(recA, compareField);
      const matches = bMap.get(key);
      if (matches && matches.length > 0) {
        const match = matches.shift();
        matched.add(match.seq);
        if (JSON.stringify(recA.data) === JSON.stringify(match.data)) {
          result.identical++;
        } else {
          result.different.push({ a: recA, b: match });
        }
      } else {
        result.onlyInA.push(recA);
      }
    }
    for (const recB of b.records) {
      if (!matched.has(recB.seq)) result.onlyInB.push(recB);
    }
    const total = Math.max(a.records.length, b.records.length);
    result.similarity = total > 0 ? (result.identical / total) : 1;
    return result;
  }

  #diffKey(rec, field) {
    if (field === 'type') return rec.type;
    if (field === 'type+tool' && rec.data.tool) return `${rec.type}:${rec.data.tool}`;
    return `${rec.type}:${JSON.stringify(rec.data).slice(0, 100)}`;
  }

  // ── Merge ───────────────────────────────────────────────────────────────

  merge(targetId, sourceId, opts = {}) {
    const target = this.#get(targetId);
    const source = this.#get(sourceId);
    const records = source.records.map(r => ({ ...r, _source: sourceId }));
    if (opts.sortByTime !== false) {
      target.records.push(...records);
      target.records.sort((a, b) => a.timestamp - b.timestamp);
      target.records.forEach((r, i) => r.seq = i);
    } else {
      const offset = target.records.length;
      for (const r of records) {
        r.seq += offset;
        target.records.push(r);
      }
    }
    target.stats.total = target.records.length;
    this.emit('session:merged', { targetId, sourceId, count: records.length });
    return target;
  }

  // ── Search ──────────────────────────────────────────────────────────────

  search(query, opts = {}) {
    const q = query.toLowerCase();
    const results = [];
    for (const [sid, session] of this.#sessions) {
      if (opts.sessionId && sid !== opts.sessionId) continue;
      for (const rec of session.records) {
        const text = JSON.stringify(rec.data).toLowerCase();
        if (text.includes(q)) {
          results.push({ sessionId: sid, record: rec, sessionMeta: session.meta });
          if (opts.limit && results.length >= opts.limit) return results;
        }
      }
    }
    return results;
  }

  // ── Export ───────────────────────────────────────────────────────────────

  toJSON(sessionId) {
    const s = this.#get(sessionId);
    return JSON.parse(JSON.stringify(s));
  }

  toMarkdown(sessionId) {
    const s = this.#get(sessionId);
    let md = `# Session: ${s.id}\n\n`;
    md += `**State:** ${s.state} | **Started:** ${new Date(s.startedAt).toISOString()} | **Records:** ${s.stats.total}\n\n`;
    if (s.meta.agent) md += `**Agent:** ${s.meta.agent}\n`;
    if (s.meta.tags?.length) md += `**Tags:** ${s.meta.tags.join(', ')}\n`;
    md += '\n---\n\n';
    for (const rec of s.records) {
      const icon = { input: '📥', output: '📤', tool_call: '🔧', tool_result: '✅', decision: '🧠', error: '❌', annotation: '📝', snapshot: '📸', metric: '📊', custom: '⚙️' }[rec.type] || '•';
      md += `### ${icon} [${rec.seq}] ${rec.type} — ${new Date(rec.timestamp).toISOString()}\n\n`;
      md += '```json\n' + JSON.stringify(rec.data, null, 2) + '\n```\n\n';
    }
    return md;
  }

  toReplayScript(sessionId) {
    const s = this.#get(sessionId);
    const lines = [
      `// Replay script for session: ${s.id}`,
      `// Generated: ${new Date().toISOString()}`,
      `// Records: ${s.stats.total}`,
      '',
      'const records = ' + JSON.stringify(s.records, null, 2) + ';',
      '',
      'async function replay(records, speed = 1) {',
      '  let prevTs = null;',
      '  for (const rec of records) {',
      '    if (prevTs !== null && speed > 0) {',
      '      const gap = (rec.timestamp - prevTs) / speed;',
      '      if (gap > 0 && gap < 60000) await new Promise(r => setTimeout(r, gap));',
      '    }',
      '    prevTs = rec.timestamp;',
      '    console.log(`[${rec.seq}] ${rec.type}:`, JSON.stringify(rec.data));',
      '  }',
      '}',
      '',
      'replay(records);'
    ];
    return lines.join('\n');
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  getStats(sessionId) {
    const s = this.#get(sessionId);
    const records = s.records;
    const toolCalls = records.filter(r => r.type === 'tool_call');
    const toolResults = records.filter(r => r.type === 'tool_result');
    const errors = records.filter(r => r.type === 'error');
    const decisions = records.filter(r => r.type === 'decision');

    const toolFreq = {};
    for (const tc of toolCalls) toolFreq[tc.data.tool] = (toolFreq[tc.data.tool] || 0) + 1;

    const avgConfidence = decisions.length > 0
      ? decisions.reduce((sum, d) => sum + (d.data.confidence || 0), 0) / decisions.length
      : 0;

    let avgGap = 0;
    if (records.length > 1) {
      let totalGap = 0;
      for (let i = 1; i < records.length; i++) totalGap += records[i].timestamp - records[i - 1].timestamp;
      avgGap = totalGap / (records.length - 1);
    }

    return {
      sessionId: s.id,
      state: s.state,
      totalRecords: records.length,
      byType: { ...s.stats.byType },
      duration: s.stats.duration || (s.endedAt ? s.endedAt - s.startedAt : Date.now() - s.startedAt),
      toolCallsCount: toolCalls.length,
      uniqueTools: Object.keys(toolFreq).length,
      toolFrequency: toolFreq,
      errorsCount: errors.length,
      decisionsCount: decisions.length,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      avgRecordGapMs: Math.round(avgGap),
      bookmarksCount: s.bookmarks.length,
      startedAt: s.startedAt,
      endedAt: s.endedAt
    };
  }

  getGlobalStats() {
    const sessions = [...this.#sessions.values()];
    const allRecords = sessions.flatMap(s => s.records);
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.state === 'recording').length,
      totalRecords: allRecords.length,
      totalErrors: allRecords.filter(r => r.type === 'error').length,
      totalToolCalls: allRecords.filter(r => r.type === 'tool_call').length,
      sessionStates: sessions.reduce((acc, s) => { acc[s.state] = (acc[s.state] || 0) + 1; return acc; }, {})
    };
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  async save(sessionId) {
    const s = this.#get(sessionId);
    await mkdir(this.#dataDir, { recursive: true });
    // JSONL for records
    const jsonlPath = join(this.#dataDir, `${sessionId}.jsonl`);
    const lines = s.records.map(r => JSON.stringify(r));
    await writeFile(jsonlPath, lines.join('\n') + '\n');
    // Snapshot for session meta
    const snap = { ...s, records: undefined };
    await writeFile(join(this.#dataDir, `${sessionId}.meta.json`), JSON.stringify(snap, null, 2));
  }

  async saveAll() {
    for (const sid of this.#sessions.keys()) {
      try { await this.save(sid); } catch { /* skip */ }
    }
  }

  async load(sessionId) {
    await mkdir(this.#dataDir, { recursive: true });
    const metaPath = join(this.#dataDir, `${sessionId}.meta.json`);
    const jsonlPath = join(this.#dataDir, `${sessionId}.jsonl`);
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const records = [];
    try {
      const text = await readFile(jsonlPath, 'utf8');
      for (const line of text.trim().split('\n')) {
        if (line) records.push(JSON.parse(line));
      }
    } catch { /* empty */ }
    meta.records = records;
    meta.stats.total = records.length;
    // Recompute byType from loaded records
    const byType = {};
    for (const r of records) byType[r.type] = (byType[r.type] || 0) + 1;
    meta.stats.byType = byType;
    this.#sessions.set(sessionId, meta);
    return meta;
  }

  async loadAll() {
    await mkdir(this.#dataDir, { recursive: true });
    const files = await readdir(this.#dataDir).catch(() => []);
    const metaFiles = files.filter(f => f.endsWith('.meta.json'));
    for (const f of metaFiles) {
      const sid = f.replace('.meta.json', '');
      try { await this.load(sid); } catch { /* skip */ }
    }
    return this.#sessions.size;
  }

  async destroy() {
    if (this.#persistTimer) clearInterval(this.#persistTimer);
    await this.saveAll();
  }

  // ── Internal ────────────────────────────────────────────────────────────

  #get(sessionId) {
    const s = this.#sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    return s;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export { RECORD_TYPES };
export default SessionRecorder;
