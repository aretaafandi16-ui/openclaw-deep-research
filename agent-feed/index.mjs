/**
 * agent-feed v1.0 — Zero-dependency RSS/Atom/JSON Feed aggregator for AI agents
 *
 * Features:
 *  - Fetch & parse RSS 2.0, Atom 1.0, JSON Feed 1.x
 *  - Feed subscription management with groups/tags
 *  - Entry deduplication (content-hash based)
 *  - Change detection between fetches
 *  - OPML import/export
 *  - Full-text search across fetched entries
 *  - Filtering: by feed, date, author, tags, content pattern
 *  - Feed health monitoring (last fetch, error count, avg response time)
 *  - JSONL persistence + periodic snapshots
 *  - EventEmitter for real-time updates
 */

import { EventEmitter } from 'events';
import { readFile, writeFile, mkdir, appendFile, stat, readdir } from 'fs/promises';
import { join, dirname } from 'path';

// ─── XML Parser (zero-dep) ───────────────────────────────────────────────────

function parseXML(xml) {
  const tokens = [];
  let i = 0;
  while (i < xml.length) {
    if (xml[i] === '<') {
      const end = xml.indexOf('>', i);
      if (end === -1) break;
      tokens.push(xml.substring(i, end + 1));
      i = end + 1;
    } else {
      let end = xml.indexOf('<', i);
      if (end === -1) end = xml.length;
      const text = xml.substring(i, end).trim();
      if (text) tokens.push(text);
      i = end;
    }
  }
  let pos = 0;
  function parseNode() {
    if (pos >= tokens.length) return null;
    const tok = tokens[pos];
    if (tok[0] !== '<') { pos++; return { text: decodeEntities(tok) }; }
    if (tok.startsWith('<?')) { pos++; return parseNode(); }
    if (tok.startsWith('<!--')) {
      while (pos < tokens.length && !tokens[pos].endsWith('-->')) pos++;
      pos++; return parseNode();
    }
    if (tok.startsWith('</')) { pos++; return null; }
    const tagMatch = tok.match(/^<([^>\s\/]+)([\s\S]*?)(\/?)>$/);
    if (!tagMatch) { pos++; return parseNode(); }
    const tag = tagMatch[1];
    const attrsStr = tagMatch[2].trim();
    const selfClose = !!tagMatch[3];
    pos++;
    const attrs = {};
    const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = attrRe.exec(attrsStr))) {
      attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    if (selfClose) return { tag, attrs, children: [] };
    const children = [];
    while (pos < tokens.length) {
      if (tokens[pos] === `</${tag}>`) { pos++; break; }
      const child = parseNode();
      if (child) children.push(child);
    }
    return { tag, attrs, children };
  }
  const nodes = [];
  while (pos < tokens.length) {
    const n = parseNode();
    if (n) nodes.push(n);
  }
  return nodes;
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function extractText(node) {
  if (typeof node === 'string') return node;
  if (!node) return '';
  if (node.text) return node.text;
  if (!node.children) return '';
  return node.children.map(extractText).join('');
}

function firstChild(node, tag) {
  if (!node?.children) return null;
  return node.children.find(c => c.tag === tag);
}

function firstText(node, tag) {
  const c = firstChild(node, tag);
  return c ? extractText(c).trim() : null;
}

// ─── Feed Parsers ────────────────────────────────────────────────────────────

function parseRSS(xml) {
  const doc = parseXML(xml);
  const channel = findDeep(doc, 'channel');
  if (!channel) return null;
  const feed = {
    title: firstText(channel, 'title') || '',
    link: firstText(channel, 'link') || '',
    description: firstText(channel, 'description') || '',
    language: firstText(channel, 'language') || '',
    lastBuildDate: firstText(channel, 'lastBuildDate') || '',
    items: []
  };
  for (const item of filterByTag(channel.children, 'item')) {
    feed.items.push({
      id: firstText(item, 'guid') || firstText(item, 'link') || '',
      title: firstText(item, 'title') || '',
      link: firstText(item, 'link') || '',
      description: firstText(item, 'description') || '',
      content: firstText(item, 'content:encoded') || firstText(item, 'content') || '',
      author: firstText(item, 'author') || firstText(item, 'dc:creator') || '',
      pubDate: firstText(item, 'pubDate') || firstText(item, 'dc:date') || '',
      categories: filterByTag(item.children, 'category').map(c => extractText(c).trim()),
    });
  }
  return feed;
}

function parseAtom(xml) {
  const doc = parseXML(xml);
  const feedNode = findDeep(doc, 'feed');
  if (!feedNode) return null;
  const feed = {
    title: firstText(feedNode, 'title') || '',
    link: (feedNode.children.find(c => c.tag === 'link' && (c.attrs?.rel === 'alternate' || !c.attrs?.rel))?.attrs?.href) || firstText(feedNode, 'link') || '',
    description: firstText(feedNode, 'subtitle') || '',
    language: feedNode.attrs?.['xml:lang'] || '',
    lastBuildDate: firstText(feedNode, 'updated') || '',
    items: []
  };
  for (const entry of filterByTag(feedNode.children, 'entry')) {
    const linkEl = entry.children.find(c => c.tag === 'link' && (c.attrs?.rel === 'alternate' || !c.attrs?.rel));
    feed.items.push({
      id: firstText(entry, 'id') || '',
      title: firstText(entry, 'title') || '',
      link: linkEl?.attrs?.href || firstText(entry, 'link') || '',
      description: firstText(entry, 'summary') || '',
      content: extractText(firstChild(entry, 'content')) || '',
      author: firstText(firstChild(entry, 'author'), 'name') || firstText(entry, 'author') || '',
      pubDate: firstText(entry, 'published') || firstText(entry, 'updated') || '',
      categories: filterByTag(entry.children, 'category').map(c => c.attrs?.term || extractText(c).trim()),
    });
  }
  return feed;
}

function parseJSONFeed(text) {
  const jf = JSON.parse(text);
  if (!jf.version || !jf.version.startsWith('https://www.jsonfeed.org/version/')) {
    if (!jf.items && !jf.feed_url) return null;
  }
  const feed = {
    title: jf.title || '',
    link: jf.home_page_url || '',
    description: jf.description || '',
    language: jf.language || '',
    lastBuildDate: '',
    items: (jf.items || []).map(item => ({
      id: String(item.id || item.url || ''),
      title: item.title || '',
      link: item.url || item.external_url || '',
      description: item.summary || '',
      content: item.content_html || item.content_text || '',
      author: item.author?.name || item.authors?.[0]?.name || '',
      pubDate: item.date_published || '',
      categories: item.tags || [],
    }))
  };
  return feed;
}

function findDeep(nodes, tag) {
  for (const n of nodes) {
    if (n.tag === tag) return n;
    if (n.children) {
      const found = findDeep(n.children, tag);
      if (found) return found;
    }
  }
  return null;
}

function filterByTag(nodes, tag) {
  return (nodes || []).filter(n => n.tag === tag);
}

// ─── Hash & Dedup ────────────────────────────────────────────────────────────

function hashEntry(entry) {
  const raw = `${entry.title}|${entry.link}|${entry.pubDate}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// ─── JSONL Helpers ───────────────────────────────────────────────────────────

async function ensureDir(p) {
  try { await mkdir(p, { recursive: true }); } catch {}
}

async function readJSONL(filePath) {
  try {
    const data = await readFile(filePath, 'utf8');
    return data.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

async function appendJSONL(filePath, record) {
  await appendFile(filePath, JSON.stringify(record) + '\n');
}

// ─── FeedEngine ──────────────────────────────────────────────────────────────

export class FeedEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dataDir = opts.dataDir || './feed-data';
    this.maxEntriesPerFeed = opts.maxEntriesPerFeed || 500;
    this.maxTotalEntries = opts.maxTotalEntries || 10000;
    this.defaultFetchInterval = opts.defaultFetchInterval || 300000; // 5 min
    this.userAgent = opts.userAgent || 'agent-feed/1.0';

    this.feeds = new Map();       // id → feed meta
    this.entries = new Map();     // feedId → entries[]
    this.seenHashes = new Set();  // global dedup
    this.groups = new Map();      // group → Set<feedId>
    this.fetchTimers = new Map(); // feedId → timer
    this.stats = { fetched: 0, newEntries: 0, errors: 0, feeds: 0 };
    this._ready = false;
  }

  async init() {
    await ensureDir(this.dataDir);
    await this._loadFeeds();
    await this._loadEntries();
    this._ready = true;
    this.emit('ready');
    return this;
  }

  // ── Feed Management ──────────────────────────────────────────────────────

  async addFeed(url, opts = {}) {
    const id = opts.id || this._makeId(url);
    if (this.feeds.has(id)) throw new Error(`Feed already exists: ${id}`);
    const feed = {
      id,
      url,
      title: opts.title || url,
      group: opts.group || 'default',
      tags: opts.tags || [],
      interval: opts.interval || this.defaultFetchInterval,
      enabled: true,
      addedAt: new Date().toISOString(),
      lastFetched: null,
      lastError: null,
      errorCount: 0,
      avgResponseMs: 0,
      entryCount: 0,
      type: null,
      link: '',
      description: '',
    };
    this.feeds.set(id, feed);
    this.entries.set(id, []);
    if (!this.groups.has(feed.group)) this.groups.set(feed.group, new Set());
    this.groups.get(feed.group).add(id);
    await this._persistFeed(feed);
    this.emit('feed:added', feed);

    // Try initial fetch
    try {
      await this.fetchFeed(id);
    } catch (e) {
      feed.lastError = e.message;
      feed.errorCount++;
      await this._persistFeed(feed);
    }

    return feed;
  }

  async removeFeed(id) {
    const feed = this.feeds.get(id);
    if (!feed) throw new Error(`Feed not found: ${id}`);
    this._stopAutoFetch(id);
    this.feeds.delete(id);
    this.entries.delete(id);
    for (const [, ids] of this.groups) ids.delete(id);
    this.emit('feed:removed', feed);
    await appendJSONL(join(this.dataDir, 'events.jsonl'), { type: 'feed:removed', id, ts: new Date().toISOString() });
    return true;
  }

  getFeed(id) { return this.feeds.get(id) || null; }
  listFeeds(group) {
    if (group) return [...this.feeds.values()].filter(f => f.group === group);
    return [...this.feeds.values()];
  }
  listGroups() { return [...this.groups.keys()]; }

  async enableFeed(id) {
    const feed = this.feeds.get(id);
    if (!feed) throw new Error(`Feed not found: ${id}`);
    feed.enabled = true;
    await this._persistFeed(feed);
    this.emit('feed:enabled', feed);
    return feed;
  }

  async disableFeed(id) {
    const feed = this.feeds.get(id);
    if (!feed) throw new Error(`Feed not found: ${id}`);
    feed.enabled = false;
    this._stopAutoFetch(id);
    await this._persistFeed(feed);
    this.emit('feed:disabled', feed);
    return feed;
  }

  // ── Fetching ─────────────────────────────────────────────────────────────

  async fetchFeed(id) {
    const feed = this.feeds.get(id);
    if (!feed) throw new Error(`Feed not found: ${id}`);
    const start = Date.now();
    let parsed;
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': this.userAgent, 'Accept': 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const contentType = res.headers.get('content-type') || '';

      // Try JSON Feed first if content-type suggests JSON
      if (contentType.includes('json') || text.trim().startsWith('{')) {
        parsed = parseJSONFeed(text);
        if (parsed) feed.type = 'json';
      }
      // Try Atom
      if (!parsed) {
        parsed = parseAtom(text);
        if (parsed) feed.type = 'atom';
      }
      // Try RSS
      if (!parsed) {
        parsed = parseRSS(text);
        if (parsed) feed.type = 'rss';
      }
      if (!parsed) throw new Error('Unrecognized feed format');

      feed.lastFetched = new Date().toISOString();
      feed.lastError = null;
      feed.errorCount = 0;
      const elapsed = Date.now() - start;
      feed.avgResponseMs = feed.avgResponseMs ? Math.round((feed.avgResponseMs + elapsed) / 2) : elapsed;
      if (parsed.title) feed.title = parsed.title;
      if (parsed.link) feed.link = parsed.link;
      if (parsed.description) feed.description = parsed.description;

      let newCount = 0;
      const existing = this.entries.get(id) || [];
      const existingIds = new Set(existing.map(e => e.hash));

      for (const item of parsed.items) {
        const hash = hashEntry(item);
        if (existingIds.has(hash) || this.seenHashes.has(hash)) continue;
        this.seenHashes.add(hash);
        const entry = {
          hash,
          feedId: id,
          feedTitle: feed.title,
          id: item.id,
          title: item.title,
          link: item.link,
          description: this._truncate(item.description || item.content, 2000),
          author: item.author,
          pubDate: item.pubDate,
          fetchedAt: new Date().toISOString(),
          categories: item.categories,
          read: false,
          starred: false,
          tags: feed.tags,
        };
        existing.push(entry);
        newCount++;
        this.emit('entry:new', entry);
      }

      // Trim
      if (existing.length > this.maxEntriesPerFeed) {
        const trimmed = existing.slice(-this.maxEntriesPerFeed);
        this.entries.set(id, trimmed);
      }

      feed.entryCount = existing.length;
      this.stats.fetched++;
      this.stats.newEntries += newCount;
      this.stats.feeds = this.feeds.size;

      await this._persistFeed(feed);
      if (newCount > 0) {
        for (const entry of existing.slice(-newCount)) {
          await appendJSONL(join(this.dataDir, 'entries.jsonl'), entry);
        }
      }
      this.emit('feed:fetched', { feed, newEntries: newCount });
      return { feed, newEntries: newCount, totalEntries: existing.length };
    } catch (e) {
      feed.lastError = e.message;
      feed.errorCount++;
      feed.lastFetched = new Date().toISOString();
      this.stats.errors++;
      await this._persistFeed(feed);
      this.emit('feed:error', { feed, error: e.message });
      throw e;
    }
  }

  async fetchAll() {
    const results = [];
    for (const [id, feed] of this.feeds) {
      if (!feed.enabled) continue;
      try {
        results.push(await this.fetchFeed(id));
      } catch (e) {
        results.push({ feed, error: e.message });
      }
    }
    return results;
  }

  // ── Auto-Fetch ───────────────────────────────────────────────────────────

  startAutoFetch(id) {
    const feed = this.feeds.get(id);
    if (!feed || !feed.enabled) return;
    this._stopAutoFetch(id);
    const timer = setInterval(async () => {
      try { await this.fetchFeed(id); } catch {}
    }, feed.interval);
    this.fetchTimers.set(id, timer);
    if (timer.unref) timer.unref();
  }

  startAllAutoFetch() {
    for (const [id] of this.feeds) this.startAutoFetch(id);
  }

  stopAllAutoFetch() {
    for (const [id] of this.fetchTimers) this._stopAutoFetch(id);
  }

  _stopAutoFetch(id) {
    const timer = this.fetchTimers.get(id);
    if (timer) { clearInterval(timer); this.fetchTimers.delete(id); }
  }

  // ── Querying ─────────────────────────────────────────────────────────────

  getEntries(feedId, opts = {}) {
    let entries = feedId ? (this.entries.get(feedId) || []) : [...this.entries.values()].flat();
    if (opts.author) entries = entries.filter(e => e.author?.toLowerCase().includes(opts.author.toLowerCase()));
    if (opts.category) entries = entries.filter(e => e.categories?.some(c => c.toLowerCase().includes(opts.category.toLowerCase())));
    if (opts.since) entries = entries.filter(e => e.pubDate >= opts.since || e.fetchedAt >= opts.since);
    if (opts.until) entries = entries.filter(e => e.pubDate <= opts.until);
    if (opts.unreadOnly) entries = entries.filter(e => !e.read);
    if (opts.starred) entries = entries.filter(e => e.starred);
    if (opts.tag) entries = entries.filter(e => e.tags?.includes(opts.tag));
    if (opts.search) {
      const q = opts.search.toLowerCase();
      entries = entries.filter(e =>
        e.title?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.author?.toLowerCase().includes(q)
      );
    }
    // Sort by pubDate desc
    entries.sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));
    if (opts.offset) entries = entries.slice(opts.offset);
    if (opts.limit) entries = entries.slice(0, opts.limit);
    return entries;
  }

  getEntry(hash) {
    for (const [, entries] of this.entries) {
      const found = entries.find(e => e.hash === hash);
      if (found) return found;
    }
    return null;
  }

  async markRead(hash) {
    const entry = this.getEntry(hash);
    if (entry) { entry.read = true; this.emit('entry:read', entry); }
    return entry;
  }

  async markUnread(hash) {
    const entry = this.getEntry(hash);
    if (entry) { entry.read = false; }
    return entry;
  }

  async star(hash) {
    const entry = this.getEntry(hash);
    if (entry) { entry.starred = true; this.emit('entry:starred', entry); }
    return entry;
  }

  async unstar(hash) {
    const entry = this.getEntry(hash);
    if (entry) { entry.starred = false; }
    return entry;
  }

  // ── Change Detection ─────────────────────────────────────────────────────

  getChanges(feedId, sinceTimestamp) {
    const entries = this.entries.get(feedId) || [];
    return entries.filter(e => e.fetchedAt > sinceTimestamp);
  }

  // ── OPML Import/Export ───────────────────────────────────────────────────

  toOPML() {
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '<head><title>agent-feed subscriptions</title></head>', '<body>'];
    const byGroup = {};
    for (const feed of this.feeds.values()) {
      if (!byGroup[feed.group]) byGroup[feed.group] = [];
      byGroup[feed.group].push(feed);
    }
    for (const [group, feeds] of Object.entries(byGroup)) {
      lines.push(`  <outline text="${this._esc(group)}" title="${this._esc(group)}">`);
      for (const f of feeds) {
        lines.push(`    <outline type="${f.type || 'rss'}" text="${this._esc(f.title)}" title="${this._esc(f.title)}" xmlUrl="${this._esc(f.url)}" htmlUrl="${this._esc(f.link || '')}" />`);
      }
      lines.push('  </outline>');
    }
    lines.push('</body>', '</opml>');
    return lines.join('\n');
  }

  async importOPML(opmlXml) {
    const doc = parseXML(opmlXml);
    const body = findDeep(doc, 'body');
    if (!body) return [];
    const added = [];
    for (const outline of filterByTag(body.children, 'outline')) {
      const subOutlines = filterByTag(outline.children, 'outline');
      const group = outline.attrs?.text || outline.attrs?.title || 'default';
      for (const sub of subOutlines.length ? subOutlines : [outline]) {
        const url = sub.attrs?.xmlUrl;
        if (!url) continue;
        try {
          const feed = await this.addFeed(url, {
            title: sub.attrs?.title || sub.attrs?.text || url,
            group,
          });
          added.push(feed);
        } catch {}
      }
    }
    return added;
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  getStats() {
    const totalEntries = [...this.entries.values()].reduce((s, e) => s + e.length, 0);
    const unreadCount = [...this.entries.values()].flat().filter(e => !e.read).length;
    return {
      ...this.stats,
      totalEntries,
      unreadCount,
      groups: this.groups.size,
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  async _persistFeed(feed) {
    await writeFile(join(this.dataDir, 'feeds.json'), JSON.stringify([...this.feeds.values()], null, 2));
  }

  async _loadFeeds() {
    try {
      const data = JSON.parse(await readFile(join(this.dataDir, 'feeds.json'), 'utf8'));
      for (const f of data) {
        this.feeds.set(f.id, f);
        if (!this.groups.has(f.group)) this.groups.set(f.group, new Set());
        this.groups.get(f.group).add(f.id);
      }
    } catch {}
  }

  async _loadEntries() {
    const entriesDir = join(this.dataDir, 'entries.jsonl');
    const records = await readJSONL(entriesDir);
    for (const entry of records) {
      if (!this.entries.has(entry.feedId)) this.entries.set(entry.feedId, []);
      const existing = this.entries.get(entry.feedId);
      if (!existing.find(e => e.hash === entry.hash)) {
        existing.push(entry);
        this.seenHashes.add(entry.hash);
      }
    }
  }

  async snapshot() {
    await ensureDir(this.dataDir);
    for (const [id, entries] of this.entries) {
      await writeFile(join(this.dataDir, `entries-${id}.json`), JSON.stringify(entries, null, 2));
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _makeId(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/\./g, '-') + u.pathname.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
    } catch { return url.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30); }
  }

  _truncate(s, max) {
    if (!s) return '';
    return s.length > max ? s.slice(0, max) + '...' : s;
  }

  _esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  destroy() {
    this.stopAllAutoFetch();
    this.removeAllListeners();
  }
}

export default FeedEngine;
export { parseRSS, parseAtom, parseJSONFeed, parseXML };
