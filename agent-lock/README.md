# agent-lock v1.0

Zero-dependency distributed locking & coordination for AI agents.

## Features

- **Mutex** — Exclusive lock with reentrant support, FIFO queuing, TTL auto-release
- **Read-Write Lock** — Multiple concurrent readers, exclusive writer, reader/writer queues
- **Semaphore** — N-concurrent permits with queuing and multi-permit acquisition
- **Barrier** — Wait for N parties before proceeding (multi-agent synchronization)
- **Leader Election** — Deterministic single-leader with automatic failover
- **Deadlock Detection** — Wait-for graph cycle detection
- **withLock / withReadLock / withWriteLock / withPermit** — Auto-release wrappers
- **Namespace Isolation** — Multiple independent lock managers
- **JSONL Persistence** — Event log + snapshots survive restarts
- **EventEmitter** — Real-time events for all lock operations
- **HTTP Dashboard** — Dark-theme web UI at port 3124
- **MCP Server** — 10 tools via JSON-RPC stdio
- **CLI** — Full command-line interface

## Install

```bash
# Zero dependencies — just Node.js 18+
cd agent-lock
node cli.mjs help
```

## Quick Start

```javascript
import { AgentLock } from './index.mjs';

const lock = new AgentLock();

// Exclusive lock with auto-release
await lock.withLock('critical-section', 'agent-1', async () => {
  // Only one agent can be here at a time
  return await doCriticalWork();
});

// Read-write lock
await lock.withReadLock('config', 'reader-1', () => readConfig());
await lock.withWriteLock('config', 'writer-1', () => updateConfig());

// Semaphore (3 concurrent)
lock.semaphore('api-limiter', 3);
await lock.withPermit('api-limiter', 'agent-1', () => callAPI());

// Barrier (wait for all agents)
lock.barrier('sync', 3);
await lock.barrierWait('sync', 'agent-1'); // blocks until 3 arrive
```

## API

### Mutex (Exclusive Lock)

```javascript
await lock.lock('resource', 'holder', timeout);
await lock.withLock('resource', 'holder', fn, timeout);
lock.unlock('resource', 'holder');
lock.forceUnlock('resource');
```

Options: `{ ttl: 30000, reentrant: true }`

### Read-Write Lock

```javascript
await lock.readLock('data', 'reader', timeout);
await lock.writeLock('data', 'writer', timeout);
await lock.withReadLock('data', 'reader', fn);
await lock.withWriteLock('data', 'writer', fn);
lock.readUnlock('data', 'reader');
lock.writeUnlock('data', 'writer');
```

### Semaphore

```javascript
lock.semaphore('pool', 5); // 5 permits
await lock.acquirePermit('pool', 'worker', 1, timeout);
await lock.withPermit('pool', 'worker', fn, count);
lock.releasePermit('pool', 'worker', 1);
```

### Barrier

```javascript
lock.barrier('sync', 3); // 3 parties
const generation = await lock.barrierWait('sync', 'label');
lock.barrierReset('sync');
```

### Leader Election

```javascript
lock.joinElection('election', 'candidate-id', { meta: true });
lock.leaveElection('election', 'candidate-id');
```

### Deadlock Detection

```javascript
const cycles = lock.detectDeadlocks();
// Returns array of cycle paths: [['agent-A', 'agent-B', 'agent-A']]
```

### Introspection

```javascript
lock.stats;        // { acquires, releases, timeouts, deadlocks, forceReleases }
lock.listLocks();  // All mutexes, rwlocks, semaphores
lock.listBarriers();
lock.listElections();
```

### Events

```javascript
lock.on('lock_acquired', ({ name, holder }) => {});
lock.on('lock_released', ({ name, holder, reason }) => {});
lock.on('read_lock_acquired', ({ name, holder }) => {});
lock.on('write_lock_acquired', ({ name, holder }) => {});
lock.on('permit_acquired', ({ name, holder, count }) => {});
lock.on('barrier_released', ({ name, generation }) => {});
lock.on('leader_changed', ({ name, leader, prev }) => {});
lock.on('deadlock', ({ cycles }) => {});
lock.on('lock_force_released', ({ name, holder }) => {});
```

## HTTP Server

```bash
node server.mjs         # Starts on port 3124
PORT=8080 node server.mjs
```

**Dashboard:** `http://localhost:3124/`

**API Endpoints:**
- `GET /api/status` — Full status (stats, locks, barriers, elections, deadlocks)
- `GET /api/stats` — Just statistics
- `GET /api/locks` — List all locks
- `POST /api/mutex/lock` — `{ name, holder?, timeout? }`
- `POST /api/mutex/unlock` — `{ name, holder? }`
- `POST /api/mutex/force` — `{ name }`
- `POST /api/rw/read-lock` — `{ name, holder?, timeout? }`
- `POST /api/rw/write-lock` — `{ name, holder?, timeout? }`
- `POST /api/rw/read-unlock` — `{ name, holder? }`
- `POST /api/rw/write-unlock` — `{ name, holder? }`
- `POST /api/semaphore/create` — `{ name, maxPermits }`
- `POST /api/semaphore/acquire` — `{ name, holder?, count?, timeout? }`
- `POST /api/semaphore/release` — `{ name, holder?, count? }`
- `POST /api/barrier/create` — `{ name, parties }`
- `POST /api/barrier/wait` — `{ name, label? }`
- `POST /api/barrier/reset` — `{ name }`
- `POST /api/with-lock` — `{ name, holder?, timeout?, result? }`
- `GET /api/locks` — List all locks
- `GET /api/barriers` — List barriers
- `GET /api/elections` — List elections
- `GET /api/deadlocks` — Detect deadlocks

## MCP Server

```bash
node mcp-server.mjs
```

**10 Tools:**
| Tool | Description |
|------|-------------|
| `lock_acquire` | Acquire exclusive mutex lock |
| `lock_release` | Release exclusive mutex lock |
| `lock_force_release` | Force-release a mutex |
| `rwlock_read_lock` | Acquire read lock |
| `rwlock_write_lock` | Acquire write lock |
| `rwlock_read_unlock` | Release read lock |
| `rwlock_write_unlock` | Release write lock |
| `semaphore_acquire` | Acquire semaphore permits |
| `semaphore_release` | Release semaphore permits |
| `lock_status` | Get stats, lists, deadlock info |

## CLI

```bash
# Mutex
node cli.mjs lock my-lock --holder agent-1
node cli.mjs unlock my-lock --holder agent-1
node cli.mjs force my-lock
node cli.mjs with-lock my-lock --exec "do-work"

# Read-Write
node cli.mjs read-lock data --holder reader-1
node cli.mjs write-lock data --holder writer-1
node cli.mjs read-unlock data --holder reader-1
node cli.mjs write-unlock data --holder writer-1

# Semaphore
node cli.mjs sem-acquire pool --max 3 --holder worker-1
node cli.mjs sem-release pool --holder worker-1

# Barrier
node cli.mjs barrier sync --parties 3 --label agent-1
node cli.mjs barrier-reset sync

# Status
node cli.mjs list
node cli.mjs stats
node cli.mjs deadlocks

# Servers
node cli.mjs serve --port 3124
node cli.mjs mcp
node cli.mjs demo
```

## Tests

```bash
node test.mjs
# 30 tests, all passing ✅
```

## Use Cases

- **Mutual Exclusion** — Ensure only one agent modifies shared state at a time
- **Rate Limiting** — Semaphore controls concurrent API calls
- **Multi-Agent Sync** — Barriers synchronize agent batches
- **Leader Election** — Single coordinator in multi-agent systems
- **Deadlock Prevention** — Detect and alert on circular wait conditions
- **Config Coordination** — RW locks for shared configuration reads

## License

MIT
