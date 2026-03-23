---
name: snippets
description: >
  Persistent snippet manager for agents. Save, search, tag, and retrieve reusable text,
  code snippets, config templates, and notes across sessions. Use when: saving something
  for later reuse, finding a previously saved snippet, managing a personal knowledge base
  of code/config/text, organizing notes with tags. NOT for: long-term memory (use MEMORY.md),
  research notes (use deep-research).
---

# Snippets 📋

Persistent snippet/clipboard manager for agents. Save once, retrieve forever.

## Capabilities

- **Save snippets** — Store text, code, config with tags
- **Search** — Full-text search across all snippets
- **Tag management** — Organize by tags, filter by tag
- **Import/Export** — Backup and restore snippets
- **Categories** — code, config, template, note, command, other

## Quick Start

```bash
# Save a snippet
node scripts/snippets.mjs save "docker-cleanup" "docker system prune -af --volumes" --tags=docker,cleanup --category=command

# Save from stdin
echo "kubectl get pods -A" | node scripts/snippets.mjs save "k8s-pods" --tags=k8s,kubectl --category=command

# List all snippets
node scripts/snippets.mjs list

# List by tag
node scripts/snippets.mjs list --tag=docker

# Get a snippet by name
node scripts/snippets.mjs get "docker-cleanup"

# Search snippets
node scripts/snippets.mjs search "docker"

# Delete a snippet
node scripts/snippets.mjs delete "docker-cleanup"

# Show tags
node scripts/snippets.mjs tags

# Export all snippets
node scripts/snippets.mjs export > backup.json

# Import snippets
node scripts/snippets.mjs import < backup.json

# Stats
node scripts/snippets.mjs stats
```

## Storage

Snippets are stored in `data/snippets.json` within the skill directory.
Each snippet has: name, content, tags, category, created, updated, accessCount.

## Categories

- `code` — Code snippets
- `config` — Configuration files/templates
- `template` — Text templates
- `note` — General notes
- `command` — CLI commands
- `other` — Everything else
