#!/usr/bin/env node
// agent-graph test suite
import { AgentGraph } from './index.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
function test(name, fn) {
  if (!name) { failed++; console.error(`  ✗ [MISSING NAME] fn=${fn?.name || 'anon'}\n    ${new Error().stack?.split('\n').slice(1,4).join('\n    ')}`); return; }
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}\n    ${e.stack?.split('\n').slice(1,3).join('\n    ')}`); }
}

console.log('🧪 agent-graph tests\n');

// Basic node operations
test('addNode creates node', () => {
  const g = new AgentGraph({ autoPersist: false });
  const n = g.addNode('a', ['Person'], { name: 'Alice' });
  assert(n.id === 'a');
  assert(n.labels.includes('Person'));
  assert(n.props.name === 'Alice');
  assert(g.nodeCount() === 1);
});

test('addNode merges labels and props on duplicate', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a', ['Person'], { age: 30 });
  const n = g.addNode('a', ['Employee'], { name: 'Alice' });
  assert(n.labels.includes('Person'));
  assert(n.labels.includes('Employee'));
  assert(n.props.age === 30);
  assert(n.props.name === 'Alice');
  assert(g.nodeCount() === 1);
});

test('getNode returns null for missing', () => {
  const g = new AgentGraph({ autoPersist: false });
  assert(g.getNode('x') === null);
});

test('updateNode modifies props', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a', [], { x: 1 });
  g.updateNode('a', { x: 2, y: 3 });
  const n = g.getNode('a');
  assert(n.props.x === 2);
  assert(n.props.y === 3);
});

test('removeNode removes node and connected edges', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b', 'rel', 1);
  g.addEdge('b', 'c', 'rel', 1);
  g.removeNode('b');
  assert(g.nodeCount() === 2);
  assert(g.edgeCount() === 0);
});

test('findNodes by label', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a', ['Person']);
  g.addNode('b', ['Place']);
  g.addNode('c', ['Person']);
  assert(g.findNodes({ label: 'Person' }).length === 2);
  assert(g.findNodes({ label: 'Place' }).length === 1);
});

test('findNodes with where filter', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a', [], { age: 25 });
  g.addNode('b', [], { age: 35 });
  const r = g.findNodes({ where: p => p.age > 30 });
  assert(r.length === 1);
  assert(r[0].id === 'b');
});

// Edge operations
test('addEdge creates edge', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b');
  const e = g.addEdge('a', 'b', 'knows', 2.5);
  assert(e.from === 'a');
  assert(e.to === 'b');
  assert(e.type === 'knows');
  assert(e.weight === 2.5);
  assert(g.edgeCount() === 1);
});

test('addEdge throws for missing nodes', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a');
  let threw = false;
  try { g.addEdge('a', 'x'); } catch { threw = true; }
  assert(threw);
});

test('removeEdge', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b');
  const e = g.addEdge('a', 'b');
  assert(g.removeEdge(e.id));
  assert(g.edgeCount() === 0);
});

test('findEdges by type', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b', 'knows');
  g.addEdge('a', 'c', 'owns');
  assert(g.findEdges({ type: 'knows' }).length === 1);
});

test('findEdges by from/to', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('a', 'c'); g.addEdge('b', 'c');
  assert(g.findEdges({ from: 'a' }).length === 2);
  assert(g.findEdges({ to: 'c' }).length === 2);
});

// Neighbors
test('neighbors out', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('a', 'c');
  const n = g.neighbors('a', { direction: 'out' });
  assert(n.length === 2);
});

test('neighbors in', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'c'); g.addEdge('b', 'c');
  const n = g.neighbors('c', { direction: 'in' });
  assert(n.length === 2);
});

test('neighbors filter by type', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b', 'knows'); g.addEdge('a', 'c', 'owns');
  const n = g.neighbors('a', { direction: 'out', type: 'knows' });
  assert(n.length === 1);
  assert(n[0].node.id === 'b');
});

test('degree', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('c', 'a');
  assert(g.degree('a') === 2);
  assert(g.degree('a', 'out') === 1);
  assert(g.degree('a', 'in') === 1);
});

// Traversal
test('bfs traversal order', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c'); g.addNode('d');
  g.addEdge('a', 'b'); g.addEdge('a', 'c'); g.addEdge('b', 'd');
  const r = g.bfs('a');
  assert(r[0].id === 'a' && r[0].depth === 0);
  assert(r.some(n => n.id === 'd' && n.depth === 2));
});

test('dfs traversal', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('a', 'c');
  const r = g.dfs('a');
  assert(r.length === 3);
  assert(r[0].id === 'a');
});

test('bfs maxDepth', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('b', 'c');
  const r = g.bfs('a', { maxDepth: 1 });
  assert(r.length === 2);
});

// Shortest path
test('shortestPath finds path', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b', 'rel', 1);
  g.addEdge('b', 'c', 'rel', 1);
  const r = g.shortestPath('a', 'c');
  assert(r !== null);
  assert(r.nodes.join(',') === 'a,b,c');
  assert(r.distance === 2);
});

test('shortestPath weighted', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b', 'rel', 10);
  g.addEdge('a', 'c', 'rel', 1);
  g.addEdge('c', 'b', 'rel', 1);
  const r = g.shortestPath('a', 'b');
  assert(r.nodes.join(',') === 'a,c,b');
  assert(r.distance === 2);
});

test('shortestPath returns null when no path', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b');
  assert(g.shortestPath('a', 'b') === null);
});

test('allPaths finds multiple paths', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c'); g.addNode('d');
  g.addEdge('a', 'b'); g.addEdge('b', 'd');
  g.addEdge('a', 'c'); g.addEdge('c', 'd');
  const paths = g.allPaths('a', 'd');
  assert(paths.length === 2);
});

// Algorithms
test('connectedComponents', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b');
  const cc = g.connectedComponents();
  assert(cc.length === 2);
});

test('topologicalSort on DAG', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('b', 'c');
  const r = g.topologicalSort();
  assert(!r.hasCycle);
  assert(r.sorted.indexOf('a') < r.sorted.indexOf('b'));
  assert(r.sorted.indexOf('b') < r.sorted.indexOf('c'));
});

test('topologicalSort detects cycle', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('c', 'a');
  assert(g.topologicalSort().hasCycle);
  assert(g.hasCycle());
});

test('stronglyConnectedComponents', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('b', 'a'); // SCC1: a,b
  g.addEdge('b', 'c'); // c is SCC2
  const scc = g.stronglyConnectedComponents();
  assert(scc.length === 2);
});

test('pagerank scores sum to ~1', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('c', 'a');
  const pr = g.pagerank();
  const sum = [...pr.values()].reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 0.01);
});

// Visualization
test('toMermaid', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a', ['X']); g.addNode('b');
  g.addEdge('a', 'b', 'rel');
  const m = g.toMermaid();
  assert(m.includes('graph TD'));
  assert(m.includes('a[a: X]'), 'mermaid should have node label a[a: X]');
  assert(m.includes('a -->|rel| b'));
});

test('toDot', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b');
  g.addEdge('a', 'b', 'rel');
  const d = g.toDot();
  assert(d.includes('digraph'));
  assert(d.includes('"a" -> "b"'));
});

// Subgraph & merge
test('subgraph', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b'); g.addEdge('b', 'c');
  const sub = g.subgraph(['a', 'b']);
  assert(sub.nodeCount() === 2);
  assert(sub.edgeCount() === 1);
});

test('merge two graphs', () => {
  const g1 = new AgentGraph({ autoPersist: false });
  g1.addNode('a'); g1.addNode('b');
  g1.addEdge('a', 'b');
  const g2 = new AgentGraph({ autoPersist: false });
  g2.addNode('c'); g2.addNode('b', ['X']);
  g2.addEdge('b', 'c');
  g1.merge(g2);
  assert(g1.nodeCount() === 3);
  assert(g1.edgeCount() === 2);
  assert(g1.getNode('b').labels.includes('X'));
});

// Persistence
test('persist and load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ag-'));
  const g = new AgentGraph({ dir, autoPersist: true });
  g.addNode('a', ['X'], { v: 1 });
  g.addNode('b', ['Y']);
  g.addEdge('a', 'b', 'rel', 2.5);
  g.persist();
  const g2 = AgentGraph.load(dir);
  assert(g2.nodeCount() === 2);
  assert(g2.edgeCount() === 1);
  assert(g2.getNode('a').labels.includes('X'));
  assert(g2.getNode('a').props.v === 1);
  rmSync(dir, { recursive: true, force: true });
});

test('clear', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b'); g.addEdge('a', 'b');
  g.clear();
  assert(g.nodeCount() === 0);
  assert(g.edgeCount() === 0);
});

// Events
test('emits node:added', () => {
  const g = new AgentGraph({ autoPersist: false });
  let fired = false;
  g.on('node:added', () => fired = true);
  g.addNode('a');
  assert(fired);
});

test('emits edge:added', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a'); g.addNode('b');
  let fired = false;
  g.on('edge:added', () => fired = true);
  g.addEdge('a', 'b');
  assert(fired);
});

test('emits node:removed', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a');
  let id = null;
  g.on('node:removed', nid => id = nid);
  g.removeNode('a');
  assert(id === 'a');
});

// JSON export
test('toJSON', () => {
  const g = new AgentGraph({ autoPersist: false });
  g.addNode('a', ['X']); g.addNode('b');
  g.addEdge('a', 'b');
  const j = g.toJSON();
  assert(j.nodes.length === 2);
  assert(j.edges.length === 1);
  assert(j.stats.nodes === 2);
});

// Max limits & eviction
test('maxNodes eviction', () => {
  const g = new AgentGraph({ autoPersist: false, maxNodes: 2 });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  assert(g.nodeCount() === 2);
  // 'a' (isolated, degree 0) should be evicted first
  assert(g.getNode('a') === null || g.getNode('b') === null || g.getNode('c') === null);
});

test('maxEdges eviction', () => {
  const g = new AgentGraph({ autoPersist: false, maxEdges: 1 });
  g.addNode('a'); g.addNode('b'); g.addNode('c');
  g.addEdge('a', 'b');
  g.addEdge('b', 'c');
  assert(g.edgeCount() === 1);
});

console.log(`\n✅ ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
