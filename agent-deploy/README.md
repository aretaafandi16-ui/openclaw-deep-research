# agent-deploy 🚀

**One-click deployment toolkit for AI agents. Deploy, monitor, and scale agents on any cloud.**

[![License: MIT-0](https://img.shields.io/badge/License-MIT--0-blue.svg)](LICENSE)
[![Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)]()

## What is this?

A zero-dependency bash toolkit for deploying and managing AI agents (OpenClaw, AutoGPT, ElizaOS, etc.) on any VPS. No Docker required. No Kubernetes. Just bash.

## Features

| Feature | Description |
|---------|-------------|
| **One-click deploy** | Install agent + dependencies in 5 minutes |
| **Multi-provider** | DigitalOcean, Vultr, Hetzner, AWS, any VPS |
| **Health monitoring** | Auto-detect failures, restart, alert |
| **Cost optimizer** | Track spending, suggest cheaper providers |
| **Auto-scaling** | Scale up/down based on load |
| **Backup system** | Daily snapshots, easy restore |
| **SSL/HTTPS** | Auto Let's Encrypt setup |
| **Multi-agent** | Run multiple agents on one server |

## Quick Start

```bash
# 1. Clone
git clone https://github.com/aretaafandi02-source/agent-deploy.git
cd agent-deploy
chmod +x scripts/*.sh

# 2. Deploy OpenClaw on current server
./scripts/deploy.sh openclaw

# 3. Deploy to new VPS
./scripts/deploy.sh openclaw --provider digitalocean --size s-1vcpu-1gb

# 4. Monitor all agents
./scripts/monitor.sh status
```

## Scripts

### deploy.sh — One-Click Deployment
```bash
./scripts/deploy.sh openclaw                    # Deploy on current server
./scripts/deploy.sh openclaw --provider vultr   # Deploy to Vultr
./scripts/deploy.sh autogpt --size s-2vcpu-2gb  # Deploy AutoGPT (2GB RAM)
./scripts/deploy.sh elizaos --domain mybot.com  # Deploy with custom domain
```

### monitor.sh — Health Monitoring
```bash
./scripts/monitor.sh status          # Show all agents status
./scripts/monitor.sh watch           # Real-time monitoring
./scripts/monitor.sh alert           # Set up alerts (Telegram/Discord)
./scripts/monitor.sh logs            # View agent logs
```

### optimize.sh — Cost Optimization
```bash
./scripts/optimize.sh analyze        # Analyze current spending
./scripts/optimize.sh compare        # Compare provider prices
./scripts/optimize.sh recommend      # Get recommendations
./scripts/optimize.sh migrate        # Migrate to cheaper provider
```

### backup.sh — Backup & Restore
```bash
./scripts/backup.sh create           # Create backup
./scripts/backup.sh list             # List backups
./scripts/backup.sh restore          # Restore latest backup
./scripts/backup.sh schedule         # Set up daily backups
```

### scale.sh — Auto-Scaling
```bash
./scripts/scale.sh up                # Scale up (add resources)
./scripts/scale.sh down              # Scale down (reduce costs)
./scripts/scale.sh auto              # Enable auto-scaling
./scripts/scale.sh status            # Show scaling status
```

## Supported Agents

| Agent | Status | Install Time |
|-------|--------|--------------|
| OpenClaw | ✅ Ready | ~3 min |
| AutoGPT | ✅ Ready | ~5 min |
| ElizaOS | ✅ Ready | ~4 min |
| LangChain Agent | ✅ Ready | ~5 min |
| Custom | ✅ Ready | Variable |

## Supported Providers

| Provider | API | Status |
|----------|-----|--------|
| DigitalOcean | ✅ | Ready |
| Vultr | ✅ | Ready |
| Hetzner | ✅ | Ready |
| AWS EC2 | ✅ | Ready |
| Any VPS | SSH | Ready |

## Configuration

### config.yaml
```yaml
agents:
  - name: openclaw-main
    type: openclaw
    provider: digitalocean
    size: s-1vcpu-1gb
    region: nyc1
    domain: myagent.com
    auto_restart: true
    backup_daily: true
    
monitoring:
  check_interval: 30
  alert_channel: telegram
  alert_chat_id: "6151986990"
  
optimization:
  max_monthly_budget: 20
  prefer_cheaper: true
  auto_migrate: false
```

## Why This Exists

Most AI agent deployment guides are either:
- Too complex (Kubernetes, Terraform, etc.)
- Too manual (SSH + pray)
- Too expensive (managed services)

This toolkit is:
- ✅ Simple (bash scripts)
- ✅ Automated (one command)
- ✅ Cheap (optimize for lowest cost)
- ✅ Reliable (auto-healing)

## Contribute

Found a bug? Want a feature? Open an issue or PR!

## Donate

**Solana:** `Cy8Qe9c2pubF43F5my2SCBj2grVQnzeHVzJxANXyrSz6`

## License

MIT-0 — Use freely, no attribution required.
