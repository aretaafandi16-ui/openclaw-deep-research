# agent-feed v1.0

Zero-dependency RSS/Atom/JSON Feed aggregator for AI agents.

## Features

- **Multi-format**: RSS 2.0, Atom 1.0, JSON Feed 1.x — auto-detected
- **Zero dependencies**: Pure Node.js, no npm install needed
- **Subscription management**: Add/remove/enable/disable feeds with groups & tags
- **Auto-fetch**: Configurable polling interval per feed
- **Deduplication**: Content-hash based — never see the same entry twice
- **Change detection**: Fetch diffs since any timestamp
- **Full-text search**: Search across all fetched entries
- **Filtering**: By feed, author, category, date range, unread, starred
- **OPML**: Import/export standard OPML files
- **Feed health**: Track fetch times, error counts, avg response time
- **Persistence**: JSONL event log + JSON snapshots, survives restarts
- **HTTP Dashboard**: Dark-theme web UI at port 3138
- **MCP Server**: 12 tools via JSON-RPC stdio
- **CLI**: Full command-line interface
- **EventEmitter**: Real-time events for new entries, fetch errors, etc.

## Quick Start

```js
import { FeedEngine } from './index.mjs';

const engine = new FeedEngine({ dataDir: './my-feeds' });
await engine.init();

// Subscribe to a feed
await engine.addFeed('https://hnrss.org/frontpage', {
  title: 'Hacker News',
  group: 'tech',
  tags: ['news', 'programming'],
});

// Fetch all feeds
await engine.fetchAll();

// Get recent entries
const entries = engine.getEntries(null, { limit: 10, unreadOnly: true });
for (const e of entries) {
  console.log(`📰 ${e.title}`);
  console.log(`   ${e.link}`);
  await engine.markRead(e.hash);
}

// Auto-fetch every 5 minutes
engine.startAllAutoFetch();

// Real-time events
engine.on('entry:new', entry => {
  console.log(`New: ${entry.title} from ${entry.feedTitle}`);
});

// Export as OPML
const opml = engine.toOPML();

// Import OPML
await engine.importOPML(opmlXml);
```

## HTTP API

Start the server: `node server.mjs` (port 3138)

| Endpoint | Method | Description |
|---|---|---|
| `/api/feeds` | GET | List feeds (?group=) |
| `/api/feeds` | POST | Add feed {url, title?, group?, tags?} |
| `/api/feeds/:id` | GET | Get feed details |
| `/api/feeds/:id` | DELETE | Remove feed |
| `/api/feeds/:id/fetch` | POST | Fetch single feed |
| `/api/fetch-all` | POST | Fetch all feeds |
| `/api/entries` | GET | List entries (?feed=, ?search=, ?author=, ?unread=, ?starred=, ?since=, ?limit=, ?offset=) |
| `/api/entries/:hash/read` | POST | Mark entry read |
| `/api/entries/:hash/star` | POST | Star entry |
| `/api/opml` | GET | Export OPML |
| `/api/opml` | POST | Import OPML (raw XML body) |
| `/api/groups` | GET | List groups |
| `/api/stats` | GET | Aggregation stats |
| `/api/health` | GET | Health check |

## MCP Server

```bash
node mcp-server.mjs
```

12 tools available:
- `feed_add` — Subscribe to a feed URL
- `feed_remove` — Unsubscribe
- `feed_fetch` — Fetch single feed now
- `feed_fetch_all` — Fetch all feeds
- `feed_list` — List subscribed feeds
- `feed_entries` — Get entries with filters
- `feed_read` — Search entries
- `feed_mark_read` — Mark entry read
- `feed_star` — Star an entry
- `feed_import_opml` — Import OPML XML
- `feed_export_opml` — Export as OPML
- `feed_stats` — Aggregation stats

## CLI

```bash
node cli.mjs add https://hnrss.org/frontpage --title "Hacker News" --group tech
node cli.mjs fetch                         # Fetch all feeds
node cli.mjs entries --limit 20            # List recent entries
node cli.mjs search "AI agents"            # Full-text search
node cli.mjs list                          # List subscriptions
node cli.mjs read <hash>                   # Mark as read
node cli.mjs star <hash>                   # Star entry
node cli.mjs import-opml feeds.opml        # Import OPML
node cli.mjs export-opml                   # Export OPML
node cli.mjs stats                         # Show stats
node cli.mjs demo                          # Add sample feeds
node cli.mjs serve                         # Start HTTP server
node cli.mjs mcp                           # Start MCP server
```

## Events

```js
engine.on('feed:added', feed => { ... });
engine.on('feed:removed', feed => { ... });
engine.on('feed:fetched', ({ feed, newEntries }) => { ... });
engine.on('feed:error', ({ feed, error }) => { ... });
engine.on('feed:enabled', feed => { ... });
engine.on('feed:disabled', feed => { ... });
engine.on('entry:new', entry => { ... });
engine.on('entry:read', entry => { ... });
engine.on('entry:starred', entry => { ... });
engine.on('ready', () => { ... });
```

## Entry Object

```js
{
  hash: 'abc123',         // Content-hash for dedup
  feedId: 'feed-id',
  feedTitle: 'Feed Name',
  id: 'guid-or-url',
  title: 'Entry Title',
  link: 'https://...',
  description: 'Truncated content',
  author: 'Author Name',
  pubDate: '2026-03-24T12:00:00Z',
  fetchedAt: '2026-03-24T12:05:00Z',
  categories: ['tech', 'ai'],
  read: false,
  starred: false,
  tags: ['news'],
}
```

## License

MIT
