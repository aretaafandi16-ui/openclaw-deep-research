# Summarizer Skill

Fetch URLs or paste text, extract readable content, and produce concise markdown summaries.

## Capabilities

- **URL Summarization**: Fetch any URL, extract text, generate summary
- **Text Summarization**: Paste long text, get concise output
- **Batch Processing**: Process multiple URLs from a file
- **Disk Cache**: Cache fetched content (1h TTL) to avoid re-fetching
- **Format Options**: Bullet points, paragraph, or structured outline
- **Deep Mode**: More detailed extraction with key quotes
- **Content Scoring**: Quality score, reading time, vocabulary richness

## Usage

```bash
# Summarize a URL (default: bullets, max 300 chars summary per section)
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs "https://example.com/article"

# Summarize with paragraph format
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs "https://example.com" --format paragraph

# Deep extraction (get more raw content for LLM processing)
node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs "https://example.com" --deep

# Summarize from stdin (pipe text in)
echo "Long text here..." | node ~/.openclaw/workspace/skills/summarizer/scripts/summarize.mjs --stdin

# Batch processing (one URL per line, # comments supported)
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
| `--batch <file>` | - | Process URLs from a text file (one per line) |
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
- Uses `web_fetch` tool content under the hood (via OpenClaw tools)

## Status

- [x] URL fetching + text extraction
- [x] Format options (bullets, paragraph, outline)
- [x] Batch URL processing
- [x] Disk cache layer (1h TTL)
- [x] Content quality scoring (word count, reading time, vocab richness, quality 0-100)
- [ ] PDF summarization support
