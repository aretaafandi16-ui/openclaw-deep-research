#!/usr/bin/env node
// agent-graph — zero-dep graph database for AI agents
// Nodes, edges, traversal, algorithms, persistence, MCP, HTTP

import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

export class AgentGraph extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dir = opts.dir || './data';
    this.nodes = new Map();       // id -> { id, labels: [], props: {} }
    this.edges = new Map();       // id -> { id, from, to, type, weight, props: {} }
    this.adjOut = new Map();      // id -> Set of edgeIds
    this.adjIn = new Map();       // id -> Set of edgeIds
    this.edgeSeq = 0;
    this.maxNodes = opts.maxNodes || 0;    // 0 = unlimited
    this.maxEdges = opts.maxEdges || 0;
    this.autoPersist = opts.autoPersist !== false;
    this.persistInterval = opts.persistInterval || 0; // ms, 0 = on mutation
    this._persistTimer = null;
    this._dirty = false;

    if (this.autoPersist) mkdirSync(this.dir, { recursive: true });
    if (this.persistInterval > 0) {
      this._persistTimer = setInterval(() => this._maybePersist(), this.persistInterval);
      this._persistTimer.unref?.();
    }
  }

  // ── Nodes ────────────────────────────────────────────────────────
  addNode(id, labels = [], props = {}) {
    if (this.maxNodes && this.nodes.size >= this.maxNodes && !this.nodes.has(id)) {
      this._evictNode();
    }
    const existing = this.nodes.get(id);
    if (existing) {
      existing.labels = [...new Set([...existing.labels, ...labels])];
      Object.assign(existing.props, props);
      this.emit('node:updated', existing);
      this._dirty = true;
      return existing;
    }
    const node = { id, labels: [...labels], props: { ...props } };
    this.nodes.set(id, node);
    this.adjOut.set(id, new Set());
    this.adjIn.set(id, new Set());
    this.emit('node:added', node);
    this._dirty = true;
    this._maybePersist();
    return node;
  }

  getNode(id) { return this.nodes.get(id) || null; }

  updateNode(id, props = {}) {
    const node = this.nodes.get(id);
    if (!node) return null;
    Object.assign(node.props, props);
    this.emit('node:updated', node);
    this._dirty = true;
    this._maybePersist();
    return node;
  }

  removeNode(id) {
    const node = this.nodes.get(id);
    if (!node) return false;
    // remove all connected edges
    const outEdges = [...(this.adjOut.get(id) || [])];
    const inEdges = [...(this.adjIn.get(id) || [])];
    for (const eid of [...outEdges, ...inEdges]) this.removeEdge(eid);
    this.nodes.delete(id);
    this.adjOut.delete(id);
    this.adjIn.delete(id);
    this.emit('node:removed', id);
    this._dirty = true;
    this._maybePersist();
    return true;
  }

  findNodes(filter = {}) {
    let results = [...this.nodes.values()];
    if (filter.label) results = results.filter(n => n.labels.includes(filter.label));
    if (filter.labels) results = results.filter(n => filter.labels.every(l => n.labels.includes(l)));
    if (filter.where) results = results.filter(n => filter.where(n.props, n));
    if (filter.limit) results = results.slice(0, filter.limit);
    return results;
  }

  nodeCount() { return this.nodes.size; }

  // ── Edges ────────────────────────────────────────────────────────
  addEdge(from, to, type = 'rel', weight = 1, props = {}) {
    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      throw new Error(`Both nodes must exist: ${from} -> ${to}`);
    }
    if (this.maxEdges && this.edges.size >= this.maxEdges) {
      this._evictEdge();
    }
    const id = `e${++this.edgeSeq}`;
    const edge = { id, from, to, type, weight, props: { ...props } };
    this.edges.set(id, edge);
    this.adjOut.get(from).add(id);
    this.adjIn.get(to).add(id);
    this.emit('edge:added', edge);
    this._dirty = true;
    this._maybePersist();
    return edge;
  }

  getEdge(id) { return this.edges.get(id) || null; }

  removeEdge(id) {
    const edge = this.edges.get(id);
    if (!edge) return false;
    this.adjOut.get(edge.from)?.delete(id);
    this.adjIn.get(edge.to)?.delete(id);
    this.edges.delete(id);
    this.emit('edge:removed', id);
    this._dirty = true;
    this._maybePersist();
    return true;
  }

  findEdges(filter = {}) {
    let results = [...this.edges.values()];
    if (filter.from) results = results.filter(e => e.from === filter.from);
    if (filter.to) results = results.filter(e => e.to === filter.to);
    if (filter.type) results = results.filter(e => e.type === filter.type);
    if (filter.where) results = results.filter(e => filter.where(e.props, e));
    if (filter.limit) results = results.slice(0, filter.limit);
    return results;
  }

  edgeCount() { return this.edges.size; }

  // ── Neighbors ────────────────────────────────────────────────────
  neighbors(id, opts = {}) {
    const { direction = 'both', type, label, limit } = opts;
    const result = [];
    const visited = new Set();
    const addEdge = (eid) => {
      const e = this.edges.get(eid);
      if (!e) return;
      if (type && e.type !== type) return;
      const neighborId = e.from === id ? e.to : e.from;
      if (visited.has(neighborId)) return;
      const neighbor = this.nodes.get(neighborId);
      if (!neighbor) return;
      if (label && !neighbor.labels.includes(label)) return;
      visited.add(neighborId);
      result.push({ node: neighbor, edge: e, direction: e.from === id ? 'out' : 'in' });
    };
    if (direction !== 'in') for (const eid of this.adjOut.get(id) || []) addEdge(eid);
    if (direction !== 'out') for (const eid of this.adjIn.get(id) || []) addEdge(eid);
    if (limit) return result.slice(0, limit);
    return result;
  }

  degree(id, direction = 'both') {
    let d = 0;
    if (direction !== 'in') d += (this.adjOut.get(id) || new Set()).size;
    if (direction !== 'out') d += (this.adjIn.get(id) || new Set()).size;
    return d;
  }

  // ── Traversal ────────────────────────────────────────────────────
  bfs(startId, opts = {}) {
    const { maxDepth = Infinity, direction = 'out', type, visitor } = opts;
    const visited = new Map(); // id -> depth
    const queue = [[startId, 0]];
    visited.set(startId, 0);
    const order = [];
    while (queue.length) {
      const [id, depth] = queue.shift();
      order.push({ id, depth, node: this.nodes.get(id) });
      if (visitor) visitor(this.nodes.get(id), depth);
      if (depth >= maxDepth) continue;
      const nextDir = direction === 'out' ? 'both' : direction === 'in' ? 'both' : 'both';
      const edges = direction === 'out' ? this.adjOut.get(id) || new Set()
                   : direction === 'in' ? this.adjIn.get(id) || new Set()
                   : new Set([...(this.adjOut.get(id) || []), ...(this.adjIn.get(id) || [])]);
      for (const eid of edges) {
        const e = this.edges.get(eid);
        if (!e || (type && e.type !== type)) continue;
        const nid = e.from === id ? e.to : e.from;
        if (visited.has(nid)) continue;
        visited.set(nid, depth + 1);
        queue.push([nid, depth + 1]);
      }
    }
    return order;
  }

  dfs(startId, opts = {}) {
    const { maxDepth = Infinity, direction = 'out', type, visitor } = opts;
    const visited = new Set();
    const order = [];
    const _dfs = (id, depth) => {
      if (visited.has(id) || depth > maxDepth) return;
      visited.add(id);
      order.push({ id, depth, node: this.nodes.get(id) });
      if (visitor) visitor(this.nodes.get(id), depth);
      const edges = direction === 'out' ? this.adjOut.get(id) || new Set()
                   : direction === 'in' ? this.adjIn.get(id) || new Set()
                   : new Set([...(this.adjOut.get(id) || []), ...(this.adjIn.get(id) || [])]);
      for (const eid of edges) {
        const e = this.edges.get(eid);
        if (!e || (type && e.type !== type)) continue;
        const nid = e.from === id ? e.to : e.from;
        _dfs(nid, depth + 1);
      }
    };
    _dfs(startId, 0);
    return order;
  }

  // ── Shortest Path (Dijkstra) ─────────────────────────────────────
  shortestPath(from, to, opts = {}) {
    const { direction = 'out', weightFn } = opts;
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    const dist = new Map();
    const prev = new Map();
    const prevEdge = new Map();
    const visited = new Set();
    dist.set(from, 0);

    // Simple priority queue (array-based, fine for <10k nodes)
    const pq = [[0, from]];
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [d, u] = pq.shift();
      if (visited.has(u)) continue;
      visited.add(u);
      if (u === to) break;
      const edges = direction === 'out' ? this.adjOut.get(u) || new Set()
                   : direction === 'in' ? this.adjIn.get(u) || new Set()
                   : new Set([...(this.adjOut.get(u) || []), ...(this.adjIn.get(u) || [])]);
      for (const eid of edges) {
        const e = this.edges.get(eid);
        if (!e) continue;
        const v = e.from === u ? e.to : e.from;
        if (visited.has(v)) continue;
        const w = weightFn ? weightFn(e) : e.weight;
        const nd = d + w;
        if (!dist.has(v) || nd < dist.get(v)) {
          dist.set(v, nd);
          prev.set(v, u);
          prevEdge.set(v, eid);
          pq.push([nd, v]);
        }
      }
    }
    if (!prev.has(to) && from !== to) return null;
    // reconstruct
    const path = [];
    let cur = to;
    while (cur !== undefined) {
      path.unshift({ node: cur, edge: prevEdge.get(cur) || null });
      cur = prev.get(cur);
    }
    return { path, distance: dist.get(to), nodes: path.map(p => p.node) };
  }

  allPaths(from, to, opts = {}) {
    const { maxDepth = 10, direction = 'out' } = opts;
    const paths = [];
    const _find = (cur, visited, path) => {
      if (cur === to) { paths.push([...path]); return; }
      if (path.length >= maxDepth) return;
      const edges = direction === 'out' ? this.adjOut.get(cur) || new Set()
                   : direction === 'in' ? this.adjIn.get(cur) || new Set()
                   : new Set([...(this.adjOut.get(cur) || []), ...(this.adjIn.get(cur) || [])]);
      for (const eid of edges) {
        const e = this.edges.get(eid);
        if (!e) continue;
        const nid = e.from === cur ? e.to : e.from;
        if (visited.has(nid)) continue;
        visited.add(nid);
        path.push({ node: nid, edge: eid });
        _find(nid, visited, path);
        path.pop();
        visited.delete(nid);
      }
    };
    _find(from, new Set([from]), [{ node: from, edge: null }]);
    return paths;
  }

  // ── Algorithms ───────────────────────────────────────────────────
  connectedComponents() {
    const visited = new Set();
    const components = [];
    for (const id of this.nodes.keys()) {
      if (visited.has(id)) continue;
      const comp = this.bfs(id, { direction: 'both' }).map(n => n.id);
      comp.forEach(c => visited.add(c));
      components.push(comp);
    }
    return components;
  }

  topologicalSort() {
    // Kahn's algorithm — directed graph
    const inDeg = new Map();
    for (const id of this.nodes.keys()) inDeg.set(id, 0);
    for (const e of this.edges.values()) inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
    const queue = [...this.nodes.keys()].filter(id => inDeg.get(id) === 0);
    const sorted = [];
    while (queue.length) {
      const u = queue.shift();
      sorted.push(u);
      for (const eid of this.adjOut.get(u) || []) {
        const e = this.edges.get(eid);
        if (!e) continue;
        inDeg.set(e.to, inDeg.get(e.to) - 1);
        if (inDeg.get(e.to) === 0) queue.push(e.to);
      }
    }
    if (sorted.length !== this.nodes.size) {
      return { sorted, hasCycle: true };
    }
    return { sorted, hasCycle: false };
  }

  hasCycle() {
    return this.topologicalSort().hasCycle;
  }

  stronglyConnectedComponents() {
    // Tarjan's algorithm
    const index = new Map();
    const lowlink = new Map();
    const onStack = new Set();
    const stack = [];
    let idx = 0;
    const sccs = [];

    const strongconnect = (v) => {
      index.set(v, idx);
      lowlink.set(v, idx);
      idx++;
      stack.push(v);
      onStack.add(v);

      for (const eid of this.adjOut.get(v) || []) {
        const e = this.edges.get(eid);
        if (!e) continue;
        const w = e.to;
        if (!index.has(w)) {
          strongconnect(w);
          lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
        }
      }

      if (lowlink.get(v) === index.get(v)) {
        const scc = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        sccs.push(scc);
      }
    };

    for (const id of this.nodes.keys()) {
      if (!index.has(id)) strongconnect(id);
    }
    return sccs;
  }

  pagerank(opts = {}) {
    const { damping = 0.85, iterations = 20 } = opts;
    const N = this.nodes.size;
    if (N === 0) return new Map();
    const pr = new Map();
    for (const id of this.nodes.keys()) pr.set(id, 1 / N);

    for (let i = 0; i < iterations; i++) {
      const newPr = new Map();
      for (const id of this.nodes.keys()) {
        let sum = 0;
        for (const eid of this.adjIn.get(id) || []) {
          const e = this.edges.get(eid);
          if (!e) continue;
          const outDeg = (this.adjOut.get(e.from) || new Set()).size;
          if (outDeg > 0) sum += pr.get(e.from) / outDeg;
        }
        newPr.set(id, (1 - damping) / N + damping * sum);
      }
      for (const [k, v] of newPr) pr.set(k, v);
    }
    return pr;
  }

  // ── Subgraph ─────────────────────────────────────────────────────
  subgraph(nodeIds) {
    const idSet = new Set(nodeIds);
    const g = new AgentGraph({ dir: this.dir + '/sub', autoPersist: false });
    for (const id of nodeIds) {
      const n = this.nodes.get(id);
      if (n) g.addNode(n.id, [...n.labels], { ...n.props });
    }
    for (const e of this.edges.values()) {
      if (idSet.has(e.from) && idSet.has(e.to)) {
        const ne = g.addEdge(e.from, e.to, e.type, e.weight, { ...e.props });
        // keep original edge id mapping if possible
      }
    }
    return g;
  }

  merge(other) {
    for (const n of other.nodes.values()) this.addNode(n.id, [...n.labels], { ...n.props });
    for (const e of other.edges.values()) this.addEdge(e.from, e.to, e.type, e.weight, { ...e.props });
    return this;
  }

  // ── Visualization ────────────────────────────────────────────────
  toMermaid(opts = {}) {
    const { direction = 'TD' } = opts;
    const lines = [`graph ${direction};`];
    for (const [id, n] of this.nodes) {
      const label = n.labels.length ? `${id}[${id}: ${n.labels.join(',')}]` : `${id}[${id}]`;
      lines.push(`  ${label};`);
    }
    for (const e of this.edges.values()) {
      lines.push(`  ${e.from} -->|${e.type}| ${e.to};`);
    }
    return lines.join('\n');
  }

  toDot(opts = {}) {
    const { name = 'G', directed = true } = opts;
    const lines = [`${directed ? 'digraph' : 'graph'} ${name} {`];
    for (const [id, n] of this.nodes) {
      const lbl = n.labels.length ? `${id}: ${n.labels.join(',')}` : id;
      lines.push(`  "${id}" [label="${lbl}"];`);
    }
    const arrow = directed ? '->' : '--';
    for (const e of this.edges.values()) {
      lines.push(`  "${e.from}" ${arrow} "${e.to}" [label="${e.type}"];`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      stats: this.stats(),
    };
  }

  stats() {
    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      labels: [...new Set([...this.nodes.values()].flatMap(n => n.labels))],
      edgeTypes: [...new Set([...this.edges.values()].map(e => e.type))],
    };
  }

  // ── Persistence ──────────────────────────────────────────────────
  _maybePersist() {
    if (!this.autoPersist || !this._dirty) return;
    if (this.persistInterval > 0) return; // timer will handle it
    this.persist();
  }

  persist() {
    if (!this.autoPersist) return;
    const snap = this.toJSON();
    writeFileSync(`${this.dir}/graph.json`, JSON.stringify(snap, null, 2));
    // append event to JSONL
    const event = { ts: Date.now(), nodes: this.nodes.size, edges: this.edges.size };
    const line = JSON.stringify(event) + '\n';
    try {
      const f = createWriteStream(`${this.dir}/events.jsonl`, { flags: 'a' });
      f.on('error', () => {}); // swallow errors (dir may be temp)
      f.write(line, () => { f.destroy(); });
    } catch {}
    this._dirty = false;
    this.emit('persisted', event);
  }

  static load(dir, opts = {}) {
    const file = `${dir}/graph.json`;
    if (!existsSync(file)) return new AgentGraph({ ...opts, dir });
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    const g = new AgentGraph({ ...opts, dir });
    for (const n of data.nodes || []) g.addNode(n.id, n.labels || [], n.props || {});
    for (const e of data.edges || []) {
      const edge = g.addEdge(e.from, e.to, e.type || 'rel', e.weight ?? 1, e.props || {});
      // restore original edge id
      if (e.id && e.id !== edge.id) {
        g.edges.delete(edge.id);
        edge.id = e.id;
        g.edges.set(e.id, edge);
        const seq = parseInt(e.id.replace('e', ''));
        if (seq > g.edgeSeq) g.edgeSeq = seq;
      }
    }
    g.emit('loaded', g.stats());
    return g;
  }

  clear() {
    this.nodes.clear();
    this.edges.clear();
    this.adjOut.clear();
    this.adjIn.clear();
    this.edgeSeq = 0;
    this._dirty = true;
    this.emit('cleared');
    this._maybePersist();
  }

  close() {
    if (this._persistTimer) clearInterval(this._persistTimer);
    if (this._dirty) this.persist();
  }

  // ── Eviction ─────────────────────────────────────────────────────
  _evictNode() {
    // evict lowest-degree node
    let minDeg = Infinity, minId = null;
    for (const id of this.nodes.keys()) {
      const d = this.degree(id);
      if (d < minDeg) { minDeg = d; minId = id; }
    }
    if (minId) this.removeNode(minId);
  }

  _evictEdge() {
    // evict oldest edge
    const first = this.edges.keys().next().value;
    if (first) this.removeEdge(first);
  }
}

// ── CLI ────────────────────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith('index.mjs') || process.argv[1]?.endsWith('index.js');
if (isMain && process.argv[2] === 'demo') {
  console.log('🐋 agent-graph demo\n');
  const g = new AgentGraph({ autoPersist: false });

  // Build a small knowledge graph
  g.addNode('agent', ['Entity', 'Agent'], { name: 'Laboon', type: 'AI' });
  g.addNode('user', ['Entity', 'Human'], { name: 'Reza' });
  g.addNode('tool', ['Entity', 'Tool'], { name: 'web_search' });
  g.addNode('skill', ['Entity', 'Skill'], { name: 'weather' });
  g.addNode('memory', ['Entity', 'Memory'], { name: 'daily-notes' });
  g.addEdge('user', 'agent', 'owns', 1);
  g.addEdge('agent', 'tool', 'uses', 1);
  g.addEdge('agent', 'skill', 'has', 1);
  g.addEdge('agent', 'memory', 'writes', 1);
  g.addEdge('tool', 'skill', 'supports', 1);

  console.log('Nodes:', g.nodeCount(), '| Edges:', g.edgeCount());
  console.log('\nNeighbors of "agent":');
  for (const n of g.neighbors('agent')) {
    console.log(`  ${n.direction === 'out' ? '→' : '←'} ${n.node.id} (${n.edge.type})`);
  }

  console.log('\nBFS from agent:');
  for (const n of g.bfs('agent', { direction: 'out' })) {
    console.log(`  depth ${n.depth}: ${n.id}`);
  }

  const sp = g.shortestPath('user', 'memory');
  console.log('\nShortest path user→memory:', sp?.nodes.join(' → '));

  console.log('\nPageRank:');
  const pr = g.pagerank();
  for (const [id, score] of [...pr.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${id}: ${score.toFixed(4)}`);
  }

  console.log('\nTopological sort:', g.topologicalSort().sorted.join(' → '));
  console.log('\nConnected components:', JSON.stringify(g.connectedComponents()));
  console.log('\nMermaid:\n' + g.toMermaid());
  console.log('\nStats:', JSON.stringify(g.stats()));
}
