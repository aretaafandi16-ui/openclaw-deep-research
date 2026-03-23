# Summarizer Skill

Fetch URLs, extract text from PDFs, or paste text — get concise markdown summaries.

## Capabilities

- **URL Summarization**: Fetch any URL, extract text, generate summary
- **PDF Summarization**: Extract text from local PDF files or PDF URLs
- **Text Summarization**: Paste long text, get concise output
- **Batch Processing**: Process multiple URLs/PDFs from a file
- **Disk Cache**: Cache fetched content (1h TTL) to avoid re-fetching
- **Format Options**: Bullet points, paragraph, or structured outline
- **Deep Mode**: More detailed extraction with key quotes
- **Content Scoring**: Quality score, reading time, vocabulary richness

## Usage

```bash
# Summarize a URL (default: bullets, max 300 chars summary per section)
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs "https://example.com/article"

# Summarize a local PDF
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs document.pdf

# Summarize a PDF from URL
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs "https://example.com/paper.pdf"

# Summarize with paragraph format
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs "https://example.com" --format paragraph

# Deep extraction (get more raw content for LLM processing)
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs "https://example.com" --deep

# Summarize from stdin (pipe text in)
echo "Long text here..." | node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs --stdin

# Batch processing (mix of URLs and PDF paths, one per line)
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs --batch urls.txt --output batch-results.md

# Enable disk cache (avoids re-fetching within 1 hour)
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs "https://example.com" --cache

# Clear cache
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs --clear-cache
```

## Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `--format` | bullets | Output format: bullets, paragraph, outline |
| `--max-chars` | 8000 | Max chars to extract before summarizing |
| `--deep` | false | Full extraction (no truncation) |
| `--stdin` | false | Read text from stdin instead of URL |
| `--batch <file>` | - | Process URLs/PDFs from a text file (one per line) |
| `--cache` | false | Enable disk cache (1h TTL, /tmp/summarizer-cache) |
| `--cache-dir <path>` | /tmp/summarizer-cache | Custom cache directory |
| `--clear-cache` | - | Clear all cached entries and exit |
| `--score` | true | Show content quality metrics (word count, reading time, quality score) |
| `--no-score` | false | Hide quality metrics |
| `--output` | stdout | Write to file instead of stdout |

## For LLM Use

The script outputs clean extracted text. For actual summarization, pair with the `image` or `pdf` tools for rich content, or feed extracted text directly to the LLM's own summarization capability.

## Dependencies

- Node.js (built-in `fetch` + `node:readline` + `node:crypto`)
- `pdf2json` (for PDF text extraction)
- Uses `web_fetch` tool content under the hood (via OpenClaw tools)

## Status

- [x] URL fetching + text extraction
- [x] Format options (bullets, paragraph, outline)
- [x] Batch URL processing
- [x] Disk cache layer (1h TTL)
- [x] Content quality scoring (word count, reading time, vocab richness, quality 0-100)
- [x] PDF summarization (local files + URLs)
