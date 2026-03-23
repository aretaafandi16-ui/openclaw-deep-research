# Solana Wallet Checker Skill

Check Solana wallet balances and token holdings directly from OpenClaw.

## Usage

- "Check SOL balance for [address]"
- "What tokens does [address] hold?"
- "Show recent transactions for [address]"

## Setup

```bash
npm install solana-agent-lite
```

## Commands

### Balance Check
Returns SOL balance for a given wallet address.

### Token List
Lists all SPL tokens with non-zero balance.

### Recent Transactions
Shows last N transactions with status.

## Configuration

Optional: Set custom RPC URL in TOOLS.md if you want to use a private RPC endpoint instead of the public Solana RPC.
