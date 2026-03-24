# agent-guard 🛡️

Schema validation & guardrails layer for AI agents. Zero dependencies.

Validate agent I/O, detect PII, enforce schemas, rate limit operations, and audit everything.

## Install

```bash
npm install agent-guard
# or just copy index.mjs — zero deps
```

## Quick Start

```js
import { AgentGuard } from './index.mjs';

const guard = new AgentGuard({ strict: true });

// Define a schema
guard.addSchema('user-input', {
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0, maximum: 150 },
  },
});

// Validate
const result = guard.validate({ name: 'Alice', email: 'alice@example.com' }, 'user-input');
console.log(result); // { valid: true, errors: [] }
```

## Guard Pipeline

Run schema + rules + content guardrails + rate limiting in one call:

```js
guard.addProfile('strict-input', {
  schema: 'user-input',
  rules: ['no-pii', 'no-sql-injection'],
  contentGuard: { blockPII: true, redact: true, maxBytes: 10240 },
  rateLimit: { limit: 100, windowMs: 60000 },
});

const result = guard.guardInput(
  { name: 'Alice', email: 'alice@example.com' },
  { profile: 'strict-input', operation: 'user-register' }
);
// { allowed: true, errors: [], warnings: [], sanitized: {...}, auditId: '...' }
```

## Schema Validation DSL

JSON Schema–like validation with zero dependencies:

```js
guard.addSchema('api-payload', {
  type: 'object',
  required: ['action', 'data'],
  properties: {
    action: { type: 'string', enum: ['create', 'update', 'delete'] },
    data: {
      type: 'object',
      properties: {
        name: { type: 'string', pattern: '^[a-zA-Z ]+$' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      },
    },
  },
  additionalProperties: false,
});
```

**Supported:** type, required, minLength/maxLength, pattern, format (email/url/uuid/date/datetime/ipv4), enum, minimum/maximum, minItems/maxItems, nested objects, arrays, additionalProperties, custom validate functions.

## PII Detection & Redaction

```js
// Detect
guard.detectPII('Email me at john@example.com, SSN 123-45-6789');
// → [{ type: 'email', count: 1, ... }, { type: 'ssn', count: 1, ... }]

// Redact
guard.redactPII('SSN: 123-45-6789');
// → 'SSN: [REDACTED_SSN]'

// Custom replacement
guard.redactPII('test@test.com', { email: '***' });
// → '***'
```

**Detects:** email, phone, SSN, credit card, IP address, JWT tokens.

## Profanity Detection

```js
guard.detectProfanity('what the hell');
// → ['hell']
```

## Text Sanitization

```js
guard.sanitizeText('<b>Test</b> email@test.com', {
  stripHTML: true,
  redactPII: true,
  maxLength: 50,
  trim: true,
});
```

## Custom Rules

```js
guard.addRule('no-admin-role', {
  description: 'Prevent admin role assignment',
  check: (data) => {
    if (data.role === 'admin') return { pass: false, message: 'admin not allowed' };
    return { pass: true };
  },
  severity: 'error',   // error | warning | info
  apply: 'input',       // input | output | both
});
```

## Preset Rules

```js
guard.loadAllPresets(); // loads all built-in presets
guard.loadPreset('no-sql-injection'); // load one
```

| Preset | Description |
|--------|-------------|
| `no-empty-strings` | Reject empty string values |
| `no-pii` | Block PII in string data |
| `reasonable-length` | Strings under 10KB |
| `no-sql-injection` | Basic SQL injection detection |
| `no-shell-injection` | Basic shell injection detection |
| `valid-json` | Ensure string is valid JSON |

## Profiles

Combine schemas, rules, content guardrails, and rate limits into named profiles:

```js
guard.addProfile('tool-output', {
  description: 'Validate tool output before returning to agent',
  schema: 'api-response',
  rules: ['no-pii', 'reasonable-length'],
  contentGuard: { blockPII: true, redact: true, maxBytes: 50000 },
  rateLimit: { limit: 200, windowMs: 60000 },
});
```

## Rate Limiting

```js
guard.rateLimiter.configure('api-calls', 100, 60000); // 100 per minute
const { allowed, remaining, resetIn } = guard.rateLimiter.consume('api-calls');
```

Or via profiles (automatic):

```js
guard.addProfile('limited', {
  rateLimit: { limit: 10, windowMs: 60000 },
  // ...
});
```

## Events

```js
guard.on('block', ({ operation, errors, data }) => { /* blocked */ });
guard.on('warn', ({ operation, warnings, data }) => { /* warned */ });
guard.on('pass', ({ operation, data }) => { /* passed */ });
```

## Audit Trail

All guard calls are logged to `data/audit.jsonl`:

```js
const entries = guard.audit.read({ limit: 50, operation: 'user-register', action: 'block' });
// [{ timestamp, operation, action, errors, warnings, schemaUsed, ... }]

const stats = guard.audit.stats();
// { total, passed, blocked, warned, byOperation: { ... } }
```

## HTTP Server

```bash
node server.mjs              # starts on :3104
# or
node cli.mjs serve           # same thing
```

**Endpoints:**
- `GET /health` — health check
- `GET /stats` — guard statistics
- `GET /audit?limit=50&operation=x&action=block` — audit log
- `GET /schemas` — list schemas
- `GET /rules` — list rules
- `GET /profiles` — list profiles
- `POST /validate` — `{schema, data}` → validation result
- `POST /guard` — `{data, profile?, operation?, ...}` → guard result
- `POST /detect` — `{text}` → PII + profanity detection
- `POST /redact` — `{text}` → redacted text
- `POST /sanitize` — `{text, rules}` → sanitized text
- `POST /schemas` — `{name, schema}` → add schema
- `POST /profiles` — `{name, profile}` → add profile

Dashboard: `http://localhost:3104/dashboard`

## MCP Server

```bash
node mcp-server.mjs
```

**Tools:**

| Tool | Description |
|------|-------------|
| `guard_validate` | Validate data against JSON schema |
| `guard_check` | Run full guard pipeline |
| `guard_detect_pii` | Detect PII in text |
| `guard_redact_pii` | Redact PII from text |
| `guard_detect_profanity` | Detect profane words |
| `guard_sanitize` | Sanitize text (HTML, PII, etc.) |
| `guard_schema_add` | Register named schema |
| `guard_profile_add` | Create guard profile |
| `guard_stats` | Get statistics |
| `guard_audit` | Read audit log |
| `guard_list_schemas` | List schemas |
| `guard_list_profiles` | List profiles |

## CLI

```bash
agent-guard validate <schema> <json>
agent-guard guard <profile> <json>
agent-guard detect "text with PII here"
agent-guard redact "email: test@test.com"
agent-guard stats
agent-guard audit [limit]
agent-guard schema list
agent-guard rule list
agent-guard profile list
agent-guard demo              # interactive demo
agent-guard serve [port]      # HTTP server
agent-guard mcp               # MCP server
```

## Stats

```js
const stats = guard.getStats();
// {
//   totalChecks: 100,
//   passed: 85,
//   blocked: 10,
//   warned: 5,
//   schemas: 3,
//   rules: 6,
//   profiles: 2,
//   rateLimits: { ... },
//   audit: { total: 100, byOperation: { ... } }
// }
```

## Tests

```bash
node test.mjs
# 43 tests, all passing
```

## License

MIT
