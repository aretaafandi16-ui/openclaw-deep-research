#!/usr/bin/env node
/**
 * agent-record CLI
 */

import { SessionRecorder } from './index.mjs';

const recorder = new SessionRecorder({ dataDir: process.env.DATA_DIR || '.agent-record' });
await recorder.loadAll();

const [,, cmd, ...args] = process.argv;

const help = () => console.log(`
🐋 agent-record — Session Recording & Playback CLI

Commands:
  start [id] [--meta JSON]     Start a new recording session
  stop <session_id>            Stop a recording session
  pause <session_id>           Pause a session
  resume <session_id>          Resume a paused session
  record <session_id> <type> <data_json>  Record an entry
  list [--state STATE]         List sessions
  get <session_id>             Get session details
  records <session_id> [--type TYPE] [--search Q] [--limit N]
  get-record <session_id> <seq>
  bookmark <session_id> <label> [seq]
  annotate <session_id> <seq> <note> [--tags t1,t2]
  diff <session_a> <session_b>
  search <query> [--limit N]
  export <session_id> [--format json|markdown|replay]
  stats [session_id]
  demo                         Run a demo recording
  serve [--port PORT]          Start HTTP server
  mcp                          Start MCP stdio server
  help                         Show this help
`);

function parseFlag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  args.splice(idx, 1);
  const val = args[idx];
  args.splice(idx, 1);
  return val;
}

switch (cmd) {
  case 'start': {
    const id = args[0] || undefined;
    const metaStr = parseFlag('meta');
    const meta = metaStr ? JSON.parse(metaStr) : {};
    const s = recorder.startSession(id, meta);
    console.log(`✅ Session started: ${s.id}`);
    break;
  }
  case 'stop': {
    const s = recorder.stopSession(args[0]);
    console.log(`🛑 Session stopped: ${s.id} (${s.stats.duration}ms, ${s.stats.total} records)`);
    break;
  }
  case 'pause': {
    recorder.pauseSession(args[0]);
    console.log(`⏸️  Session paused: ${args[0]}`);
    break;
  }
  case 'resume': {
    recorder.resumeSession(args[0]);
    console.log(`▶️  Session resumed: ${args[0]}`);
    break;
  }
  case 'record': {
    const [sid, type, dataStr] = args;
    const data = JSON.parse(dataStr || '{}');
    const entry = recorder.record(sid, type, data);
    console.log(`📝 Recorded #${entry.seq}: ${entry.type}`);
    break;
  }
  case 'list': {
    const state = parseFlag('state');
    const sessions = recorder.listSessions({ state });
    if (!sessions.length) { console.log('No sessions found.'); break; }
    console.log(`\n${'ID'.padEnd(20)} ${'State'.padEnd(12)} ${'Records'.padEnd(10)} ${'Started'.padEnd(22)} Agent`);
    console.log('─'.repeat(80));
    for (const s of sessions) {
      console.log(`${s.id.padEnd(20)} ${s.state.padEnd(12)} ${String(s.stats.total).padEnd(10)} ${new Date(s.startedAt).toISOString().padEnd(22)} ${s.meta.agent || '-'}`);
    }
    console.log(`\n${sessions.length} session(s)`);
    break;
  }
  case 'get': {
    const s = recorder.getSession(args[0]);
    console.log(JSON.stringify(s, null, 2));
    break;
  }
  case 'records': {
    const sid = args[0];
    const type = parseFlag('type');
    const search = parseFlag('search');
    const limit = parseFlag('limit');
    const opts = {};
    if (type) opts.type = type;
    if (search) opts.search = search;
    if (limit) opts.limit = parseInt(limit);
    const records = recorder.getRecords(sid, opts);
    for (const r of records) {
      console.log(`  [${r.seq}] ${r.type.padEnd(14)} ${JSON.stringify(r.data).slice(0, 120)}`);
    }
    console.log(`\n${records.length} record(s)`);
    break;
  }
  case 'get-record': {
    const r = recorder.getRecord(args[0], parseInt(args[1]));
    console.log(JSON.stringify(r, null, 2));
    break;
  }
  case 'bookmark': {
    const [sid, label, seqStr] = args;
    const bm = recorder.bookmark(sid, label, seqStr ? parseInt(seqStr) : null);
    console.log(`🔖 Bookmarked: ${bm.label} at seq ${bm.seq}`);
    break;
  }
  case 'annotate': {
    const [sid, seqStr, note] = args;
    const tagsStr = parseFlag('tags');
    const tags = tagsStr ? tagsStr.split(',') : [];
    recorder.annotate(sid, parseInt(seqStr), note, tags);
    console.log(`📝 Annotated record #${seqStr}`);
    break;
  }
  case 'diff': {
    const d = recorder.diff(args[0], args[1]);
    console.log(`\n📊 Diff: ${args[0]} vs ${args[1]}`);
    console.log(`  Similarity: ${(d.similarity * 100).toFixed(1)}%`);
    console.log(`  Identical: ${d.identical}`);
    console.log(`  Different: ${d.different.length}`);
    console.log(`  Only in A: ${d.onlyInA.length}`);
    console.log(`  Only in B: ${d.onlyInB.length}`);
    break;
  }
  case 'search': {
    const q = args[0];
    const limit = parseFlag('limit');
    const results = recorder.search(q, { limit: limit ? parseInt(limit) : 50 });
    for (const r of results) {
      console.log(`  [${r.sessionId}] #${r.record.seq} ${r.record.type}: ${JSON.stringify(r.record.data).slice(0, 100)}`);
    }
    console.log(`\n${results.length} result(s)`);
    break;
  }
  case 'export': {
    const sid = args[0];
    const fmt = parseFlag('format') || 'json';
    if (fmt === 'markdown') console.log(recorder.toMarkdown(sid));
    else if (fmt === 'replay') console.log(recorder.toReplayScript(sid));
    else console.log(JSON.stringify(recorder.toJSON(sid), null, 2));
    break;
  }
  case 'stats': {
    const sid = args[0];
    const stats = sid ? recorder.getStats(sid) : recorder.getGlobalStats();
    console.log(JSON.stringify(stats, null, 2));
    break;
  }
  case 'demo': {
    console.log('🐋 Running agent-record demo...\n');
    const s = recorder.startSession('demo-session', { agent: 'demo-agent', tags: ['demo', 'test'] });
    console.log(`  Session started: ${s.id}`);

    recorder.recordInput(s.id, 'What is the capital of France?');
    recorder.recordDecision(s.id, 'Search for answer', 'Knowledge lookup required', 0.9);
    recorder.recordToolCall(s.id, 'search', { query: 'capital of France' });
    recorder.recordToolResult(s.id, 'search', { results: ['Paris is the capital'] });
    recorder.recordOutput(s.id, 'The capital of France is Paris.');
    recorder.recordMetric(s.id, 'latency_ms', 1250, 'ms');
    recorder.recordInput(s.id, 'Tell me about Berlin');
    recorder.recordDecision(s.id, 'Search for answer', 'Knowledge lookup', 0.85);
    recorder.recordError(s.id, new Error('Rate limit exceeded'), { tool: 'search', retry: true });
    recorder.recordToolCall(s.id, 'search', { query: 'Berlin' });
    recorder.recordToolResult(s.id, 'search', { results: ['Berlin is the capital of Germany'] });
    recorder.recordOutput(s.id, 'Berlin is the capital and largest city of Germany.');
    recorder.bookmark(s.id, 'error-encountered', 7);
    recorder.annotate(s.id, 7, 'This was a rate limit - recovered after retry', ['error', 'recovery']);

    const stats = recorder.getStats(s.id);
    console.log(`\n  📊 Session Stats:`);
    console.log(`     Records: ${stats.totalRecords}`);
    console.log(`     Duration: ${stats.duration}ms`);
    console.log(`     Tool calls: ${stats.toolCallsCount} (${stats.uniqueTools} unique)`);
    console.log(`     Errors: ${stats.errorsCount}`);
    console.log(`     Decisions: ${stats.decisionsCount}`);
    console.log(`     Avg confidence: ${stats.avgConfidence}`);
    console.log(`     Avg gap: ${stats.avgRecordGapMs}ms`);

    console.log(`\n  📝 Markdown export preview:`);
    const md = recorder.toMarkdown(s.id);
    console.log(md.split('\n').slice(0, 15).map(l => '     ' + l).join('\n'));
    console.log('     ...\n');

    // Second session for diff demo
    const s2 = recorder.startSession('demo-session-2', { agent: 'demo-agent-v2' });
    recorder.recordInput(s2.id, 'What is the capital of France?');
    recorder.recordOutput(s2.id, 'Paris is the capital city of France.');
    const diff = recorder.diff(s.id, s2.id);
    console.log(`  📊 Diff demo: ${(diff.similarity * 100).toFixed(1)}% similar`);

    recorder.stopSession(s.id);
    recorder.stopSession(s2.id);
    console.log('\n✅ Demo complete!');
    break;
  }
  case 'serve': {
    const port = parseFlag('port') || '3133';
    process.env.PORT = port;
    await import('./server.mjs');
    break;
  }
  case 'mcp': {
    await import('./mcp-server.mjs');
    break;
  }
  case 'help':
  default:
    help();
    break;
}

await recorder.destroy();
