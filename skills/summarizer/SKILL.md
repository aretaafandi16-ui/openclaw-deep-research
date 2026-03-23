# Summarizer Skill

Fetch URLs or paste text, extract readable content, and produce concise markdown summaries.

## Capabilities

- **URL Summarization**: Fetch any URL, extract text, generate summary
- **Text Summarization**: Paste long text, get concise output
- **Format Options**: Bullet points, paragraph, or structured outline
- **Deep Mode**: More detailed extraction with key quotes

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
```

## Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `--format` | bullets | Output format: bullets, paragraph, outline |
| `--max-chars` | 8000 | Max chars to extract before summarizing |
| `--deep` | false | Full extraction (no truncation) |
| `--stdin` | false | Read text from stdin instead of URL |
| `--output` | stdout | Write to file instead of stdout |

## For LLM Use

The script outputs clean extracted text. For actual summarization, pair with the `image` or `pdf` tools for rich content, or feed extracted text directly to the LLM's own summarization capability.

## Dependencies

- Node.js (built-in `fetch` + `node:readline`)
- Uses `web_fetch` tool content under the hood (via OpenClaw tools)

## Status

- [x] URL fetching + text extraction
- [x] Format options (bullets, paragraph, outline)
- [ ] PDF summarization support
- [ ] Batch URL processing
- [ ] Cache layer for repeated URLs
