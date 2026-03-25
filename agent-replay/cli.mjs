#!/usr/bin/env node
/**
 * agent-replay CLI
 */

import { ReplayEngine } from './index.mjs';
import { writeFileSync } from 'node:fs';

const [,, cmd, ...args] = process.argv;
const engine = new ReplayEngine();

function help() {
  console.log(`
agent-replay CLI — Deterministic replay engine

Commands:
  demo                          Run demo scenario
  create <id>                   Create session
  record <session> <type> [json] Record step
  list                          List sessions
  get <session>                 Get session details
  timeline <session>            Show timeline
  assert-state <session> <idx> <expected-json>
  assert-output <session> <idx> <expected-json>
  assert-no-errors <session>
  diff <sessionA> <sessionB>    Compare sessions
  merge <sessionA> <sessionB>   Merge sessions
  export-json <session>         Export as JSON
  export-md <session>           Export as Markdown
  stats                         Global stats
  serve                         Start HTTP server
  mcp                           Start MCP server
  help                          Show this help
`);
}

function parseJSON(str) { try { return JSON.parse(str); } catch { return str; } }

async function main() {
  switch (cmd) {
    case 'create': {
      const s = engine.createSession(args[0]);
      console.log(JSON.stringify({ id: s.id, recording: s.isRecording }));
      break;
    }
    case 'record': {
      const s = engine.getSession(args[0]);
      if (!s) { console.error('Session not found'); process.exit(1); }
      const data = args[2] ? JSON.parse(args[2]) : {};
      const step = s.record(args[1], data);
      console.log(JSON.stringify(step, null, 2));
      break;
    }
    case 'list': {
      console.log(JSON.stringify(engine.listSessions(), null, 2));
      break;
    }
    case 'get': {
      const s = engine.getSession(args[0]);
      if (!s) { console.error('Session not found'); process.exit(1); }
      console.log(JSON.stringify(s.toJSON(), null, 2));
      break;
    }
    case 'timeline': {
      const s = engine.getSession(args[0]);
      if (!s) { console.error('Session not found'); process.exit(1); }
      console.log(JSON.stringify(s.timeline(), null, 2));
      break;
    }
    case 'assert-state': {
      const s = engine.getSession(args[0]);
      const r = s.assertState(parseInt(args[1]), JSON.parse(args[2]));
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.pass ? 0 : 1);
      break;
    }
    case 'assert-output': {
      const s = engine.getSession(args[0]);
      const r = s.assertOutput(parseInt(args[1]), JSON.parse(args[2]));
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.pass ? 0 : 1);
      break;
    }
    case 'assert-no-errors': {
      const s = engine.getSession(args[0]);
      const r = s.assertNoErrors();
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.pass ? 0 : 1);
      break;
    }
    case 'diff': {
      const d = engine.diff(args[0], args[1]);
      console.log(JSON.stringify(d, null, 2));
      break;
    }
    case 'merge': {
      const m = engine.merge(args[0], args[1]);
      console.log(JSON.stringify({ id: m.id, steps: m.steps.length }));
      break;
    }
    case 'export-json': {
      const s = engine.getSession(args[0]);
      const out = args[1] || `${args[0]}.json`;
      writeFileSync(out, JSON.stringify(s.toJSON(), null, 2));
      console.log(`Exported to ${out}`);
      break;
    }
    case 'export-md': {
      const s = engine.getSession(args[0]);
      const out = args[1] || `${args[0]}.md`;
      writeFileSync(out, s.toMarkdown());
      console.log(`Exported to ${out}`);
      break;
    }
    case 'stats': {
      console.log(JSON.stringify(engine.stats(), null, 2));
      break;
    }
    case 'serve': {
      await import('./server.mjs');
      break;
    }
    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }
    case 'demo': {
      // Demo: record an agent reasoning session
      const s = engine.createSession('demo-agent-reasoning', { metadata: { agent: 'gpt-4', task: 'math-problem' } });
      
      // Step 1: receive input
      s.record('input', { input: { question: 'What is 17 * 23?' }, state: { context: [], tokens: 0 } });
      
      // Step 2: think
      const thinkState = { context: ['breaking down 17*23'], tokens: 45 };
      s.record('think', { input: { strategy: 'decomposition' }, output: '17*20 + 17*3', state: thinkState, durationMs: 120 });
      
      // Step 3: compute
      const computeState = { context: ['breaking down 17*23', '17*20=340', '17*3=51'], tokens: 89 };
      s.record('compute', { input: { expr: '340 + 51' }, output: 391, state: computeState, durationMs: 45 });
      
      // Step 4: verify
      const verifyState = { ...computeState, verified: true };
      s.record('verify', { input: { expr: '391 / 17' }, output: 23, state: verifyState, durationMs: 30 });
      
      // Step 5: output
      s.record('output', { output: { answer: 391, confidence: 0.99 }, state: { ...verifyState, complete: true }, durationMs: 10 });
      
      s.annotate(2, 'Decomposition strategy chosen for mental math');
      s.annotate(3, 'Could optimize with shortcut: 17*23 = (20-3)*(20+3) = 400-9 = 391');
      
      s.stop();

      // Run assertions
      const assertions = s.runAssertions([
        { type: 'sequence', expected: ['input', 'think', 'compute', 'verify', 'output'] },
        { type: 'output', index: 1, expected: '17*20 + 17*3' },
        { type: 'output', index: 4, expected: { answer: 391, confidence: 0.99 } },
        { type: 'noErrors' },
        { type: 'duration', index: 2, maxMs: 200 }
      ]);

      // Create a branch exploring alternative strategy
      const alt = s.branch('shortcut', 1);
      alt.record('think', { input: { strategy: 'algebraic_identity' }, output: '(20-3)*(20+3) = 400-9', durationMs: 80 });
      alt.record('compute', { output: 391, durationMs: 15 });
      alt.record('output', { output: { answer: 391, confidence: 0.995 }, durationMs: 5 });

      // Create second session for diff
      const s2 = engine.createSession('demo-agent-reasoning-fast');
      s2.record('input', { input: { question: 'What is 17 * 23?' } });
      s2.record('compute', { output: 391, durationMs: 200 });
      s2.record('output', { output: { answer: 391 } });
      s2.stop();

      // Compare
      const comparison = engine.diff('demo-agent-reasoning', 'demo-agent-reasoning-fast');

      // Output
      console.log('\n🐋 agent-replay Demo\n');
      console.log('=== Session Stats ===');
      console.log(JSON.stringify(s.stats(), null, 2));
      console.log('\n=== Timeline ===');
      console.table(s.timeline());
      console.log('\n=== Assertions ===');
      assertions.forEach((a, i) => console.log(`  ${a.pass ? '✅' : '❌'} ${a.message}`));
      console.log('\n=== Branches ===');
      console.table(s.listBranches());
      console.log('\n=== Annotations ===');
      console.table(s.getAnnotations());
      console.log('\n=== Session Comparison ===');
      console.log(JSON.stringify({ similarity: comparison.similarity, diffs: comparison.diffs.length }, null, 2));
      console.log('\n=== Markdown Export (excerpt) ===');
      console.log(s.toMarkdown().slice(0, 800) + '...\n');
      break;
    }
    default:
      help();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
