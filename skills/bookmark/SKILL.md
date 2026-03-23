---
name: bookmark
description: >
  URL bookmark manager with tagging, collections, and dead-link checking.
  Use when: saving URLs for later, organizing bookmarks by topic, checking if saved links are alive,
  searching saved bookmarks, managing a personal link collection. NOT for: web research (use deep-research),
  web monitoring (use web-monitor).
---

# Bookmark 🔖

URL bookmark manager with tagging, collections, and dead-link checking.

## Capabilities

- **Save bookmarks** — Store URLs with title, tags, description, and collection
- **Search** — Full-text search across titles, URLs, descriptions, and tags
- **Collections** — Organize bookmarks into named collections
- **Tag management** — Filter and browse by tags
- **Dead-link checker** — Verify saved URLs are still alive
- **Import/Export** — Backup and restore as JSON

## Quick Start

```bash
# Add a bookmark
node scripts/bookmark.mjs add "https://example.com" --title="Example" --tags=docs,reference --desc="Official docs"

# List all bookmarks
node scripts/bookmark.mjs list

# List by tag
node scripts/bookmark.mjs list --tag=docs

# List by collection
node scripts/bookmark.mjs list --collection=work

# Get a bookmark by ID or query
node scripts/bookmark.mjs get "abc123"
node scripts/bookmark.mjs get "example"

# Search bookmarks
node scripts/bookmark.mjs search "docker"

# Edit a bookmark
node scripts/bookmark.mjs edit abc123 --title="New Title" --tags=docker,devops

# Delete a bookmark
node scripts/bookmark.mjs delete abc123

# Show all tags
node scripts/bookmark.mjs tags

# Show all collections
node scripts/bookmark.mjs collections

# Check for dead links
node scripts/bookmark.mjs check

# Export bookmarks
node scripts/bookmark.mjs export > backup.json

# Import bookmarks
node scripts/bookmark.mjs import < backup.json

# Stats
node scripts/bookmark.mjs stats
```

## Storage

Bookmarks stored in `data/bookmarks.json`. Each bookmark has: id, url, title, tags, desc, collection, created, updated, accessCount.

## Roadmap

- [x] v0.1 — Core CRUD + search + tags + collections + dead-link check
- [ ] v0.2 — Metadata auto-extraction from URLs (title, description, favicon)
- [ ] v0.3 — Browser bookmark import (Chrome/Firefox HTML export)
- [ ] v0.4 — Duplicate detection and link shortening awareness
