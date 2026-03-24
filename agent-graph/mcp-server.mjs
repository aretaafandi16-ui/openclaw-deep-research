#!/usr/bin/env node
// agent-graph MCP Server — JSON-RPC stdio
// 12 tools for graph operations via Model Context Protocol

import { AgentGraph } from './index.mjs';
import { readFileSync } from 'node:fs';

const graph = new AgentGraph({ dir: process.env.GRAPH_DIR || './data' });

const TOOLS = [
  { name: 'graph_add_node', description: 'Add or update a node', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, props: { type: 'object' } } } },
  { name: 'graph_get_node', description: 'Get node by ID', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'graph_remove_node', description: 'Remove node and its edges', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'graph_find_nodes', description: 'Find nodes by label or properties', inputSchema: { type: 'object', properties: { label: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } } } },
  { name: 'graph_add_edge', description: 'Add an edge between nodes', inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, type: { type: 'string' }, weight: { type: 'number' }, props: { type: 'object' } } } },
  { name: 'graph_remove_edge', description: 'Remove edge by ID', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'graph_neighbors', description: 'Get neighbors of a node', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, direction: { type: 'string', enum: ['in', 'out', 'both'] }, type: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'graph_shortest_path', description: 'Find shortest path between nodes', inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, direction: { type: 'string' } } } },
  { name: 'graph_traverse', description: 'BFS or DFS traversal', inputSchema: { type: 'object', required: ['start'], properties: { start: { type: 'string' }, algorithm: { type: 'string', enum: ['bfs', 'dfs'] }, maxDepth: { type: 'number' }, direction: { type: 'string' } } } },
  { name: 'graph_pagerank', description: 'Calculate PageRank scores', inputSchema: { type: 'object', properties: { damping: { type: 'number' }, iterations: { type: 'number' } } } },
  { name: 'graph_toposort', description: 'Topological sort (DAG)', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_export', description: 'Export graph as Mermaid/DOT/JSON', inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['mermaid', 'dot', 'json'] } } } },
];

function handle(method, args) {
  switch (method) {
    case 'graph_add_node': {
      const n = graph.addNode(args.id, args.labels || [], args.props || {});
      return { id: n.id, labels: n.labels, props: n.props };
    }
    case 'graph_get_node': return graph.getNode(args.id);
    case 'graph_remove_node': return { removed: graph.removeNode(args.id) };
    case 'graph_find_nodes': return graph.findNodes(args);
    case 'graph_add_edge': {
      const e = graph.addEdge(args.from, args.to, args.type || 'rel', args.weight ?? 1, args.props || {});
      return { id: e.id, from: e.from, to: e.to, type: e.type };
    }
    case 'graph_remove_edge': return { removed: graph.removeEdge(args.id) };
    case 'graph_neighbors': {
      return graph.neighbors(args.id, { direction: args.direction || 'both', type: args.type, limit: args.limit })
        .map(n => ({ id: n.node.id, labels: n.node.labels, edge: n.edge.type, direction: n.direction }));
    }
    case 'graph_shortest_path': {
      const r = graph.shortestPath(args.from, args.to, { direction: args.direction || 'out' });
      return r ? { nodes: r.nodes, distance: r.distance } : null;
    }
    case 'graph_traverse': {
      const algo = args.algorithm === 'dfs' ? graph.dfs : graph.bfs;
      return algo.call(graph, args.start, { maxDepth: args.maxDepth || 10, direction: args.direction || 'out' })
        .map(n => ({ id: n.id, depth: n.depth, labels: n.node?.labels }));
    }
    case 'graph_pagerank': {
      const pr = graph.pagerank({ damping: args.damping, iterations: args.iterations });
      return Object.fromEntries([...pr.entries()].sort((a, b) => b[1] - a[1]));
    }
    case 'graph_toposort': return graph.topologicalSort();
    case 'graph_export': {
      const fmt = args.format || 'json';
      if (fmt === 'mermaid') return { content: graph.toMermaid() };
      if (fmt === 'dot') return { content: graph.toDot() };
      return graph.toJSON();
    }
    default: throw new Error(`Unknown: ${method}`);
  }
}

// JSON-RPC stdio
let buf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-graph', version: '1.0.0' } } }) + '\n');
    } else if (msg.method === 'notifications/initialized') {
      // no response needed
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }) + '\n');
    } else if (msg.method === 'tools/call') {
      try {
        const result = handle(msg.params.name, msg.params.arguments || {});
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }) + '\n');
      } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }) + '\n');
      }
    }
  }
});
process.stdin.resume();
