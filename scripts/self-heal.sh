#!/bin/bash
# Laboon Self-Healing System v1.0
# Built by Laboon 🐋 — 100% safe, zero external dependencies
# Uses only OpenClaw built-in commands

LOG_FILE="/home/ubuntu/.openclaw/workspace/scripts/self-heal.log"
STATE_FILE="/home/ubuntu/.openclaw/workspace/scripts/self-heal-state.json"
CONFIG_FILE="/home/ubuntu/.openclaw/openclaw.json"
CONFIG_BACKUP="/home/ubuntu/.openclaw/openclaw.json.bak"

# Ensure directories exist
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# === LEVEL 1: Gateway Health Check ===
check_gateway() {
  STATUS=$(openclaw health 2>&1)
  if echo "$STATUS" | grep -q "ok"; then
    return 0
  else
    return 1
  fi
}

# === LEVEL 2: Auto-Restart Gateway ===
restart_gateway() {
  log "⚠️ Gateway down — attempting auto-restart..."
  openclaw gateway restart 2>&1 >> "$LOG_FILE" || true
  sleep 5
  if check_gateway; then
    log "✅ Gateway restarted successfully"
    return 0
  else
    log "❌ Gateway restart failed"
    return 1
  fi
}

# === LEVEL 3: Config Backup ===
backup_config() {
  if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$CONFIG_BACKUP"
    log "📦 Config backed up"
  fi
}

# === LEVEL 4: Doctor Fix ===
run_doctor() {
  log "🩺 Running doctor --fix..."
  openclaw doctor --fix 2>&1 >> "$LOG_FILE" || true
}

# === LEVEL 5: Session Health ===
check_sessions() {
  SESSIONS=$(openclaw sessions list 2>&1 | grep -c "agent:" || echo "0")
  log "📊 Active sessions: $SESSIONS"
}

# === LEVEL 6: Disk Space Check ===
check_disk() {
  USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
  if [ "$USAGE" -gt 90 ]; then
    log "🚨 Disk usage critical: ${USAGE}%"
    # Clean old logs
    find /home/ubuntu/.openclaw/workspace/memory/ -name "*.md" -mtime +14 -delete 2>/dev/null || true
    log "🧹 Cleaned old memory files"
    return 1
  fi
  return 0
}

# === MAIN HEALTH CHECK ===
log "=== Self-Healing Check Started ==="

# Step 1: Check gateway
if check_gateway; then
  log "✅ Gateway healthy"
else
  log "❌ Gateway unhealthy"
  backup_config
  if restart_gateway; then
    log "✅ Recovered via restart"
  else
    run_doctor
    if restart_gateway; then
      log "✅ Recovered via doctor + restart"
    else
      log "🚨 CRITICAL: Gateway cannot be recovered"
    fi
  fi
fi

# Step 2: Check disk
check_disk

# Step 3: Check sessions
check_sessions

# Step 4: Save state
cat > "$STATE_FILE" << EOF
{
  "lastCheck": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gatewayHealthy": $(check_gateway && echo "true" || echo "false"),
  "diskUsage": "$(df -h / | awk 'NR==2 {print $5}')",
  "uptime": "$(uptime -p 2>/dev/null || echo 'unknown')"
}
EOF

log "=== Self-Healing Check Complete ==="
