#!/usr/bin/env node
/**
 * agent-feed CLI
 */

import { FeedEngine } from './index.mjs';
import { writeFile, readFile } from 'fs/promises';

const engine = new FeedEngine();
await engine.init();

const [,, cmd, ...args] = process.argv;

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { o[a[i].slice(2)] = a[i+1] || true; i++; }
    else if (!o._) o._ = [a[i]]; else o._.push(a[i]);
  }
  return o;
}

const flags = parseArgs(args);

try {
  switch (cmd) {
    case 'add': {
      const url = flags._?.[0] || flags.url;
      if (!url) { console.error('Usage: feed add <url> [--title T] [--group G] [--tags t1,t2]'); process.exit(1); }
      const feed = await engine.addFeed(url, {
        title: flags.title, group: flags.group,
        tags: flags.tags ? flags.tags.split(',') : undefined,
      });
      console.log(`✅ Subscribed: ${feed.title} (${feed.id})`);
      break;
    }
    case 'remove': case 'rm': {
      const id = flags._?.[0] || flags.id;
      if (!id) { console.error('Usage: feed remove <id>'); process.exit(1); }
      await engine.removeFeed(id);
      console.log('🗑 Removed');
      break;
    }
    case 'fetch': {
      const id = flags._?.[0] || flags.id;
      if (id) {
        const r = await engine.fetchFeed(id);
        console.log(`📡 ${r.feed.title}: ${r.newEntries} new / ${r.totalEntries} total`);
      } else {
        const results = await engine.fetchAll();
        for (const r of results) {
          if (r.error) console.log(`❌ ${r.feed.title}: ${r.error}`);
          else console.log(`📡 ${r.feed.title}: ${r.newEntries} new / ${r.totalEntries} total`);
        }
      }
      break;
    }
    case 'list': case 'ls': {
      const feeds = engine.listFeeds(flags.group);
      if (!feeds.length) { console.log('No feeds subscribed.'); break; }
      console.log('ID'.padEnd(35) + 'TITLE'.padEnd(35) + 'TYPE'.padEnd(8) + 'ENTRIES'.padEnd(10) + 'STATUS');
      console.log('─'.repeat(90));
      for (const f of feeds) {
        const status = f.errorCount > 0 ? `❌ ${f.lastError?.slice(0,30)}` : (f.lastFetched ? '✅' : '⏳');
        console.log(f.id.padEnd(35) + f.title.slice(0,33).padEnd(35) + (f.type||'?').padEnd(8) + String(f.entryCount).padEnd(10) + status);
      }
      break;
    }
    case 'entries': case 'ls-entries': {
      const entries = engine.getEntries(flags.feed, {
        search: flags.search, author: flags.author, unreadOnly: flags.unread === 'true',
        limit: parseInt(flags.limit || '20'),
      });
      for (const e of entries) {
        const read = e.read ? '  ' : '🔵';
        console.log(`${read} ${e.title?.slice(0,60)}`);
        console.log(`   ${e.feedTitle} | ${e.author || 'unknown'} | ${e.pubDate?.slice(0,10) || ''}`);
        console.log(`   ${e.link}`);
        console.log();
      }
      if (!entries.length) console.log('No entries found.');
      break;
    }
    case 'search': {
      const q = flags._?.[0];
      if (!q) { console.error('Usage: feed search <query>'); process.exit(1); }
      const entries = engine.getEntries(null, { search: q, limit: parseInt(flags.limit || '20') });
      for (const e of entries) {
        console.log(`📰 ${e.title?.slice(0,60)} [${e.feedTitle}]`);
        console.log(`   ${e.link}`);
      }
      if (!entries.length) console.log('No results.');
      break;
    }
    case 'read': {
      const hash = flags._?.[0];
      if (!hash) { console.error('Usage: feed read <hash>'); process.exit(1); }
      await engine.markRead(hash);
      console.log('✅ Marked as read');
      break;
    }
    case 'star': {
      const hash = flags._?.[0];
      if (!hash) { console.error('Usage: feed star <hash>'); process.exit(1); }
      await engine.star(hash);
      console.log('⭐ Starred');
      break;
    }
    case 'import-opml': {
      const file = flags._?.[0] || flags.file;
      if (!file) { console.error('Usage: feed import-opml <file.opml>'); process.exit(1); }
      const xml = await readFile(file, 'utf8');
      const added = await engine.importOPML(xml);
      console.log(`📥 Imported ${added.length} feeds`);
      break;
    }
    case 'export-opml': {
      const opml = engine.toOPML();
      if (flags.output) { await writeFile(flags.output, opml); console.log(`📤 Exported to ${flags.output}`); }
      else process.stdout.write(opml);
      break;
    }
    case 'stats': {
      const s = engine.getStats();
      console.log('📊 Feed Stats');
      console.log('─'.repeat(30));
      console.log(`Feeds:        ${s.feeds}`);
      console.log(`Total entries:${s.totalEntries}`);
      console.log(`Unread:       ${s.unreadCount}`);
      console.log(`Fetched:      ${s.fetched}`);
      console.log(`New entries:  ${s.newEntries}`);
      console.log(`Errors:       ${s.errors}`);
      console.log(`Groups:       ${s.groups}`);
      break;
    }
    case 'serve': {
      const { createFeedServer } = await import('./server.mjs');
      const s = await createFeedServer({ port: parseInt(flags.port || '3138') });
      await s.start();
      break;
    }
    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }
    case 'demo': {
      console.log('🌊 Adding demo feeds...');
      const demos = [
        { url: 'https://hnrss.org/frontpage', title: 'Hacker News', group: 'tech' },
        { url: 'https://github.blog/feed/', title: 'GitHub Blog', group: 'tech' },
        { url: 'https://openai.com/blog/rss.xml', title: 'OpenAI Blog', group: 'ai' },
        { url: 'https://www.anthropic.com/feed.xml', title: 'Anthropic', group: 'ai' },
      ];
      for (const d of demos) {
        try {
          const feed = await engine.addFeed(d.url, d);
          console.log(`  ✅ ${feed.title} (${feed.entryCount} entries)`);
        } catch (e) { console.log(`  ❌ ${d.title}: ${e.message}`); }
      }
      console.log('\nDone! Run "feed entries" to see entries.');
      break;
    }
    default:
      console.log(`
agent-feed v1.0 — RSS/Atom/JSON Feed aggregator

Commands:
  add <url>          Subscribe to a feed
  remove <id>        Unsubscribe from a feed
  fetch [id]         Fetch feeds (all or specific)
  list               List subscribed feeds
  entries            List entries (--feed, --search, --unread, --limit)
  search <query>     Full-text search across entries
  read <hash>        Mark entry as read
  star <hash>        Star an entry
  import-opml <file> Import from OPML
  export-opml        Export as OPML
  stats              Show aggregation stats
  serve              Start HTTP dashboard (:3138)
  mcp                Start MCP server (stdio)
  demo               Add sample feeds
      `);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

engine.destroy();
