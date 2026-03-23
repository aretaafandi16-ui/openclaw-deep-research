#!/usr/bin/env node
/**
 * transform.mjs — Text transformation tool for text-processor skill
 * Usage: echo '...' | node transform.mjs <command> [args]
 * Commands: dedup, sort, sort -n, reverse, shuffle, head N, tail N,
 *           grep PATTERN, grep -v PATTERN, count, slugify, uppercase,
 *           lowercase, titlecase, truncate N, wrap N, trim, squeeze, wordwrap N
 */

import { readFileSync } from 'fs';

const args = process.argv.slice(2);
let command = args[0];
let param = args[1];

// Handle "sort -n" style
if (command === 'sort' && param === '-n') {
  command = 'sortn';
  param = args[2];
}

let input;
try {
  input = readFileSync('/dev/stdin', 'utf8');
} catch {
  input = '';
}

if (!input && command !== 'count') {
  process.exit(0);
}

const lines = input.split('\n');
// Remove trailing empty line from split
if (lines[lines.length - 1] === '') lines.pop();

switch (command) {
  case 'dedup': {
    const seen = new Set();
    const result = lines.filter(l => {
      if (seen.has(l)) return false;
      seen.add(l);
      return true;
    });
    console.log(result.join('\n'));
    break;
  }

  case 'sort':
    console.log([...lines].sort().join('\n'));
    break;

  case 'sortn':
    console.log([...lines].sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    }).join('\n'));
    break;

  case 'reverse':
    console.log([...lines].reverse().join('\n'));
    break;

  case 'shuffle': {
    const arr = [...lines];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    console.log(arr.join('\n'));
    break;
  }

  case 'head':
    console.log(lines.slice(0, parseInt(param) || 10).join('\n'));
    break;

  case 'tail': {
    const n = parseInt(param) || 10;
    console.log(lines.slice(-n).join('\n'));
    break;
  }

  case 'grep': {
    const invert = param === '-v';
    const pattern = invert ? args[2] : param;
    if (!pattern) { console.error('Usage: grep [-v] PATTERN'); process.exit(1); }
    const regex = new RegExp(pattern, 'i');
    console.log(lines.filter(l => invert ? !regex.test(l) : regex.test(l)).join('\n'));
    break;
  }

  case 'count': {
    const text = input.trim();
    const lineCount = text ? lines.length : 0;
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const charCount = text.length;
    console.log(JSON.stringify({ lines: lineCount, words: wordCount, chars: charCount }, null, 2));
    break;
  }

  case 'slugify':
    console.log(
      input.trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    );
    break;

  case 'uppercase':
    console.log(input.toUpperCase());
    break;

  case 'lowercase':
    console.log(input.toLowerCase());
    break;

  case 'titlecase':
    console.log(input.replace(/\w\S*/g, txt =>
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    ));
    break;

  case 'truncate': {
    const n = parseInt(param) || 100;
    console.log(lines.map(l => l.length > n ? l.slice(0, n) + '...' : l).join('\n'));
    break;
  }

  case 'wrap': {
    const width = parseInt(param) || 80;
    const result = [];
    for (const line of lines) {
      if (line.length <= width) { result.push(line); continue; }
      let remaining = line;
      while (remaining.length > width) {
        let breakAt = remaining.lastIndexOf(' ', width);
        if (breakAt <= 0) breakAt = width;
        result.push(remaining.slice(0, breakAt));
        remaining = remaining.slice(breakAt).trimStart();
      }
      if (remaining) result.push(remaining);
    }
    console.log(result.join('\n'));
    break;
  }

  case 'trim':
    console.log(lines.map(l => l.trim()).join('\n'));
    break;

  case 'squeeze': {
    let prev = '';
    const result = [];
    for (const line of lines) {
      if (line.trim() === '' && prev.trim() === '') continue;
      result.push(line);
      prev = line;
    }
    console.log(result.join('\n'));
    break;
  }

  case 'strip-ansi':
    console.log(input.replace(/\x1b\[[0-9;]*m/g, ''));
    break;

  case 'wordcount':
  case 'wc': {
    const text = input.trim();
    console.log(`${lines.length} ${text.split(/\s+/).filter(Boolean).length} ${text.length}`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Commands: dedup, sort, sort -n, reverse, shuffle, head N, tail N,');
    console.error('  grep [-v] PATTERN, count, slugify, uppercase, lowercase,');
    console.error('  titlecase, truncate N, wrap N, trim, squeeze, strip-ansi, wc');
    process.exit(1);
}
