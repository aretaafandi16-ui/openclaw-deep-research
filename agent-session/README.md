# agent-session

Zero-dependency session manager for AI agents — multi-turn conversations, lifecycle, expiration, context isolation.

## Features

- **Session lifecycle**: create, get, touch, extend, destroy, auto-expire
- **Multi-turn conversations**: add/get/filter messages by role, time, limit
- **State management**: per-session key-value state storage
- **Isolation**: namespace, owner, and tag-based session grouping
- **TTL & expiration**: configurable per-session TTL with automatic cleanup
- **LRU eviction**: configurable max sessions with least-recently-used eviction
- **Message limits**: per-session max messages with oldest-first eviction
- **Persistence**: JSONL event log + periodic snapshots (survives restarts)
- **Events**: EventEmitter for create/destroy/expire/touch/message events
- **HTTP Dashboard**: dark-theme web UI on port 3118
- **MCP Server**: 10 tools via JSON-RPC stdio
- **CLI**: full command-line interface
- **Zero dependencies**: pure Node.js, no npm packages

## Install

```bash
# Clone and use directly — no npm install needed
cd agent-session
```

## Quick Start

```js
import { SessionManager } from './index.mjs';

const sm = new SessionManager({
  defaultTTL: 30 * 60 * 1000,  // 30 min
  maxSessions: 10000,
  maxMessages: 500,
  persistDir: './data'          // optional persistence
});

// Create session
const session = sm.create({
  owner: 'user-42',
  namespace: 'chat',
  tags: ['support', 'billing']
});

// Add messages
sm.addMessage(session.id, 'user', 'I need help with my order');
sm.addMessage(session.id, 'assistant', 'Sure! What is your order number?');
sm.addMessage(session.id, 'user', 'Order #12345');

// Set state
sm.setState(session.id, 'orderId', '12345');
sm.setState(session.id, 'step', 'lookup');

// Get session with messages
const s = sm.get(session.id);
console.log(s.messages);   // all 3 messages
console.log(s.state);      // { orderId: '12345', step: 'lookup' }

// Query
sm.findByOwner('user-42');
sm.findByNamespace('chat');
sm.findByTag('support');
sm.search(s => s.messageCount > 2);

// Touch (refresh TTL)
sm.touch(session.id);

// Events
sm.on('expire', (session) => {
  console.log(`Session ${session.id} expired`);
});
```

## API

### SessionManager(options)

| Option | Default | Description |
|--------|---------|-------------|
| `defaultTTL` | `1800000` | Default TTL in ms (30 min) |
| `maxSessions` | `10000` | Max concurrent sessions |
| `maxMessages` | `500` | Max messages per session |
| `persistDir` | `null` | Directory for persistence files |
| `persistInterval` | `30000` | Snapshot interval in ms |
| `cleanupInterval` | `60000` | Expiry cleanup interval in ms |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `create(opts)` | Session | Create a new session |
| `get(id)` | Session? | Get session (returns null if expired) |
| `touch(id)` | Session | Refresh TTL |
| `destroy(id)` | bool | Destroy session |
| `extend(id, ttl)` | Session | Update TTL |
| `update(id, updates)` | Session | Update owner/namespace/tags/metadata/ttl |
| `addMessage(id, role, content, opts)` | Message | Add conversation message |
| `getMessages(id, opts)` | Message[] | Get messages (filter by role/since/limit) |
| `getLastMessage(id)` | Message? | Get last message |
| `clearMessages(id)` | number | Clear all messages |
| `setState(id, key, value)` | object | Set state key |
| `getState(id, key?)` | any | Get state value or all state |
| `deleteState(id, key)` | void | Delete state key |
| `list(opts)` | Session[] | List with filters |
| `count(opts)` | number | Count sessions |
| `findByOwner(owner)` | Session[] | Find by owner |
| `findByNamespace(ns)` | Session[] | Find by namespace |
| `findByTag(tag)` | Session[] | Find by tag |
| `search(fn)` | Session[] | Custom predicate search |
| `destroyByOwner(owner)` | number | Destroy all by owner |
| `destroyByNamespace(ns)` | number | Destroy all by namespace |
| `destroyAll()` | number | Destroy all sessions |
| `stats()` | object | Get statistics |

### Events

- `create` — session created
- `destroy` — session destroyed
- `expire` — session expired (TTL reached)
- `touch` — session touched
- `message` — message added (payload: `{ session, message }`)
- `shutdown` — manager shutting down

## HTTP Server

```bash
node server.mjs          # → http://localhost:3118
PORT=8080 node server.mjs  # custom port
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Web dashboard |
| GET | `/api/stats` | Statistics |
| GET | `/api/sessions` | List sessions (?owner=&ns=&tag=&limit=) |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions/:id` | Get session |
| DELETE | `/api/sessions/:id` | Destroy session |
| PATCH | `/api/sessions/:id` | Update session |
| POST | `/api/sessions/:id/touch` | Touch session |
| POST | `/api/sessions/:id/extend` | Extend TTL |
| GET | `/api/sessions/:id/messages` | Get messages |
| POST | `/api/sessions/:id/messages` | Add message |
| DELETE | `/api/sessions/:id/messages` | Clear messages |
| GET | `/api/sessions/:id/state` | Get all state |
| GET | `/api/sessions/:id/state/:key` | Get state key |
| PUT | `/api/sessions/:id/state` | Set state (body: {key: value}) |
| DELETE | `/api/sessions/:id/state/:key` | Delete state key |

## MCP Server

```bash
node mcp-server.mjs
```

### Tools (10)

| Tool | Description |
|------|-------------|
| `session_create` | Create session |
| `session_get` | Get session by ID |
| `session_touch` | Refresh session TTL |
| `session_destroy` | Destroy session |
| `session_list` | List sessions with filters |
| `session_message_add` | Add message to conversation |
| `session_message_get` | Get messages from session |
| `session_state` | Get/set/delete state |
| `session_extend` | Extend session TTL |
| `session_stats` | Get statistics |

## CLI

```bash
node cli.mjs create --owner user-42 --ns chat --tags support,billing --ttl 1800000
node cli.mjs get <session-id>
node cli.mjs touch <session-id>
node cli.mjs destroy <session-id>
node cli.mjs list --owner user-42 --ns chat
node cli.mjs message add --sid <id> --role user --content "Hello"
node cli.mjs message list --sid <id> --limit 10
node cli.mjs message clear <id>
node cli.mjs state --sid <id> --key step --value lookup
node cli.mjs state --sid <id> --key step
node cli.mjs extend <id> 3600000
node cli.mjs stats
node cli.mjs expire
node cli.mjs serve     # start HTTP server
node cli.mjs mcp       # start MCP server
node cli.mjs demo      # run demo
```

## License

MIT
