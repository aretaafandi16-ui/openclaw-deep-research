#!/usr/bin/env node
/**
 * agent-sync CLI
 */

import { AgentSync } from './index.mjs';
import { writeFileSync, readFileSync } from 'fs';

const [,, cmd, ...args] = process.argv;

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    }
  }
  return o;
}

const help = `
agent-sync — Distributed data sync with CRDTs

Commands:
  set <key> <value> [--type lww|g-counter|pn-counter|or-set|lww-map] [--ns namespace]
  get <key>                  Get value
  delete <key>               Delete a key
  keys [--ns namespace]      List keys
  entries [--ns namespace]   List all entries
  increment <key> [amount]   Increment G-counter
  decrement <key> [amount]   Decrement PN-counter
  add-to-set <key> <value>   Add to OR-set
  remove-from-set <key> <val> Remove from OR-set
  snapshot                   Create snapshot (output JSON)
  load-snapshot <file>       Load snapshot from JSON file
  delta <peerId>             Get delta for peer
  peers                      List peers
  register-peer <peerId>     Register a peer
  conflicts                  List conflicts
  log [--limit N]            Show sync log
  stats                      Show statistics
  clear                      Clear all data
  save                       Force persist to disk
  serve [--port PORT]        Start HTTP server
  demo                       Run demo
  mcp                        Start MCP server
  help                       Show this help
`;

const flags = parseArgs(args);

async function main() {
  const sync = new AgentSync({
    peerId: flags.peer || 'cli-peer',
    namespace: flags.ns || 'default',
    persistPath: flags.persist || null
  });

  switch (cmd) {
    case 'set': {
      const [key, val] = args.filter(a => !a.startsWith('--'));
      if (!key) { console.error('Usage: set <key> <value> [--type TYPE]'); process.exit(1); }
      sync.set(key, tryParse(val), { type: flags.type || 'lww', namespace: flags.ns });
      console.log(`✓ Set ${key} = ${val} (${flags.type || 'lww'})`);
      break;
    }
    case 'get': {
      const [key] = args.filter(a => !a.startsWith('--'));
      const v = sync.get(key);
      console.log(v !== undefined ? JSON.stringify(v, null, 2) : '(not found)');
      break;
    }
    case 'delete': {
      const [key] = args.filter(a => !a.startsWith('--'));
      console.log(sync.delete(key) ? `✓ Deleted ${key}` : 'Key not found');
      break;
    }
    case 'keys': {
      console.log(sync.keys(flags.ns).join('\n') || '(empty)');
      break;
    }
    case 'entries': {
      console.log(JSON.stringify(sync.entries(flags.ns), null, 2));
      break;
    }
    case 'increment': {
      const [key, amt] = args.filter(a => !a.startsWith('--'));
      sync.increment(key, parseInt(amt) || 1);
      console.log(`✓ ${key} = ${sync.get(key)}`);
      break;
    }
    case 'decrement': {
      const [key, amt] = args.filter(a => !a.startsWith('--'));
      sync.decrement(key, parseInt(amt) || 1);
      console.log(`✓ ${key} = ${sync.get(key)}`);
      break;
    }
    case 'add-to-set': {
      const [key, val] = args.filter(a => !a.startsWith('--'));
      sync.addToSet(key, tryParse(val));
      console.log(`✓ Added to set ${key}`);
      break;
    }
    case 'remove-from-set': {
      const [key, val] = args.filter(a => !a.startsWith('--'));
      sync.removeFromSet(key, tryParse(val));
      console.log(`✓ Removed from set ${key}`);
      break;
    }
    case 'snapshot': {
      console.log(JSON.stringify(sync.createSnapshot(), null, 2));
      break;
    }
    case 'load-snapshot': {
      const [file] = args.filter(a => !a.startsWith('--'));
      const snap = JSON.parse(readFileSync(file, 'utf-8'));
      sync.loadSnapshot(snap);
      console.log('✓ Snapshot loaded');
      break;
    }
    case 'delta': {
      const [peerId] = args.filter(a => !a.startsWith('--'));
      console.log(JSON.stringify(sync.getDelta(peerId), null, 2));
      break;
    }
    case 'peers': {
      const peers = sync.listPeers();
      if (!peers.length) console.log('(no peers)');
      else peers.forEach(p => console.log(`  ${p.peerId} (last sync: ${p.lastSync ? new Date(p.lastSync).toLocaleString() : 'never'})`));
      break;
    }
    case 'register-peer': {
      const [peerId] = args.filter(a => !a.startsWith('--'));
      sync.registerPeer(peerId);
      console.log(`✓ Registered peer: ${peerId}`);
      break;
    }
    case 'conflicts': {
      const c = sync.getConflicts();
      console.log(c.length ? JSON.stringify(c, null, 2) : '(no conflicts)');
      break;
    }
    case 'log': {
      const log = sync.getLog(null, parseInt(flags.limit) || 20);
      log.forEach(e => console.log(`  ${new Date(e.timestamp).toISOString()} ${e.op.padEnd(8)} ${e.key} (${e.peer})`));
      break;
    }
    case 'stats': {
      const s = sync.stats();
      console.log(`Peer: ${s.peerId} | Namespace: ${s.namespace}`);
      console.log(`Keys: ${s.keys} | Peers: ${s.peers}`);
      console.log(`Sets: ${s.sets} | Deletes: ${s.deletes} | Syncs: ${s.syncs} | Merges: ${s.merges}`);
      console.log(`Conflicts: ${s.conflicts} | Log: ${s.logEntries}`);
      console.log(`Clock: ${JSON.stringify(s.clock)}`);
      break;
    }
    case 'clear': {
      sync.clear();
      console.log('✓ Cleared all data');
      break;
    }
    case 'save': {
      sync.save();
      console.log('✓ Persisted to disk');
      break;
    }
    case 'serve': {
      await import('./server.mjs');
      break;
    }
    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }
    case 'demo': {
      console.log('🐋 agent-sync demo\n');

      console.log('1. Creating LWW register values...');
      sync.set('user:name', 'Alice');
      sync.set('user:email', 'alice@example.com');
      console.log(`   user:name = ${sync.get('user:name')}`);

      console.log('\n2. G-Counter (page views)...');
      sync.set('pageviews', null, { type: 'g-counter', increment: 10 });
      sync.increment('pageviews', 5);
      console.log(`   pageviews = ${sync.get('pageviews')}`);

      console.log('\n3. PN-Counter (balance)...');
      sync.set('balance', null, { type: 'pn-counter', increment: 100 });
      sync.decrement('balance', 30);
      console.log(`   balance = ${sync.get('balance')}`);

      console.log('\n4. OR-Set (active users)...');
      sync.addToSet('active-users', 'user-1');
      sync.addToSet('active-users', 'user-2');
      sync.addToSet('active-users', 'user-3');
      console.log(`   active-users = ${JSON.stringify(sync.get('active-users'))}`);
      sync.removeFromSet('active-users', 'user-2');
      console.log(`   after remove = ${JSON.stringify(sync.get('active-users'))}`);

      console.log('\n5. LWW-Map (config)...');
      sync.setInMap('config', 'theme', 'dark');
      sync.setInMap('config', 'lang', 'en');
      console.log(`   config = ${JSON.stringify(sync.get('config'))}`);

      console.log('\n6. Cross-peer sync...');
      const peer1 = new AgentSync({ peerId: 'server-1' });
      const peer2 = new AgentSync({ peerId: 'server-2' });
      peer1.set('shared-key', 'from-peer-1');
      peer2.set('shared-key', 'from-peer-2');
      peer1.set('only-p1', 'local');
      peer2.set('only-p2', 'remote');

      const snap1 = peer1.createSnapshot();
      const snap2 = peer2.createSnapshot();
      peer1.sync(snap2);
      console.log(`   After sync: shared-key = ${peer1.get('shared-key')}`);
      console.log(`   only-p1 = ${peer1.get('only-p1')}, only-p2 = ${peer1.get('only-p2')}`);

      console.log('\n7. Delta sync...');
      const d1 = new AgentSync({ peerId: 'delta-a' });
      const d2 = new AgentSync({ peerId: 'delta-b' });
      d1.set('x', 1);
      d1.set('y', 2);
      d2.registerPeer('delta-a');
      const delta = d1.getDelta('delta-b');
      console.log(`   Delta: ${delta.deltas.length} changes from ${delta.from}`);

      console.log('\n8. Stats:');
      const s = sync.stats();
      console.log(`   Keys: ${s.keys} | Sets: ${s.sets} | Deletes: ${s.deletes}`);
      console.log(`   Log: ${s.logEntries} entries | Peers: ${s.peers}`);

      console.log('\n✅ Demo complete!');
      break;
    }
    default:
      console.log(help);
  }
}

function tryParse(v) {
  if (v === undefined || v === null) return v;
  try { return JSON.parse(v); } catch { return v; }
}

main().catch(e => { console.error(e.message); process.exit(1); });
