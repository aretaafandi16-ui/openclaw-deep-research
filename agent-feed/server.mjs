/**
 * agent-feed HTTP server — dark-theme web dashboard + REST API
 */

import { createServer } from 'http';
import { FeedEngine } from './index.mjs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createFeedServer(opts = {}) {
  const port = opts.port || parseInt(process.env.FEED_PORT) || 3138;
  const engine = new FeedEngine(opts);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    function json(data, code = 200) {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }

    try {
      // REST API
      if (path === '/api/feeds' && method === 'GET') {
        return json(engine.listFeeds(url.searchParams.get('group')));
      }
      if (path === '/api/feeds' && method === 'POST') {
        const body = await readBody(req);
        const feed = await engine.addFeed(body.url, body);
        return json(feed, 201);
      }
      if (path.startsWith('/api/feeds/') && method === 'GET') {
        const id = path.split('/')[3];
        const feed = engine.getFeed(id);
        if (!feed) return json({ error: 'Not found' }, 404);
        return json(feed);
      }
      if (path.match(/^\/api\/feeds\/[^/]+\/fetch$/) && method === 'POST') {
        const id = path.split('/')[3];
        const result = await engine.fetchFeed(id);
        return json(result);
      }
      if (path.match(/^\/api\/feeds\/[^/]+$/) && method === 'DELETE') {
        const id = path.split('/')[3];
        await engine.removeFeed(id);
        return json({ ok: true });
      }
      if (path === '/api/fetch-all' && method === 'POST') {
        const results = await engine.fetchAll();
        return json(results);
      }
      if (path === '/api/entries' && method === 'GET') {
        const sp = url.searchParams;
        const entries = engine.getEntries(sp.get('feed'), {
          search: sp.get('search'), author: sp.get('author'),
          category: sp.get('category'), since: sp.get('since'),
          unreadOnly: sp.get('unread') === 'true', starred: sp.get('starred') === 'true',
          limit: parseInt(sp.get('limit') || '50'),
          offset: parseInt(sp.get('offset') || '0'),
        });
        return json(entries);
      }
      if (path.match(/^\/api\/entries\/[^/]+\/read$/) && method === 'POST') {
        const hash = path.split('/')[3];
        return json(await engine.markRead(hash));
      }
      if (path.match(/^\/api\/entries\/[^/]+\/star$/) && method === 'POST') {
        const hash = path.split('/')[3];
        return json(await engine.star(hash));
      }
      if (path === '/api/groups') return json(engine.listGroups());
      if (path === '/api/opml' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(engine.toOPML());
      }
      if (path === '/api/opml' && method === 'POST') {
        const body = await readBody(req, true);
        const added = await engine.importOPML(body);
        return json({ added: added.length });
      }
      if (path === '/api/stats') return json(engine.getStats());
      if (path === '/api/health') return json({ status: 'ok', uptime: process.uptime() });

      // Dashboard
      if (path === '/' || path === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(DASHBOARD_HTML);
      }

      json({ error: 'Not found' }, 404);
    } catch (e) {
      json({ error: e.message }, 500);
    }
  });

  return { server, engine, port, async start() {
    await engine.init();
    return new Promise(r => server.listen(port, () => { console.log(`Feed dashboard: http://localhost:${port}`); r(this); }));
  }, async stop() {
    engine.destroy();
    return new Promise(r => server.close(r));
  }};
}

function readBody(req, raw = false) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { if (raw) return resolve(data); try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-feed</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9}
.header{background:#161b22;border-bottom:1px solid #30363d;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:20px;color:#58a6ff}.header h1 span{color:#8b949e;font-weight:400;font-size:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;padding:16px 24px}
.stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 16px}
.stat .val{font-size:24px;font-weight:700;color:#58a6ff}.stat .label{font-size:12px;color:#8b949e;margin-top:4px}
.main{display:grid;grid-template-columns:280px 1fr;gap:0;height:calc(100vh - 120px)}
.sidebar{background:#161b22;border-right:1px solid #30363d;overflow-y:auto;padding:12px}
.sidebar h3{font-size:12px;text-transform:uppercase;color:#8b949e;padding:8px;letter-spacing:1px}
.feed-item{padding:8px 12px;border-radius:6px;cursor:pointer;margin:2px 0;display:flex;align-items:center;gap:8px}
.feed-item:hover{background:#21262d}.feed-item.active{background:#1f6feb22;color:#58a6ff}
.feed-item .count{background:#30363d;border-radius:10px;padding:2px 8px;font-size:11px;color:#8b949e;margin-left:auto}
.content{overflow-y:auto;padding:16px 24px}
.entry{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:8px;transition:border-color .2s}
.entry:hover{border-color:#58a6ff}.entry.unread{border-left:3px solid #58a6ff}
.entry h3{font-size:15px;margin-bottom:4px}.entry h3 a{color:#c9d1d9;text-decoration:none}
.entry h3 a:hover{color:#58a6ff}
.entry .meta{font-size:12px;color:#8b949e;display:flex;gap:12px;margin-bottom:8px}
.entry .desc{font-size:13px;color:#8b949e;line-height:1.5}
.btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px}
.btn:hover{background:#30363d;border-color:#58a6ff}
.btn.primary{background:#238636;border-color:#238636;color:#fff}
.add-feed{padding:16px}.add-feed input{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:8px 12px;border-radius:6px;width:100%;margin-bottom:8px}
.add-feed input::placeholder{color:#484f58}
.toolbar{display:flex;gap:8px;padding:12px 0;align-items:center}
.search{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 12px;border-radius:6px;flex:1;max-width:300px}
.group-badge{font-size:11px;color:#58a6ff;background:#1f6feb22;padding:2px 6px;border-radius:4px}
.auto-refresh{font-size:11px;color:#8b949e}
</style></head><body>
<div class="header">
  <h1>🐋 agent-feed <span>v1.0</span></h1>
  <div class="auto-refresh" id="status">Loading...</div>
</div>
<div class="stats" id="stats"></div>
<div class="main">
  <div class="sidebar">
    <div class="add-feed">
      <input id="feedUrl" placeholder="Enter feed URL..." onkeydown="if(event.key==='Enter')addFeed()">
      <button class="btn primary" onclick="addFeed()">+ Add Feed</button>
    </div>
    <h3>Feeds</h3>
    <div class="feed-item active" data-id="" onclick="selectFeed('')">📡 All Feeds <span class="count" id="totalCount">0</span></div>
    <div id="feedList"></div>
  </div>
  <div class="content">
    <div class="toolbar">
      <input class="search" placeholder="Search entries..." oninput="searchEntries(this.value)">
      <button class="btn" onclick="fetchAll()">🔄 Fetch All</button>
      <button class="btn" onclick="toggleUnread()">👁 Unread</button>
    </div>
    <div id="entries"></div>
  </div>
</div>
<script>
let currentFeed = '', showUnread = false;
async function api(p, m='GET', b) {
  const r = await fetch('/api'+p, {method:m, headers:b?{'Content-Type':'application/json'}:{}, body:b?JSON.stringify(b):undefined});
  return r.json();
}
async function loadStats() {
  const s = await api('/stats');
  document.getElementById('stats').innerHTML = [
    ['📡 Feeds', s.feeds], ['📰 Entries', s.totalEntries], ['🆕 New', s.newEntries],
    ['📬 Unread', s.unreadCount], ['❌ Errors', s.errors]
  ].map(([l,v]) => '<div class="stat"><div class="val">'+v+'</div><div class="label">'+l+'</div></div>').join('');
}
async function loadFeeds() {
  const feeds = await api('/feeds');
  document.getElementById('feedList').innerHTML = feeds.map(f =>
    '<div class="feed-item'+(currentFeed===f.id?' active':'')+'" data-id="'+f.id+'" onclick="selectFeed(\\''+f.id+'\\')">'+
    (f.type==='atom'?'⚛':'📡')+' '+f.title.slice(0,25)+' <span class="count">'+f.entryCount+'</span></div>'
  ).join('');
  document.getElementById('totalCount').textContent = feeds.reduce((s,f)=>s+f.entryCount,0);
}
async function loadEntries() {
  const p = new URLSearchParams({limit:'50'});
  if (currentFeed) p.set('feed', currentFeed);
  if (showUnread) p.set('unread', 'true');
  const entries = await api('/entries?'+p);
  document.getElementById('entries').innerHTML = entries.map(e =>
    '<div class="entry'+(e.read?'':' unread')+'" id="e'+e.hash+'">'+
    '<h3><a href="'+e.link+'" target="_blank">'+(e.title||'Untitled')+'</a></h3>'+
    '<div class="meta"><span>'+e.feedTitle+'</span><span>'+(e.author||'')+'</span><span>'+(e.pubDate?new Date(e.pubDate).toLocaleDateString():'')+'</span></div>'+
    '<div class="desc">'+(e.description||'').slice(0,200)+'</div></div>'
  ).join('') || '<p style="color:#8b949e;text-align:center;padding:40px">No entries yet. Add a feed above!</p>';
}
async function addFeed() {
  const url = document.getElementById('feedUrl').value.trim();
  if (!url) return;
  await api('/feeds','POST',{url}).catch(()=>{});
  document.getElementById('feedUrl').value = '';
  setTimeout(()=>{loadFeeds();loadEntries();loadStats();},2000);
}
async function fetchAll() { await api('/fetch-all','POST'); setTimeout(()=>{loadFeeds();loadEntries();loadStats();},3000); }
function selectFeed(id) { currentFeed = id; loadFeeds(); loadEntries(); }
function toggleUnread() { showUnread = !showUnread; loadEntries(); }
function searchEntries(q) {
  if (!q) return loadEntries();
  const p = new URLSearchParams({search:q,limit:'50'});
  if (currentFeed) p.set('feed', currentFeed);
  api('/entries?'+p).then(entries => {
    document.getElementById('entries').innerHTML = entries.map(e =>
      '<div class="entry'+(e.read?'':' unread')+'"><h3><a href="'+e.link+'" target="_blank">'+(e.title||'Untitled')+'</a></h3>'+
      '<div class="meta"><span>'+e.feedTitle+'</span><span>'+(e.author||'')+'</span></div>'+
      '<div class="desc">'+(e.description||'').slice(0,200)+'</div></div>'
    ).join('') || '<p style="color:#8b949e;text-align:center;padding:40px">No results.</p>';
  });
}
loadStats(); loadFeeds(); loadEntries();
setInterval(()=>{loadStats();loadFeeds();},30000);
document.getElementById('status').textContent = 'Auto-refresh 30s';
</script></body></html>`;

// ─── Standalone ──────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  createFeedServer().then(s => s.start());
}
