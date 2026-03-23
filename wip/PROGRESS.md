# Work-in-Progress Tracker

Track active projects being built by skill-builder cron job.

## Active Projects

| Project | Status | Last Updated | GitHub Repo |
|---------|--------|-------------|-------------|
| summarizer | v0.2 — batch + cache | 2026-03-23 | - |

## Completed Projects

| Project | Completed | GitHub Repo |
|---------|-----------|-------------|
| laboon-self-healing | 2026-03-23 | [github.com/aretaafandi02-source/laboon-self-healing](https://github.com/aretaafandi02-source/laboon-self-healing) |
| scripts/sysinfo.sh | 2026-03-23 | - |

## Log

- 2026-03-23: Created PROGRESS.md tracker
- 2026-03-23: Started summarizer skill (URL/text → markdown extraction). v0.1 done: SKILL.md, summarize.mjs with format options (bullets/paragraph/outline), stdin & URL support, HTML stripping.
- 2026-03-23: Summarizer v0.2 — Added batch URL processing (`--batch urls.txt`), disk cache with 1h TTL (`--cache`), cache clearing (`--clear-cache`). Remaining: PDF support, content scoring.
