# MEMORY.md — Long-Term Memory

_Curated knowledge. Updated periodically from daily notes._
_Last reviewed: 2026-03-22_

---

## 👤 People

### Reza
- Telegram: @Glassparty (username Romelo)
- Location: Jakarta, WIB (UTC+7)
- Prefers direct, no-fluff communication
- Speaks Indonesian casually ("bro", "gmn", "udah")
- Uses Indonesian + English mix

---

## 🛠️ Skills & Setup

### Tavily Search (installed 2026-03-22)
- AI-optimized web search via Tavily API
- Scripts: `search.mjs`, `extract.mjs`
- Installed at: `~/.openclaw/skills/tavily-search/`
- Env: `TAVILY_API_KEY` set in openclaw.json
- Tested & working
- **DEFAULT search engine** — pakai ini untuk semua pencarian

### Privy Wallet (installed 2026-03-22)
- Agentic wallet management via Privy API
- Installed at: `~/.openclaw/workspace/skills/privy/`
- Status: Waiting for Reza to create account at dashboard.privy.io
- Needs: `PRIVY_APP_ID` + `PRIVY_APP_SECRET`

### CoinFello (installed 2026-03-22)
- Smart account + natural language crypto txs
- Installed at: `~/.openclaw/workspace/skills/coinfello/`
- Status: Backup option (better for macOS)

### Solana Agent Kit (setup 2026-03-22)
- Open-source toolkit for AI agents × Solana (96 actions built)
- Installed at: `~/.openclaw/workspace/solana-agent-kit/`
- MCP server ready at: `~/.openclaw/workspace/solana-agent-kit/mcp-server/`
- Built: core + 5 plugins (token, nft, defi, misc, blinks) + MCP adapter
- **Wallet generated:** `Cy8Qe9c2pubF43F5my2SCBj2grVQnzeHVzJxANXyrSz6`
- Private key: saved in `.wallet.json` (⚠️ KEEP SECURE)
- **Actions available:** Trade, Swap, Launch Token, Compressed Airdrop, Stake, Lend, Perps, Bridge
- Start: `cd mcp-server && node index.mjs`

---

## 📌 Decisions & Preferences

- Persona: **Laboon** 🐋 — smart, tactical, direct
- Communication style: No fluff, warm when it counts
- Language: **Bahasa Indonesia** untuk semua report dan output. Bisa mix English untuk technical terms.

---

## 🤝 GitHub Contributions (2026-03-23)

| PR/Contribution | Repo | Status |
|-----------------|------|--------|
| Pydantic validation #436 | TauricResearch/TradingAgents (37.9k ⭐) | ✅ PR created |
| Self-healing to awesome list | BlockRunAI/awesome-OpenClaw-Money-Maker | ✅ PR #7 |
| Day/night cycle | Scottcjn/rustchain-bounties | ✅ Pushed |
| OpenClaw skill wrapper | Krypto-Hashers-Community/polymarket-trading-bot | ✅ Pushed |
| Monitoring entry | rohitg00/awesome-openclaw | ✅ Pushed |

---

## 🧠 Lessons Learned

_(Update as we go)_

---

## ⚡ Optimizations Applied (2026-03-22)

- **Memory flush** enabled — auto-saves critical context before compaction drops history
- **Session idle reset** — 8 hours idle → fresh session (prevents token bloat)
- **HEARTBEAT.md** — minimal, only 2 periodic checks
- **Skill discipline** — only 6/53 skills enabled (healthcheck, node-connect, skill-creator, tmux, weather, tavily)
- **3-layer memory** — daily logs → curated MEMORY.md → quick index
- **Custom self-healing** — built safe watchdog script (no external deps, zero risk)
  - Gateway health check + auto-restart
  - Config backup before changes
  - Disk space monitoring
  - Doctor auto-fix fallback
  - Cron job: every 30 minutes (silent, alerts on failure)

---

## 🔗 Active Projects

### Airdrop Farming Setup
- Target: Privy Wallet → Base chain
- Strategy: Farm Polymarket, MegaETH, Hyperliquid S2
- Status: Pending Privy account setup
- Next: Reza daftar Privy → gw setup wallet + policy

---

## 📊 System State

- Gateway: running on port 18789
- Channel: Telegram (direct)
- Model: kilocode/xiaomi/mimo-v2-pro:free
