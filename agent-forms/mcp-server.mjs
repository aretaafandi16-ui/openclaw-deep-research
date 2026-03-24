// agent-forms/mcp-server.mjs — MCP server via JSON-RPC stdio (10 tools)
import { FormEngine } from './index.mjs';

const PERSIST = process.env.AGENT_FORMS_DATA || '/tmp/agent-forms-data';
const engine = new FormEngine({ persistPath: PERSIST });

const TOOLS = [
  { name: 'forms_create', description: 'Create a new form with fields', inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, fields: { type: 'array', items: { type: 'object' } }, steps: { type: 'array', items: { type: 'object' } }, settings: { type: 'object' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['name'] } },
  { name: 'forms_get', description: 'Get form details by ID', inputSchema: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] } },
  { name: 'forms_list', description: 'List all forms (optional tag filter)', inputSchema: { type: 'object', properties: { tag: { type: 'string' } } } },
  { name: 'forms_delete', description: 'Delete a form and its responses', inputSchema: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] } },
  { name: 'forms_add_field', description: 'Add a field to an existing form', inputSchema: { type: 'object', properties: { formId: { type: 'string' }, field: { type: 'object' } }, required: ['formId', 'field'] } },
  { name: 'forms_start', description: 'Start a new response for a form', inputSchema: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] } },
  { name: 'forms_fill', description: 'Fill a field value in a response', inputSchema: { type: 'object', properties: { formId: { type: 'string' }, responseId: { type: 'string' }, field: { type: 'string' }, value: {} }, required: ['formId', 'responseId', 'field', 'value'] } },
  { name: 'forms_next', description: 'Get next field to fill (chat-style prompt)', inputSchema: { type: 'object', properties: { formId: { type: 'string' }, responseId: { type: 'string' } }, required: ['formId', 'responseId'] } },
  { name: 'forms_validate', description: 'Validate a response and return errors', inputSchema: { type: 'object', properties: { formId: { type: 'string' }, responseId: { type: 'string' } }, required: ['formId', 'responseId'] } },
  { name: 'forms_submit', description: 'Validate and submit a response', inputSchema: { type: 'object', properties: { formId: { type: 'string' }, responseId: { type: 'string' } }, required: ['formId', 'responseId'] } },
  { name: 'forms_progress', description: 'Get response fill progress', inputSchema: { type: 'object', properties: { formId: { type: 'string' }, responseId: { type: 'string' } }, required: ['formId', 'responseId'] } },
  { name: 'forms_aggregate', description: 'Aggregate field values (numeric stats or distribution)', inputSchema: { type: 'object', properties: { formId: { type: 'string' }, field: { type: 'string' } }, required: ['formId', 'field'] } },
  { name: 'forms_export', description: 'Export responses as CSV or JSON', inputSchema: { type: 'object', properties: { formId: { type: 'string' }, format: { type: 'string', enum: ['csv', 'json'] } }, required: ['formId'] } },
  { name: 'forms_stats', description: 'Get engine statistics', inputSchema: { type: 'object', properties: {} } },
];

function handleTool(name, args) {
  switch (name) {
    case 'forms_create': return engine.createForm(args).toJSON();
    case 'forms_get': return engine.getForm(args.formId).toJSON();
    case 'forms_list': return engine.listForms(args.tag).map(f => f.toJSON());
    case 'forms_delete': engine.deleteForm(args.formId); return { deleted: true };
    case 'forms_add_field': return engine.addField(args.formId, args.field).toJSON();
    case 'forms_start': { const r = engine.startResponse(args.formId); return { id: r.id, formId: r.formId, status: r.status }; }
    case 'forms_fill': engine.fillField(args.formId, args.responseId, args.field, args.value); return { filled: true };
    case 'forms_next': return engine.getNextField(args.formId, args.responseId) || { complete: true };
    case 'forms_validate': return engine.validateResponse(args.formId, args.responseId);
    case 'forms_submit': return engine.submitResponse(args.formId, args.responseId);
    case 'forms_progress': return engine.getProgress(args.formId, args.responseId);
    case 'forms_aggregate': return engine.aggregate(args.formId, args.field);
    case 'forms_export': {
      if (args.format === 'csv') return { csv: engine.exportCSV(args.formId) };
      return engine.exportJSON(args.formId);
    }
    case 'forms_stats': return engine.stats();
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC stdio
let id = 0;
function respond(result, error) {
  const resp = { jsonrpc: '2.0', id: id++, result, error };
  process.stdout.write(JSON.stringify(resp) + '\n');
}

const buf = [];
process.stdin.on('data', chunk => {
  buf.push(chunk);
  const str = Buffer.concat(buf).toString();
  const lines = str.split('\n').filter(l => l.trim());
  buf.length = 0;
  if (!str.endsWith('\n')) { buf.push(Buffer.from(lines.pop() || '')); }

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') {
        respond({ protocolVersion: '2024-11-05', serverInfo: { name: 'agent-forms', version: '1.0.0' }, capabilities: { tools: {} } });
      } else if (msg.method === 'tools/list') {
        respond({ tools: TOOLS });
      } else if (msg.method === 'tools/call') {
        try {
          const result = handleTool(msg.params.name, msg.params.arguments || {});
          respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (e) {
          respond(null, { code: -32000, message: e.message });
        }
      } else if (msg.method === 'notifications/initialized') {
        // no-op
      }
    } catch {}
  }
});

process.stdin.resume();
console.error('agent-forms MCP server running (stdio)');
