---
name: text-processor
description: >
  Convert between data formats (JSON, CSV, YAML, markdown tables) and perform text
  transformations (dedup, sort, extract, template). Use when: converting data between
  formats, extracting structured data from text, generating markdown tables from data,
  deduplicating or sorting lists, applying text templates, or transforming raw data into
  readable reports. NOT for: web scraping (use web-monitor), research (use deep-research).
---

# Text Processor 🔧

Format conversion and text transformation toolkit for agents.

## Capabilities

- **Format conversion** — JSON ↔ CSV ↔ Markdown Table ↔ YAML
- **Text extraction** — Regex patterns, email/URL/phone extraction
- **List operations** — Dedup, sort, filter, count
- **Template engine** — Apply templates to data for reports/emails
- **Text transforms** — Case change, slugify, truncate, wrap

## Quick Start

```bash
# Convert JSON to CSV
echo '[{"name":"Alice","age":30},{"name":"Bob","age":25}]' | node scripts/convert.mjs json2csv

# Convert CSV to JSON
echo 'name,age\nAlice,30\nBob,25' | node scripts/convert.mjs csv2json

# Convert JSON to markdown table
echo '[{"name":"Alice","age":30},{"name":"Bob","age":25}]' | node scripts/convert.mjs json2md

# Deduplicate a list
echo -e "apple\nbanana\napple\ncherry" | node scripts/transform.mjs dedup

# Sort lines
echo -e "zebra\napple\nmango" | node scripts/transform.mjs sort

# Extract emails from text
node scripts/extract.mjs emails < input.txt

# Extract URLs from text
node scripts/extract.mjs urls < input.txt

# Slugify text
echo "Hello World! This Is A Test" | node scripts/transform.mjs slugify

# Apply template
node scripts/template.mjs --template="Hello {name}, you are {age}!" --data='{"name":"Alice","age":30}'

# Read from file
node scripts/convert.mjs json2csv --file=data.json

# Count lines/words
echo -e "hello world\nfoo bar baz" | node scripts/transform.mjs count
```

## Supported Conversions

| From | To |
|------|----|
| JSON (array of objects) | CSV, Markdown Table, YAML, Plain Text |
| CSV | JSON, Markdown Table |
| Markdown Table | JSON, CSV |
| YAML | JSON, CSV, Markdown Table |
| Plain list (one per line) | JSON array, CSV |

## Text Operations

| Command | Description |
|---------|-------------|
| `dedup` | Remove duplicate lines |
| `sort` | Sort lines alphabetically |
| `sort -n` | Sort lines numerically |
| `reverse` | Reverse line order |
| `shuffle` | Randomize line order |
| `head N` | First N lines |
| `tail N` | Last N lines |
| `grep PATTERN` | Filter lines matching pattern |
| `grep -v PATTERN` | Filter lines NOT matching pattern |
| `count` | Count lines, words, chars |
| `slugify` | Convert to URL-safe slug |
| `uppercase` | Convert to uppercase |
| `lowercase` | Convert to lowercase |
| `titlecase` | Convert to Title Case |
| `truncate N` | Truncate to N chars per line |
| `wrap N` | Wrap text at N chars |
| `trim` | Trim whitespace |
| `squeeze` | Collapse multiple blank lines |

## Extraction Commands

| Command | Description |
|---------|-------------|
| `emails` | Extract email addresses |
| `urls` | Extract URLs |
| `phones` | Extract phone numbers |
| `ips` | Extract IP addresses |
| `hashtags` | Extract hashtags |
| `mentions` | Extract @mentions |
| `regex PATTERN` | Extract custom regex matches |

## Template Syntax

Templates use `{key}` for placeholders. Supports:
- Simple: `{name}` → value from data object
- Nested: `{user.name}` → dot notation access
- Default: `{name|fallback}` → fallback if missing
- Pipe: `{items|join:", "}` → join array
- Format: `{price|fixed:2}` → number formatting
