#!/usr/bin/env node
/**
 * agent-session CLI
 */

import { SessionManager } from './index.mjs';

const sm = new SessionManager({
  persistDir: process.env.PERSIST_DIR ?? null,
  defaultTTL: parseInt(process.env.DEFAULT_TTL ?? '1800000')
});

const [,, cmd, ...args] = process.argv;

function getArg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
}

function getFlag(name) { return args.includes('--' + name); }

async function main() {
  switch (cmd) {
    case 'create': {
      const s = sm.create({
        owner: getArg('owner'),
        namespace: getArg('ns') ?? 'default',
        tags: getArg('tags')?.split(','),
        ttl: parseInt(getArg('ttl') ?? '1800000')
      });
      console.log(JSON.stringify(s, null, 2));
      break;
    }
    case 'get': {
      const s = sm.get(args[0]);
      console.log(s ? JSON.stringify(s, null, 2) : 'Not found');
      break;
    }
    case 'touch': {
      console.log(JSON.stringify(sm.touch(args[0]), null, 2));
      break;
    }
    case 'destroy': {
      console.log(sm.destroy(args[0]) ? 'Destroyed' : 'Not found');
      break;
    }
    case 'list': {
      const opts = {};
      if (getArg('owner')) opts.owner = getArg('owner');
      if (getArg('ns')) opts.namespace = getArg('ns');
      if (getArg('tag')) opts.tag = getArg('tag');
      if (getArg('limit')) opts.limit = parseInt(getArg('limit'));
      const sessions = sm.list(opts);
      if (getFlag('json')) { console.log(JSON.stringify(sessions, null, 2)); break; }
      console.log(`Sessions (${sessions.length}):\n`);
      for (const s of sessions) {
        console.log(`  ${s.id.slice(0,12)}…  owner=${s.owner||'—'}  ns=${s.namespace}  msgs=${s.messageCount}  status=${s.status}`);
      }
      break;
    }
    case 'message': {
      const sub = args[0];
      if (sub === 'add') {
        const sid = getArg('sid');
        const role = getArg('role') ?? 'user';
        const content = args.slice(args.indexOf('--content') + 1).join(' ').split('--')[0].trim();
        const msg = sm.addMessage(sid, role, content);
        console.log(JSON.stringify(msg, null, 2));
      } else if (sub === 'list') {
        const sid = getArg('sid');
        const msgs = sm.getMessages(sid, { limit: parseInt(getArg('limit') ?? '20') });
        for (const m of msgs) {
          console.log(`[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role}: ${m.content}`);
        }
      } else if (sub === 'clear') {
        console.log(`Cleared ${sm.clearMessages(args[1])} messages`);
      }
      break;
    }
    case 'state': {
      const sid = getArg('sid');
      const key = getArg('key');
      const value = getArg('value');
      if (value !== undefined) {
        sm.setState(sid, key, value);
        console.log(`Set ${key}=${value}`);
      } else if (getFlag('delete')) {
        sm.deleteState(sid, key);
        console.log(`Deleted ${key}`);
      } else {
        console.log(JSON.stringify(sm.getState(sid, key), null, 2));
      }
      break;
    }
    case 'extend': {
      console.log(JSON.stringify(sm.extend(args[0], parseInt(args[1])), null, 2));
      break;
    }
    case 'stats': {
      console.log(JSON.stringify(sm.stats(), null, 2));
      break;
    }
    case 'expire': {
      console.log(`Expired ${sm.destroyExpired()} sessions`);
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
      console.log('=== agent-session demo ===\n');
      const s1 = sm.create({ owner: 'user-42', namespace: 'chat', tags: ['demo', 'test'] });
      console.log('Created session:', s1.id);
      sm.addMessage(s1.id, 'user', 'Hello, I need help with my order');
      sm.addMessage(s1.id, 'assistant', 'Sure! What is your order number?');
      sm.addMessage(s1.id, 'user', 'Order #12345');
      sm.setState(s1.id, 'orderId', '12345');
      sm.setState(s1.id, 'step', 'lookup');
      const s2 = sm.get(s1.id);
      console.log(`Messages: ${s2.messageCount}, State: ${JSON.stringify(s2.state)}`);
      const msgs = sm.getMessages(s1.id);
      msgs.forEach(m => console.log(`  [${m.role}] ${m.content}`));
      const s3 = sm.create({ owner: 'user-99', namespace: 'chat', tags: ['demo'] });
      sm.addMessage(s3.id, 'system', 'You are a helpful assistant');
      console.log(`\nTotal sessions: ${sm.count()}`);
      console.log(`By owner user-42: ${sm.findByOwner('user-42').length}`);
      console.log(`By namespace chat: ${sm.findByNamespace('chat').length}`);
      console.log(`By tag demo: ${sm.findByTag('demo').length}`);
      console.log('\nStats:', JSON.stringify(sm.stats(), null, 2));
      sm.destroy(s1.id);
      sm.destroy(s3.id);
      console.log('\n✅ Demo complete');
      break;
    }
    default:
      console.log(`agent-session v1.0.0 — Zero-dep session manager

Commands:
  create [--owner X] [--ns X] [--tags X,Y] [--ttl MS]   Create session
  get <id>                                                Get session
  touch <id>                                              Refresh TTL
  destroy <id>                                            Destroy session
  list [--owner X] [--ns X] [--tag X] [--limit N] [--json] List sessions
  message add --sid X --role X --content "..."            Add message
  message list --sid X [--limit N]                        List messages
  message clear <sid>                                     Clear messages
  state --sid X [--key X] [--value X] [--delete]          Manage state
  extend <id> <ttl-ms>                                    Extend TTL
  expire                                                  Expire stale sessions
  stats                                                   Show statistics
  serve                                                   Start HTTP server (port 3118)
  mcp                                                     Start MCP server (stdio)
  demo                                                    Run demo`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
