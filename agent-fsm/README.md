# agent-fsm

Zero-dependency finite state machine engine for AI agents. Typed transitions, guards, actions, hooks, history tracking, parallel machines, presets, persistence, and visualization.

## Features

- **Typed transitions** — from + event → to with optional guards and actions
- **Guards** — conditional transitions based on context
- **Hooks** — onEnter, onExit, onState callbacks
- **Context** — per-machine key-value state with update/merge
- **History** — full transition log with timestamps and durations
- **Wildcards** — `*` from-state matches any state
- **Presets** — 5 built-in FSMs (order, conversation, task, connection, approval)
- **Registry** — multi-machine manager with broadcast
- **Parallel FSMs** — run multiple machines concurrently with sync
- **Visualization** — Mermaid and Graphviz DOT export
- **Persistence** — JSON save/load with auto-persist
- **Events** — EventEmitter for start/transition/rejected/done
- **HTTP Dashboard** — dark-theme web UI on port 3124
- **MCP Server** — 10 tools via JSON-RPC stdio
- **CLI** — full command-line interface
- **41 tests** — all passing

## Quick Start

```javascript
import { FSM } from './index.mjs';

const fsm = new FSM({ initial: 'idle' });
fsm.addTransition({ from: 'idle', event: 'start', to: 'running' });
fsm.addTransition({ from: 'running', event: 'stop', to: 'idle' });
fsm.addTransition({ from: 'running', event: 'finish', to: 'done' });

fsm.start();
console.log(fsm.state); // 'idle'

fsm.send('start');
console.log(fsm.state); // 'running'

fsm.send('finish');
console.log(fsm.done); // true
```

## Guards

```javascript
const fsm = new FSM({
  initial: 'locked',
  guards: {
    hasKey: (ctx) => ctx.context.pin === '1234',
  },
});
fsm.addTransition({ from: 'locked', event: 'unlock', to: 'unlocked', guard: 'hasKey' });
fsm.start();

fsm.can('unlock'); // false
fsm.set('pin', '1234');
fsm.can('unlock'); // true
fsm.send('unlock');
```

## Presets

```javascript
import { FSM, presets } from './index.mjs';

const order = new FSM(presets.orderLifecycle);
order.start();
order.send('confirm');
order.send('pay');
order.send('ship');
order.send('deliver');
console.log(order.done); // true
```

Available presets: `orderLifecycle`, `conversation`, `taskLifecycle`, `connection`, `approval`

## Registry

```javascript
import { FSMRegistry } from './index.mjs';

const reg = new FSMRegistry();
const fsm1 = reg.create({ initial: 'a', name: 'Machine 1' });
const fsm2 = reg.create({ initial: 'x', name: 'Machine 2' });

// Broadcast event to all active machines
reg.broadcast('tick');

console.log(reg.stats());
// { total: 2, active: 2, done: 0, totalTransitions: 2 }
```

## Parallel FSMs

```javascript
import { ParallelFSM } from './index.mjs';

const p = new ParallelFSM([
  { name: 'validator', initial: 'waiting' },
  { name: 'processor', initial: 'idle' },
]);
p.start();
p.send('start');
console.log(p.states);
console.log(p.done);
```

## Visualization

```javascript
const fsm = new FSM(presets.orderLifecycle);
console.log(fsm.toMermaid());
// stateDiagram-v2
//     [*] --> pending
//     pending --> confirmed: confirm
//     confirmed --> paid: pay
//     ...

console.log(fsm.toDot());
// digraph FSM { ... }
```

## HTTP Server

```bash
node server.mjs
# → http://localhost:3124
```

REST API:
- `GET /api/registry/stats` — machine statistics
- `GET /api/registry/list` — list all machines
- `POST /api/create` — create machine (JSON body)
- `GET /api/fsm/:id` — machine state
- `POST /api/fsm/:id/send` — send event
- `GET /api/fsm/:id/events` — available events
- `GET /api/fsm/:id/history` — transition history
- `POST /api/fsm/:id/reset` — reset machine
- `GET /api/fsm/:id/mermaid` — Mermaid diagram
- `GET /api/fsm/:id/dot` — DOT diagram
- `GET /api/presets` — list presets
- `POST /api/presets/create` — create from preset

## MCP Server

```bash
node mcp-server.mjs
```

10 tools: `fsm_create`, `fsm_send`, `fsm_get`, `fsm_can`, `fsm_list`, `fsm_history`, `fsm_reset`, `fsm_remove`, `fsm_export`, `fsm_presets`

## CLI

```bash
node cli.mjs demo              # Interactive demo
node cli.mjs presets           # List presets
node cli.mjs create orderLifecycle  # Create from preset
node cli.mjs create '{"initial":"a","transitions":[{"from":"a","event":"go","to":"b"}]}'
node cli.mjs serve             # HTTP server
node cli.mjs mcp               # MCP server
```

## API Reference

### FSM(config)

| Option | Type | Description |
|--------|------|-------------|
| `id` | string | Machine ID (auto-generated) |
| `name` | string | Display name |
| `initial` | string | Initial state (required) |
| `finalStates` | string[] | Terminal states |
| `context` | object | Initial context |
| `transitions` | array | Transition definitions |
| `guards` | object | Guard functions |
| `onEnter` | object | Enter hooks by state |
| `onExit` | object | Exit hooks by state |
| `persistencePath` | string | JSON file path |
| `autoPersist` | boolean | Auto-save on change |

### FSM Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start(state?)` | FSM | Start the machine |
| `stop()` | FSM | Stop the machine |
| `reset(state?)` | FSM | Reset to initial |
| `send(event, payload?)` | result | Send an event |
| `can(event)` | boolean | Check if event valid |
| `availableEvents()` | string[] | List valid events |
| `possibleTransitions()` | array | List transitions |
| `getStates()` | string[] | All states |
| `set(key, value)` | FSM | Set context |
| `get(key)` | any | Get context |
| `toMermaid()` | string | Mermaid diagram |
| `toDot()` | string | DOT diagram |
| `save(path?)` | FSM | Persist to file |

## License

MIT
