// agent-diag MCP Server — JSON-RPC stdio with 10 tools
import { AgentDiag, presets, AlertEngine } from './index.mjs';

const diag = new AgentDiag();
const alerts = new AlertEngine();

const tools = {
  diag_register: { desc: 'Register a health check', params: ['name','category','intervalMs','timeoutMs','threshold'],
    exec: async (p) => { diag.register({ name: p.name, category: p.category || 'custom', intervalMs: p.intervalMs || 30000, timeoutMs: p.timeoutMs || 5000, threshold: p.threshold || 3, check: async () => ({ ok: true, message: 'placeholder' }) }); return { registered: p.name }; }},
  diag_run: { desc: 'Run a specific check by name', params: ['name'],
    exec: async (p) => await diag.runCheck(p.name) },
  diag_run_all: { desc: 'Run all registered checks', params: [],
    exec: async () => ({ results: await diag.runAll() }) },
  diag_run_category: { desc: 'Run checks by category', params: ['category'],
    exec: async (p) => ({ results: await diag.runCategory(p.category) }) },
  diag_status: { desc: 'Get overall health status', params: [],
    exec: async () => diag.getStatus() },
  diag_checks: { desc: 'List all registered checks', params: [],
    exec: async () => diag.listChecks() },
  diag_history: { desc: 'Get check history', params: ['name','category','status','limit'],
    exec: async (p) => diag.getHistory({ name: p.name, category: p.category, status: p.status, limit: p.limit || 100 }) },
  diag_system: { desc: 'Collect system diagnostics', params: [],
    exec: async () => diag.collectSystem() },
  diag_remove: { desc: 'Unregister a check', params: ['name'],
    exec: async (p) => ({ removed: diag.unregister(p.name) }) },
  diag_start: { desc: 'Start periodic checking', params: [],
    exec: async () => { diag.start(); return { started: true }; }},
};

// JSON-RPC stdio
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handle(JSON.parse(line));
  }
});

async function handle(msg) {
  if (msg.method === 'initialize') return resp(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-diag', version: '1.0.0' } });
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') return resp(msg.id, { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.desc, inputSchema: { type: 'object', properties: Object.fromEntries(t.params.map(p => [p, { type: 'string' }])), required: [] } })) });
  if (msg.method === 'tools/call') {
    const tool = tools[msg.params.name];
    if (!tool) return resp(msg.id, { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${msg.params.name}` }) }] });
    try {
      const r = await tool.exec(msg.params.arguments || {});
      return resp(msg.id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
    } catch (e) {
      return resp(msg.id, { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true });
    }
  }
}
function resp(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
