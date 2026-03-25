#!/usr/bin/env node
// agent-contract test suite

import { ContractEngine, SchemaValidator } from './index.mjs';
import { strict as assert } from 'node:assert';
import { rmSync, existsSync } from 'node:fs';

const DATA_DIR = '/tmp/agent-contract-test-' + Date.now();
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

async function atest(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('🧪 agent-contract tests\n');

// ── SchemaValidator ──
console.log('SchemaValidator');
const sv = new SchemaValidator();

test('validates type string', () => {
  const r = sv.validate('hello', { type: 'string' });
  assert.ok(r.valid);
});

test('rejects wrong type', () => {
  const r = sv.validate(42, { type: 'string' });
  assert.ok(!r.valid);
  assert.equal(r.errors[0].rule, 'type');
});

test('validates required properties', () => {
  const r = sv.validate({ name: 'test' }, { type: 'object', required: ['name', 'email'] });
  assert.ok(!r.valid);
  assert.equal(r.errors[0].missing, 'email');
});

test('validates nested properties', () => {
  const r = sv.validate({ user: { name: 'Alice', age: 30 } }, {
    type: 'object',
    properties: { user: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } } } }
  });
  assert.ok(r.valid);
});

test('validates enum', () => {
  const r1 = sv.validate('active', { enum: ['active', 'inactive'] });
  assert.ok(r1.valid);
  const r2 = sv.validate('deleted', { enum: ['active', 'inactive'] });
  assert.ok(!r2.valid);
});

test('validates number min/max', () => {
  assert.ok(sv.validate(5, { type: 'number', minimum: 1, maximum: 10 }).valid);
  assert.ok(!sv.validate(0, { type: 'number', minimum: 1 }).valid);
  assert.ok(!sv.validate(11, { type: 'number', maximum: 10 }).valid);
});

test('validates string minLength/maxLength', () => {
  assert.ok(sv.validate('hello', { type: 'string', minLength: 2, maxLength: 10 }).valid);
  assert.ok(!sv.validate('x', { type: 'string', minLength: 2 }).valid);
});

test('validates string pattern', () => {
  assert.ok(sv.validate('abc123', { type: 'string', pattern: '^[a-z0-9]+$' }).valid);
  assert.ok(!sv.validate('ABC!', { type: 'string', pattern: '^[a-z0-9]+$' }).valid);
});

test('validates string format email', () => {
  assert.ok(sv.validate('test@example.com', { type: 'string', format: 'email' }).valid);
  assert.ok(!sv.validate('not-email', { type: 'string', format: 'email' }).valid);
});

test('validates string format uri', () => {
  assert.ok(sv.validate('https://example.com', { type: 'string', format: 'uri' }).valid);
  assert.ok(!sv.validate('not-uri', { type: 'string', format: 'uri' }).valid);
});

test('validates string format uuid', () => {
  assert.ok(sv.validate('550e8400-e29b-41d4-a716-446655440000', { type: 'string', format: 'uuid' }).valid);
  assert.ok(!sv.validate('not-uuid', { type: 'string', format: 'uuid' }).valid);
});

test('validates array items', () => {
  const r = sv.validate([1, 2, 'three'], { type: 'array', items: { type: 'number' } });
  assert.ok(!r.valid);
  assert.equal(r.errors[0].path, '[2]');
});

test('matchResponse allows extra fields', () => {
  const r = sv.matchResponse({ id: 1, name: 'Alice', extra: true }, { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } } });
  assert.ok(r.valid);
});

test('matchResponse catches missing required', () => {
  const r = sv.matchResponse({ id: 1 }, { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string', required: true } } });
  assert.ok(!r.valid);
});

// ── ContractEngine ──
console.log('\nContractEngine');
const engine = new ContractEngine({ dataDir: DATA_DIR });

test('creates contract', () => {
  const c = engine.createContract({ name: 'Test API', description: 'Test', base_url: 'https://api.test.com' });
  assert.equal(c.name, 'Test API');
  assert.ok(c.id);
});

test('gets contract', () => {
  const c = engine.createContract({ name: 'Get Test' });
  const got = engine.getContract(c.id);
  assert.equal(got.name, 'Get Test');
});

test('lists contracts', () => {
  const list = engine.listContracts();
  assert.ok(list.length >= 2);
});

test('deletes contract', () => {
  const c = engine.createContract({ name: 'Delete Me' });
  engine.deleteContract(c.id);
  assert.ok(!engine.getContract(c.id));
});

test('adds endpoint', () => {
  const c = engine.createContract({ name: 'EP Test' });
  const ep = engine.addEndpoint(c.id, {
    method: 'POST',
    path: '/users',
    name: 'Create User',
    request: { body_schema: { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' } } } },
    responses: { '201': { description: 'Created', schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } }, '400': { description: 'Bad Request', schema: { type: 'object', properties: { error: { type: 'string' } } } } },
  });
  assert.equal(ep.method, 'POST');
  assert.equal(ep.path, '/users');
});

test('removes endpoint', () => {
  const c = engine.createContract({ name: 'EP Remove' });
  const ep = engine.addEndpoint(c.id, { method: 'GET', path: '/test' });
  const removed = engine.removeEndpoint(c.id, ep.id);
  assert.equal(removed.id, ep.id);
  assert.equal(c.endpoints.length, 0);
});

test('validates request - pass', () => {
  const c = engine.createContract({ name: 'Req Pass' });
  const ep = engine.addEndpoint(c.id, {
    method: 'POST', path: '/items',
    request: { body_schema: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 1 } } } },
  });
  const r = engine.validateRequest(c.id, ep.id, { method: 'POST', body: { title: 'Hello' } });
  assert.ok(r.valid);
  assert.ok(r.checks.body.valid);
});

test('validates request - fail', () => {
  const c = engine.createContract({ name: 'Req Fail' });
  const ep = engine.addEndpoint(c.id, {
    method: 'POST', path: '/items',
    request: { body_schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } },
  });
  const r = engine.validateRequest(c.id, ep.id, { method: 'POST', body: {} });
  assert.ok(!r.valid);
  assert.ok(!r.checks.body.valid);
});

test('validates request - wrong method', () => {
  const c = engine.createContract({ name: 'Method Test' });
  const ep = engine.addEndpoint(c.id, { method: 'GET', path: '/data' });
  const r = engine.validateRequest(c.id, ep.id, { method: 'POST' });
  assert.ok(!r.valid);
  assert.ok(!r.checks.method.valid);
});

test('validates request - headers', () => {
  const c = engine.createContract({ name: 'Header Test' });
  const ep = engine.addEndpoint(c.id, {
    method: 'GET', path: '/secure',
    request: { headers: { 'Authorization': { required: true, pattern: '^Bearer .+' } } },
  });
  const r1 = engine.validateRequest(c.id, ep.id, { method: 'GET', headers: { 'Authorization': 'Bearer token123' } });
  assert.ok(r1.valid);
  const r2 = engine.validateRequest(c.id, ep.id, { method: 'GET', headers: {} });
  assert.ok(!r2.valid);
});

test('validates response - pass', () => {
  const c = engine.createContract({ name: 'Res Pass' });
  const ep = engine.addEndpoint(c.id, {
    method: 'GET', path: '/users/:id',
    responses: { '200': { description: 'OK', schema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } } } } },
  });
  const r = engine.validateResponse(c.id, ep.id, 200, { id: 1, name: 'Alice', extra: true });
  assert.ok(r.valid);
});

test('validates response - fail type mismatch', () => {
  const c = engine.createContract({ name: 'Res Fail' });
  const ep = engine.addEndpoint(c.id, {
    method: 'GET', path: '/users/:id',
    responses: { '200': { description: 'OK', schema: { type: 'object', properties: { id: { type: 'number' } } } } },
  });
  const r = engine.validateResponse(c.id, ep.id, 200, { id: 'not-a-number' });
  assert.ok(!r.valid);
});

test('validates response - unknown status', () => {
  const c = engine.createContract({ name: 'Res Unknown' });
  const ep = engine.addEndpoint(c.id, { method: 'GET', path: '/x', responses: { '200': { description: 'OK', schema: {} } } });
  const r = engine.validateResponse(c.id, ep.id, 500, { error: 'boom' });
  assert.ok(!r.valid);
  assert.ok(r.known_statuses.includes('200'));
});

// ── Mock Server ──
console.log('\nMock Server');
await atest('creates and responds to mock server', async () => {
  const c = engine.createContract({ name: 'Mock API' });
  const ep = engine.addEndpoint(c.id, {
    method: 'GET', path: '/health',
    responses: { '200': { description: 'OK', schema: { type: 'object', properties: { status: { type: 'string' } } }, example: { status: 'healthy' } } },
  });
  engine.setMockResponse(c.id, ep.id, 200, { status: 'healthy', uptime: 1234 });

  const mock = await engine.createMockServer(c.id, 3199);
  try {
    const res = await fetch('http://localhost:3199/health');
    const body = await res.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.uptime, 1234);
    assert.equal(res.headers.get('x-contract-id'), c.id);
  } finally {
    mock.close();
  }
});

await atest('mock server returns 404 for unknown endpoint', async () => {
  const c = engine.createContract({ name: 'Mock 404' });
  engine.addEndpoint(c.id, { method: 'GET', path: '/known' });
  const mock = await engine.createMockServer(c.id, 3198);
  try {
    const res = await fetch('http://localhost:3198/unknown');
    assert.equal(res.status, 404);
  } finally {
    mock.close();
  }
});

await atest('mock server parses query params', async () => {
  const c = engine.createContract({ name: 'Mock Query' });
  const ep = engine.addEndpoint(c.id, {
    method: 'GET', path: '/search',
    request: { query: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } } },
    responses: { '200': { description: 'OK', schema: {} } },
  });
  const mock = await engine.createMockServer(c.id, 3197);
  try {
    const res = await fetch('http://localhost:3197/search?q=hello');
    const body = await res.json();
    assert.ok(res.ok);
  } finally {
    mock.close();
  }
});

// ── OpenAPI Import ──
console.log('\nOpenAPI Import');
test('imports OpenAPI spec', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Pet Store', version: '1.0.0', description: 'A pet store API' },
    servers: [{ url: 'https://petstore.example.com' }],
    paths: {
      '/pets': {
        get: { operationId: 'listPets', summary: 'List all pets', tags: ['pets'], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'A list of pets', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } } } } } } },
        post: { operationId: 'createPet', summary: 'Create a pet', tags: ['pets'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, tag: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
      },
      '/pets/{petId}': {
        get: { operationId: 'getPet', summary: 'Get a pet', parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'A pet', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } } } } } },
      },
    },
  };
  const c = engine.importOpenAPI(spec);
  assert.equal(c.name, 'Pet Store');
  assert.equal(c.base_url, 'https://petstore.example.com');
  assert.equal(c.endpoints.length, 3);
  const listPets = c.endpoints.find(e => e.id === 'listPets');
  assert.equal(listPets.method, 'GET');
  assert.equal(listPets.path, '/pets');
  const createPet = c.endpoints.find(e => e.id === 'createPet');
  assert.equal(createPet.method, 'POST');
  assert.ok(createPet.request.body_schema);
});

// ── Report ──
console.log('\nReport');
test('generates markdown report', () => {
  const c = engine.createContract({ name: 'Report API', description: 'For reporting' });
  engine.addEndpoint(c.id, { method: 'GET', path: '/data', responses: { '200': { description: 'OK', schema: { type: 'object' } } } });
  const report = engine.generateReport(c.id);
  assert.ok(report.includes('# Contract Report: Report API'));
  assert.ok(report.includes('GET /data'));
});

// ── Stats ──
test('tracks stats', () => {
  const stats = engine.getStats();
  assert.ok(stats.validations > 0);
  assert.ok(stats.passed > 0);
  assert.ok(stats.contracts > 0);
});

// ── Import/Export ──
test('exports and imports contract', () => {
  const c = engine.createContract({ name: 'Export Test', base_url: 'https://export.test' });
  engine.addEndpoint(c.id, { method: 'GET', path: '/ping' });
  const exported = engine.exportContract(c.id);
  assert.equal(exported.name, 'Export Test');
  const imported = engine.importContract({ ...exported, id: undefined });
  assert.equal(imported.name, 'Export Test');
  assert.equal(imported.endpoints.length, 1);
});

// ── Events ──
console.log('\nEvents');
test('emits contract:created', (done) => {
  let emitted = false;
  engine.once('contract:created', () => { emitted = true; });
  engine.createContract({ name: 'Event Test' });
  assert.ok(emitted);
});

test('emits validation:request', () => {
  let emitted = false;
  engine.once('validation:request', () => { emitted = true; });
  const c = engine.createContract({ name: 'Event Req' });
  const ep = engine.addEndpoint(c.id, { method: 'GET', path: '/x', responses: { '200': { description: 'OK', schema: {} } } });
  engine.validateRequest(c.id, ep.id, { method: 'GET' });
  assert.ok(emitted);
});

// ── Cleanup ──
if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('✅ All tests passed!');
