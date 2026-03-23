# Work-in-Progress Tracker

Track active projects being built by skill-builder cron job.

## Active Projects

| Project | Status | Last Updated | GitHub Repo |
|---------|--------|-------------|-------------|
| bookmark | v0.2 done | 2026-03-23 | - |

## Completed Projects

| Project | Completed | GitHub Repo |
|---------|-----------|-------------|
| skill-discover | 2026-03-23 | - |
| summarizer | 2026-03-23 | - |
| laboon-self-healing | 2026-03-23 | [github.com/aretaafandi02-source/laboon-self-healing](https://github.com/aretaafandi02-source/laboon-self-healing) |
| scripts/sysinfo.sh | 2026-03-23 | - |

## Log

- 2026-03-23: Created PROGRESS.md tracker
- 2026-03-23: Started summarizer skill (URL/text → markdown extraction). v0.1 done: SKILL.md, summarize.mjs with format options (bullets/paragraph/outline), stdin & URL support, HTML stripping.
- 2026-03-23: Summarizer v0.2 — Added batch URL processing (`--batch urls.txt`), disk cache with 1h TTL (`--cache`), cache clearing (`--clear-cache`). Remaining: PDF support, content scoring.
- 2026-03-23: Summarizer v0.3 — Added content quality scoring: word count, sentence/paragraph count, avg sentence & word length, vocabulary richness (% unique), reading time estimate (200 wpm), quality score (0-100) with labels. Toggle with --score/--no-score. Remaining: PDF support.
- 2026-03-23: Summarizer v0.4 — Added PDF support: local .pdf files + PDF URLs. Uses pdf-parse for text extraction. Shows PDF metadata (page count, title) in output header. Updated SKILL.md. All planned features complete!
- 2026-03-23: Summarizer marked complete. Added YAML frontmatter to summarizer + price-tracker SKILL.md files (were missing it, causing discover tool to not find them).
- 2026-03-23: Created skill-discover — CLI tool to search installed skills by keyword. Parses YAML frontmatter with fallback to heading extraction. Ranks results by relevance. Lists all 10 installed skills. Fixed path discovery to also scan .openclaw/skills/.
- 2026-03-23: Started **bookmark** skill — URL bookmark manager. v0.1 done: add, get, list, search, delete, edit, tags, collections, dead-link check, export/import, stats. All tested and working. Next: v0.2 metadata auto-extraction from URLs.
- 2026-03-23: Bookmark v0.2 — Added metadata auto-extraction: `--meta` flag on `add` (auto-fetches title, description, favicon from HTML). Auto-fetches by default when no --title provided. New `fetch-meta` command for retroactive extraction (all, specific id, or missing-title bookmarks). Fixed sort bug in `list` (was sorting b.updated - b.updated = always 0). Updated SKILL.md with new capabilities. Next: v0.3 browser bookmark import.
