# 🐋 Solana Token Scanner — AI Agent Safety Tool

A lightweight CLI tool for AI agents to quickly assess Solana token safety before interacting with it. Designed for OpenClaw and similar agent frameworks.

## What It Does

Given a Solana token mint address, it checks:
- ✅ Token metadata (name, symbol, decimals)
- ✅ Holder distribution (top holders concentration)
- ✅ Supply information
- ✅ Freeze authority status (can tokens be frozen?)
- ✅ Mint authority status (can more tokens be minted?)
- ⚠️ Risk score (0-100, lower = safer)

## Usage

```bash
# Basic scan
node scanner.mjs <TOKEN_MINT_ADDRESS>

# With custom RPC
SOLANA_RPC_URL=https://your-rpc.com node scanner.mjs <TOKEN_MINT_ADDRESS>

# JSON output (for agent integration)
node scanner.mjs --json <TOKEN_MINT_ADDRESS>
```

## Risk Indicators

| Flag | Meaning | Risk Level |
|------|---------|------------|
| Freeze Authority Active | Creator can freeze your tokens | 🔴 High |
| Mint Authority Active | Unlimited supply possible | 🔴 High |
| Top holder > 20% | Whale concentration risk | 🟡 Medium |
| Low holder count (<100) | Illiquid, rug-pull risk | 🟡 Medium |
| No metadata | Unknown token, proceed with caution | 🟡 Medium |

## Integration with AI Agents

The `--json` flag outputs structured data perfect for agent decision-making:

```json
{
  "mint": "...",
  "name": "Example Token",
  "symbol": "EXMPL",
  "supply": "1000000000",
  "decimals": 9,
  "freezeAuthority": null,
  "mintAuthority": null,
  "topHolders": [...],
  "holderCount": 1234,
  "riskScore": 15,
  "riskFlags": [],
  "verdict": "LOW_RISK"
}
```

## Requirements

- Node.js 18+
- No external dependencies (uses native fetch + Solana public RPC)

## License

MIT — Use freely, contribute back improvements.
