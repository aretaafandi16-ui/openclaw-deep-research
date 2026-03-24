#!/usr/bin/env node
/**
 * agent-trace CLI
 */

import { TraceStore, createHTTPServer, generateId } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';

function flag(name) {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : undefined;
}
function boolFlag(name) {
  return args.includes(`--${name}`);
}

const store = new TraceStore({ dir: flag('data-dir') || undefined });

async function main() {
  switch (cmd) {
    case 'serve': {
      const port = Number(flag('port') || 3105);
      createHTTPServer(store, port);
      break;
    }

    case 'list': {
      const opts = {};
      if (flag('type')) opts.type = flag('type');
      if (flag('service')) opts.service = flag('service');
      if (flag('status')) opts.status = flag('status');
      if (flag('name')) opts.name = flag('name');
      if (flag('trace')) opts.traceId = flag('trace');
      if (boolFlag('errors')) opts.error = true;
      opts.limit = Number(flag('limit') || 20);

      const spans = store.query(opts);
      const icons = { llm: '🤖', tool: '🔧', span: '📍', decision: '🧠', error: '❌', custom: '⭐' };
      for (const s of spans) {
        const icon = icons[s.type] || '📍';
        const dur = s.duration != null ? `${s.duration}ms` : 'active';
        console.log(`${icon} ${s.name} [${s.type}] ${dur} ${s.status} ${s.service !== 'default' ? `(${s.service})` : ''}`);
      }
      console.log(`\n${spans.length} spans`);
      break;
    }

    case 'trace': {
      const traceId = flag('id');
      if (!traceId) { console.error('Usage: trace --id=<traceId>'); process.exit(1); }
      console.log(store.timeline(traceId));
      break;
    }

    case 'perf': {
      const opts = {};
      if (flag('type')) opts.type = flag('type');
      if (flag('service')) opts.service = flag('service');
      const stats = store.perfStats(opts);
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    case 'active': {
      const active = store.getActive();
      for (const s of active) {
        console.log(`📍 ${s.name} [${s.type}] started ${new Date(s.startTime).toISOString()} (${s.service})`);
      }
      console.log(`\n${active.length} active spans`);
      break;
    }

    case 'stats': {
      console.log('Store stats:', JSON.stringify(store.stats, null, 2));
      break;
    }

    case 'export': {
      console.log(store.exportJSONL());
      break;
    }

    case 'demo': {
      console.log('Running demo trace...\n');
      const traceId = generateId();

      const root = store.startSpan('agent:plan', { traceId, type: 'decision', attributes: { task: 'Summarize document' } });
      await sleep(50);

      const llm1 = store.startSpan('llm:claude-sonnet', { traceId, parentId: root.id, type: 'llm', attributes: { model: 'claude-sonnet-4-20250514', tokens: 890 } });
      await sleep(280);
      store.endSpan(llm1.id, { attributes: { completion_tokens: 320 } });

      const tool1 = store.startSpan('tool:read_file', { traceId, parentId: root.id, type: 'tool', attributes: { path: 'README.md' } });
      await sleep(45);
      store.endSpan(tool1.id);

      const llm2 = store.startSpan('llm:claude-sonnet', { traceId, parentId: root.id, type: 'llm', attributes: { model: 'claude-sonnet-4-20250514', tokens: 1540 } });
      await sleep(390);
      store.endSpan(llm2.id);

      const tool2 = store.startSpan('tool:write_file', { traceId, parentId: root.id, type: 'tool', attributes: { path: 'summary.md' } });
      await sleep(20);
      store.endSpan(tool2.id);

      store.endSpan(root.id);

      console.log('Trace timeline:\n');
      console.log(store.timeline(traceId));
      console.log('\n\nPerformance:\n');
      console.log(JSON.stringify(store.perfStats(), null, 2));
      break;
    }

    case 'mcp': {
      const { MCPStdioServer } = await import('./mcp-server.mjs');
      new MCPStdioServer(store);
      break;
    }

    default:
      console.log(`
agent-trace v1.0 — Zero-dep distributed tracing for AI agents

Commands:
  serve [--port=3105]       Start HTTP dashboard
  list [--type=llm] [--limit=20] [--errors] [--name=] [--trace=]
  trace --id=<traceId>      Show timeline for a trace
  perf [--type=llm]         Performance statistics
  active                    List active (unfinished) spans
  stats                     Store statistics
  export                    Export all spans as JSONL
  demo                      Run demo trace
  mcp                       Start MCP server (stdio)

Flags:
  --type=<span|llm|tool|decision|error|custom>
  --service=<name>
  --status=<ok|error|active>
  --name=<substring>
  --trace=<traceId>
  --errors                  Filter errors only
  --limit=<n>
  --port=<n>
  --data-dir=<path>
`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error(err); process.exit(1); });
