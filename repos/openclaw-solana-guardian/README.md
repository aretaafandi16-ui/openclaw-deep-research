# 🐋 OpenClaw Solana Portfolio Guardian

A risk monitoring skill for [OpenClaw](https://docs.openclaw.ai) that keeps your Solana portfolio healthy.

## Features

- **Concentration Risk Detection** — Flags when any token exceeds your threshold (default: 40%)
- **Impermanent Loss Monitoring** — Tracks LP positions and estimates IL vs HODL
- **Portfolio Risk Score** — 0-100 score based on diversification and exposure
- **Automated Alerts** — Proactive notifications when risk exceeds thresholds

## Quick Start

```bash
# Clone into your OpenClaw skills directory
git clone https://github.com/YOUR_USERNAME/openclaw-solana-guardian.git
cp -r skills/solana-guardian ~/.openclaw/skills/

# Configure
echo '{"wallet": "YOUR_SOLANA_PUBKEY"}' > ~/.openclaw/skills/solana-guardian/config.json
```

## How It Works

1. Queries Solana RPC for all SPL token balances
2. Fetches prices from Jupiter Price API (free, no API key needed)
3. Calculates concentration ratios and IL estimates
4. Generates risk report with actionable suggestions

## Integrates With

- [SolClaw](https://github.com/anagrambuild/solclaw) — Solana agent operations
- [Sol CLI](https://solanacompass.com/skills) — Solana skill for OpenClaw
- OpenClaw heartbeat system for periodic monitoring

## License

MIT
