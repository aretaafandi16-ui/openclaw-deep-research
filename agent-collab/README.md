# agent-collab v1.0

Multi-agent collaboration protocol for AI agents. Zero dependencies.

Spawn agents, delegate tasks, coordinate work, share state — all in-process or over HTTP.

## Features

- **Agent Registry** — register/unregister agents with roles (coordinator, worker, observer, specialist) and capabilities
- **Task Queue** — priority-based with capability requirements, dependencies, retries
- **Auto-Assignment** — 5 strategies: round-robin, least-loaded, random, capability-match, broadcast
- **Delegation** — split parent tasks into parallel subtasks, auto-assigned
- **Task Chains** — sequential pipelines with automatic dependency wiring
- **Messaging** — direct agent-to-agent messages + broadcast with role exclusions
- **Shared Memory** — key-value store with TTL, distributed locks, watchers
- **Persistence** — JSONL state snapshots, survives restarts
- **Event Emitter** — lifecycle events for all operations
- **MCP Server** — 12 tools via JSON-RPC stdio
- **CLI** — full command-line interface
- **HTTP API** — REST endpoints on port 3132

## Quick Start

```js
import { CollabEngine, ROLES, STRATEGIES } from './index.mjs';

const engine = new CollabEngine();

// Register agents
const coord = engine.registerAgent({ name: 'coordinator', role: ROLES.COORDINATOR });
const coder = engine.registerAgent({ name: 'coder', capabilities: ['python', 'testing'] });
const reviewer = engine.registerAgent({ name: 'reviewer', capabilities: ['review'] });

// Create and delegate tasks
const parent = engine.createTask({ type: 'feature', payload: { name: 'auth' } });
engine.delegate(parent.id, [
  { type: 'implement', requires: ['python'] },
  { type: 'test', requires: ['testing'] },
  { type: 'review', requires: ['review'] },
], STRATEGIES.CAPABILITY);

// Communicate
engine.sendMessage(coord.id, coder.id, 'Start auth implementation');
engine.broadcast(coord.id, 'Sprint update: auth module in progress');
```

## CLI

```bash
node cli.mjs register --name=worker1 --capabilities=python,testing
node cli.mjs task --type=implement --payload='{"module":"auth"}'
node cli.mjs auto --task=<taskId>
node cli.mjs done --task=<taskId>
node cli.mjs stats
node cli.mjs demo
```

## MCP Server

```bash
node mcp-server.mjs  # JSON-RPC stdio
node mcp-server.mjs --list  # List available tools
```

Tools: `collab_register_agent`, `collab_unregister_agent`, `collab_list_agents`, `collab_create_task`, `collab_assign_task`, `collab_auto_assign`, `collab_delegate`, `collab_complete_task`, `collab_fail_task`, `collab_send_message`, `collab_get_messages`, `collab_stats`

## HTTP API

```bash
node cli.mjs serve --port=3132
curl http://localhost:3132/api/stats
curl http://localhost:3132/api/agents
curl http://localhost:3132/api/tasks
curl http://localhost:3132/api/messages
```

## Tests

```bash
node --test test.mjs  # 27 tests, all passing
```

## License

MIT
