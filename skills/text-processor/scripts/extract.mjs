#!/usr/bin/env node
/**
 * extract.mjs — Text extraction tool for text-processor skill
 * Usage: echo '...' | node extract.mjs <command> [pattern]
 * Commands: emails, urls, phones, ips, hashtags, mentions, numbers, json-urls, regex PATTERN
 */

import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const command = args[0];
const param = args.slice(1).join(' ');

let input;
try {
  input = readFileSync('/dev/stdin', 'utf8');
} catch {
  console.error('Error: No input. Pipe text via stdin.');
  process.exit(1);
}

if (!input.trim()) {
  process.exit(0);
}

const patterns = {
  emails: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  urls: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
  phones: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
  ips: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  hashtags: /#[a-zA-Z_]\w*/g,
  mentions: /@[a-zA-Z_]\w*/g,
  numbers: /-?\b\d+\.?\d*\b/g,
  'json-urls': /"(?:url|href|link|src|image|avatar)":\s*"(https?:\/\/[^"]+)"/g,
};

switch (command) {
  case 'emails':
  case 'urls':
  case 'phones':
  case 'ips':
  case 'hashtags':
  case 'mentions':
  case 'numbers':
  case 'json-urls': {
    const matches = [...input.matchAll(patterns[command])];
    const unique = [...new Set(matches.map(m => m[command === 'json-urls' ? 1 : 0]))];
    console.log(unique.join('\n'));
    break;
  }

  case 'domains': {
    const emailMatches = [...input.matchAll(patterns.emails)];
    const urlMatches = [...input.matchAll(patterns.urls)];
    const domains = new Set();
    emailMatches.forEach(m => domains.add(m[0].split('@')[1]));
    urlMatches.forEach(m => {
      try { domains.add(new URL(m[0]).hostname); } catch {}
    });
    console.log([...domains].sort().join('\n'));
    break;
  }

  case 'dates': {
    // ISO dates, US dates, common formats
    const datePatterns = [
      /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi,
      /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/gi,
    ];
    const dates = new Set();
    datePatterns.forEach(p => {
      [...input.matchAll(p)].forEach(m => dates.add(m[0]));
    });
    console.log([...dates].sort().join('\n'));
    break;
  }

  case 'code-blocks': {
    const blocks = [...input.matchAll(/```(\w*)\n([\s\S]*?)```/g)];
    blocks.forEach((m, i) => {
      console.log(`--- Block ${i + 1}${m[1] ? ` (${m[1]})` : ''} ---`);
      console.log(m[2].trim());
      console.log();
    });
    break;
  }

  case 'headers': {
    const headers = [...input.matchAll(/^(#{1,6})\s+(.+)$/gm)];
    headers.forEach(m => {
      const level = m[1].length;
      console.log(`${'  '.repeat(level - 1)}${m[2]}`);
    });
    break;
  }

  case 'links': {
    const links = [...input.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    if (links.length === 0) {
      // Fall back to plain URLs
      const urls = [...input.matchAll(patterns.urls)];
      console.log(urls.map(m => m[0]).join('\n'));
    } else {
      links.forEach(m => console.log(`${m[1]} → ${m[2]}`));
    }
    break;
  }

  case 'words': {
    const words = input.toLowerCase().match(/\b[a-zA-Z]{2,}\b/g) || [];
    const freq = {};
    words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const limit = parseInt(param) || 20;
    sorted.slice(0, limit).forEach(([word, count]) => console.log(`${count}\t${word}`));
    break;
  }

  case 'regex': {
    if (!param) { console.error('Usage: regex PATTERN'); process.exit(1); }
    try {
      const regex = new RegExp(param, 'g');
      const matches = [...input.matchAll(regex)];
      const unique = [...new Set(matches.map(m => m[0]))];
      console.log(unique.join('\n'));
    } catch (e) {
      console.error(`Invalid regex: ${e.message}`);
      process.exit(1);
    }
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Commands: emails, urls, phones, ips, hashtags, mentions, numbers,');
    console.error('  json-urls, domains, dates, code-blocks, headers, links, words, regex PATTERN');
    process.exit(1);
}
