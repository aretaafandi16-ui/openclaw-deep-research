#!/usr/bin/env node
/**
 * bookmark.mjs — URL bookmark manager with tagging and metadata
 * Usage: node bookmark.mjs <command> [args]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'bookmarks.json');

function loadDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) return { bookmarks: [], version: 1 };
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { bookmarks: [], version: 1 };
  }
}

function saveDb(db) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getArg(args, name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

function flag(args, name) {
  return args.includes(`--${name}`);
}

function shortId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const [,, command, ...args] = process.argv;

switch (command) {
  case 'add': {
    const url = args[0];
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      console.error('Usage: add <url> [--title=...] [--tags=t1,t2] [--desc=...] [--collection=...]');
      process.exit(1);
    }

    const title = getArg(args, 'title') || url;
    const tags = (getArg(args, 'tags') || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const desc = getArg(args, 'desc') || '';
    const collection = getArg(args, 'collection') || 'default';

    const db = loadDb();
    const now = new Date().toISOString();

    // Check for duplicate URL
    const existing = db.bookmarks.find(b => b.url === url);
    if (existing) {
      // Update existing
      existing.title = title;
      existing.tags = [...new Set([...existing.tags, ...tags])];
      if (desc) existing.desc = desc;
      existing.updated = now;
      existing.accessCount++;
      saveDb(db);
      console.log(`♻️ Updated bookmark: ${existing.id} — ${title}`);
    } else {
      const bookmark = {
        id: shortId(),
        url,
        title,
        tags,
        desc,
        collection,
        created: now,
        updated: now,
        accessCount: 0,
      };
      db.bookmarks.push(bookmark);
      saveDb(db);
      console.log(`🔖 Saved bookmark: ${bookmark.id} — ${title}`);
      if (tags.length) console.log(`   Tags: ${tags.join(', ')}`);
      if (collection !== 'default') console.log(`   Collection: ${collection}`);
    }
    break;
  }

  case 'get': {
    const id = args[0];
    if (!id) { console.error('Usage: get <id|query>'); process.exit(1); }

    const db = loadDb();
    // Try exact ID first, then title/tag search
    let bm = db.bookmarks.find(b => b.id === id);
    if (!bm) {
      const query = id.toLowerCase();
      bm = db.bookmarks.find(b =>
        b.title.toLowerCase().includes(query) ||
        b.tags.some(t => t.includes(query))
      );
    }

    if (!bm) {
      console.error(`Bookmark not found: ${id}`);
      process.exit(1);
    }

    bm.accessCount++;
    bm.lastAccessed = new Date().toISOString();
    saveDb(db);

    console.log(`🔖 ${bm.title}`);
    console.log(`   URL: ${bm.url}`);
    if (bm.desc) console.log(`   Desc: ${bm.desc}`);
    if (bm.tags.length) console.log(`   Tags: ${bm.tags.join(', ')}`);
    console.log(`   Collection: ${bm.collection}`);
    console.log(`   Created: ${bm.created}`);
    console.log(`   Accessed: ${bm.accessCount}x`);
    break;
  }

  case 'list': {
    const tag = getArg(args, 'tag');
    const collection = getArg(args, 'collection');
    const sort = getArg(args, 'sort') || 'updated';
    const limit = parseInt(getArg(args, 'limit') || '50');

    const db = loadDb();
    let bms = [...db.bookmarks];

    if (tag) bms = bms.filter(b => b.tags.includes(tag.toLowerCase()));
    if (collection) bms = bms.filter(b => b.collection === collection.toLowerCase());

    bms.sort((a, b) => {
      if (sort === 'accessed') return b.accessCount - a.accessCount;
      if (sort === 'created') return new Date(b.created) - new Date(a.created);
      return new Date(b.updated) - new Date(b.updated);
    });

    bms = bms.slice(0, limit);

    if (bms.length === 0) {
      console.log('No bookmarks found.');
    } else {
      for (const b of bms) {
        const tags = b.tags.length ? ` [${b.tags.join(', ')}]` : '';
        const coll = b.collection !== 'default' ? ` {${b.collection}}` : '';
        console.log(`🔖 ${b.id} | ${b.title}${tags}${coll}`);
        console.log(`   ${b.url}`);
      }
      console.log(`\n${bms.length} bookmark(s)`);
    }
    break;
  }

  case 'search': {
    const query = args.join(' ').toLowerCase();
    if (!query) { console.error('Usage: search <query>'); process.exit(1); }

    const db = loadDb();
    const matches = db.bookmarks.filter(b =>
      b.title.toLowerCase().includes(query) ||
      b.url.toLowerCase().includes(query) ||
      b.desc.toLowerCase().includes(query) ||
      b.tags.some(t => t.includes(query))
    );

    if (matches.length === 0) {
      console.log('No matches found.');
    } else {
      for (const b of matches) {
        const tags = b.tags.length ? ` [${b.tags.join(', ')}]` : '';
        console.log(`🔖 ${b.id} | ${b.title}${tags}`);
        console.log(`   ${b.url}`);
        if (b.desc) console.log(`   ${b.desc}`);
      }
      console.log(`\n${matches.length} match(es)`);
    }
    break;
  }

  case 'delete': {
    const id = args[0];
    if (!id) { console.error('Usage: delete <id>'); process.exit(1); }

    const db = loadDb();
    const idx = db.bookmarks.findIndex(b => b.id === id);
    if (idx === -1) {
      console.error(`Bookmark not found: ${id}`);
      process.exit(1);
    }

    const removed = db.bookmarks.splice(idx, 1)[0];
    saveDb(db);
    console.log(`🗑️ Deleted: ${removed.title} (${removed.url})`);
    break;
  }

  case 'edit': {
    const id = args[0];
    if (!id) { console.error('Usage: edit <id> [--title=...] [--tags=...] [--desc=...] [--collection=...]'); process.exit(1); }

    const db = loadDb();
    const bm = db.bookmarks.find(b => b.id === id);
    if (!bm) { console.error(`Bookmark not found: ${id}`); process.exit(1); }

    const title = getArg(args, 'title');
    const tags = getArg(args, 'tags');
    const desc = getArg(args, 'desc');
    const collection = getArg(args, 'collection');

    if (title) bm.title = title;
    if (tags) bm.tags = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (desc) bm.desc = desc;
    if (collection) bm.collection = collection.toLowerCase();
    bm.updated = new Date().toISOString();

    saveDb(db);
    console.log(`✏️ Updated: ${bm.id} — ${bm.title}`);
    break;
  }

  case 'tags': {
    const db = loadDb();
    const tagCounts = {};
    for (const b of db.bookmarks) {
      for (const t of b.tags) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
    }

    const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      console.log('No tags found.');
    } else {
      sorted.forEach(([tag, count]) => console.log(`${tag} (${count})`));
    }
    break;
  }

  case 'collections': {
    const db = loadDb();
    const collCounts = {};
    for (const b of db.bookmarks) {
      collCounts[b.collection] = (collCounts[b.collection] || 0) + 1;
    }

    const sorted = Object.entries(collCounts).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([coll, count]) => console.log(`${coll} (${count})`));
    break;
  }

  case 'check': {
    // Check URLs for dead links (basic HTTP HEAD check)
    const db = loadDb();
    const results = [];

    console.log(`Checking ${db.bookmarks.length} bookmark(s)...\n`);

    for (const b of db.bookmarks) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(b.url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
        clearTimeout(timeout);
        const status = resp.ok ? '✅' : `⚠️ ${resp.status}`;
        results.push({ title: b.title, url: b.url, status, code: resp.status });
      } catch (e) {
        results.push({ title: b.title, url: b.url, status: '❌ dead', code: 0 });
      }
    }

    const dead = results.filter(r => r.code === 0);
    const broken = results.filter(r => r.code >= 400);

    for (const r of results) {
      console.log(`${r.status} ${r.title}`);
      console.log(`   ${r.url}`);
    }

    console.log(`\n${results.length} checked: ${dead.length} dead, ${broken.length} broken, ${results.length - dead.length - broken.length} ok`);
    break;
  }

  case 'export': {
    const db = loadDb();
    console.log(JSON.stringify(db, null, 2));
    break;
  }

  case 'import': {
    const input = readFileSync('/dev/stdin', 'utf8');
    const imported = JSON.parse(input);
    const db = loadDb();

    let count = 0;
    for (const bm of imported.bookmarks || imported) {
      if (!db.bookmarks.find(b => b.url === bm.url)) {
        db.bookmarks.push(bm);
        count++;
      }
    }

    saveDb(db);
    console.log(`📥 Imported ${count} bookmark(s)`);
    break;
  }

  case 'stats': {
    const db = loadDb();
    const bms = db.bookmarks;
    const tags = new Set(bms.flatMap(b => b.tags));
    const colls = new Set(bms.map(b => b.collection));
    const topAccessed = [...bms].sort((a, b) => b.accessCount - a.accessCount).slice(0, 5);

    console.log(JSON.stringify({
      total: bms.length,
      tags: tags.size,
      collections: colls.size,
      mostAccessed: topAccessed.map(b => ({ title: b.title, accesses: b.accessCount })),
    }, null, 2));
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Commands: add, get, list, search, delete, edit, tags, collections, check, export, import, stats');
    process.exit(1);
}
