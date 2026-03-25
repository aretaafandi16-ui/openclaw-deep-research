#!/usr/bin/env node
/**
 * agent-replay MCP Server — 12 tools via JSON-RPC stdio
 */

import { ReplayEngine } from './index.mjs';
import { createInterface } from 'node:readline';

const engine = new ReplayEngine();

const TOOLS = {
  replay_create: { desc: 'Create a replay session', schema: { id: 'string (optional)', metadata: 'object (optional)', tags: 'array (optional)' } },
  replay_record: { desc: 'Record a step in a session', schema: { session: 'string', type: 'string', input: 'any (optional)', output: 'any (optional)', state: 'object (optional)', durationMs: 'number (optional)', error: 'string (optional)', tags: 'array (optional)' } },
  replay_stop: { desc: 'Stop recording a session', schema: { session: 'string' } },
  replay_get: { desc: 'Get session details', schema: { session: 'string' } },
  replay_list: { desc: 'List all sessions', schema: {} },
  replay_step: { desc: 'Get a specific step', schema: { session: 'string', index: 'number' } },
  replay_timeline: { desc: 'Get session timeline', schema: { session: 'string' } },
  replay_assert: { desc: 'Run an assertion', schema: { session: 'string', type: 'string (state|output|sequence|noErrors|duration)', index: 'number (optional)', expected: 'any (optional)', maxMs: 'number (optional)', message: 'string (optional)' } },
  replay_annotate: { desc: 'Add annotation to a step', schema: { session: 'string', stepIndex: 'number', text: 'string', tags: 'array (optional)' } },
  replay_branch: { desc: 'Create a branch from a step', schema: { session: 'string', name: 'string', fromStep: 'number (optional)' } },
  replay_diff: { desc: 'Compare two sessions', schema: { sessionA: 'string', sessionB: 'string' } },
  replay_stats: { desc: 'Get engine stats', schema: {} },
};

function handle(req) {
  const { id, method, params } = req;
  if (method === 'tools/list') {
    return { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.desc, inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(t.schema).map(([k, v]) => [k, { description: v }])) } })) };
  }
  if (method === 'tools/call') {
    const { name, arguments: a = {} } = params;
    try {
      switch (name) {
        case 'replay_create': { const s = engine.createSession(a.id, { metadata: a.metadata, tags: a.tags }); return { content: [{ type: 'text', text: JSON.stringify({ id: s.id, recording: s.isRecording }) }] }; }
        case 'replay_record': { const s = engine.getSession(a.session); if (!s) throw new Error('Session not found'); const step = s.record(a.type, a); return { content: [{ type: 'text', text: JSON.stringify(step) }] }; }
        case 'replay_stop': { const s = engine.getSession(a.session); if (!s) throw new Error('Session not found'); s.stop(); return { content: [{ type: 'text', text: JSON.stringify({ ok: true, steps: s.steps.length }) }] }; }
        case 'replay_get': { const s = engine.getSession(a.session); if (!s) throw new Error('Session not found'); return { content: [{ type: 'text', text: JSON.stringify(s.toJSON()) }] }; }
        case 'replay_list': return { content: [{ type: 'text', text: JSON.stringify(engine.listSessions()) }] };
        case 'replay_step': { const s = engine.getSession(a.session); const step = s?.getStep(a.index); if (!step) throw new Error('Step not found'); return { content: [{ type: 'text', text: JSON.stringify(step) }] }; }
        case 'replay_timeline': { const s = engine.getSession(a.session); return { content: [{ type: 'text', text: JSON.stringify(s.timeline()) }] }; }
        case 'replay_assert': { const s = engine.getSession(a.session); let r; if (a.type === 'state') r = s.assertState(a.index, a.expected, a.message); else if (a.type === 'output') r = s.assertOutput(a.index, a.expected, a.message); else if (a.type === 'sequence') r = s.assertTypeSequence(a.expected); else if (a.type === 'noErrors') r = s.assertNoErrors(); else if (a.type === 'duration') r = s.assertDuration(a.index, a.maxMs); else throw new Error('Unknown assertion type'); return { content: [{ type: 'text', text: JSON.stringify(r) }] }; }
        case 'replay_annotate': { const s = engine.getSession(a.session); return { content: [{ type: 'text', text: JSON.stringify(s.annotate(a.stepIndex, a.text, a.tags)) }] }; }
        case 'replay_branch': { const s = engine.getSession(a.session); return { content: [{ type: 'text', text: JSON.stringify(s.branch(a.name, a.fromStep)) }] }; }
        case 'replay_diff': return { content: [{ type: 'text', text: JSON.stringify(engine.diff(a.sessionA, a.sessionB)) }] };
        case 'replay_stats': return { content: [{ type: 'text', text: JSON.stringify(engine.stats()) }] };
        default: throw new Error(`Unknown tool: ${name}`);
      }
    } catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }; }
  }
  return { error: { code: -32601, message: 'Method not found' } };
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('line', line => {
  try {
    const req = JSON.parse(line);
    const res = handle(req);
    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, ...res }));
  } catch (e) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }));
  }
});

process.stderr.write('🐋 agent-replay MCP server ready\n');
