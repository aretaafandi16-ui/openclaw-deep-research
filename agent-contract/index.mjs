// agent-contract — Zero-dep API contract validator & mock server for AI agents
// Contract definitions, request/response validation, mock generation, OpenAPI import

import { EventEmitter } from 'node:events';
import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';

// ─── Schema Validator ────────────────────────────────────────────────────────

class SchemaValidator {
  validate(value, schema, path = '') {
    if (!schema || typeof schema !== 'object') return { valid: true, errors: [] };
    const errors = [];

    if (schema.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== schema.type) {
        errors.push({ path: path || '/', expected: schema.type, actual: actualType, rule: 'type' });
      }
    }

    if (schema.required && Array.isArray(schema.required) && typeof value === 'object' && value !== null) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push({ path: `${path || '/'}`, missing: key, rule: 'required' });
        }
      }
    }

    if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          const sub = this.validate(value[key], propSchema, `${path}/${key}`);
          errors.push(...sub.errors);
        }
      }
    }

    if (schema.items && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const sub = this.validate(value[i], schema.items, `${path}[${i}]`);
        errors.push(...sub.errors);
      }
    }

    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({ path: path || '/', expected: schema.enum, actual: value, rule: 'enum' });
    }

    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: path || '/', rule: 'minimum', value, min: schema.minimum });
      if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: path || '/', rule: 'maximum', value, max: schema.maximum });
    }

    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path: path || '/', rule: 'minLength', length: value.length, min: schema.minLength });
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path: path || '/', rule: 'maxLength', length: value.length, max: schema.maxLength });
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path: path || '/', rule: 'pattern', pattern: schema.pattern, value });
      if (schema.format) {
        const formats = {
          email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
          uri: /^https?:\/\/.+/,
          uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          date: /^\d{4}-\d{2}-\d{2}$/,
          'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
        };
        if (formats[schema.format] && !formats[schema.format].test(value)) {
          errors.push({ path: path || '/', rule: 'format', format: schema.format, value });
        }
      }
    }

    if (schema.not !== undefined) {
      const sub = this.validate(value, schema.not, path);
      if (sub.errors.length === 0) errors.push({ path: path || '/', rule: 'not' });
    }

    return { valid: errors.length === 0, errors };
  }

  // Match response against expected (flexible: allows extra fields)
  matchResponse(actual, expected, path = '') {
    if (!expected || typeof expected !== 'object') return { valid: true, errors: [] };
    const errors = [];

    if (expected.type) {
      const actualType = Array.isArray(actual) ? 'array' : typeof actual;
      if (actualType !== expected.type) {
        errors.push({ path: path || '/', expected: expected.type, actual: actualType, rule: 'type' });
        return { valid: false, errors };
      }
    }

    if (expected.properties && typeof actual === 'object' && actual !== null && !Array.isArray(actual)) {
      for (const [key, propSchema] of Object.entries(expected.properties)) {
        if (key in actual) {
          const sub = this.matchResponse(actual[key], propSchema, `${path}/${key}`);
          errors.push(...sub.errors);
        } else if (propSchema.required) {
          errors.push({ path: `${path || '/'}`, missing: key, rule: 'required' });
        }
      }
    }

    if (expected.items && Array.isArray(actual) && actual.length > 0) {
      const sub = this.matchResponse(actual[0], expected.items, `${path}[0]`);
      errors.push(...sub.errors);
    }

    return { valid: errors.length === 0, errors };
  }
}

// ─── Contract Store ──────────────────────────────────────────────────────────

class ContractStore {
  constructor(dataDir) {
    this.dataDir = dataDir || join(process.cwd(), '.contract-data');
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    this.contractsFile = join(this.dataDir, 'contracts.jsonl');
    this.logFile = join(this.dataDir, 'validation-log.jsonl');
    this.contracts = new Map();
    this._load();
  }

  _load() {
    if (!existsSync(this.contractsFile)) return;
    try {
      const lines = readFileSync(this.contractsFile, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        const c = JSON.parse(line);
        this.contracts.set(c.id, c);
      }
    } catch {}
  }

  _save(contract) {
    appendFileSync(this.contractsFile, JSON.stringify(contract) + '\n');
  }

  add(contract) {
    const id = contract.id || `contract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const c = {
      id,
      name: contract.name || id,
      description: contract.description || '',
      version: contract.version || '1.0.0',
      base_url: contract.base_url || '',
      endpoints: contract.endpoints || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: contract.tags || [],
    };
    this.contracts.set(id, c);
    this._save(c);
    return c;
  }

  get(id) { return this.contracts.get(id); }
  list() { return [...this.contracts.values()]; }
  remove(id) {
    const c = this.contracts.get(id);
    if (c) this.contracts.delete(id);
    return c;
  }

  logValidation(entry) {
    appendFileSync(this.logFile, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
  }

  getValidationLog(limit = 50) {
    if (!existsSync(this.logFile)) return [];
    try {
      const lines = readFileSync(this.logFile, 'utf-8').split('\n').filter(Boolean);
      return lines.slice(-limit).map(l => JSON.parse(l));
    } catch { return []; }
  }
}

// ─── Main Contract Engine ────────────────────────────────────────────────────

class ContractEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.validator = new SchemaValidator();
    this.store = new ContractStore(opts.dataDir);
    this.stats = { validations: 0, passed: 0, failed: 0, contracts: 0, mocks: 0, requests: 0 };
    this.stats.contracts = this.store.contracts.size;
    this.mockResponses = new Map(); // contractId:endpoint -> responses
  }

  // ── Contract Management ──

  createContract(def) {
    const c = this.store.add(def);
    this.stats.contracts = this.store.contracts.size;
    this.emit('contract:created', c);
    return c;
  }

  getContract(id) { return this.store.get(id); }
  listContracts() { return this.store.list(); }
  deleteContract(id) {
    const c = this.store.remove(id);
    if (c) { this.stats.contracts = this.store.contracts.size; this.emit('contract:deleted', c); }
    return c;
  }

  // ── Endpoint Management ──

  addEndpoint(contractId, endpoint) {
    const c = this.store.contracts.get(contractId);
    if (!c) throw new Error(`Contract not found: ${contractId}`);
    const ep = {
      id: endpoint.id || `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      method: (endpoint.method || 'GET').toUpperCase(),
      path: endpoint.path || '/',
      name: endpoint.name || '',
      description: endpoint.description || '',
      request: endpoint.request || {},
      responses: endpoint.responses || { '200': { description: 'OK', schema: {} } },
      tags: endpoint.tags || [],
    };
    c.endpoints.push(ep);
    c.updated_at = new Date().toISOString();
    this.store._save(c);
    this.emit('endpoint:added', { contractId, endpoint: ep });
    return ep;
  }

  removeEndpoint(contractId, endpointId) {
    const c = this.store.contracts.get(contractId);
    if (!c) throw new Error(`Contract not found: ${contractId}`);
    const idx = c.endpoints.findIndex(e => e.id === endpointId);
    if (idx === -1) return null;
    const [ep] = c.endpoints.splice(idx, 1);
    c.updated_at = new Date().toISOString();
    this.emit('endpoint:removed', { contractId, endpoint: ep });
    return ep;
  }

  // ── Request Validation ──

  validateRequest(contractId, endpointId, request) {
    const c = this.store.contracts.get(contractId);
    if (!c) throw new Error(`Contract not found: ${contractId}`);
    const ep = c.endpoints.find(e => e.id === endpointId);
    if (!ep) throw new Error(`Endpoint not found: ${endpointId}`);
    this.stats.validations++;

    const result = { contractId, endpointId, method: ep.method, path: ep.path, valid: true, checks: {} };

    // Validate method
    if (request.method && request.method.toUpperCase() !== ep.method) {
      result.checks.method = { valid: false, expected: ep.method, actual: request.method.toUpperCase() };
      result.valid = false;
    } else {
      result.checks.method = { valid: true };
    }

    // Validate headers
    if (ep.request.headers) {
      const headerResult = this._validateHeaders(request.headers || {}, ep.request.headers);
      result.checks.headers = headerResult;
      if (!headerResult.valid) result.valid = false;
    }

    // Validate query params
    if (ep.request.query) {
      const queryResult = this.validator.validate(request.query || {}, ep.request.query, 'query');
      result.checks.query = queryResult;
      if (!queryResult.valid) result.valid = false;
    }

    // Validate body
    if (ep.request.body_schema) {
      const bodyResult = this.validator.validate(request.body || {}, ep.request.body_schema, 'body');
      result.checks.body = bodyResult;
      if (!bodyResult.valid) result.valid = false;
    }

    // Validate path params
    if (ep.request.path_params) {
      const pathResult = this.validator.validate(request.path_params || {}, ep.request.path_params, 'path_params');
      result.checks.path_params = pathResult;
      if (!pathResult.valid) result.valid = false;
    }

    if (result.valid) this.stats.passed++; else this.stats.failed++;
    this.store.logValidation({ type: 'request', ...result });
    this.emit('validation:request', result);
    return result;
  }

  _validateHeaders(actual, expected) {
    const errors = [];
    for (const [key, spec] of Object.entries(expected)) {
      const val = actual[key] || actual[key.toLowerCase()] || actual[key.toUpperCase()];
      if (spec.required && val === undefined) {
        errors.push({ header: key, rule: 'required' });
      } else if (val !== undefined && spec.pattern && !new RegExp(spec.pattern).test(val)) {
        errors.push({ header: key, rule: 'pattern', pattern: spec.pattern, value: val });
      } else if (val !== undefined && spec.value && val !== spec.value) {
        errors.push({ header: key, rule: 'value', expected: spec.value, actual: val });
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // ── Response Validation ──

  validateResponse(contractId, endpointId, statusCode, body) {
    const c = this.store.contracts.get(contractId);
    if (!c) throw new Error(`Contract not found: ${contractId}`);
    const ep = c.endpoints.find(e => e.id === endpointId);
    if (!ep) throw new Error(`Endpoint not found: ${endpointId}`);
    this.stats.validations++;

    const statusKey = String(statusCode);
    const expected = ep.responses[statusKey];
    if (!expected) {
      const result = { contractId, endpointId, statusCode, valid: false, error: `No schema defined for status ${statusKey}`, known_statuses: Object.keys(ep.responses) };
      this.store.logValidation({ type: 'response', ...result });
      this.stats.failed++;
      this.emit('validation:response', result);
      return result;
    }

    const check = this.validator.matchResponse(body, expected.schema || {}, 'response');
    const result = { contractId, endpointId, statusCode, statusDescription: expected.description, valid: check.valid, checks: { body: check } };
    if (check.valid) this.stats.passed++; else this.stats.failed++;
    this.store.logValidation({ type: 'response', ...result });
    this.emit('validation:response', result);
    return result;
  }

  // ── Mock Server ──

  setMockResponse(contractId, endpointId, statusCode, body, headers = {}) {
    const key = `${contractId}:${endpointId}:${statusCode}`;
    this.mockResponses.set(key, { body, headers, statusCode });
    this.emit('mock:set', { contractId, endpointId, statusCode });
  }

  getMockResponse(contractId, endpointId, statusCode = 200) {
    const key = `${contractId}:${endpointId}:${statusCode}`;
    return this.mockResponses.get(key);
  }

  createMockServer(contractId, port = 3144) {
    const c = this.store.contracts.get(contractId);
    if (!c) throw new Error(`Contract not found: ${contractId}`);

    const server = createServer((req, res) => {
      this.stats.requests++;
      const url = new URL(req.url, `http://localhost:${port}`);
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const method = req.method.toUpperCase();
        let parsedBody;
        try { parsedBody = JSON.parse(body); } catch { parsedBody = body; }

        const request = {
          method,
          headers: req.headers,
          query: Object.fromEntries(url.searchParams),
          body: parsedBody,
          path: url.pathname,
        };

        // Find matching endpoint
        const ep = c.endpoints.find(e => {
          if (e.method !== method) return false;
          const epPath = e.path.replace(/\{[^}]+\}/g, '[^/]+');
          return new RegExp(`^${epPath}$`).test(url.pathname);
        });

        if (!ep) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found', available: c.endpoints.map(e => `${e.method} ${e.path}`) }));
          return;
        }

        // Validate request
        const validation = this.validateRequest(c.id, ep.id, request);

        // Get mock response
        const mockKey = `${c.id}:${ep.id}`;
        let mock = null;
        for (const [k, v] of this.mockResponses) {
          if (k.startsWith(mockKey)) { mock = v; break; }
        }

        const statusCode = mock?.statusCode || 200;
        const responseBody = mock?.body || (ep.responses['200']?.example || { status: 'ok', endpoint: `${ep.method} ${ep.path}` });
        const responseHeaders = { 'Content-Type': 'application/json', 'X-Contract-Id': c.id, 'X-Validation': validation.valid ? 'pass' : 'fail', ...(mock?.headers || {}) };

        res.writeHead(statusCode, responseHeaders);
        res.end(JSON.stringify(responseBody));
      });
    });

    return new Promise((resolve, reject) => {
      server.listen(port, () => {
        this.stats.mocks++;
        this.emit('mock:started', { contractId, port });
        resolve({ server, port, contract: c, close: () => { server.close(); this.emit('mock:stopped', { contractId, port }); } });
      });
      server.on('error', reject);
    });
  }

  // ── OpenAPI Import ──

  importOpenAPI(spec) {
    const contract = { name: spec.info?.title || 'imported', description: spec.info?.description || '', version: spec.info?.version || '1.0.0', base_url: spec.servers?.[0]?.url || '', endpoints: [] };

    for (const [path, methods] of Object.entries(spec.paths || {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].indexOf(method) === -1) continue;
        const endpoint = {
          id: op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
          method: method.toUpperCase(),
          path,
          name: op.summary || op.operationId || `${method} ${path}`,
          description: op.description || '',
          request: {},
          responses: {},
          tags: op.tags || [],
        };

        // Parameters
        for (const param of (op.parameters || [])) {
          if (param.in === 'header') {
            endpoint.request.headers = endpoint.request.headers || {};
            endpoint.request.headers[param.name] = { required: param.required, pattern: param.schema?.pattern };
          } else if (param.in === 'query') {
            endpoint.request.query = endpoint.request.query || { type: 'object', properties: {} };
            endpoint.request.query.properties[param.name] = param.schema || {};
            if (param.required) {
              endpoint.request.query.required = endpoint.request.query.required || [];
              endpoint.request.query.required.push(param.name);
            }
          } else if (param.in === 'path') {
            endpoint.request.path_params = endpoint.request.path_params || { type: 'object', properties: {} };
            endpoint.request.path_params.properties[param.name] = param.schema || { type: 'string' };
          }
        }

        // Request body
        if (op.requestBody?.content?.['application/json']?.schema) {
          endpoint.request.body_schema = op.requestBody.content['application/json'].schema;
        }

        // Responses
        for (const [code, resp] of Object.entries(op.responses || {})) {
          endpoint.responses[code] = {
            description: resp.description || '',
            schema: resp.content?.['application/json']?.schema || {},
            example: resp.content?.['application/json']?.example,
          };
        }

        contract.endpoints.push(endpoint);
      }
    }

    return this.createContract(contract);
  }

  // ── Report Generation ──

  generateReport(contractId) {
    const c = this.store.contracts.get(contractId);
    if (!c) throw new Error(`Contract not found: ${contractId}`);
    const logs = this.store.getValidationLog(1000).filter(l => l.contractId === contractId);
    const reqLogs = logs.filter(l => l.type === 'request');
    const resLogs = logs.filter(l => l.type === 'response');

    let md = `# Contract Report: ${c.name}\n\n`;
    md += `**Version:** ${c.version}  \n`;
    md += `**Base URL:** ${c.base_url || 'N/A'}  \n`;
    md += `**Endpoints:** ${c.endpoints.length}  \n`;
    md += `**Created:** ${c.created_at}  \n\n`;

    md += `## Endpoints\n\n`;
    for (const ep of c.endpoints) {
      md += `### \`${ep.method} ${ep.path}\`\n`;
      if (ep.name) md += `**${ep.name}**\n`;
      if (ep.description) md += `${ep.description}\n`;
      md += `\n**Request Schema:**\n\`\`\`json\n${JSON.stringify(ep.request, null, 2)}\n\`\`\`\n\n`;
      md += `**Response Schemas:**\n`;
      for (const [code, resp] of Object.entries(ep.responses)) {
        md += `- **${code}** ${resp.description}\n  \`\`\`json\n  ${JSON.stringify(resp.schema, null, 2)}\n  \`\`\`\n`;
      }
      md += '\n';
    }

    if (reqLogs.length || resLogs.length) {
      md += `## Validation History\n\n`;
      md += `- **Request validations:** ${reqLogs.length} (${reqLogs.filter(l => l.valid).length} passed, ${reqLogs.filter(l => !l.valid).length} failed)\n`;
      md += `- **Response validations:** ${resLogs.length} (${resLogs.filter(l => l.valid).length} passed, ${resLogs.filter(l => !l.valid).length} failed)\n\n`;

      const failures = logs.filter(l => !l.valid);
      if (failures.length) {
        md += `### Recent Failures\n\n`;
        for (const f of failures.slice(-10)) {
          md += `- **${f.type}** ${f.endpointId} @ ${f.timestamp}: ${JSON.stringify(f.checks)}\n`;
        }
      }
    }

    return md;
  }

  getStats() {
    return { ...this.stats, contracts: this.store.contracts.size };
  }

  exportContract(contractId) {
    const c = this.store.contracts.get(contractId);
    if (!c) throw new Error(`Contract not found: ${contractId}`);
    return JSON.parse(JSON.stringify(c));
  }

  importContract(def) {
    return this.createContract(def);
  }
}

export { ContractEngine, SchemaValidator, ContractStore };
export default ContractEngine;
