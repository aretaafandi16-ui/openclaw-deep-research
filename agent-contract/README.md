# agent-contract

> Zero-dep API contract validator & mock server for AI agents

Define API contracts, validate requests/responses against schemas, run mock servers, import OpenAPI specs — all with zero dependencies.

## Features

- **Schema Validation** — JSON Schema-like validation for requests (body, headers, query, path params) and responses
- **Contract Management** — Create, update, delete, export/import API contracts with full endpoint definitions
- **Request Validation** — Validate method, headers (required + regex), query params, path params, body schemas
- **Response Validation** — Flexible matching (allows extra fields), type checking, required fields
- **Mock Server** — Auto-generate HTTP servers from contract definitions, set custom responses per endpoint
- **OpenAPI Import** — Import OpenAPI 3.0 specs → contracts with endpoints, schemas, parameters
- **Format Validators** — Built-in email, URI, UUID, date, date-time format checking
- **Validation Log** — JSONL audit trail of all validations (pass/fail with details)
- **Reports** — Generate markdown reports with endpoints, schemas, validation history
- **EventEmitter** — Real-time events for contract/endpoint/validation/mock lifecycle
- **HTTP Dashboard** — Dark-theme web UI with real-time stats, contract browser
- **MCP Server** — 16 tools via Model Context Protocol (JSON-RPC stdio)
- **CLI** — Full command-line interface with demo mode

## Quick Start

```js
import { ContractEngine } from './index.mjs';

const engine = new ContractEngine();

// Create a contract
const contract = engine.createContract({
  name: 'User API',
  base_url: 'https://api.example.com',
});

// Add an endpoint
const ep = engine.addEndpoint(contract.id, {
  method: 'POST',
  path: '/users',
  name: 'Create User',
  request: {
    body_schema: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string', minLength: 1 },
        email: { type: 'string', format: 'email' },
      },
    },
  },
  responses: {
    '201': {
      description: 'Created',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  },
});

// Validate a request
const result = engine.validateRequest(contract.id, ep.id, {
  method: 'POST',
  body: { name: 'Alice', email: 'alice@example.com' },
});
// → { valid: true, checks: { method: { valid: true }, body: { valid: true } } }

// Validate a response
const res = engine.validateResponse(contract.id, ep.id, 201, { id: 'abc', name: 'Alice' });
// → { valid: true }

// Start a mock server
engine.setMockResponse(contract.id, ep.id, 201, { id: 'user_001', name: 'Alice' });
const mock = await engine.createMockServer(contract.id, 3000);
// GET http://localhost:3000/users → mock response
mock.close();
```

## CLI

```bash
# Create a contract
node cli.mjs create "My API" --url https://api.example.com

# Add endpoint
node cli.mjs add-endpoint <cid> POST /users

# Validate request
node cli.mjs validate-req <cid> <eid> request.json

# Validate response
node cli.mjs validate-res <cid> <eid> 200 response.json

# Start mock server
node cli.mjs mock-serve <cid> --port 3000

# Import OpenAPI
node cli.mjs openapi-import openapi.json

# Generate report
node cli.mjs report <cid>

# Run demo
node cli.mjs demo

# Start HTTP server
node cli.mjs serve --port 3144

# Start MCP server
node cli.mjs mcp
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `contract_create` | Create a new API contract |
| `contract_get` | Get contract by ID |
| `contract_list` | List all contracts |
| `contract_delete` | Delete a contract |
| `contract_export` | Export contract as JSON |
| `contract_import` | Import contract from JSON |
| `contract_report` | Generate markdown report |
| `endpoint_add` | Add endpoint to contract |
| `endpoint_remove` | Remove endpoint |
| `validate_request` | Validate request against endpoint |
| `validate_response` | Validate response against schema |
| `mock_set` | Set mock response for endpoint |
| `mock_get` | Get mock response |
| `mock_serve` | Start mock HTTP server |
| `openapi_import` | Import OpenAPI 3.0 spec |
| `stats` | Get engine statistics |

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard` | GET | Web dashboard |
| `/api/stats` | GET | Engine stats |
| `/api/contracts` | GET/POST | List/create contracts |
| `/api/contracts/:id` | GET/DELETE | Get/delete contract |
| `/api/contracts/:id/export` | GET | Export contract |
| `/api/contracts/:id/report` | GET | Markdown report |
| `/api/contracts/:id/endpoints` | POST | Add endpoint |
| `/api/contracts/:id/validate-request` | POST | Validate request |
| `/api/contracts/:id/validate-response` | POST | Validate response |
| `/api/contracts/:id/mock` | POST | Set mock response |
| `/api/openapi/import` | POST | Import OpenAPI spec |
| `/api/validation-log` | GET | Validation history |

## Schema Features

### Type Validation
- `string`, `number`, `boolean`, `array`, `object`

### String Constraints
- `minLength`, `maxLength`, `pattern` (regex)
- `format`: email, uri, uuid, date, date-time

### Number Constraints
- `minimum`, `maximum`

### Object Validation
- `required` array
- `properties` with nested schemas
- `enum` for allowed values

### Array Validation
- `items` schema for element validation

### Response Matching
- Flexible: allows extra fields not in schema
- Validates presence of required fields
- Type checking on specified properties

## License

MIT
