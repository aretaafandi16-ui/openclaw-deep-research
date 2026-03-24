#!/usr/bin/env node
// agent-graph CLI
import { AgentGraph } from './index.mjs';

const [,, cmd, ...args] = process.argv;
const DIR = process.env.GRAPH_DIR || './data';

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      opts[key] = args[i + 1] || true;
      i++;
    } else {
      opts._ = opts._ || [];
      opts._.push(args[i]);
    }
  }
  return opts;
}

const help = `
agent-graph CLI — zero-dep graph database

Commands:
  add-node <id> [--labels l1,l2] [--props '{}']   Add/update node
  get-node <id>                                    Get node
  remove-node <id>                                 Remove node
  find-nodes [--label x] [--limit N]              Find nodes
  add-edge <from> <to> [--type rel] [--weight 1]  Add edge
  remove-edge <id>                                 Remove edge
  neighbors <id> [--direction out|in|both]        Get neighbors
  path <from> <to>                                 Shortest path
  traverse <start> [--algo bfs|dfs] [--depth N]   Traverse
  pagerank [--damping 0.85] [--iter 20]           PageRank
  toposort                                         Topological sort
  components                                       Connected components
  scc                                              Strongly connected components
  export [--format json|mermaid|dot]               Export graph
  stats                                            Graph statistics
  clear                                            Clear all data
  demo                                             Run demo
  serve [--port 3117]                              Start HTTP server
  mcp                                              Start MCP server
`;

async function main() {
  const opts = parseArgs(args);
  let g;

  switch (cmd) {
    case 'add-node': {
      g = AgentGraph.load(DIR);
      const id = opts._?.[0]; if (!id) { console.error('Usage: add-node <id>'); process.exit(1); }
      const labels = opts.labels ? opts.labels.split(',').map(s => s.trim()) : [];
      const props = opts.props ? JSON.parse(opts.props) : {};
      const n = g.addNode(id, labels, props);
      console.log(JSON.stringify(n, null, 2));
      g.close();
      break;
    }
    case 'get-node': {
      g = AgentGraph.load(DIR);
      console.log(JSON.stringify(g.getNode(opts._?.[0]), null, 2));
      g.close();
      break;
    }
    case 'remove-node': {
      g = AgentGraph.load(DIR);
      console.log(JSON.stringify({ removed: g.removeNode(opts._?.[0]) }));
      g.close();
      break;
    }
    case 'find-nodes': {
      g = AgentGraph.load(DIR);
      console.log(JSON.stringify(g.findNodes({ label: opts.label, labels: opts.labels?.split(','), limit: parseInt(opts.limit || '100') }), null, 2));
      g.close();
      break;
    }
    case 'add-edge': {
      g = AgentGraph.load(DIR);
      const from = opts._?.[0], to = opts._?.[1];
      if (!from || !to) { console.error('Usage: add-edge <from> <to>'); process.exit(1); }
      const e = g.addEdge(from, to, opts.type || 'rel', parseFloat(opts.weight || '1'), opts.props ? JSON.parse(opts.props) : {});
      console.log(JSON.stringify(e, null, 2));
      g.close();
      break;
    }
    case 'remove-edge': {
      g = AgentGraph.load(DIR);
      console.log(JSON.stringify({ removed: g.removeEdge(opts._?.[0]) }));
      g.close();
      break;
    }
    case 'neighbors': {
      g = AgentGraph.load(DIR);
      const n = g.neighbors(opts._?.[0], { direction: opts.direction || 'both', type: opts.type, limit: parseInt(opts.limit || '0') || undefined });
      console.log(JSON.stringify(n.map(x => ({ id: x.node.id, labels: x.node.labels, edge: x.edge.type, direction: x.direction })), null, 2));
      g.close();
      break;
    }
    case 'path': {
      g = AgentGraph.load(DIR);
      const r = g.shortestPath(opts._?.[0], opts._?.[1]);
      console.log(r ? `Path: ${r.nodes.join(' → ')} (distance: ${r.distance})` : 'No path found');
      g.close();
      break;
    }
    case 'traverse': {
      g = AgentGraph.load(DIR);
      const algo = opts.algo === 'dfs' ? 'dfs' : 'bfs';
      const r = g[algo](opts._?.[0], { maxDepth: parseInt(opts.depth || '10'), direction: opts.direction || 'out' });
      r.forEach(n => console.log(`  depth ${n.depth}: ${n.id}`));
      g.close();
      break;
    }
    case 'pagerank': {
      g = AgentGraph.load(DIR);
      const pr = g.pagerank({ damping: parseFloat(opts.damping || '0.85'), iterations: parseInt(opts.iter || '20') });
      for (const [id, score] of [...pr.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${id}: ${score.toFixed(4)}`);
      g.close();
      break;
    }
    case 'toposort': {
      g = AgentGraph.load(DIR);
      const r = g.topologicalSort();
      console.log(r.sorted.join(' → '));
      if (r.hasCycle) console.log('⚠️  Cycle detected');
      g.close();
      break;
    }
    case 'components': {
      g = AgentGraph.load(DIR);
      console.log(JSON.stringify(g.connectedComponents(), null, 2));
      g.close();
      break;
    }
    case 'scc': {
      g = AgentGraph.load(DIR);
      console.log(JSON.stringify(g.stronglyConnectedComponents(), null, 2));
      g.close();
      break;
    }
    case 'export': {
      g = AgentGraph.load(DIR);
      const fmt = opts.format || 'json';
      if (fmt === 'mermaid') console.log(g.toMermaid());
      else if (fmt === 'dot') console.log(g.toDot());
      else console.log(JSON.stringify(g.toJSON(), null, 2));
      g.close();
      break;
    }
    case 'stats': {
      g = AgentGraph.load(DIR);
      console.log(JSON.stringify(g.stats(), null, 2));
      g.close();
      break;
    }
    case 'clear': {
      g = AgentGraph.load(DIR);
      g.clear();
      console.log('Cleared.');
      g.close();
      break;
    }
    case 'demo': {
      await import('./index.mjs');
      break;
    }
    case 'serve': {
      process.env.PORT = opts.port || '3117';
      process.env.GRAPH_DIR = DIR;
      await import('./server.mjs');
      break;
    }
    case 'mcp': {
      process.env.GRAPH_DIR = DIR;
      await import('./mcp-server.mjs');
      break;
    }
    default:
      console.log(help);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
