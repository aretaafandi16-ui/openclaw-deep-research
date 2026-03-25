# agent-stream v1.0

Zero-dependency streaming data processor for AI agents.

## Features

- **20+ operators**: map, filter, flatMap, reduce, batch, window (tumbling/sliding), debounce, throttle, distinct, take, skip, pluck, compact, flatten, tap, delay, sort
- **Multiple sources**: array, async generator, interval timer, file (JSONL), Node.js readable streams
- **Fan-out**: broadcast, round-robin, hash-based partitioning
- **Fan-in**: merge (interleaved), concat (ordered), zip (parallel)
- **Backpressure**: pull-based async iteration — consumer controls flow
- **Error handling**: retry with exponential backoff, error handler callback, DROP/STOP sentinels
- **Windowed aggregations**: sum, avg, min, max, count, median, stddev, groupBy
- **Stream composition**: pipe chains, static merge/concat/zip
- **Monitoring**: real-time stats (throughput, latency, items processed/dropped/errors)
- **Persistence**: optional JSONL recording for replay
- **HTTP Dashboard**: dark-theme web UI with pipeline runner
- **MCP Server**: 12 tools via JSON-RPC stdio
- **CLI**: command-line pipeline processing

## Quick Start

```js
import { StreamEngine, Aggregations } from './index.mjs';

// Basic pipeline
const results = await StreamEngine.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  .filter(x => x % 2 === 0)
  .map(x => ({ value: x, squared: x * x }))
  .batch(2)
  .run();
// [[2,4],[6,8],[10]]

// Windowed aggregation
const windows = await StreamEngine.from([
  { name: 'alice', score: 85 },
  { name: 'bob', score: 92 },
  { name: 'charlie', score: 78 },
]).window(2, 'tumbling').run();

// Async operations
const processed = await StreamEngine.from(urls)
  .map(async url => fetch(url).then(r => r.json()))
  .filter(item => item.status === 'active')
  .take(10)
  .run();

// Statistics
const engine = StreamEngine.from(data).filter(x => x > 0).map(x => x * 2);
await engine.run();
console.log(engine.getStats());
// { itemsReceived: 100, itemsProcessed: 60, throughput: 15000, ... }
```

## Operators

| Operator | Description |
|----------|-------------|
| `map(fn)` | Transform each item |
| `filter(fn)` | Keep items matching predicate |
| `flatMap(fn)` | Transform and flatten arrays |
| `reduce(fn, initial)` | Accumulate into single value |
| `tap(fn)` | Side-effect without modifying |
| `distinct(keyFn?)` | Remove duplicates |
| `take(n)` | Take first N items |
| `skip(n)` | Skip first N items |
| `batch(size)` | Group into arrays |
| `window(size, type)` | Tumbling or sliding windows |
| `debounce(ms)` | Debounce rapid items |
| `throttle(ms)` | Rate-limit items |
| `delay(ms)` | Add delay between items |
| `pluck(key)` | Extract property |
| `compact()` | Remove falsy values |
| `flatten()` | Flatten nested arrays |

## Fan-out / Fan-in

```js
// Broadcast to multiple streams
source.broadcast(streamA, streamB, streamC);

// Round-robin distribution
source.roundRobin(worker1, worker2, worker3);

// Hash-based partitioning
source.hash(item => item.userId, partition0, partition1, partition2);

// Merge multiple streams
const merged = StreamEngine.merge(streamA, streamB, streamC);

// Concat in order
const concated = StreamEngine.concat(streamA, streamB);

// Zip parallel items
const zipped = StreamEngine.zip(streamA, streamB);
// yields [a1, b1], [a2, b2], ...
```

## Aggregations

```js
import { Aggregations } from './index.mjs';

Aggregations.sum([1, 2, 3]);                    // 6
Aggregations.avg([{v: 10}, {v: 20}], 'v');     // 15
Aggregations.median([1, 2, 3, 4, 5]);          // 3
Aggregations.stddev([10, 20, 30]);             // 8.16
Aggregations.groupBy(users, 'department');      // { eng: [...], sales: [...] }
```

## Error Handling

```js
const engine = new StreamEngine({
  retry: { attempts: 3, delay: 100 },
  onError: (err, item) => {
    console.error('Failed:', err.message);
    return StreamEngine.DROP; // or return modified item
  }
});
```

## HTTP Server

```bash
node server.mjs
# Dashboard: http://localhost:3141
# API: http://localhost:3141/api/run (POST)
```

## MCP Server

```bash
node mcp-server.mjs
# 12 tools: stream_create, stream_map, stream_filter, stream_batch,
# stream_window, stream_take, stream_distinct, stream_run,
# stream_stats, stream_stop, stream_list, stream_aggregate
```

## CLI

```bash
# Pipeline from stdin
echo '[1,2,3,4,5]' | node cli.mjs run - | node cli.mjs aggregate sum

# Interactive demo
node cli.mjs demo
```

## License

MIT
