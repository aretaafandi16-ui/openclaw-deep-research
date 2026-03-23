#!/usr/bin/env node
/**
 * Web Monitor — Track website content changes
 * Usage:
 *   node monitor.mjs add <url> --name="Label" [--selector="css"] [--threshold=0]
 *   node monitor.mjs list
 *   node monitor.mjs check [--name="Label"]
 *   node monitor.mjs remove <name>
 *   node monitor.mjs history <name> [--limit=10]
 *   node monitor.mjs snapshot <name>
 *   node monitor.mjs clear
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const MONITORS_FILE = join(DATA_DIR, 'monitors.json');
const SNAPSHOTS_DIR = join(DATA_DIR, 'snapshots');
const HISTORY_DIR = join(DATA_DIR, 'history');

// Ensure directories exist
for (const dir of [DATA_DIR, SNAPSHOTS_DIR, HISTORY_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Data helpers ---

function loadMonitors() {
  if (!existsSync(MONITORS_FILE)) return { monitors: [] };
  try {
    return JSON.parse(readFileSync(MONITORS_FILE, 'utf-8'));
  } catch {
    return { monitors: [] };
  }
}

function saveMonitors(data) {
  writeFileSync(MONITORS_FILE, JSON.stringify(data, null, 2));
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function formatTimestamp(ts) {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function getSnapshotPath(name) {
  const slug = slugify(name);
  return join(SNAPSHOTS_DIR, `${slug}.json`);
}

function getHistoryPath(name) {
  const slug = slugify(name);
  return join(HISTORY_DIR, `${slug}.jsonl`);
}

// --- Fetch with basic extraction ---

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OpenClaw-WebMonitor/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const html = await res.text();
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

function extractText(html, selector) {
  // Simple HTML text extraction (no DOM parser dependency)
  let content = html;
  
  if (selector) {
    // Basic CSS selector support: tag, .class, #id
    const sel = selector.trim();
    let pattern;
    
    if (sel.startsWith('#')) {
      // ID selector
      const id = sel.slice(1);
      pattern = new RegExp(`<[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
    } else if (sel.startsWith('.')) {
      // Class selector
      const cls = sel.slice(1);
      pattern = new RegExp(`<[^>]*class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
    } else {
      // Tag selector
      pattern = new RegExp(`<${sel}[^>]*>([\\s\\S]*?)<\\/${sel}>`, 'i');
    }
    
    const match = html.match(pattern);
    if (match) {
      content = match[0];
    }
  }
  
  // Strip script/style tags
  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  
  // Strip HTML tags
  content = content.replace(/<[^>]+>/g, ' ');
  
  // Normalize whitespace
  content = content.replace(/\s+/g, ' ').trim();
  
  return content;
}

function computeDiff(oldText, newText) {
  if (oldText === newText) return null;
  
  // Simple diff: find added/removed content
  const oldLines = oldText.split('\n').filter(l => l.trim());
  const newLines = newText.split('\n').filter(l => l.trim());
  
  const added = newLines.filter(l => !oldLines.includes(l));
  const removed = oldLines.filter(l => !newLines.includes(l));
  
  // Character-level summary
  const oldLen = oldText.length;
  const newLen = newText.length;
  const pctChange = oldLen > 0 ? Math.abs(newLen - oldLen) / oldLen * 100 : 100;
  
  return {
    added: added.length,
    removed: removed.length,
    oldLength: oldLen,
    newLength: newLen,
    lengthDiff: newLen - oldLen,
    percentChange: Math.round(pctChange * 10) / 10,
    addedPreview: added.slice(0, 3).map(l => l.slice(0, 100)),
    removedPreview: removed.slice(0, 3).map(l => l.slice(0, 100)),
  };
}

// --- Snapshot management ---

function loadSnapshot(name) {
  const path = getSnapshotPath(name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function saveSnapshot(name, data) {
  writeFileSync(getSnapshotPath(name), JSON.stringify(data, null, 2));
}

function appendHistory(name, entry) {
  const path = getHistoryPath(name);
  const line = JSON.stringify(entry) + '\n';
  // Append to file
  const { appendFileSync } = await import('fs');
  appendFileSync(path, line);
}

// --- Commands ---

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v !== undefined ? v : true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

if (command === 'add') {
  const { flags, positional } = parseFlags(args.slice(1));
  const url = positional[0];
  
  if (!url) {
    console.error('Usage: node monitor.mjs add <url> --name="Label" [--selector="css"] [--threshold=0]');
    process.exit(1);
  }
  
  const name = flags.name || new URL(url).hostname;
  const selector = flags.selector || null;
  const threshold = parseInt(flags.threshold) || 0;
  
  const data = loadMonitors();
  
  // Check for duplicates
  if (data.monitors.find(m => m.name === name)) {
    console.error(`❌ Monitor "${name}" already exists. Remove it first or use a different name.`);
    process.exit(1);
  }
  
  const monitor = {
    name,
    url,
    selector,
    threshold,
    createdAt: Date.now(),
    lastChecked: null,
    lastChanged: null,
    checkCount: 0,
    changeCount: 0,
  };
  
  data.monitors.push(monitor);
  saveMonitors(data);
  
  console.log(`✅ Added monitor: ${name}`);
  console.log(`   URL: ${url}`);
  if (selector) console.log(`   Selector: ${selector}`);
  console.log(`\nRun: node monitor.mjs check --name="${name}"`);

} else if (command === 'list') {
  const data = loadMonitors();
  
  if (data.monitors.length === 0) {
    console.log('No monitors configured. Use: node monitor.mjs add <url> --name="Label"');
    process.exit(0);
  }
  
  console.log(`\n🌐 Web Monitors (${data.monitors.length})\n`);
  
  for (const m of data.monitors) {
    const lastChecked = m.lastChecked ? formatTimestamp(m.lastChecked) : 'never';
    const lastChanged = m.lastChanged ? formatTimestamp(m.lastChanged) : 'never';
    
    console.log(`📌 ${m.name}`);
    console.log(`   URL: ${m.url}`);
    if (m.selector) console.log(`   Selector: ${m.selector}`);
    console.log(`   Last checked: ${lastChecked} | Last changed: ${lastChanged}`);
    console.log(`   Checks: ${m.checkCount} | Changes detected: ${m.changeCount}`);
    console.log('');
  }

} else if (command === 'check') {
  const { flags } = parseFlags(args.slice(1));
  const data = loadMonitors();
  const targetName = flags.name;
  
  const monitors = targetName
    ? data.monitors.filter(m => m.name === targetName)
    : data.monitors;
  
  if (monitors.length === 0) {
    console.error(targetName ? `Monitor "${targetName}" not found.` : 'No monitors configured.');
    process.exit(1);
  }
  
  console.log(`\n🔍 Checking ${monitors.length} monitor(s)...\n`);
  
  let changesDetected = 0;
  
  for (const monitor of monitors) {
    process.stdout.write(`   ${monitor.name}... `);
    
    try {
      const html = await fetchPage(monitor.url);
      const text = extractText(html, monitor.selector);
      const hash = hashContent(text);
      const timestamp = Date.now();
      
      const oldSnapshot = loadSnapshot(monitor.name);
      
      // Save new snapshot
      saveSnapshot(monitor.name, {
        name: monitor.name,
        url: monitor.url,
        hash,
        length: text.length,
        timestamp,
        textPreview: text.slice(0, 500),
      });
      
      monitor.lastChecked = timestamp;
      monitor.checkCount++;
      
      if (!oldSnapshot) {
        console.log('📸 First snapshot taken');
      } else if (oldSnapshot.hash === hash) {
        console.log('✅ No changes');
      } else {
        const diff = computeDiff(oldSnapshot.textPreview || '', text.slice(0, 500));
        
        if (diff && diff.percentChange >= (monitor.threshold || 0)) {
          monitor.lastChanged = timestamp;
          monitor.changeCount++;
          changesDetected++;
          
          console.log(`🔄 CHANGED! (${diff.percentChange}% different)`);
          if (diff.addedPreview.length > 0) {
            console.log(`   + Added: ${diff.addedPreview[0].slice(0, 80)}`);
          }
          if (diff.removedPreview.length > 0) {
            console.log(`   - Removed: ${diff.removedPreview[0].slice(0, 80)}`);
          }
          
          // Log to history
          const historyEntry = {
            timestamp,
            name: monitor.name,
            url: monitor.url,
            hash,
            diff,
          };
          
          try {
            const { appendFileSync } = await import('fs');
            appendFileSync(getHistoryPath(monitor.name), JSON.stringify(historyEntry) + '\n');
          } catch (e) {
            console.error(`   ⚠️ Failed to write history: ${e.message}`);
          }
        } else {
          console.log(`✅ Minor change (${diff?.percentChange || 0}%, below threshold)`);
        }
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
  }
  
  // Save updated monitor stats
  saveMonitors(data);
  
  if (changesDetected > 0) {
    console.log(`\n⚠️ ${changesDetected} change(s) detected!`);
  } else {
    console.log('\n✅ All clear.');
  }

} else if (command === 'remove') {
  const { positional } = parseFlags(args.slice(1));
  const name = positional[0];
  
  if (!name) {
    console.error('Usage: node monitor.mjs remove <name>');
    process.exit(1);
  }
  
  const data = loadMonitors();
  const idx = data.monitors.findIndex(m => m.name === name || slugify(m.name) === slugify(name));
  
  if (idx === -1) {
    console.error(`Monitor "${name}" not found.`);
    process.exit(1);
  }
  
  const removed = data.monitors.splice(idx, 1)[0];
  saveMonitors(data);
  
  // Clean up snapshot (keep history for reference)
  const snapPath = getSnapshotPath(removed.name);
  if (existsSync(snapPath)) {
    const { unlinkSync } = await import('fs');
    try { unlinkSync(snapPath); } catch {}
  }
  
  console.log(`🗑️ Removed monitor: ${removed.name}`);

} else if (command === 'history') {
  const { flags, positional } = parseFlags(args.slice(1));
  const name = positional[0];
  const limit = parseInt(flags.limit) || 10;
  
  if (!name) {
    console.error('Usage: node monitor.mjs history <name> [--limit=10]');
    process.exit(1);
  }
  
  const data = loadMonitors();
  const monitor = data.monitors.find(m => m.name === name || slugify(m.name) === slugify(name));
  const monitorName = monitor ? monitor.name : name;
  
  const histPath = getHistoryPath(monitorName);
  if (!existsSync(histPath)) {
    console.log(`No change history for "${monitorName}".`);
    process.exit(0);
  }
  
  const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
  const entries = lines.slice(-limit).map(l => JSON.parse(l));
  
  console.log(`\n📜 Change History: ${monitorName} (last ${entries.length})\n`);
  
  for (const entry of entries) {
    console.log(`  ${formatTimestamp(entry.timestamp)}`);
    if (entry.diff) {
      console.log(`    +${entry.diff.added} / -${entry.diff.removed} lines (${entry.diff.percentChange}% change)`);
    }
    console.log('');
  }

} else if (command === 'snapshot') {
  const { positional } = parseFlags(args.slice(1));
  const name = positional[0];
  
  if (!name) {
    console.error('Usage: node monitor.mjs snapshot <name>');
    process.exit(1);
  }
  
  const data = loadMonitors();
  const monitor = data.monitors.find(m => m.name === name || slugify(m.name) === slugify(name));
  
  if (!monitor) {
    console.error(`Monitor "${name}" not found.`);
    process.exit(1);
  }
  
  console.log(`📸 Taking snapshot: ${monitor.name}`);
  
  const html = await fetchPage(monitor.url);
  const text = extractText(html, monitor.selector);
  const hash = hashContent(text);
  
  saveSnapshot(monitor.name, {
    name: monitor.name,
    url: monitor.url,
    hash,
    length: text.length,
    timestamp: Date.now(),
    textPreview: text.slice(0, 500),
  });
  
  console.log(`✅ Snapshot saved (${text.length} chars, hash: ${hash})`);

} else if (command === 'clear') {
  saveMonitors({ monitors: [] });
  console.log('🗑️ All monitors cleared.');

} else {
  console.log(`
Web Monitor — Track website content changes

Commands:
  add <url> --name="Label"    Add a URL to monitor
  list                        List all monitors
  check [--name="Label"]      Check for changes
  remove <name>               Remove a monitor
  history <name> [--limit=N]  View change history
  snapshot <name>             Take a manual snapshot
  clear                       Remove all monitors

Examples:
  node monitor.mjs add "https://example.com" --name="Example"
  node monitor.mjs add "https://example.com/pricing" --selector=".price-table"
  node monitor.mjs check
  node monitor.mjs history "Example" --limit=20
  `);
}
