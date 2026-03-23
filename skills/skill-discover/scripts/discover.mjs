#!/usr/bin/env node
/**
 * skill-discover: Search installed OpenClaw skills by keyword.
 * Usage:
 *   node discover.mjs <query>           -- full-text search
 *   node discover.mjs --list             -- list all skills
 *   node discover.mjs --json <query>     -- JSON output
 *   node discover.mjs --category <tag>   -- filter by category
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Navigate up to workspace root, then scan for skills/*/SKILL.md
// scripts/discover.mjs → skill-discover/ → skills/ → workspace/
const WORKSPACE = resolve(import.meta.dirname, '..', '..', '..');
const SCAN_DIRS = [
  join(WORKSPACE, 'skills'),
  join(WORKSPACE, '.openclaw', 'skills'),
];

// Parse YAML frontmatter from SKILL.md
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let currentVal = '';
  let isMultiline = false;

  for (const line of lines) {
    // Check for YAML key (not indented)
    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (keyMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Flush previous
      if (currentKey && currentVal) {
        fm[currentKey] = currentVal.trim();
      }
      currentKey = keyMatch[1];
      const val = keyMatch[2];

      if (val === '>' || val === '|') {
        isMultiline = true;
        currentVal = '';
      } else if (val.startsWith('"') || val.startsWith("'")) {
        currentVal = val.slice(1, val.endsWith('"') || val.endsWith("'") ? -1 : undefined);
        isMultiline = false;
      } else {
        currentVal = val;
        isMultiline = false;
      }
    } else if (isMultiline && (line.startsWith('  ') || line.startsWith('\t'))) {
      currentVal += (currentVal ? ' ' : '') + line.trim();
    }
  }
  // Flush last
  if (currentKey && currentVal) {
    fm[currentKey] = currentVal.trim();
  }

  return fm;
}

// Simple relevance scoring
function scoreMatch(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);

  let score = 0;

  // Exact phrase match
  if (t.includes(q)) score += 50;

  // Word-level matches
  for (const w of words) {
    if (t.includes(w)) score += 10;
    // Boost for name matches
    if (text.startsWith('#') && t.includes(w)) score += 20;
  }

  return score;
}

async function discover(query = null, opts = {}) {
  const { json = false, list = false, category = null } = opts;

  // Find all skill directories
  const skills = [];

  for (const dir of SCAN_DIRS) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { continue; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = join(dir, entry.name, 'SKILL.md');
      let content;
      try {
        content = await readFile(skillMd, 'utf-8');
      } catch { continue; }

      const fm = parseFrontmatter(content);
      let name, description;
      if (fm && fm.name) {
        name = fm.name;
        description = fm.description || '(no description)';
      } else {
        // Fallback: parse from first heading + first paragraph
        const heading = content.match(/^#\s+(.+)/m);
        const desc = content.match(/^#\s+.+\n+\s*(.+)/m);
        name = heading ? heading[1].replace(/[^\w\s-]/g, '').trim() : entry.name;
        description = desc ? desc[1].slice(0, 200) : '(no description)';
      }

      skills.push({
        name,
        dir: entry.name,
        description,
        path: skillMd,
      });
    }
  }

  if (list || !query) {
    if (json) {
      console.log(JSON.stringify(skills, null, 2));
      return;
    }
    console.log(`\n📚 Installed Skills (${skills.length}):\n`);
    for (const s of skills) {
      console.log(`  • ${s.name.padEnd(22)} ${s.description.slice(0, 80)}`);
    }
    console.log('');
    return;
  }

  // Score and rank
  const scored = skills.map(s => ({
    ...s,
    score: scoreMatch(`${s.name} ${s.description}`, query),
  })).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  if (json) {
    console.log(JSON.stringify(scored, null, 2));
    return;
  }

  if (scored.length === 0) {
    console.log(`\n❌ No skills found for: "${query}"\n`);
    console.log('Try: node discover.mjs --list\n');
    return;
  }

  console.log(`\n🔍 Results for "${query}" (${scored.length} matches):\n`);
  for (const s of scored.slice(0, 10)) {
    const bar = '█'.repeat(Math.min(10, Math.round(s.score / 5)));
    console.log(`  ${s.name.padEnd(22)} ${s.score.toString().padStart(3)}pts ${bar}`);
    console.log(`  ${' '.repeat(22)} ${s.description.slice(0, 100)}`);
    console.log('');
  }
}

// CLI
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));

if (flags.has('--help') || flags.has('-h')) {
  console.log(`
skill-discover: Find the right skill for the job

Usage:
  node discover.mjs <query>        Search skills by keyword
  node discover.mjs --list         List all installed skills
  node discover.mjs --json <query> JSON output

Examples:
  node discover.mjs url
  node discover.mjs "web scrape"
  node discover.mjs pdf
  node discover.mjs --list
  node discover.mjs --json crypto
`);
  process.exit(0);
}

const query = positional.join(' ') || null;
discover(query, {
  list: flags.has('--list'),
  json: flags.has('--json'),
  category: flags.has('--category') ? positional[0] : null,
});
