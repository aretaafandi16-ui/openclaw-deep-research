/**
 * agent-feed MCP Server — 12 tools via JSON-RPC stdio
 */

import { FeedEngine } from './index.mjs';
import { createInterface } from 'readline';

const engine = new FeedEngine();
let initialized = false;

async function ensureInit() {
  if (!initialized) { await engine.init(); initialized = true; }
}

const TOOLS = {
  feed_add: { description: 'Subscribe to an RSS/Atom/JSON feed URL', params: { url: 'Feed URL', title: 'Display name (optional)', group: 'Group name (optional)', tags: 'Array of tags (optional)' } },
  feed_remove: { description: 'Unsubscribe from a feed', params: { id: 'Feed ID' } },
  feed_fetch: { description: 'Fetch and parse a single feed now', params: { id: 'Feed ID' } },
  feed_fetch_all: { description: 'Fetch all subscribed feeds', params: {} },
  feed_list: { description: 'List all subscribed feeds', params: { group: 'Filter by group (optional)' } },
  feed_entries: { description: 'Get entries with filters', params: { feed: 'Feed ID (optional)', search: 'Full-text search', author: 'Filter by author', unread: 'true/false', limit: 'Max results', since: 'ISO date filter' } },
  feed_read: { description: 'Search or get entries (alias)', params: { query: 'Search query', feed: 'Feed ID (optional)', limit: 'Max results' } },
  feed_mark_read: { description: 'Mark an entry as read', params: { hash: 'Entry hash' } },
  feed_star: { description: 'Star/bookmark an entry', params: { hash: 'Entry hash' } },
  feed_import_opml: { description: 'Import feeds from OPML XML', params: { opml: 'OPML XML string' } },
  feed_export_opml: { description: 'Export feeds as OPML', params: {} },
  feed_stats: { description: 'Get feed aggregation stats', params: {} },
};

function handleTool(name, args) {
  switch (name) {
    case 'feed_add': return engine.addFeed(args.url, args);
    case 'feed_remove': return engine.removeFeed(args.id);
    case 'feed_fetch': return engine.fetchFeed(args.id);
    case 'feed_fetch_all': return engine.fetchAll();
    case 'feed_list': return Promise.resolve(engine.listFeeds(args.group));
    case 'feed_entries': return Promise.resolve(engine.getEntries(args.feed, {
      search: args.search, author: args.author, unreadOnly: args.unread === 'true',
      limit: parseInt(args.limit || '50'), since: args.since,
    }));
    case 'feed_read': return Promise.resolve(engine.getEntries(args.feed, {
      search: args.query, limit: parseInt(args.limit || '50'),
    }));
    case 'feed_mark_read': return engine.markRead(args.hash);
    case 'feed_star': return engine.star(args.hash);
    case 'feed_import_opml': return engine.importOPML(args.opml).then(r => ({ added: r.length }));
    case 'feed_export_opml': return Promise.resolve(engine.toOPML());
    case 'feed_stats': return Promise.resolve(engine.getStats());
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC stdio ──────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    return respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-feed', version: '1.0' } });
  }
  if (msg.method === 'tools/list') {
    await ensureInit();
    return respond(msg.id, { tools: Object.entries(TOOLS).map(([name, t]) => ({
      name, description: t.description,
      inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, { type: typeof v === 'boolean' ? 'boolean' : 'string', description: v }])), required: [] }
    }))});
  }
  if (msg.method === 'tools/call') {
    await ensureInit();
    try {
      const result = await handleTool(msg.params.name, msg.params.arguments || {});
      return respond(msg.id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return respond(msg.id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
