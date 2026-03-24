#!/usr/bin/env bash
# agent-deploy — Health monitoring for AI agents
# monitor.sh: Check status, watch, alert, view logs
# Usage: ./monitor.sh <command> [options]
# Dependencies: zero (pure bash)

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${AGENT_DEPLOY_CONFIG:-$HOME/.agent-deploy}"
STATE_FILE="$CONFIG_DIR/state.json"
LOG_DIR="$CONFIG_DIR/logs"
ALERT_CONFIG="$CONFIG_DIR/alerts.conf"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*" >&2; }
info()  { echo -e "${CYAN}[i]${NC} $*"; }

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# ─── State Reading ──────────────────────────────────────────────────────────
get_agents() {
    if [[ ! -f "$STATE_FILE" ]]; then
        echo ""
        return
    fi
    cut -d'|' -f1 "$STATE_FILE" | sort -u
}

get_agent_field() {
    local agent="$1" field="$2"
    grep "^${agent}|" "$STATE_FILE" 2>/dev/null | tail -1 | cut -d'|' -f"$field"
}

# ─── Health Checks ──────────────────────────────────────────────────────────
check_process() {
    local pid="$1"
    if [[ "$pid" == "0" ]] || [[ -z "$pid" ]]; then
        echo "unknown"
        return
    fi
    if kill -0 "$pid" 2>/dev/null; then
        echo "alive"
    else
        echo "dead"
    fi
}

check_port() {
    local port="$1"
    if [[ "$port" == "0" ]] || [[ -z "$port" ]]; then
        echo "n/a"
        return
    fi
    if ss -tlnp 2>/dev/null | grep -q ":${port} " || \
       netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
        echo "open"
    else
        echo "closed"
    fi
}

check_systemd() {
    local service="$1"
    if systemctl is-active "$service" &>/dev/null; then
        echo "active"
    elif systemctl is-enabled "$service" &>/dev/null; then
        echo "inactive"
    else
        echo "none"
    fi
}

check_http() {
    local port="$1" path="${2:-/}"
    if [[ "$port" == "0" ]] || [[ -z "$port" ]]; then
        echo "n/a"
        return
    fi
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://localhost:${port}${path}" 2>/dev/null || echo "000")
    echo "$code"
}

check_uptime() {
    local pid="$1"
    if [[ "$pid" == "0" ]] || [[ -z "$pid" ]]; then
        echo "n/a"
        return
    fi
    local ps_output
    ps_output=$(ps -o etimes= -p "$pid" 2>/dev/null || echo "")
    if [[ -n "$ps_output" ]]; then
        local seconds=$((ps_output))
        local days=$((seconds / 86400))
        local hours=$(( (seconds % 86400) / 3600 ))
        local mins=$(( (seconds % 3600) / 60 ))
        echo "${days}d ${hours}h ${mins}m"
    else
        echo "n/a"
    fi
}

check_memory() {
    local pid="$1"
    if [[ "$pid" == "0" ]] || [[ -z "$pid" ]]; then
        echo "n/a"
        return
    fi
    local mem
    mem=$(ps -o rss= -p "$pid" 2>/dev/null || echo "0")
    if [[ "$mem" -gt 0 ]]; then
        local mb=$((mem / 1024))
        echo "${mb}MB"
    else
        echo "n/a"
    fi
}

# ─── Status Display ──────────────────────────────────────────────────────────
show_status() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  📊 agent-deploy — Agent Status Dashboard                            ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    local agents
    agents=$(get_agents)

    if [[ -z "$agents" ]]; then
        warn "No agents deployed yet."
        info "Run './scripts/deploy.sh <agent>' to deploy your first agent."
        echo ""
        return
    fi

    printf "${BOLD}%-15s %-10s %-8s %-10s %-10s %-12s %-8s${NC}\n" \
        "AGENT" "STATUS" "PORT" "PROCESS" "UPTIME" "MEMORY" "HTTP"
    echo "$(printf '%.0s─' {1..85})"

    while IFS= read -r agent; do
        local status pid port version
        status=$(get_agent_field "$agent" 2)
        pid=$(get_agent_field "$agent" 3)
        port=$(get_agent_field "$agent" 4)
        version=$(get_agent_field "$agent" 5)

        local proc_health port_health uptime http_code mem_usage
        proc_health=$(check_process "$pid")
        port_health=$(check_port "$port")
        uptime=$(check_uptime "$pid")
        http_code=$(check_http "$port")
        mem_usage=$(check_memory "$pid")

        # Color the status
        local status_color="$GREEN"
        [[ "$proc_health" == "dead" ]] && status_color="$RED"
        [[ "$port_health" == "closed" ]] && status_color="$YELLOW"

        printf "${status_color}%-15s${NC} %-10s %-8s %-10s %-10s %-12s %-8s\n" \
            "$agent" "$status" "$port" "$proc_health" "$uptime" "$mem_usage" "$http_code"
    done <<< "$agents"

    echo ""

    # System overview
    echo -e "${BOLD}System Overview:${NC}"
    echo "  CPU:    $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' 2>/dev/null || echo 'n/a')%"
    echo "  Memory: $(free -h | awk '/Mem:/ {printf "%s/%s (%.0f%%)", $3, $2, $3/$2*100}' 2>/dev/null || echo 'n/a')"
    echo "  Disk:   $(df -h / | awk 'NR==2 {printf "%s/%s (%s)", $3, $2, $5}' 2>/dev/null || echo 'n/a')"
    echo "  Load:   $(uptime | awk -F'load average:' '{print $2}' | xargs 2>/dev/null || echo 'n/a')"
    echo ""
}

# ─── Real-time Watch ────────────────────────────────────────────────────────
watch_agents() {
    local interval="${1:-5}"
    info "Watching agents (refresh every ${interval}s). Press Ctrl+C to stop."
    echo ""

    while true; do
        clear
        show_status
        sleep "$interval"
    done
}

# ─── Alerts ──────────────────────────────────────────────────────────────────
send_telegram_alert() {
    local message="$1"
    local token chat_id

    if [[ -f "$ALERT_CONFIG" ]]; then
        token=$(grep "^TELEGRAM_TOKEN=" "$ALERT_CONFIG" 2>/dev/null | cut -d= -f2)
        chat_id=$(grep "^TELEGRAM_CHAT_ID=" "$ALERT_CONFIG" 2>/dev/null | cut -d= -f2)
    fi

    token="${token:-${TELEGRAM_TOKEN:-}}"
    chat_id="${chat_id:-${TELEGRAM_CHAT_ID:-}}"

    if [[ -z "$token" ]] || [[ -z "$chat_id" ]]; then
        warn "Telegram alerts not configured."
        info "Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID env vars or in $ALERT_CONFIG"
        return 1
    fi

    curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
        -d "chat_id=${chat_id}" \
        -d "text=🚨 agent-deploy alert: ${message}" \
        -d "parse_mode=HTML" &>/dev/null

    log "Telegram alert sent: $message"
}

send_discord_alert() {
    local message="$1"
    local webhook

    if [[ -f "$ALERT_CONFIG" ]]; then
        webhook=$(grep "^DISCORD_WEBHOOK=" "$ALERT_CONFIG" 2>/dev/null | cut -d= -f2)
    fi
    webhook="${webhook:-${DISCORD_WEBHOOK:-}}"

    if [[ -z "$webhook" ]]; then
        warn "Discord alerts not configured."
        return 1
    fi

    curl -s -X POST "$webhook" \
        -H "Content-Type: application/json" \
        -d "{\"content\": \"🚨 agent-deploy alert: ${message}\"}" &>/dev/null

    log "Discord alert sent: $message"
}

check_and_alert() {
    local agents
    agents=$(get_agents)
    [[ -z "$agents" ]] && return

    while IFS= read -r agent; do
        local pid port
        pid=$(get_agent_field "$agent" 3)
        port=$(get_agent_field "$agent" 4)

        local proc_health port_health
        proc_health=$(check_process "$pid")
        port_health=$(check_port "$port")

        if [[ "$proc_health" == "dead" ]]; then
            local msg="Agent '$agent' process is DEAD (PID: $pid)"
            err "$msg"
            send_telegram_alert "$msg" 2>/dev/null || true
            send_discord_alert "$msg" 2>/dev/null || true

            # Attempt auto-restart
            warn "Attempting to restart $agent..."
            if systemctl is-enabled "${agent}-gateway" &>/dev/null || \
               systemctl is-enabled "openclaw-gateway" &>/dev/null; then
                systemctl restart "${agent}-gateway" 2>/dev/null || \
                systemctl restart "openclaw-gateway" 2>/dev/null || true
                log "Restart attempted via systemd"
            fi
        fi

        if [[ "$port_health" == "closed" ]] && [[ "$port" != "0" ]]; then
            local msg="Agent '$agent' port $port is CLOSED"
            warn "$msg"
            send_telegram_alert "$msg" 2>/dev/null || true
        fi
    done <<< "$agents"
}

setup_alerts() {
    echo ""
    info "Alert Configuration"
    echo ""

    read -rp "Telegram Bot Token (or press Enter to skip): " tg_token
    read -rp "Telegram Chat ID: " tg_chat
    read -rp "Discord Webhook URL: " dc_webhook

    mkdir -p "$(dirname "$ALERT_CONFIG")"
    cat > "$ALERT_CONFIG" <<EOF
# agent-deploy alert configuration
TELEGRAM_TOKEN=${tg_token}
TELEGRAM_CHAT_ID=${tg_chat}
DISCORD_WEBHOOK=${dc_webhook}
CHECK_INTERVAL=30
EOF

    log "Alert config saved to $ALERT_CONFIG"

    if [[ -n "$tg_token" ]]; then
        send_telegram_alert "✅ agent-deploy alerts configured and working!"
    fi
}

# ─── Log Viewer ──────────────────────────────────────────────────────────────
show_logs() {
    local agent="${1:-}" lines="${2:-50}"

    if [[ -n "$agent" ]]; then
        local log_file="$LOG_DIR/${agent}.log"
        if [[ -f "$log_file" ]]; then
            echo -e "${BOLD}=== $agent log (last $lines lines) ===${NC}"
            tail -n "$lines" "$log_file"
        else
            # Try systemd journal
            if journalctl -u "${agent}-gateway" --no-pager -n "$lines" 2>/dev/null; then
                return
            fi
            warn "No logs found for $agent"
        fi
    else
        # Show deploy log
        local deploy_log="$LOG_DIR/deploy.log"
        if [[ -f "$deploy_log" ]]; then
            echo -e "${BOLD}=== Deployment Log (last $lines entries) ===${NC}"
            tail -n "$lines" "$deploy_log" | while IFS='|' read -r ts event agent details; do
                echo "  $ts  [$event]  $agent  $details"
            done
        else
            warn "No deployment log found"
        fi

        echo ""
        echo -e "${BOLD}=== Available agent logs ===${NC}"
        ls -1 "$LOG_DIR"/*.log 2>/dev/null | while read -r f; do
            echo "  $(basename "$f") ($(wc -l < "$f") lines)"
        done
    fi
    echo ""
}

# ─── Daemon Mode ────────────────────────────────────────────────────────────
run_daemon() {
    local interval="${1:-30}"
    info "Starting health check daemon (interval: ${interval}s)..."
    info "PID: $$"
    echo "$$" > "$CONFIG_DIR/monitor.pid"

    trap 'rm -f "$CONFIG_DIR/monitor.pid"; exit 0' INT TERM

    while true; do
        check_and_alert
        sleep "$interval"
    done
}

# ─── Main ────────────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
agent-deploy — Agent Health Monitor

Usage:
  ./monitor.sh <command> [options]

Commands:
  status              Show all agents status dashboard
  watch [interval]    Real-time monitoring (default: 5s refresh)
  alert               Configure Telegram/Discord alerts
  daemon [interval]   Run continuous health checks (default: 30s)
  logs [agent] [n]    View logs (default: all agents, 50 lines)
  check               One-shot health check with alerts

Examples:
  ./monitor.sh status
  ./monitor.sh watch 10
  ./monitor.sh alert
  ./monitor.sh daemon 60
  ./monitor.sh logs openclaw 100
EOF
}

main() {
    mkdir -p "$LOG_DIR"

    if [[ $# -lt 1 ]]; then
        usage
        exit 0
    fi

    local cmd="$1"; shift

    case "$cmd" in
        status)   show_status ;;
        watch)    watch_agents "${1:-5}" ;;
        alert)    setup_alerts ;;
        daemon)   run_daemon "${1:-30}" ;;
        logs)     show_logs "${1:-}" "${2:-50}" ;;
        check)    check_and_alert; show_status ;;
        *)        usage; exit 1 ;;
    esac
}

main "$@"
