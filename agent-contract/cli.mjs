#!/usr/bin/env node
// agent-contract CLI

import { ContractEngine } from './index.mjs';
import { readFileSync } from 'node:fs';

const engine = new ContractEngine({ dataDir: process.env.CONTRACT_DATA_DIR });
const [,, cmd, ...args] = process.argv;

const HELP = `
📋 agent-contract CLI

Commands:
  create <name> [--desc <d>] [--url <url>]    Create a contract
  get <id>                                      Get contract by ID
  list                                          List all contracts
  delete <id>                                   Delete a contract
  export <id>                                   Export contract as JSON
  import <file.json>                            Import contract from file

  add-endpoint <contract-id> <method> <path>    Add endpoint
  remove-endpoint <contract-id> <endpoint-id>   Remove endpoint

  validate-req <cid> <eid> <request.json>       Validate request
  validate-res <cid> <eid> <status> <body.json> Validate response

  mock-set <cid> <eid> <body.json> [status]     Set mock response
  mock-serve <cid> [--port <port>]              Start mock server

  openapi-import <file.json>                    Import OpenAPI spec
  report <id>                                   Generate markdown report
  stats                                         Show stats
  log [--limit <n>]                             Show validation log
  serve [--port <port>]                         Start HTTP server
  mcp                                           Start MCP server
  demo                                          Run demo

Options:
  --data-dir <dir>    Data directory
`;

function arg(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }

try {
  switch (cmd) {
    case 'create': {
      const name = args[0];
      if (!name) { console.error('Usage: create <name>'); process.exit(1); }
      const c = engine.createContract({ name, description: arg('--desc') || '', base_url: arg('--url') || '' });
      console.log(JSON.stringify(c, null, 2));
      break;
    }
    case 'get': {
      const c = engine.getContract(args[0]);
      console.log(c ? JSON.stringify(c, null, 2) : 'Not found');
      break;
    }
    case 'list': {
      const cs = engine.listContracts();
      if (!cs.length) { console.log('No contracts.'); break; }
      for (const c of cs) console.log(`  ${c.id}  ${c.name} v${c.version}  (${c.endpoints.length} endpoints)`);
      break;
    }
    case 'delete': { engine.deleteContract(args[0]); console.log('Deleted.'); break; }
    case 'export': { console.log(JSON.stringify(engine.exportContract(args[0]), null, 2)); break; }
    case 'import': { const d = JSON.parse(readFileSync(args[0], 'utf-8')); console.log(JSON.stringify(engine.importContract(d), null, 2)); break; }
    case 'add-endpoint': {
      const [cid, method, path, ...rest] = args;
      if (!cid || !method || !path) { console.error('Usage: add-endpoint <cid> <method> <path>'); process.exit(1); }
      const ep = engine.addEndpoint(cid, { method, path, name: rest.join(' ') || `${method} ${path}` });
      console.log(JSON.stringify(ep, null, 2));
      break;
    }
    case 'remove-endpoint': { engine.removeEndpoint(args[0], args[1]); console.log('Removed.'); break; }
    case 'validate-req': {
      const [cid, eid, file] = args;
      const req = JSON.parse(readFileSync(file, 'utf-8'));
      console.log(JSON.stringify(engine.validateRequest(cid, eid, req), null, 2));
      break;
    }
    case 'validate-res': {
      const [cid, eid, status, file] = args;
      const body = JSON.parse(readFileSync(file, 'utf-8'));
      console.log(JSON.stringify(engine.validateResponse(cid, eid, parseInt(status), body), null, 2));
      break;
    }
    case 'mock-set': {
      const [cid, eid, file, status] = args;
      const body = JSON.parse(readFileSync(file, 'utf-8'));
      engine.setMockResponse(cid, eid, parseInt(status) || 200, body);
      console.log('Mock set.');
      break;
    }
    case 'mock-serve': {
      const cid = args[0];
      const port = parseInt(arg('--port') || '3144');
      const mock = await engine.createMockServer(cid, port);
      console.log(`Mock server on :${port} for ${mock.contract.name}`);
      console.log(`Endpoints: ${mock.contract.endpoints.map(e => `${e.method} ${e.path}`).join(', ')}`);
      process.on('SIGINT', () => { mock.close(); process.exit(); });
      break;
    }
    case 'openapi-import': {
      const spec = JSON.parse(readFileSync(args[0], 'utf-8'));
      const c = engine.importOpenAPI(spec);
      console.log(JSON.stringify(c, null, 2));
      break;
    }
    case 'report': { console.log(engine.generateReport(args[0])); break; }
    case 'stats': { console.log(JSON.stringify(engine.getStats(), null, 2)); break; }
    case 'log': {
      const limit = parseInt(arg('--limit') || '20');
      const log = engine.store.getValidationLog(limit);
      for (const entry of log) console.log(`  [${entry.timestamp}] ${entry.type} ${entry.endpointId} ${entry.valid ? '✅' : '❌'}`);
      break;
    }
    case 'serve': {
      const { default: s } = await import('./server.mjs');
      break;
    }
    case 'mcp': { await import('./mcp-server.mjs'); break; }
    case 'demo': {
      console.log('📋 Running demo...\n');
      const c = engine.createContract({ name: 'Demo API', description: 'A demo contract', base_url: 'https://demo.example.com', tags: ['demo', 'test'] });
      console.log(`Created contract: ${c.name} (${c.id})`);

      const users = engine.addEndpoint(c.id, {
        method: 'POST', path: '/users', name: 'Create User',
        request: { body_schema: { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string', minLength: 1 }, email: { type: 'string', format: 'email' } } } },
        responses: {
          '201': { description: 'Created', schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } } },
          '400': { description: 'Bad Request', schema: { type: 'object', properties: { error: { type: 'string' } } } },
        },
      });

      const getUser = engine.addEndpoint(c.id, {
        method: 'GET', path: '/users/{id}', name: 'Get User',
        request: { headers: { 'Authorization': { required: true, pattern: '^Bearer .+' } } },
        responses: { '200': { description: 'OK', schema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } } } } },
      });

      // Validate good request
      const goodReq = engine.validateRequest(c.id, users.id, { method: 'POST', body: { name: 'Alice', email: 'alice@example.com' } });
      console.log(`\nValidate good request: ${goodReq.valid ? '✅ PASS' : '❌ FAIL'}`);

      // Validate bad request
      const badReq = engine.validateRequest(c.id, users.id, { method: 'POST', body: { name: '' } });
      console.log(`Validate bad request: ${!badReq.valid ? '✅ Correctly rejected' : '❌ Should have failed'}`);

      // Validate response
      const goodRes = engine.validateResponse(c.id, users.id, 201, { id: 'abc', name: 'Alice', email: 'alice@example.com' });
      console.log(`Validate good response: ${goodRes.valid ? '✅ PASS' : '❌ FAIL'}`);

      const badRes = engine.validateResponse(c.id, users.id, 201, { id: 123 });
      console.log(`Validate bad response: ${!badRes.valid ? '✅ Correctly rejected' : '❌ Should have failed'}`);

      // Import OpenAPI
      const imported = engine.importOpenAPI({
        openapi: '3.0.0', info: { title: 'Pet Store', version: '1.0.0' },
        paths: { '/pets': { get: { operationId: 'listPets', summary: 'List pets', responses: { '200': { description: 'OK' } } } } },
      });
      console.log(`\nImported OpenAPI: ${imported.name} (${imported.endpoints.length} endpoints)`);

      // Mock server
      engine.setMockResponse(c.id, users.id, 201, { id: 'user_001', name: 'Alice', email: 'alice@example.com' });
      const mock = await engine.createMockServer(c.id, 3196);
      const res = await fetch('http://localhost:3196/users', { method: 'POST', body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }), headers: { 'Content-Type': 'application/json' } });
      console.log(`\nMock request: ${res.status} ${JSON.stringify(await res.json())}`);
      mock.close();

      // Stats
      console.log(`\nStats: ${JSON.stringify(engine.getStats())}`);
      console.log('\n✅ Demo complete!');
      break;
    }
    default:
      console.log(HELP);
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
