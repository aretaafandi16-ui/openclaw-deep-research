#!/usr/bin/env node
// agent-contract MCP server — JSON-RPC stdio

import { ContractEngine } from './index.mjs';

const engine = new ContractEngine({ dataDir: process.env.CONTRACT_DATA_DIR });

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function error(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
}

const tools = {
  contract_create: (p) => engine.createContract(p),
  contract_get: (p) => engine.getContract(p.id),
  contract_list: () => engine.listContracts(),
  contract_delete: (p) => engine.deleteContract(p.id),
  contract_export: (p) => engine.exportContract(p.id),
  contract_import: (p) => engine.importContract(p),
  contract_report: (p) => engine.generateReport(p.id),

  endpoint_add: (p) => engine.addEndpoint(p.contract_id, p),
  endpoint_remove: (p) => engine.removeEndpoint(p.contract_id, p.endpoint_id),

  validate_request: (p) => engine.validateRequest(p.contract_id, p.endpoint_id, p.request),
  validate_response: (p) => engine.validateResponse(p.contract_id, p.endpoint_id, p.status_code, p.body),

  mock_set: (p) => { engine.setMockResponse(p.contract_id, p.endpoint_id, p.status_code || 200, p.body, p.headers || {}); return { ok: true }; },
  mock_get: (p) => engine.getMockResponse(p.contract_id, p.endpoint_id, p.status_code),
  mock_serve: async (p) => {
    const mock = await engine.createMockServer(p.contract_id, p.port || 3144);
    return { port: p.port || 3144, contract: mock.contract.name, endpoints: mock.contract.endpoints.length };
  },

  openapi_import: (p) => engine.importOpenAPI(p.spec),
  stats: () => engine.getStats(),
};

const toolDefs = [
  { name: 'contract_create', description: 'Create a new API contract', inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, base_url: { type: 'string' }, version: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['name'] } },
  { name: 'contract_get', description: 'Get contract by ID', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'contract_list', description: 'List all contracts', inputSchema: { type: 'object', properties: {} } },
  { name: 'contract_delete', description: 'Delete a contract', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'contract_export', description: 'Export contract as JSON', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'contract_import', description: 'Import contract from JSON', inputSchema: { type: 'object', properties: { name: { type: 'string' }, endpoints: { type: 'array' } }, required: ['name'] } },
  { name: 'contract_report', description: 'Generate markdown report for contract', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'endpoint_add', description: 'Add endpoint to contract', inputSchema: { type: 'object', properties: { contract_id: { type: 'string' }, method: { type: 'string' }, path: { type: 'string' }, name: { type: 'string' }, request: { type: 'object' }, responses: { type: 'object' } }, required: ['contract_id', 'method', 'path'] } },
  { name: 'endpoint_remove', description: 'Remove endpoint from contract', inputSchema: { type: 'object', properties: { contract_id: { type: 'string' }, endpoint_id: { type: 'string' } }, required: ['contract_id', 'endpoint_id'] } },
  { name: 'validate_request', description: 'Validate a request against an endpoint', inputSchema: { type: 'object', properties: { contract_id: { type: 'string' }, endpoint_id: { type: 'string' }, request: { type: 'object' } }, required: ['contract_id', 'endpoint_id', 'request'] } },
  { name: 'validate_response', description: 'Validate a response against an endpoint schema', inputSchema: { type: 'object', properties: { contract_id: { type: 'string' }, endpoint_id: { type: 'string' }, status_code: { type: 'number' }, body: { type: 'object' } }, required: ['contract_id', 'endpoint_id', 'status_code', 'body'] } },
  { name: 'mock_set', description: 'Set mock response for an endpoint', inputSchema: { type: 'object', properties: { contract_id: { type: 'string' }, endpoint_id: { type: 'string' }, status_code: { type: 'number' }, body: { type: 'object' }, headers: { type: 'object' } }, required: ['contract_id', 'endpoint_id', 'body'] } },
  { name: 'mock_get', description: 'Get mock response for an endpoint', inputSchema: { type: 'object', properties: { contract_id: { type: 'string' }, endpoint_id: { type: 'string' }, status_code: { type: 'number' } }, required: ['contract_id', 'endpoint_id'] } },
  { name: 'mock_serve', description: 'Start mock HTTP server for a contract', inputSchema: { type: 'object', properties: { contract_id: { type: 'string' }, port: { type: 'number' } }, required: ['contract_id'] } },
  { name: 'openapi_import', description: 'Import an OpenAPI 3.0 spec', inputSchema: { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] } },
  { name: 'stats', description: 'Get engine stats', inputSchema: { type: 'object', properties: {} } },
];

let buf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === 'initialize') {
      respond(msg.id, { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-contract', version: '1.0.0' }, capabilities: { tools: {} } });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: toolDefs });
    } else if (msg.method === 'tools/call') {
      const fn = tools[msg.params?.name];
      if (!fn) { error(msg.id, `Unknown tool: ${msg.params?.name}`); continue; }
      Promise.resolve().then(() => fn(msg.params?.arguments || {}))
        .then(r => respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }))
        .catch(e => error(msg.id, e.message));
    } else if (msg.method === 'notifications/initialized') {
      // no-op
    }
  }
});

process.stdin.resume();
