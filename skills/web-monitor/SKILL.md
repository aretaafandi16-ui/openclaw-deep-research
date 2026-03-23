---
name: web-monitor
description: >
  Monitor websites for content changes, detect updates, and get notifications.
  Track product availability, competitor updates, news changes, API status pages,
  or any web page. Use when: user wants to monitor a website, detect changes,
  track page updates, set up web alerts, or watch for content modifications.
  NOT for: price tracking (use price-tracker), general web search (use tavily).
---

# Web Monitor 🌐

Monitor websites for changes. Get notified when content updates.

## Capabilities

- **Page snapshots** — Hash and store page content for comparison
- **Change detection** — Diff-based analysis of what changed
- **CSS selectors** — Monitor specific elements, not full pages
- **Scheduled checks** — Run via cron for continuous monitoring
- **Multi-page watches** — Track multiple URLs simultaneously
- **Change history** — Log all detected changes with timestamps

## Quick Start

```bash
# Add a URL to monitor
node scripts/monitor.mjs add "https://example.com" --name="Example Site"

# Add with CSS selector (monitor only that element)
node scripts/monitor.mjs add "https://example.com/pricing" --name="Pricing" --selector=".price-table"

# List all monitored URLs
node scripts/monitor.mjs list

# Check all monitors for changes
node scripts/monitor.mjs check

# Check a specific monitor
node scripts/monitor.mjs check --name="Pricing"

# Remove a monitor
node scripts/monitor.mjs remove "Example Site"

# View change history for a monitor
node scripts/monitor.mjs history "Example Site"

# Take a snapshot (manual, no diff)
node scripts/monitor.mjs snapshot "Example Site"
```

## File Structure

```
web-monitor/
├── SKILL.md              # This file
├── scripts/
│   └── monitor.mjs       # Core monitoring script
├── data/
│   ├── monitors.json     # Monitored URLs & config
│   ├── snapshots/        # Page content snapshots
│   └── history/          # Change history logs
└── references/
    └── selectors.md      # CSS selector tips
```

## Integration Points

- **Cron** — Schedule periodic checks (e.g., every hour)
- **Tavily** — Enrich change detection with context search
- **Deep Research** — Investigate what changed and why
- **Price Tracker** — Complement with price-specific monitoring

## Use Cases

- 🛒 **Product availability** — Monitor out-of-stock items
- 📰 **News monitoring** — Track when articles are updated
- 🏢 **Competitor pages** — Watch for pricing/feature changes
- 📊 **API status pages** — Get notified of incidents
- 📝 **Documentation** — Track when docs are updated
- 🎫 **Event tickets** — Watch for ticket availability

## Tips

- Use `--selector` for targeted monitoring (faster, less noise)
- Set `--threshold=<number>` to ignore minor changes (default: 0)
- Combine with cron for automated monitoring
- Check `history` to understand change patterns over time
