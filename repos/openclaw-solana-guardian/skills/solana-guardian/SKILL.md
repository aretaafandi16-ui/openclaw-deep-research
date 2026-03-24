# SKILL.md — Solana Portfolio Guardian

## Description
Monitors a Solana wallet for portfolio health, concentration risk, and impermanent loss alerts. Designed as an OpenClaw skill.

## Triggers
- "Check my Solana portfolio health"
- "What's my concentration risk?"
- "Any impermanent loss alerts?"
- "Portfolio risk report"

## Tools Required
- `solana-keygen` / `solana` CLI (for wallet queries)
- Jupiter Price API (free, no key needed)
- `node` (for analysis scripts)

## Usage
The agent runs periodic portfolio analysis when triggered:

1. **Balance Snapshot** — Fetch all SPL token balances + SOL
2. **Concentration Check** — Flag if any single token > 40% of portfolio value
3. **IL Monitor** — Track LP positions and estimate impermanent loss vs HODL
4. **Risk Score** — 0-100 score based on diversification, volatility, IL exposure

## Configuration
```json
{
  "wallet": "<SOLANA_PUBKEY>",
  "checkIntervalMinutes": 60,
  "concentrationThreshold": 0.4,
  "ilAlertThreshold": 0.05,
  "riskAlertLevel": "medium"
}
```

## Output Format
```
🐋 Solana Portfolio Guardian Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Total Value: $12,450.32
📊 Risk Score: 72/100 (Medium)

⚠️ Concentration Alerts:
  • SOL: 52% of portfolio (threshold: 40%)
  
🔄 LP Positions:
  • SOL/USDC (Raydium): IL = -2.1%
  • BONK/SOL (Orca): IL = -8.3% ⚠️

💡 Suggestions:
  • Consider rebalancing SOL exposure
  • BONK/SOL IL above threshold — evaluate exiting
```
