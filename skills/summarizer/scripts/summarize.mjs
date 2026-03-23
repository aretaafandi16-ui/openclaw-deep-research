#!/usr/bin/env node
/**
 * summarize.mjs — URL/text summarizer utility
 * Fetches URLs, extracts readable text, or reads from stdin.
 * Outputs clean markdown suitable for LLM summarization or direct use.
 */

import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// --- Arg parsing ---
const args = process.argv.slice(2);
let url = null;
let format = 'bullets';
let maxChars = 8000;
let deep = false;
let useStdin = false;
let outputFile = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--format' && args[i + 1]) { format = args[++i]; }
  else if (a === '--max-chars' && args[i + 1]) { maxChars = parseInt(args[++i], 10); }
  else if (a === '--deep') { deep = true; }
  else if (a === '--stdin') { useStdin = true; }
  else if (a === '--output' && args[i + 1]) { outputFile = args[++i]; }
  else if (a === '--help' || a === '-h') {
    console.log(`Usage: summarize.mjs [URL] [options]

Options:
  --format <bullets|paragraph|outline>  Output format (default: bullets)
  --max-chars <n>                       Max chars to extract (default: 8000)
  --deep                                Full extraction, no truncation
  --stdin                               Read from stdin instead of URL
  --output <file>                       Write to file instead of stdout
  -h, --help                            Show this help`);
    process.exit(0);
  }
  else if (!a.startsWith('-')) { url = a; }
}

// --- Read stdin ---
async function readStdin() {
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join('\n');
}

// --- Fetch URL content via readability extraction ---
async function fetchUrl(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SummarizerBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();

    // Basic HTML stripping (lightweight readability)
    let text = raw;
    if (contentType.includes('html') || contentType.includes('xml')) {
      text = extractFromHtml(raw);
    }

    return { text, contentType, status: res.status, url: targetUrl };
  } catch (err) {
    return { error: err.message, url: targetUrl };
  }
}

// --- Lightweight HTML → text extraction ---
function extractFromHtml(html) {
  // Remove script/style blocks
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Common block-level elements get newlines
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|article|section|blockquote|pre|br)>/gi, '\n');

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');

  // Clean up whitespace
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

// --- Format output ---
function formatOutput(text, fmt, maxLen) {
  const trimmed = maxLen && !deep ? text.slice(0, maxLen) : text;
  const truncated = maxLen && !deep && text.length > maxLen;

  switch (fmt) {
    case 'paragraph': {
      // Collapse to paragraph
      const para = trimmed.replace(/\n{2,}/g, '\n\n').trim();
      return para + (truncated ? '\n\n[...truncated]' : '');
    }
    case 'outline': {
      // Split on headers or paragraph breaks, make outline
      const sections = trimmed.split(/\n{2,}/).filter(s => s.trim());
      const outline = sections.map((s, i) => {
        const firstLine = s.trim().split('\n')[0].slice(0, 80);
        return `- **${firstLine}**`;
      }).join('\n');
      return outline + (truncated ? '\n\n[...truncated]' : '');
    }
    case 'bullets':
    default: {
      // Split into sentences, make bullets
      const sentences = trimmed
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 20);
      const bullets = sentences.slice(0, 20).map(s => `- ${s}`).join('\n');
      return bullets + (truncated ? '\n\n[...truncated]' : '');
    }
  }
}

// --- Main ---
async function main() {
  let text;
  let meta = {};

  if (useStdin || (!url && !process.stdin.isTTY)) {
    text = await readStdin();
    meta.source = 'stdin';
  } else if (url) {
    // Check if it's a file path
    if (!url.startsWith('http')) {
      try {
        text = await readFile(url, 'utf-8');
        meta.source = `file:${url}`;
      } catch {
        // Treat as URL anyway
        url = url.startsWith('http') ? url : `https://${url}`;
        const result = await fetchUrl(url);
        if (result.error) {
          console.error(`Error fetching ${url}: ${result.error}`);
          process.exit(1);
        }
        text = result.text;
        meta = { source: result.url, contentType: result.contentType, status: result.status };
      }
    } else {
      const result = await fetchUrl(url);
      if (result.error) {
        console.error(`Error fetching ${url}: ${result.error}`);
        process.exit(1);
      }
      text = result.text;
      meta = { source: result.url, contentType: result.contentType, status: result.status };
    }
  } else {
    console.error('No URL or stdin provided. Use --help for usage.');
    process.exit(1);
  }

  if (!text || text.trim().length === 0) {
    console.error('No content extracted.');
    process.exit(1);
  }

  // Output metadata header
  const header = [
    `# Extracted Content`,
    '',
    meta.source ? `**Source:** ${meta.source}` : null,
    meta.contentType ? `**Type:** ${meta.contentType}` : null,
    `**Length:** ${text.length} chars`,
    '',
    '---',
    '',
  ].filter(Boolean).join('\n');

  const formatted = formatOutput(text, format, deep ? null : maxChars);
  const output = header + formatted;

  if (outputFile) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outputFile, output, 'utf-8');
    console.error(`Written to ${outputFile}`);
  } else {
    console.log(output);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
