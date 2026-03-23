#!/usr/bin/env node
/**
 * snippets.mjs — Persistent snippet manager
 * Usage: node snippets.mjs <command> [args]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'snippets.json');

function loadDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) return { snippets: {}, version: 1 };
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { snippets: {}, version: 1 };
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

const [,, command, ...args] = process.argv;

switch (command) {
  case 'save': {
    const name = args[0];
    if (!name) { console.error('Usage: save <name> [content] [--tags=t1,t2] [--category=code]'); process.exit(1); }
    
    let content = args[1];
    if (!content || content.startsWith('--')) {
      // Read from stdin
      try { content = readFileSync('/dev/stdin', 'utf8').trim(); } catch { content = ''; }
    }
    
    const tags = (getArg(args, 'tags') || '').split(',').filter(Boolean);
    const category = getArg(args, 'category') || 'other';
    
    const db = loadDb();
    const now = new Date().toISOString();
    const existing = db.snippets[name];
    
    db.snippets[name] = {
      name,
      content,
      tags,
      category,
      created: existing?.created || now,
      updated: now,
      accessCount: existing?.accessCount || 0,
    };
    
    saveDb(db);
    console.log(`✅ Saved snippet: ${name} (${content.length} chars, ${tags.length} tags)`);
    break;
  }

  case 'get': {
    const name = args[0];
    if (!name) { console.error('Usage: get <name>'); process.exit(1); }
    
    const db = loadDb();
    const snippet = db.snippets[name];
    if (!snippet) {
      // Try fuzzy match
      const matches = Object.keys(db.snippets).filter(k => k.includes(name));
      if (matches.length === 1) {
        const s = db.snippets[matches[0]];
        s.accessCount++;
        saveDb(db);
        console.log(s.content);
      } else if (matches.length > 1) {
        console.error(`Multiple matches: ${matches.join(', ')}`);
        process.exit(1);
      } else {
        console.error(`Snippet not found: ${name}`);
        process.exit(1);
      }
    } else {
      snippet.accessCount++;
      saveDb(db);
      console.log(snippet.content);
    }
    break;
  }

  case 'list': {
    const tag = getArg(args, 'tag');
    const category = getArg(args, 'category');
    const db = loadDb();
    
    let snippets = Object.values(db.snippets);
    if (tag) snippets = snippets.filter(s => s.tags.includes(tag));
    if (category) snippets = snippets.filter(s => s.category === category);
    
    snippets.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    
    if (snippets.length === 0) {
      console.log('No snippets found.');
    } else {
      for (const s of snippets) {
        const tags = s.tags.length ? ` [${s.tags.join(', ')}]` : '';
        const preview = s.content.length > 60 ? s.content.slice(0, 60) + '...' : s.content;
        console.log(`📋 ${s.name} (${s.category})${tags}`);
        console.log(`   ${preview.replace(/\n/g, ' ')}`);
      }
      console.log(`\n${snippets.length} snippet(s)`);
    }
    break;
  }

  case 'search': {
    const query = args.join(' ').toLowerCase();
    if (!query) { console.error('Usage: search <query>'); process.exit(1); }
    
    const db = loadDb();
    const matches = Object.values(db.snippets).filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.content.toLowerCase().includes(query) ||
      s.tags.some(t => t.toLowerCase().includes(query))
    );
    
    if (matches.length === 0) {
      console.log('No matches found.');
    } else {
      for (const s of matches) {
        const tags = s.tags.length ? ` [${s.tags.join(', ')}]` : '';
        const preview = s.content.length > 80 ? s.content.slice(0, 80) + '...' : s.content;
        console.log(`📋 ${s.name} (${s.category})${tags}`);
        console.log(`   ${preview.replace(/\n/g, ' ')}`);
      }
      console.log(`\n${matches.length} match(es)`);
    }
    break;
  }

  case 'delete': {
    const name = args[0];
    if (!name) { console.error('Usage: delete <name>'); process.exit(1); }
    
    const db = loadDb();
    if (!db.snippets[name]) {
      console.error(`Snippet not found: ${name}`);
      process.exit(1);
    }
    
    delete db.snippets[name];
    saveDb(db);
    console.log(`🗑️ Deleted snippet: ${name}`);
    break;
  }

  case 'tags': {
    const db = loadDb();
    const tagCounts = {};
    for (const s of Object.values(db.snippets)) {
      for (const tag of s.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
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
    for (const [name, snippet] of Object.entries(imported.snippets || imported)) {
      if (!db.snippets[name]) {
        db.snippets[name] = snippet;
        count++;
      }
    }
    
    saveDb(db);
    console.log(`📥 Imported ${count} snippet(s)`);
    break;
  }

  case 'stats': {
    const db = loadDb();
    const snippets = Object.values(db.snippets);
    const totalSize = snippets.reduce((sum, s) => sum + s.content.length, 0);
    const categories = {};
    snippets.forEach(s => categories[s.category] = (categories[s.category] || 0) + 1);
    
    console.log(JSON.stringify({
      total: snippets.length,
      totalChars: totalSize,
      categories,
      mostAccessed: snippets.sort((a, b) => b.accessCount - a.accessCount).slice(0, 5).map(s => ({ name: s.name, accesses: s.accessCount })),
    }, null, 2));
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Commands: save, get, list, search, delete, tags, export, import, stats');
    process.exit(1);
}
