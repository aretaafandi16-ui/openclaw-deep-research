#!/usr/bin/env node
/**
 * agent-embed CLI
 */

import { EmbedStore } from './index.mjs';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const [,, cmd, ...args] = process.argv;

const HELP = `
agent-embed — Zero-dep vector embedding store for AI agents

Commands:
  upsert <id> <json-vector> [json-metadata]   Insert/update a vector
  batch <json-file>                            Batch insert from JSON file
  get <id>                                     Get vector by ID
  search <json-vector> [k] [json-filter]       KNN search
  delete <id>                                  Delete vector
  update-meta <id> <json-metadata>             Update metadata
  has <id>                                     Check existence
  clear                                        Clear all vectors
  export [file]                                Export to JSON file
  import <json-file>                           Import from JSON file
  ids                                          List all IDs
  stats                                        Show statistics
  build-index [partitions]                     Build IVF index
  serve [port]                                 Start HTTP server
  mcp                                          Start MCP server
  demo                                         Run demo

Options:
  --persist <path>    Persistence file (default: ./data/embed.jsonl)
  --dimension <n>     Vector dimension (auto-detected if omitted)
  --distance <name>   Distance function: cosine|euclidean|dot
  --ivf <n>           IVF partitions (0 = brute-force)
`;

function getStore() {
  const persist = getOpt('--persist') || './data/embed.jsonl';
  const dim = parseInt(getOpt('--dimension') || '0');
  const dist = getOpt('--distance') || 'cosine';
  const ivf = parseInt(getOpt('--ivf') || '0');
  return new EmbedStore({ dimension: dim, distance: dist, persistPath: persist, ivfPartitions: ivf });
}

function getOpt(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); return; }

  const store = getStore();

  switch (cmd) {
    case 'upsert': {
      const [id, vecStr, metaStr] = args;
      if (!id || !vecStr) { console.error('Usage: embed upsert <id> <vector-json> [metadata-json]'); process.exit(1); }
      const vector = JSON.parse(vecStr);
      const metadata = metaStr ? JSON.parse(metaStr) : {};
      const result = store.upsert(id, vector, metadata);
      console.log(JSON.stringify(result));
      break;
    }
    case 'batch': {
      const [file] = args;
      if (!file) { console.error('Usage: embed batch <json-file>'); process.exit(1); }
      const items = JSON.parse(readFileSync(file, 'utf-8'));
      const result = store.upsertBatch(Array.isArray(items) ? items : items.items || []);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'get': {
      const [id] = args;
      console.log(JSON.stringify(store.get(id)));
      break;
    }
    case 'search': {
      const [vecStr, kStr, filterStr] = args;
      if (!vecStr) { console.error('Usage: embed search <vector-json> [k] [filter-json]'); process.exit(1); }
      const vector = JSON.parse(vecStr);
      const k = parseInt(kStr || '10');
      const filter = filterStr ? JSON.parse(filterStr) : null;
      const results = store.search(vector, k, { filter });
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case 'delete': {
      const [id] = args;
      console.log(JSON.stringify({ deleted: store.delete(id) }));
      break;
    }
    case 'update-meta': {
      const [id, metaStr] = args;
      console.log(JSON.stringify({ updated: store.updateMetadata(id, JSON.parse(metaStr)) }));
      break;
    }
    case 'has': {
      const [id] = args;
      console.log(JSON.stringify({ exists: store.has(id) }));
      break;
    }
    case 'clear': {
      console.log(JSON.stringify({ cleared: store.clear() }));
      break;
    }
    case 'export': {
      const [file] = args;
      const data = store.export();
      if (file) { writeFileSync(file, JSON.stringify(data, null, 2)); console.log(`Exported ${data.length} vectors to ${file}`); }
      else console.log(JSON.stringify(data, null, 2));
      break;
    }
    case 'import': {
      const [file] = args;
      if (!file) { console.error('Usage: embed import <json-file>'); process.exit(1); }
      const items = JSON.parse(readFileSync(file, 'utf-8'));
      console.log(JSON.stringify(store.upsertBatch(items), null, 2));
      break;
    }
    case 'ids': {
      console.log(JSON.stringify(store.ids()));
      break;
    }
    case 'stats': {
      console.log(JSON.stringify(store.getInfo(), null, 2));
      break;
    }
    case 'build-index': {
      const [partitions] = args;
      store.buildIndex(parseInt(partitions || '0'));
      console.log(JSON.stringify({ trained: store.ivf?.trained || false }));
      break;
    }
    case 'serve': {
      const [port] = args;
      process.env.PORT = port || '3113';
      process.env.PERSIST_PATH = getOpt('--persist') || './data/embed.jsonl';
      process.env.DIMENSION = getOpt('--dimension') || '0';
      process.env.DISTANCE = getOpt('--distance') || 'cosine';
      await import('./server.mjs');
      break;
    }
    case 'mcp': {
      process.env.PERSIST_PATH = getOpt('--persist') || './data/embed.jsonl';
      process.env.DIMENSION = getOpt('--dimension') || '0';
      process.env.DISTANCE = getOpt('--distance') || 'cosine';
      await import('./mcp-server.mjs');
      break;
    }
    case 'demo': {
      console.log('agent-embed demo\n');
      const demo = new EmbedStore({ dimension: 4 });
      console.log('Inserting 5 documents...');
      demo.upsert('doc1', [0.9, 0.1, 0, 0], { title: 'Cats are great', type: 'animal' });
      demo.upsert('doc2', [0.1, 0.9, 0, 0], { title: 'Dogs are loyal', type: 'animal' });
      demo.upsert('doc3', [0, 0, 0.9, 0.1], { title: 'Python programming', type: 'tech' });
      demo.upsert('doc4', [0, 0, 0.1, 0.9], { title: 'JavaScript tips', type: 'tech' });
      demo.upsert('doc5', [0.5, 0.5, 0, 0], { title: 'Cat vs Dog debate', type: 'animal' });

      console.log(`\nStore: ${demo.getInfo().count} vectors, ${demo.getInfo().dimension}D\n`);

      console.log('Search: [1, 0, 0, 0] (cat-like) → top 3:');
      console.log(JSON.stringify(demo.search([1, 0, 0, 0], 3).map(r => `${r.id} (${r.score.toFixed(3)}) — ${r.metadata.title}`), null, 2));

      console.log('\nSearch with filter (type=tech):');
      console.log(JSON.stringify(demo.search([0, 0, 1, 0], 3, { filter: { type: 'tech' } }).map(r => `${r.id} (${r.score.toFixed(3)}) — ${r.metadata.title}`), null, 2));

      console.log('\nStats:', JSON.stringify(demo.getInfo(), null, 2));
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
