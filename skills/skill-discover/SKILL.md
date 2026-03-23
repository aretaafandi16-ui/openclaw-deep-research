---
name: skill-discover
description: >
  Search across all installed OpenClaw skills by keyword to find the right tool for the job.
  Lists installed skills with descriptions, ranks by relevance to search query. Use when: unsure
  which skill handles a task, searching for capabilities, or listing available skills.
---

# Skill Discover 🔍

Find the right skill for any job — search across all installed skills by keyword.

## Usage

```bash
# Search for a skill by keyword
node ~/.openclaw/workspace/skills/skill-discover/scripts/discover.mjs "web"

# List all installed skills
node ~/.openclaw/workspace/skills/skill-discover/scripts/discover.mjs --list

# JSON output (for programmatic use)
node ~/.openclaw/workspace/skills/skill-discover/scripts/discover.mjs --json crypto

# Help
node ~/.openclaw/workspace/skills/skill-discover/scripts/discover.mjs --help
```

## How It Works

1. Scans all `skills/*/SKILL.md` files in the workspace
2. Parses YAML frontmatter (name + description)
3. Scores each skill against the search query (word matches + phrase match)
4. Returns ranked results with relevance scores

## Parameters

| Param | Description |
|-------|-------------|
| `<query>` | Keywords to search for |
| `--list` | List all installed skills |
| `--json` | Output as JSON |
| `--help` | Show usage help |

## Dependencies

- Node.js (no external packages needed)
