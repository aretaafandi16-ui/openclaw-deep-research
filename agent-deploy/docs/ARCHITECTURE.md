# agent-deploy Architecture

## Overview

agent-deploy is a zero-dependency bash toolkit for deploying and managing AI agents on any VPS. It uses plain bash with no external dependencies beyond standard Linux utilities.

## Design Principles

1. **Zero dependencies** — runs on any Linux VPS with just bash, curl, git
2. **Stateless scripts** — each script is self-contained and can run independently
3. **JSONL state** — simple pipe-delimited state files, no database required
4. **Systemd integration** — uses native Linux service management
5. **Progressive enhancement** — works without root, better with root

## Directory Structure

```
~/.agent-deploy/
├── config.yaml          # Main configuration
├── state.json           # Agent state (pipe-delimited)
├── alerts.conf          # Alert channel config
├── scaling.conf         # Auto-scaling config
├── logs/
│   ├── deploy.log       # Deployment events
│   ├── monitor.log      # Health check events
│   ├── openclaw.log     # Agent-specific logs
│   └── backup-cron.log  # Scheduled backup output
└── backups/
    ├── backup-manual-20260324-120000.tar.gz
    └── backup-scheduled-20260324-030000.tar.gz
```

## Scripts

### deploy.sh
- Detects cloud provider automatically
- Installs agent dependencies (Node.js, Python as needed)
- Creates systemd services for auto-start
- Supports OpenClaw, AutoGPT, ElizaOS, and custom projects
- SSL setup via certbot

### monitor.sh
- Real-time health dashboard
- Process, port, HTTP, and memory checks
- Telegram/Discord alerting
- Daemon mode for continuous monitoring
- Auto-restart on failure

### backup.sh
- Creates compressed tar.gz backups
- Automatic target discovery
- Configurable retention (default: 10 backups)
- Cron scheduling for daily/hourly/weekly backups
- One-command restore

### optimize.sh
- Resource utilization analysis
- Multi-provider price comparison
- Per-agent resource tracking
- Personalized downsize/upscale recommendations

### scale.sh
- Resource monitoring with visual bars
- Scale-up/down analysis
- Auto-scaling daemon with configurable thresholds
- Kernel tuning for high-load scenarios

## State Format

State file is pipe-delimited:
```
agent|status|pid|port|version|timestamp
openclaw|running|12345|3000|0.15.0|2026-03-24T12:00:00Z
```

## Alert Flow

```
monitor.sh daemon
  → check process health (kill -0)
  → check port availability
  → check HTTP response
  → if failure:
    → send Telegram alert
    → send Discord alert
    → attempt systemd restart
    → log event
```

## Security

- No external dependencies (no npm, pip, etc. for the toolkit itself)
- Systemd security hardening (NoNewPrivileges, ProtectSystem)
- Config files stored in user home (no root required)
- Backup archives are compressed and optionally encrypted
- Alert tokens stored in local config (never transmitted except to APIs)
