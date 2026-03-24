# agent-sync 🔄

Zero-dependency distributed data sync & replication engine for AI agents with CRDTs.

## Features

- **5 CRDT Types**: LWW-Register, G-Counter, PN-Counter, OR-Set, LWW-Map
- **Delta-based sync**: Only transmit changes since last sync
- **Vector clocks**: Lamport-style causality tracking across peers
- **Full snapshot/restore**: Complete state transfer for initial sync
- **Conflict resolution**: LWW, FWW, merge, custom, and manual strategies
- **Peer management**: Register/unregister peers, track sync state
- **Sync log**: Full audit trail with configurable max entries
- **Namespace isolation**: Multi-tenant data separation
- **JSONL persistence**: Event log + periodic snapshots
- **EventEmitter**: Real-time notifications for all sync events

## Quick Start

```js
import { AgentSync } from './index.mjs';

const sync = new AgentSync({ peerId: 'server-1' });

// LWW Register
sync.set('user:name', 'Alice');
sync.get('user:name'); // 'Alice'

// G-Counter (monotonic)
sync.set('views', null, { type: 'g-counter', increment: 10 });
sync.increment('views', 5);
sync.get('views'); // 15

// PN-Counter (bidirectional)
sync.set('balance', null, { type: 'pn-counter', increment: 100 });
sync.decrement('balance', 30);
sync.get('balance'); // 70

// OR-Set
sync.addToSet('tags', 'important');
sync.addToSet('tags', 'urgent');
sync.removeFromSet('tags', 'urgent');
sync.get('tags'); // ['important']

// LWW-Map
sync.setInMap('config', 'theme', 'dark');
sync.getFromMap('config', 'theme'); // 'dark'
```

## Cross-Peer Sync

```js
const peer1 = new AgentSync({ peerId: 'server-1' });
const peer2 = new AgentSync({ peerId: 'server-2' });

peer1.set('shared', 'from-1');
peer2.set('shared', 'from-2');

// Full sync
peer1.sync(peer2.createSnapshot());

// Delta sync (only changes)
peer2.registerPeer('server-1');
const delta = peer1.getDelta('server-2');
peer2.applyDelta(delta);
```

## CRDT Types

| Type | Use Case | Operations |
|------|----------|------------|
| `lww` | Simple key-value | set, get (last write wins by timestamp) |
| `g-counter` | Page views, counts | increment only (monotonic) |
| `pn-counter` | Balances, deltas | increment, decrement |
| `or-set` | Tags, active users | add, remove, has, values |
| `lww-map` | Config, nested objects | set, get, delete, keys |

## API

### Core
- `set(key, value, opts)` — Set with CRDT type
- `get(key)` — Get value
- `delete(key)` — Delete key
- `has(key)` — Check existence
- `keys(namespace)` — List keys
- `entries(namespace)` — All entries as object

### CRDT Operations
- `increment(key, amount)` — G-counter increment
- `decrement(key, amount)` — PN-counter decrement
- `addToSet(key, value)` — OR-set add
- `removeFromSet(key, value)` — OR-set remove
- `setInMap(key, mapKey, value)` — LWW-map set
- `getFromMap(key, mapKey)` — LWW-map get

### Sync & Replication
- `createSnapshot()` — Full state snapshot
- `loadSnapshot(snapshot)` — Merge remote snapshot
- `getDelta(peerId)` — Changes since last sync
- `applyDelta(delta)` — Apply remote delta
- `sync(snapshot)` — Full bidirectional sync

### Peer Management
- `registerPeer(peerId, clock)` — Register peer
- `unregisterPeer(peerId)` — Remove peer
- `listPeers()` — List registered peers

### Query
- `stats()` — Sync statistics
- `getLog(since, limit)` — Sync log entries
- `getConflicts()` — Unresolved conflicts
- `clear()` — Clear all data

## CLI

```bash
node cli.mjs set user:name "Alice"
node cli.mjs get user:name
node cli.mjs increment views 5
node cli.mjs add-to-set tags important
node cli.mjs snapshot
node cli.mjs peers
node cli.mjs stats
node cli.mjs log --limit 10
node cli.mjs serve --port 3119
node cli.mjs mcp
node cli.mjs demo
```

## MCP Server

```bash
node mcp-server.mjs
```

24 tools: sync_set, sync_get, sync_get_entry, sync_delete, sync_keys, sync_entries, sync_increment, sync_decrement, sync_add_to_set, sync_remove_from_set, sync_snapshot, sync_load_snapshot, sync_delta, sync_apply_delta, sync_full_sync, sync_register_peer, sync_unregister_peer, sync_peers, sync_conflicts, sync_resolve_conflict, sync_log, sync_stats, sync_clear, sync_save

## HTTP Server

```bash
PORT=3119 node server.mjs
```

Dashboard: http://localhost:3119/

REST API:
- GET /api/stats
- GET /api/entries
- GET /api/keys
- GET /api/peers
- GET /api/conflicts
- GET /api/log?limit=50
- POST /api/set {key, value, type}
- POST /api/get {key}
- POST /api/delete {key}
- POST /api/increment {key, amount}
- POST /api/snapshot
- POST /api/sync {snapshot}

## Events

```js
sync.on('change', ({ op, key, value }) => { ... });
sync.on('set', ({ key, value, type }) => { ... });
sync.on('delete', ({ key }) => { ... });
sync.on('sync', ({ from, entries }) => { ... });
sync.on('synced', ({ from, conflicts }) => { ... });
sync.on('conflicts', (conflicts) => { ... });
sync.on('delta-applied', ({ from, entries }) => { ... });
sync.on('peer-registered', ({ peerId }) => { ... });
```

## License

MIT
