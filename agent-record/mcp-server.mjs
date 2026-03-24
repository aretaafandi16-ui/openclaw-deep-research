/**
 * agent-record MCP Server — JSON-RPC stdio interface
 */

import { SessionRecorder } from './index.mjs';

const recorder = new SessionRecorder({ dataDir: process.env.DATA_DIR || '.agent-record' });
await recorder.loadAll();

const TOOLS = [
  { name: 'record_start_session', description: 'Start a new recording session', inputSchema: { type: 'object', properties: { id: { type: 'string' }, meta: { type: 'object' } } } },
  { name: 'record_stop_session', description: 'Stop a recording session', inputSchema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] } },
  { name: 'record_entry', description: 'Record an entry in a session', inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, type: { type: 'string', enum: ['input', 'output', 'tool_call', 'tool_result', 'decision', 'error', 'annotation', 'snapshot', 'metric', 'custom'] }, data: { type: 'object' }, meta: { type: 'object' } }, required: ['session_id', 'type', 'data'] } },
  { name: 'record_get_session', description: 'Get session details', inputSchema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] } },
  { name: 'record_list_sessions', description: 'List all sessions', inputSchema: { type: 'object', properties: { state: { type: 'string' }, tag: { type: 'string' } } } },
  { name: 'record_get_records', description: 'Get records from a session', inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, type: { type: 'string' }, search: { type: 'string' }, limit: { type: 'number' } }, required: ['session_id'] } },
  { name: 'record_bookmark', description: 'Add a bookmark to a session', inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, label: { type: 'string' }, seq: { type: 'number' } }, required: ['session_id', 'label'] } },
  { name: 'record_diff', description: 'Diff two sessions', inputSchema: { type: 'object', properties: { session_a: { type: 'string' }, session_b: { type: 'string' } }, required: ['session_a', 'session_b'] } },
  { name: 'record_search', description: 'Search across all sessions', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'record_export', description: 'Export a session as JSON/Markdown/replay script', inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, format: { type: 'string', enum: ['json', 'markdown', 'replay'] } }, required: ['session_id'] } },
  { name: 'record_stats', description: 'Get session or global statistics', inputSchema: { type: 'object', properties: { session_id: { type: 'string' } } } },
  { name: 'record_annotate', description: 'Annotate a record entry', inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, seq: { type: 'number' }, note: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['session_id', 'seq', 'note'] } }
];

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') return respond(id, { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-record', version: '1.0.0' }, capabilities: { tools: {} } });
  if (method === 'tools/list') return respond(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      let result;
      switch (name) {
        case 'record_start_session': result = recorder.startSession(args?.id, args?.meta || {}); break;
        case 'record_stop_session': result = recorder.stopSession(args.session_id); break;
        case 'record_entry': result = recorder.record(args.session_id, args.type, args.data, args.meta || {}); break;
        case 'record_get_session': result = recorder.getSession(args.session_id); break;
        case 'record_list_sessions': result = recorder.listSessions({ state: args?.state, tag: args?.tag }); break;
        case 'record_get_records': {
          const opts = {};
          if (args?.type) opts.type = args.type;
          if (args?.search) opts.search = args.search;
          if (args?.limit) opts.limit = args.limit;
          result = recorder.getRecords(args.session_id, opts);
          break;
        }
        case 'record_bookmark': result = recorder.bookmark(args.session_id, args.label, args.seq); break;
        case 'record_diff': result = recorder.diff(args.session_a, args.session_b); break;
        case 'record_search': result = recorder.search(args.query, { limit: args.limit || 50 }); break;
        case 'record_export': {
          const fmt = args.format || 'json';
          result = fmt === 'markdown' ? recorder.toMarkdown(args.session_id) : fmt === 'replay' ? recorder.toReplayScript(args.session_id) : recorder.toJSON(args.session_id);
          break;
        }
        case 'record_stats': result = args.session_id ? recorder.getStats(args.session_id) : recorder.getGlobalStats(); break;
        case 'record_annotate': result = recorder.annotate(args.session_id, args.seq, args.note, args.tags || []); break;
        default: return respondError(id, `Unknown tool: ${name}`);
      }
      return respond(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] });
    } catch (e) { return respondError(id, e.message); }
  }

  respondError(id, `Unknown method: ${method}`);
}

// Stdio JSON-RPC
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) { try { handleRequest(JSON.parse(line)); } catch { /* ignore parse errors */ } }
  }
});
process.stdin.resume();

process.on('SIGINT', () => { recorder.destroy().then(() => process.exit(0)); });
process.on('SIGTERM', () => { recorder.destroy().then(() => process.exit(0)); });

console.error('🐋 agent-record MCP server ready (stdio)');
