# agent-secrets 🔐

Zero-dependency secrets manager for AI agents. AES-256-GCM encryption, namespace isolation, rotation tracking, audit logging.

## Features

- **AES-256-GCM encryption** — all secrets encrypted at rest with master password
- **Namespace isolation** — separate prod/staging/dev environments
- **TTL & expiration** — auto-expire secrets after configured duration
- **Rotation tracking** — configurable rotation intervals with overdue detection
- **Tag-based filtering** — organize secrets with tags, filter by tag
- **Import/export** — encrypted JSON export for backup/transfer
- **Environment injection** — export secrets as shell env vars
- **Audit logging** — every operation tracked with timestamps
- **Search** — full-text search across keys, tags, metadata
- **HTTP dashboard** — dark-theme web UI on port 3130
- **MCP server** — 12 tools via JSON-RPC stdio
- **CLI** — full command-line interface
- **Zero dependencies** — pure Node.js

## Quick Start

```javascript
import AgentSecrets from './index.mjs';

const secrets = new AgentSecrets({ password: 'my-master-password' });

// Store
secrets.set('OPENAI_API_KEY', 'sk-...', {
  namespace: 'prod',
  tags: ['ai', 'openai'],
  rotationInterval: 86400 * 30, // 30 days
});

// Retrieve
const val = secrets.get('OPENAI_API_KEY', { namespace: 'prod' });
console.log(val.value);

// Environment export
const env = secrets.toEnv('prod', 'APP_');
// → { APP_OPENAI_API_KEY: 'sk-...' }

// Check rotation
const overdue = secrets.needsRotation();
```

## CLI

```bash
node cli.mjs set OPENAI_API_KEY sk-xxx --ns prod --tags ai,openai --rotate 2592000
node cli.mjs get OPENAI_API_KEY --ns prod
node cli.mjs list --ns prod
node cli.mms search openai
node cli.mjs rotate OPENAI_API_KEY sk-new-xxx --ns prod
node cli.mjs needs-rotation
node cli.mjs to-env --ns prod --prefix APP_
node cli.mjs export --ns prod > backup.enc
node cli.mjs stats
node cli.mjs audit --limit 10 --action create
node cli.mjs serve   # HTTP dashboard at :3130
node cli.mjs mcp     # MCP server (stdio)
node cli.mjs demo    # run demo
```

## API

### `new AgentSecrets(options)`

| Option | Default | Description |
|--------|---------|-------------|
| `password` | `'agent-secrets-default'` | Master encryption password |
| `persistPath` | `null` | File path for encrypted persistence |
| `auditPath` | `null` | File path for JSONL audit log |
| `maxSecrets` | `10000` | Max secrets before LRU eviction |
| `defaultTTL` | `0` | Default TTL in seconds (0=forever) |
| `autoSaveMs` | — | Auto-save interval in ms |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `set(key, value, opts)` | `{id, key, namespace, ...}` | Store/update secret |
| `get(keyOrId, opts)` | `SecretEntry \| null` | Retrieve decrypted secret |
| `delete(keyOrId, opts)` | `boolean` | Delete secret |
| `has(keyOrId, opts)` | `boolean` | Check existence (respects expiry) |
| `list(opts)` | `SecretMeta[]` | List metadata (no values) |
| `keys(namespace)` | `string[]` | List key names |
| `search(query, opts)` | `SecretMeta[]` | Search by key/tag/metadata |
| `rotate(keyOrId, value, opts)` | `{id, rotatedAt}` | Update value + rotation timestamp |
| `needsRotation(opts)` | `RotationInfo[]` | List overdue secrets |
| `toEnv(namespace, prefix)` | `object` | Export as `{KEY: value}` map |
| `injectEnv(namespace, prefix)` | `number` | Inject into `process.env` |
| `exportEncrypted(namespace)` | `string` | Encrypted base64 export |
| `importEncrypted(data, opts)` | `number` | Import encrypted export |
| `exportPlaintext(namespace)` | `object[]` | Plaintext JSON export |
| `namespaces()` | `string[]` | List namespaces |
| `deleteNamespace(ns)` | `number` | Delete all secrets in namespace |
| `getAuditLog(opts)` | `AuditEntry[]` | Filter audit log |
| `stats()` | `Stats` | Summary statistics |
| `save()` | `Promise` | Persist to disk |
| `load()` | `Promise` | Load from disk |
| `destroy()` | — | Cleanup (clear intervals, memory) |

### Events

- `set`, `get`, `delete`, `expire`, `rotate`, `rotation_needed`
- `delete_namespace`, `import`, `save`, `load`
- `audit` — every operation

## MCP Server

12 tools:

| Tool | Description |
|------|-------------|
| `secrets_set` | Store a secret |
| `secrets_get` | Retrieve secret value |
| `secrets_delete` | Delete a secret |
| `secrets_has` | Check existence |
| `secrets_list` | List secrets |
| `secrets_search` | Search by query |
| `secrets_rotate` | Rotate a secret |
| `secrets_needs_rotation` | List secrets needing rotation |
| `secrets_to_env` | Export as env vars |
| `secrets_stats` | Get statistics |
| `secrets_audit` | Get audit log |
| `secrets_export` | Export encrypted |

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard |
| `/api/stats` | GET | Statistics |
| `/api/secrets` | GET | List secrets (`?namespace=&tag=`) |
| `/api/secrets` | POST | Create secret `{key, value, namespace?, ttl?, tags?}` |
| `/api/secrets/:id` | DELETE | Delete secret |
| `/api/search?q=` | GET | Search |
| `/api/audit?limit=&action=` | GET | Audit log |
| `/api/namespaces` | GET | List namespaces |
| `/api/rotate` | POST | Rotate `{keyOrId, newValue, namespace?}` |
| `/api/needs-rotation` | GET | Overdue secrets |
| `/api/export?namespace=` | GET | Export encrypted |

## Security

- AES-256-GCM with random salt (32B) + IV (16B) per encryption
- scrypt key derivation (N=16384, r=8, p=1)
- Authenticated encryption prevents tampering
- Master password never stored — use env var `SECRETS_MASTER_PASSWORD`
- Plaintext export available but audit-logged

## Tests

```bash
node test.mjs
# 30 tests
```
