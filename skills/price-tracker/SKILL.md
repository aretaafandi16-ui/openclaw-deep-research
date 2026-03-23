---
name: price-tracker
description: >
  Real-time price tracking for crypto, stocks, and commodities. Set alerts, build watchlists,
  get daily digests. Use when: checking crypto/stock prices, setting price alerts, building
  watchlists, or getting market data.
---

# Price Tracker Skill

Real-time price tracking for crypto, stocks, and commodities. Set alerts, build watchlists, get daily digests — all from your agent.

## Capabilities

- **Crypto prices** — CoinGecko API (free, no key needed)
- **Stock prices** — Yahoo Finance via web scraping
- **Price alerts** — Set thresholds, get notified when hit
- **Watchlist management** — Save and track favorites
- **Price comparisons** — Compare assets side-by-side
- **Historical snapshots** — Log prices over time

## Quick Start

```bash
# Check a single crypto price
node scripts/price-check.mjs bitcoin

# Check multiple
node scripts/price-check.mjs bitcoin ethereum solana

# Check with currency
node scripts/price-check.mjs bitcoin --currency=idr

# Stock price
node scripts/price-check.mjs AAPL --type=stock

# Set an alert
node scripts/alerts.mjs set bitcoin above 100000

# List alerts
node scripts/alerts.mjs list

# Check alerts (run via cron)
node scripts/alerts.mjs check

# Manage watchlist
node scripts/watchlist.mjs add bitcoin ethereum solana
node scripts/watchlist.mjs list
node scripts/watchlist.mjs remove bitcoin
node scripts/watchlist.mjs prices
```

## File Structure

```
price-tracker/
├── SKILL.md              # This file
├── scripts/
│   ├── price-check.mjs   # Core price fetching
│   ├── alerts.mjs        # Alert management & checking
│   ├── watchlist.mjs     # Watchlist CRUD
│   └── price-history.mjs # Historical logging
├── data/
│   ├── alerts.json       # Saved alerts
│   ├── watchlist.json    # Saved watchlists
│   └── history/          # Price snapshots
└── docs/
    └── README.md         # Extended documentation
```

## Integration Points

- **Tavily Search** — Enrich price data with news context
- **Solana Agent Kit** — Trigger trades when price alerts fire
- **Cron** — Schedule periodic price checks
- **Telegram** — Alert delivery channel

## Supported Currencies

USD, EUR, IDR, GBP, JPY, SGD, AUD, CAD, and 40+ more via CoinGecko.

## API Notes

- Crypto: CoinGecko free tier (30 calls/min)
- Stocks: Yahoo Finance (no key needed)
- Rate limits respected automatically
