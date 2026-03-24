# agent-graph

Zero-dep graph database for AI agents. Nodes, edges, labels, properties, traversal, algorithms, persistence — all in pure Node.js.

## Features

- **Nodes & Edges**: Labeled nodes with properties, weighted typed edges
- **Traversal**: BFS, DFS with depth limits and direction control
- **Shortest Path**: Dijkstra's algorithm (weighted), all-paths enumeration
- **Algorithms**: PageRank, topological sort, cycle detection, connected components, strongly connected components (Tarjan's)
- **Visualization**: Mermaid, Graphviz DOT, JSON export
- **Subgraph**: Extract and merge subgraphs
- **Persistence**: JSON snapshots + JSONL event logs, auto-save on mutation
- **Events**: EventEmitter for node/edge add/update/remove/persist
- **Limits**: Max nodes/edges with automatic eviction
- **HTTP Dashboard**: Dark-theme web UI with CRUD, shortest path, stats
- **MCP Server**: 12 tools via JSON-RPC stdio
- **CLI**: Full command-line interface

## Quick Start

```js
import { AgentGraph } from './index.mjs';

const g = new AgentGraph({ autoPersist: false });

// Add labeled nodes with properties
g.addNode('alice', ['Person', 'Engineer'], { age: 30 });
g.addNode('bob', ['Person'], { age: 25 });
g.addNode('company', ['Org'], { name: 'Acme' });

// Add typed, weighted edges
g.addEdge('alice', 'company', 'works_at', 1);
g.addEdge('alice', 'bob', 'knows', 0.8);
g.addEdge('bob', 'company', 'works_at', 1);

// Query
g.neighbors('alice');           // → [{ node, edge, direction }]
g.findNodes({ label: 'Person' }); // → filtered by label
g.degree('alice');              // → 2

// Traverse
g.bfs('alice', { maxDepth: 2 }); // → [{ id, depth, node }]
g.dfs('bob', { direction: 'out' });

// Shortest path
const path = g.shortestPath('alice', 'bob');
// → { nodes: ['alice', 'company', 'bob'], distance: 2 }

// Algorithms
g.pagerank();                         // → Map<id, score>
g.topologicalSort();                  // → { sorted, hasCycle }
g.connectedComponents();              // → [[ids], ...]
g.stronglyConnectedComponents();      // → [[ids], ...]

// Visualize
g.toMermaid();  // Mermaid diagram
g.toDot();      // Graphviz DOT
g.toJSON();     // Full export
```

## CLI

```bash
node cli.mjs add-node alice --labels Person,Engineer --props '{"age":30}'
node cli.mjs add-node bob --labels Person
node cli.mjs add-edge alice bob --type knows --weight 0.8
node cli.mjs neighbors alice --direction out
node cli.mjs path alice bob
node cli.mjs traverse alice --algo bfs --depth 3
node cli.mjs pagerank
node cli.mjs toposort
node cli.mjs components
node cli.mjs export --format mermaid
node cli.mjs stats
node cli.mjs serve --port 3117
node cli.mjs mcp
node cli.mjs demo
```

## HTTP API

```bash
node server.mjs  # → http://localhost:3117

# Nodes
curl localhost:3117/api/nodes
curl -X POST localhost:3117/api/nodes -d '{"id":"a","labels":["Person"],"props":{"name":"Alice"}}'
curl localhost:3117/api/nodes/a
curl -X DELETE localhost:3117/api/nodes/a

# Edges
curl localhost:3117/api/edges
curl -X POST localhost:3117/api/edges -d '{"from":"a","to":"b","type":"knows","weight":1}'

# Algorithms
curl -X POST localhost:3117/api/shortest-path -d '{"from":"a","to":"b"}'
curl -X POST localhost:3117/api/traverse -d '{"start":"a","algorithm":"bfs"}'
curl localhost:3117/api/pagerank
curl localhost:3117/api/toposort
curl localhost:3117/api/components
curl localhost:3117/api/scc
curl localhost:3117/api/export?format=mermaid
curl localhost:3117/api/stats
```

## MCP Server

```bash
node mcp-server.mjs  # JSON-RPC stdio
```

**12 tools**: `graph_add_node`, `graph_get_node`, `graph_remove_node`, `graph_find_nodes`, `graph_add_edge`, `graph_remove_edge`, `graph_neighbors`, `graph_shortest_path`, `graph_traverse`, `graph_pagerank`, `graph_toposort`, `graph_export`

## API Reference

### `AgentGraph`

| Method | Returns | Description |
|--------|---------|-------------|
| `addNode(id, labels[], props{})` | Node | Add/update node |
| `getNode(id)` | Node \| null | Get node by ID |
| `updateNode(id, props{})` | Node \| null | Update node props |
| `removeNode(id)` | boolean | Remove node + connected edges |
| `findNodes(filter{})` | Node[] | Find by label/labels/where/limit |
| `nodeCount()` | number | Total nodes |
| `addEdge(from, to, type, weight, props{})` | Edge | Add edge (nodes must exist) |
| `getEdge(id)` | Edge \| null | Get edge by ID |
| `removeEdge(id)` | boolean | Remove edge |
| `findEdges(filter{})` | Edge[] | Find by from/to/type/where/limit |
| `edgeCount()` | number | Total edges |
| `neighbors(id, opts{})` | [{node,edge,direction}] | Get neighbors |
| `degree(id, direction)` | number | In/out/total degree |
| `bfs(start, opts{})` | [{id,depth,node}] | BFS traversal |
| `dfs(start, opts{})` | [{id,depth,node}] | DFS traversal |
| `shortestPath(from, to, opts{})` | {nodes,distance} \| null | Dijkstra's |
| `allPaths(from, to, opts{})` | [[path]] | All paths (maxDepth) |
| `connectedComponents()` | [[ids]] | Connected components |
| `topologicalSort()` | {sorted,hasCycle} | Topological sort |
| `hasCycle()` | boolean | Cycle detection |
| `stronglyConnectedComponents()` | [[ids]] | Tarjan's SCC |
| `pagerank(opts{})` | Map<id,score> | PageRank algorithm |
| `subgraph(nodeIds)` | AgentGraph | Extract subgraph |
| `merge(other)` | AgentGraph | Merge another graph |
| `toMermaid(opts{})` | string | Mermaid diagram |
| `toDot(opts{})` | string | Graphviz DOT |
| `toJSON()` | {nodes,edges,stats} | Full export |
| `stats()` | {nodes,edges,labels,edgeTypes} | Graph stats |
| `persist()` | void | Save to disk |
| `clear()` | void | Remove all data |
| `close()` | void | Persist + cleanup |
| `static load(dir, opts{})` | AgentGraph | Load from disk |

### Options

```js
{
  dir: './data',          // Persistence directory
  autoPersist: true,      // Save on every mutation
  maxNodes: 0,            // Max nodes (0=unlimited)
  maxEdges: 0,            // Max edges (0=unlimited)
  persistInterval: 0,     // Auto-persist interval ms (0=on mutation)
}
```

### Events

```js
graph.on('node:added', (node) => {});
graph.on('node:updated', (node) => {});
graph.on('node:removed', (id) => {});
graph.on('edge:added', (edge) => {});
graph.on('edge:removed', (id) => {});
graph.on('persisted', (stats) => {});
graph.on('loaded', (stats) => {});
graph.on('cleared', () => {});
```

## Use Cases

- **Knowledge graphs**: Entity relationships, ontology
- **Dependency tracking**: Build order, impact analysis
- **Social networks**: Follow/friend graphs, influence
- **Recommendation engines**: Collaborative filtering
- **Route planning**: Weighted shortest paths
- **Code analysis**: AST, call graphs, imports
- **AI agent memory**: Relationship-aware memory systems

## Tests

```bash
node test.mjs  # 81 tests
```

## License

MIT
