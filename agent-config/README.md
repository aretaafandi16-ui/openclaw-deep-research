# agent-config v1.0

Zero-dependency configuration manager for AI agents.

## Features

- **Multi-source loading** — defaults → file → env → runtime, layered correctly
- **Schema validation** — type coercion, enum, min/max, required fields
- **Hot-reload** — file watching with polling (zero deps), auto-reload on change
- **Secrets masking** — auto-detect (password/secret/token/key patterns) + manual marking
- **Hierarchical namespaces** — dotted path access (`database.host`, `server.port`)
- **Environment variable mapping** — auto-prefix (`AGENT_DB__HOST` → `db.host`) + explicit mapping
- **Snapshots & rollback** — named snapshots, instant rollback
- **Template interpolation** — `{{section.key}}` replacement in strings
- **Change history** — JSONL audit trail of all config changes
- **EventEmitter** — `change`, `change:<key>`, `reload`, `watch:start/stop`, `snapshot`, `rollback`
- **Persistence** — save/load config JSON, auto-save on change

## Quick Start

```js
import { AgentConfig } from './index.mjs';

const config = new AgentConfig({ dataDir: './data', envPrefix: 'APP_' });

// Define schema
config.defineSchema({
  'db.host': { type: 'string', default: 'localhost' },
  'db.port': { type: 'number', default: 5432, min: 1, max: 65535 },
  'db.password': { type: 'string' },  // auto-masked
  'server.port': { type: 'number', default: 3000 },
  'env': { type: 'string', enum: ['dev', 'staging', 'prod'], default: 'dev' },
});

// Load from environment, then file
config.loadEnv();
config.loadFile('config.json');

// Access
console.log(config.get('db.host'));        // 'localhost'
console.log(config.getMasked('db.password')); // '********'

// Set with validation
config.set('db.port', '5432');  // coerced to number

// Validate all
const result = config.validate();
if (!result.valid) console.error(result.errors);

// Snapshots
config.snapshot('before-deploy');
config.set('server.port', 8080);
config.rollback('before-deploy');

// Watch for changes
config.watch('config.json', 2000);
config.on('reload', ({ path, current }) => console.log('Config reloaded:', path));

// Interpolation
const url = config.interpolate('http://{{db.host}}:{{db.port}}/api');
```

## API

### Constructor
```js
new AgentConfig({
  dataDir: './data',          // persistence directory
  envPrefix: 'AGENT_',        // env var prefix
  autoSave: true,             // save on every change
  watchInterval: 2000,        // file watch poll ms
  maxHistory: 1000,           // max change entries
  secretsPatterns: [/password/i, ...],  // auto-detect patterns
  maskValue: '********',      // mask replacement
})
```

### Methods

| Method | Description |
|--------|-------------|
| `get(path, default?)` | Get value by dotted path |
| `set(path, value, opts?)` | Set value (validates against schema) |
| `has(path)` | Check existence |
| `delete(path)` | Remove key |
| `getAll()` | Full config object |
| `keys(prefix?)` | List keys under prefix |
| `getMasked(path)` | Get with secret masking |
| `getAllMasked()` | Full config with secrets masked |
| `defineSchema(schema)` | Define validation schema |
| `validate()` | Validate all config against schema |
| `loadEnv(env?)` | Load from environment variables |
| `mapEnv(envVar, configPath, spec?)` | Explicit env mapping |
| `loadFile(path)` | Load from JSON/JSON5 file |
| `loadObject(obj, source?)` | Load from plain object |
| `watch(path, interval?)` | Start file watching |
| `unwatch(path)` | Stop watching |
| `markSecret(path)` | Mark key as secret |
| `snapshot(name)` | Create named snapshot |
| `rollback(name)` | Restore snapshot |
| `interpolate(template)` | Replace `{{key}}` in string |
| `namespace(ns)` | Get namespace proxy object |
| `history(limit?)` | Get change history |
| `save(path?)` | Persist to disk |
| `stats()` | Get config statistics |
| `destroy()` | Cleanup watchers and listeners |

### Schema Types
`string`, `number`, `boolean`, `array`, `object`

### Events
- `change` — any config change
- `change:<path>` — specific key change
- `reload` — file reloaded
- `watch:start` / `watch:stop` — file watcher events
- `snapshot` / `rollback` — snapshot events
- `loaded` — config loaded from source

## CLI

```bash
# Get/Set
node cli.mjs get db.host
node cli.mjs set server.port 8080
node cli.mjs get api_key --masked

# Validate
node cli.mjs validate

# Snapshots
node cli.mjs snapshot pre-deploy
node cli.mjs rollback pre-deploy

# History
node cli.mjs history 50

# Export
node cli.mjs export

# Server
node cli.mjs serve    # HTTP dashboard on :3122

# MCP
node cli.mjs mcp      # JSON-RPC stdio

# Demo
node cli.mjs demo
```

## HTTP API (port 3122)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web dashboard |
| `/api/config` | GET | Full config (masked) |
| `/api/config/:key` | GET | Get key |
| `/api/config/:key` | PUT | Set key |
| `/api/config/:key` | DELETE | Delete key |
| `/api/validate` | POST | Validate schema |
| `/api/snapshots` | GET | List snapshots |
| `/api/snapshots/:name` | POST | Create snapshot |
| `/api/snapshots/:name` | DELETE | Delete snapshot |
| `/api/snapshots/:name/rollback` | POST | Rollback |
| `/api/history` | GET | Change history |
| `/api/stats` | GET | Statistics |
| `/api/schema` | GET | Schema definition |

## MCP Tools (14)

`config_set`, `config_get`, `config_delete`, `config_has`, `config_keys`, `config_get_all`, `config_validate`, `config_snapshot`, `config_rollback`, `config_stats`, `config_history`, `config_load_file`, `config_export`, `config_interpolate`

## Tests

```bash
node test.mjs
# 58 tests, all passing ✅
```

## License

MIT
