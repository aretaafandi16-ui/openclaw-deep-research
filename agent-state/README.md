# agent-state 🐋

Zero-dependency state machine engine for AI agent workflows. Define, persist, monitor, and orchestrate complex multi-step processes.

## Features

- **Finite State Machines** with guards, actions, and side effects
- **Hierarchical states** with parent-child relationships
- **Timers & delays** — auto-transition after timeout
- **History states** — shallow (last sub-state) and deep (full nested state)
- **Guards** — composable boolean conditions (`and`, `or`, `not`, `eq`, `gt`, `lt`, `in`, `exists`)
- **Workflow factory** — linear pipeline of steps (fetch → process → save)
- **Game loop factory** — cycling state phases (day → night → day)
- **Persistence** — JSONL event log for crash recovery
- **Snapshot/restore** — serialize and resume state machines
- **EventEmitter** — real-time monitoring of transitions, entries, exits
- **HTTP Dashboard** — dark-theme web UI with live machine monitoring
- **MCP Server** — 12 tools via JSON-RPC stdio
- **CLI** — interactive command-line interface

## Quick Start

```js
import { StateMachine } from './index.mjs';

const sm = new StateMachine({
  id: 'traffic-light',
  initial: 'red',
  context: { cycles: 0 },
  states: {
    red: {
      onEntry: (ctx) => { ctx.cycles++; },
      on: { TIMER: { target: 'green' } },
      after: { 5000: 'green' }, // auto-transition after 5s
    },
    green: {
      on: { TIMER: { target: 'yellow' } },
      after: { 5000: 'yellow' },
    },
    yellow: {
      on: { TIMER: { target: 'red' } },
      after: { 2000: 'red' },
    },
  },
});

sm.on('transition', (e) => console.log(`${e.from} → ${e.to}`));
sm.on('done', () => console.log('Machine complete'));

await sm.start();
await sm.send('TIMER');
console.log(sm.state); // 'green'
```

## State Definition

```js
{
  states: {
    myState: {
      type: 'normal',           // normal | final | history
      onEntry: (ctx) => {},     // called when entering state
      onExit: (ctx) => {},      // called when leaving state
      on: {                     // event → transition mapping
        EVENT_NAME: {
          target: 'nextState',
          guard: (ctx, data) => boolean,
          action: (ctx, data) => {},
        },
        MULTI_GUARD: [          // array = first passing guard wins
          { target: 'a', guard: (ctx) => ctx.x > 10 },
          { target: 'b' },      // fallback (no guard)
        ],
      },
      after: { 5000: 'timeout' },  // auto-transition after ms
      always: { target: 'next', guard: (ctx) => ctx.ready }, // immediate
      meta: { label: 'My State' }, // arbitrary metadata
    },
  },
}
```

## Guards

Built-in composable guard functions:

```js
import { Guards } from './index.mjs';

const sm = new StateMachine({
  states: {
    waiting: {
      on: {
        PROCEED: {
          target: 'active',
          guard: Guards.and(
            Guards.gt('score', 80),
            Guards.in('role', ['admin', 'owner']),
            Guards.exists('user.email'),
          ),
        },
        REJECT: {
          target: 'blocked',
          guard: Guards.or(
            Guards.eq('status', 'banned'),
            Guards.not(Guards.exists('user')),
          ),
        },
      },
    },
  },
});
```

| Guard | Usage | Description |
|-------|-------|-------------|
| `Guards.always` | `Guards.always` | Always passes |
| `Guards.never` | `Guards.never` | Always fails |
| `Guards.and(...guards)` | `Guards.and(g1, g2)` | All must pass |
| `Guards.or(...guards)` | `Guards.or(g1, g2)` | Any must pass |
| `Guards.not(guard)` | `Guards.not(g1)` | Inverts guard |
| `Guards.eq(path, val)` | `Guards.eq('status', 'ok')` | Context field equals value |
| `Guards.gt(path, val)` | `Guards.gt('score', 50)` | Greater than |
| `Guards.lt(path, val)` | `Guards.lt('retries', 3)` | Less than |
| `Guards.in(path, arr)` | `Guards.in('role', ['a','b'])` | Value in array |
| `Guards.exists(path)` | `Guards.exists('user.name')` | Path exists in context |

## Workflow Factory

Create linear pipelines that auto-advance through steps:

```js
import { createWorkflow } from './index.mjs';

const wf = createWorkflow('data-pipeline', [
  { name: 'fetch', action: async (ctx) => { ctx.data = await fetchApi(); } },
  { name: 'validate', action: (ctx) => { if (!ctx.data.ok) throw new Error('bad data'); } },
  { name: 'transform', action: (ctx) => { ctx.result = transform(ctx.data); } },
  { name: 'save', action: async (ctx) => { await db.save(ctx.result); } },
]);

await wf.start();
// Send NEXT to advance: fetch → validate → transform → save → done
await wf.send('NEXT');
```

## Game Loop Factory

Create cycling state phases with optional timeouts:

```js
import { createGameLoop } from './index.mjs';

const game = createGameLoop('day-cycle', [
  { name: 'morning', timeout: 5000, onEnter: () => console.log('☀️') },
  { name: 'afternoon', timeout: 5000, onEnter: () => console.log('🌤️') },
  { name: 'evening', timeout: 5000, onEnter: () => console.log('🌅') },
  { name: 'night', timeout: 5000, onEnter: () => console.log('🌙') },
], { stopEvent: 'QUIT' });

await game.start();
// Auto-cycles: morning → afternoon → evening → night → morning...
```

## Snapshot & Restore

```js
const snap = sm.snapshot();
// { id, currentState, context, stateHistory, deepHistory, ... }

// Later or in another process:
const sm2 = new StateMachine(config);
sm2.restore(snap);
// Continues from saved state
```

## CLI

```bash
# Interactive state machine from JSON config
agent-state run machine.json

# Demo traffic light
agent-state demo

# Run linear workflow
agent-state workflow pipeline.json

# Start HTTP dashboard
agent-state serve 3112

# Start MCP server
agent-state mcp

# Run tests
agent-state test
```

### Config file format

```json
{
  "id": "my-machine",
  "initial": "idle",
  "context": { "count": 0 },
  "states": {
    "idle": {
      "onEntry": "ctx.count++",
      "on": { "START": { "target": "running" } }
    },
    "running": {
      "on": { "STOP": { "target": "idle" } },
      "after": { "5000": "idle" }
    }
  }
}
```

Action strings are evaluated as JavaScript functions.

## MCP Server

12 tools via JSON-RPC stdio:

| Tool | Description |
|------|-------------|
| `state_create` | Create a state machine |
| `state_start` | Start a machine |
| `state_send` | Send an event |
| `state_get` | Get current state + context |
| `state_can` | Check if event can be handled |
| `state_stop` | Stop a machine |
| `state_snapshot` | Serialize machine state |
| `state_restore` | Restore from snapshot |
| `state_list` | List all machines |
| `state_history` | Get transition history |
| `workflow_create` | Create linear workflow |
| `state_stats` | Get statistics |

## HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machines` | List all machines |
| POST | `/api/machines` | Create machine |
| GET | `/api/machines/:id` | Get machine detail |
| POST | `/api/machines/:id/send` | Send event `{event, data}` |
| POST | `/api/machines/:id/start` | Start machine |
| POST | `/api/machines/:id/stop` | Stop machine |
| GET | `/api/machines/:id/history` | Get transition history |
| GET | `/api/machines/:id/snapshot` | Get snapshot |
| GET | `/api/stats` | Global statistics |
| GET | `/` | Web dashboard |

## API Reference

### `new StateMachine(config)`

Create a new state machine.

- `config.id` — Machine ID (auto-generated if omitted)
- `config.initial` — Initial state name
- `config.context` — Initial context object
- `config.states` — State definitions map
- `config.persistenceDir` — Directory for JSONL persistence

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start(initialState?)` | `Promise<this>` | Start the machine |
| `send(event, data?)` | `Promise<{changed, from?, to?, reason?}>` | Send event |
| `stop()` | `this` | Stop the machine |
| `can(event)` | `boolean` | Can event be handled? |
| `addState(name, def)` | `this` | Add a state |
| `snapshot()` | `object` | Serializable snapshot |
| `restore(snap)` | `this` | Restore from snapshot |
| `toJSON()` | `object` | Machine configuration |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `state` | `string` | Current state name |
| `isRunning` | `boolean` | Is machine running? |
| `isDone` | `boolean` | Reached final state? |
| `events` | `string[]` | Available events from current state |
| `context` | `object` | Mutable context data |
| `history` | `array` | Full transition history |

### Events

| Event | Data | When |
|-------|------|------|
| `start` | `{state, context}` | Machine started |
| `transition` | `{from, to, event, data, context, ts}` | State changed |
| `enter` | `{state, context}` | Entering a state |
| `exit` | `{state, context}` | Exiting a state |
| `timeout` | `{state, timeout, target}` | Timer fired |
| `done` | `{state, context}` | Final state reached |
| `stop` | `{state}` | Machine stopped |
| `unhandled` | `{state, event, data}` | No transition for event |
| `guard_failed` | `{state, event}` | Guard blocked transition |
| `ignored` | `{type, event}` | Event sent to stopped machine |

## License

MIT
