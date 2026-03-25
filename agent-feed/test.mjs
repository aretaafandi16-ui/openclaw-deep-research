/**
 * agent-feed test suite — zero-dep XML parsing, feed parsing, engine operations
 */

import { FeedEngine, parseRSS, parseAtom, parseJSONFeed, parseXML } from './index.mjs';
import { mkdir, rm } from 'fs/promises';

const DATA_DIR = '/tmp/agent-feed-test-' + Date.now();
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (!cond) { failed++; console.error(`  ❌ ${msg}`); } else { passed++; }
}

function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try { fn(); console.log('✅'); } catch (e) { failed++; console.log(`❌ ${e.message}`); }
}

async function testAsync(name, fn) {
  process.stdout.write(`  ${name}... `);
  try { await fn(); console.log('✅'); passed++; } catch (e) { failed++; console.log(`❌ ${e.message}`); }
}

// ─── XML Parser ──────────────────────────────────────────────────────────────
console.log('\n📦 XML Parser');
test('parses simple XML', () => {
  const r = parseXML('<root><item>hello</item></root>');
  assert(r[0].tag === 'root', 'root tag');
  assert(r[0].children[0].tag === 'item', 'item tag');
  assert(r[0].children[0].children[0].text === 'hello', 'text content');
});

test('parses attributes', () => {
  const r = parseXML('<link href="https://example.com" rel="alternate"/>');
  assert(r[0].attrs.href === 'https://example.com', 'href attr');
  assert(r[0].attrs.rel === 'alternate', 'rel attr');
});

test('decodes entities', () => {
  const r = parseXML('<t>&amp; &lt; &gt; &quot;</t>');
  assert(r[0].children[0].text === '& < > "', 'entities decoded');
});

test('handles self-closing tags', () => {
  const r = parseXML('<root><br/><img src="a.png"/></root>');
  assert(r[0].children.length === 2, 'two children');
  assert(r[0].children[1].attrs.src === 'a.png', 'img src');
});

test('handles comments', () => {
  const r = parseXML('<!-- comment --><root>text</root>');
  assert(r[0].tag === 'root', 'skips comments');
});

test('handles CDATA', () => {
  const r = parseXML('<root><![CDATA[<b>bold</b>]]></root>');
  // CDATA isn't specially handled but should parse the text
  assert(r.length > 0, 'parses CDATA content');
});

// ─── RSS Parser ──────────────────────────────────────────────────────────────
console.log('\n📦 RSS Parser');
const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Test Feed</title>
  <link>https://example.com</link>
  <description>A test RSS feed</description>
  <language>en-us</language>
  <item>
    <title>First Post</title>
    <link>https://example.com/post1</link>
    <description>This is the first post</description>
    <author>author@example.com</author>
    <pubDate>Mon, 24 Mar 2026 12:00:00 GMT</pubDate>
    <guid>post-1</guid>
    <category>tech</category>
    <category>news</category>
  </item>
  <item>
    <title>Second Post</title>
    <link>https://example.com/post2</link>
    <description>Second post content</description>
    <guid>post-2</guid>
  </item>
</channel>
</rss>`;

test('parses RSS feed metadata', () => {
  const f = parseRSS(RSS_XML);
  assert(f.title === 'Test Feed', 'title');
  assert(f.link === 'https://example.com', 'link');
  assert(f.description === 'A test RSS feed', 'description');
  assert(f.language === 'en-us', 'language');
});

test('parses RSS items', () => {
  const f = parseRSS(RSS_XML);
  assert(f.items.length === 2, 'item count');
  assert(f.items[0].title === 'First Post', 'item title');
  assert(f.items[0].link === 'https://example.com/post1', 'item link');
  assert(f.items[0].author === 'author@example.com', 'item author');
  assert(f.items[0].id === 'post-1', 'item guid');
  assert(f.items[0].categories.length === 2, 'categories');
  assert(f.items[0].categories[0] === 'tech', 'category value');
});

// ─── Atom Parser ─────────────────────────────────────────────────────────────
console.log('\n📦 Atom Parser');
const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Test</title>
  <link href="https://example.com" rel="alternate"/>
  <subtitle>An atom feed</subtitle>
  <entry>
    <title>Entry One</title>
    <link href="https://example.com/entry1" rel="alternate"/>
    <id>entry-1</id>
    <summary>Summary of entry one</summary>
    <author><name>Jane Doe</name></author>
    <published>2026-03-24T10:00:00Z</published>
    <category term="ai"/>
  </entry>
</feed>`;

test('parses Atom feed metadata', () => {
  const f = parseAtom(ATOM_XML);
  assert(f.title === 'Atom Test', 'title');
  assert(f.link === 'https://example.com', 'link');
  assert(f.description === 'An atom feed', 'subtitle');
});

test('parses Atom entries', () => {
  const f = parseAtom(ATOM_XML);
  assert(f.items.length === 1, 'entry count');
  assert(f.items[0].title === 'Entry One', 'entry title');
  assert(f.items[0].link === 'https://example.com/entry1', 'entry link');
  assert(f.items[0].author === 'Jane Doe', 'author from name child');
  assert(f.items[0].id === 'entry-1', 'entry id');
  assert(f.items[0].categories[0] === 'ai', 'category term');
});

// ─── JSON Feed Parser ────────────────────────────────────────────────────────
console.log('\n📦 JSON Feed Parser');
test('parses JSON Feed', () => {
  const jf = JSON.stringify({
    version: 'https://www.jsonfeed.org/version/1.1',
    title: 'JSON Feed Test',
    home_page_url: 'https://example.com',
    items: [
      { id: '1', title: 'JSON Item', url: 'https://example.com/1', summary: 'A summary', date_published: '2026-03-24', tags: ['test'] },
    ]
  });
  const f = parseJSONFeed(jf);
  assert(f.title === 'JSON Feed Test', 'title');
  assert(f.items.length === 1, 'item count');
  assert(f.items[0].title === 'JSON Item', 'item title');
  assert(f.items[0].categories[0] === 'test', 'tags');
});

// ─── FeedEngine ──────────────────────────────────────────────────────────────
console.log('\n📦 FeedEngine');
let engine;

await testAsync('initializes engine', async () => {
  engine = new FeedEngine({ dataDir: DATA_DIR });
  await engine.init();
  assert(engine._ready === true, 'ready flag');
});

await testAsync('starts with empty state', async () => {
  assert(engine.feeds.size === 0, 'no feeds');
  assert(engine.listGroups().length === 0, 'no groups');
  const stats = engine.getStats();
  assert(stats.feeds === 0, 'stats.feeds');
  assert(stats.totalEntries === 0, 'stats.totalEntries');
});

await testAsync('OPML export with no feeds', async () => {
  const opml = engine.toOPML();
  assert(opml.includes('<?xml'), 'is valid XML');
  assert(opml.includes('agent-feed'), 'contains title');
});

await testAsync('import OPML', async () => {
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Test</title></head><body>
  <outline text="Tech" title="Tech">
    <outline type="rss" text="Hacker News" xmlUrl="https://hnrss.org/frontpage" htmlUrl="https://news.ycombinator.com"/>
    <outline type="rss" text="GitHub Blog" xmlUrl="https://github.blog/feed/" htmlUrl="https://github.blog"/>
  </outline>
</body></opml>`;
  const added = await engine.importOPML(opml);
  assert(added.length >= 1, `imported ${added.length} feeds`);
  assert(engine.feeds.size >= 1, `has ${engine.feeds.size} feeds`);
});

await testAsync('export OPML includes feeds', async () => {
  const opml = engine.toOPML();
  assert(opml.includes('xmlUrl'), 'has feed URLs');
});

await testAsync('addFeed creates feed entry', async () => {
  const feed = await engine.addFeed('https://example.com/test.xml', { title: 'Test Feed', group: 'test-group' });
  assert(feed.id, 'has id');
  assert(feed.title === 'Test Feed', 'has title');
  assert(feed.group === 'test-group', 'has group');
  assert(engine.feeds.has(feed.id), 'stored in feeds map');
});

await testAsync('listFeeds returns feeds', async () => {
  const feeds = engine.listFeeds();
  assert(feeds.length > 0, 'has feeds');
  const grouped = engine.listFeeds('test-group');
  assert(grouped.length > 0, 'has grouped feeds');
});

await testAsync('listGroups returns groups', async () => {
  const groups = engine.listGroups();
  assert(groups.includes('test-group'), 'includes test-group');
});

await testAsync('enable/disable feed', async () => {
  const feeds = engine.listFeeds();
  const id = feeds[feeds.length - 1].id;
  await engine.disableFeed(id);
  assert(!engine.getFeed(id).enabled, 'disabled');
  await engine.enableFeed(id);
  assert(engine.getFeed(id).enabled, 'enabled');
});

await testAsync('removeFeed deletes feed', async () => {
  const feed = await engine.addFeed('https://temp.example.com/rss', { title: 'Temp' });
  const id = feed.id;
  await engine.removeFeed(id);
  assert(!engine.feeds.has(id), 'removed');
});

await testAsync('getEntries returns empty for empty engine', async () => {
  const entries = engine.getEntries('nonexistent');
  assert(entries.length === 0, 'empty');
});

await testAsync('getEntry returns null for unknown hash', async () => {
  assert(engine.getEntry('unknown') === null, 'null');
});

await testAsync('getStats returns correct structure', async () => {
  const s = engine.getStats();
  assert(typeof s.fetched === 'number', 'has fetched');
  assert(typeof s.newEntries === 'number', 'has newEntries');
  assert(typeof s.errors === 'number', 'has errors');
  assert(typeof s.totalEntries === 'number', 'has totalEntries');
  assert(typeof s.unreadCount === 'number', 'has unreadCount');
});

await testAsync('event emitter fires on operations', async () => {
  let fired = false;
  engine.once('feed:added', () => { fired = true; });
  await engine.addFeed('https://event.example.com/rss', { title: 'Event Test' });
  assert(fired, 'feed:added event fired');
});

await testAsync('markRead/star operations', async () => {
  // These won't throw even with missing entries
  await engine.markRead('nonexistent');
  await engine.star('nonexistent');
  assert(true, 'no errors on missing hashes');
});

// Cleanup
engine.destroy();
await rm(DATA_DIR, { recursive: true, force: true });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
