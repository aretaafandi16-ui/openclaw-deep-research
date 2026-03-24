#!/usr/bin/env bash
# agent-deploy — Auto-scaling for AI agent workloads
# scale.sh: Scale resources up/down, enable auto-scaling
# Usage: ./scale.sh <command> [options]
# Dependencies: zero (pure bash)

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
CONFIG_DIR="${AGENT_DEPLOY_CONFIG:-$HOME/.agent-deploy}"
STATE_FILE="$CONFIG_DIR/state.json"
LOG_DIR="$CONFIG_DIR/logs"
SCALE_CONFIG="$CONFIG_DIR/scaling.conf"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

# ─── Resource Monitoring ────────────────────────────────────────────────────
get_cpu_load() {
    uptime | awk -F'load average:' '{print $2}' | cut -d, -f1 | xargs
}

get_memory_usage() {
    free | awk '/Mem:/ {printf "%.0f", $3/$2*100}'
}

get_agent_memory() {
    local pid="$1"
    ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.0f", $1/1024}' || echo "0"
}

# ─── Scale Up: Resource Limits ──────────────────────────────────────────────
scale_up() {
    local agent="${1:-}"

    echo ""
    info "Analyzing resource needs..."

    local mem_usage cpu_load
    mem_usage=$(get_memory_usage)
    cpu_load=$(get_cpu_load)
    local cpu_cores
    cpu_cores=$(nproc)

    echo ""
    echo -e "${BOLD}Current State:${NC}"
    echo "  CPU Load:   $cpu_load / $cpu_cores cores"
    echo "  Memory:     ${mem_usage}% used"
    echo ""

    if [[ -n "$agent" ]]; then
        # Scale specific agent
        local pid
        pid=$(grep "^${agent}|" "$STATE_FILE" 2>/dev/null | tail -1 | cut -d'|' -f3)

        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            local agent_mem
            agent_mem=$(get_agent_memory "$pid")
            info "Agent '$agent' using ${agent_mem}MB (PID: $pid)"

            # Increase Node.js memory limit if applicable
            if grep -q "node" /proc/"$pid"/cmdline 2>/dev/null; then
                warn "To increase Node.js heap, restart with --max-old-space-size=<MB>"
                info "Example: NODE_OPTIONS='--max-old-space-size=4096' openclaw gateway start"
            fi
        fi
    fi

    # General scale-up advice
    echo -e "${BOLD}Scale-Up Actions:${NC}"

    if [[ "$mem_usage" -gt 85 ]]; then
        echo "  🔴 Memory critical (${mem_usage}%)"
        echo "     → Upgrade server RAM"
        echo "     → Or reduce agent memory (check for memory leaks)"
        echo ""
    fi

    if awk "BEGIN {exit !($cpu_load > $cpu_cores * 0.8)}" 2>/dev/null; then
        echo "  🔴 CPU overloaded ($cpu_load / $cpu_cores)"
        echo "     → Upgrade to more cores"
        echo "     → Or reduce concurrent workload"
        echo ""
    fi

    # Kernel tuning for higher load
    if [[ "$mem_usage" -gt 70 ]]; then
        info "Applying kernel tuning for high-load scenario..."
        # Increase file descriptors
        ulimit -n 65536 2>/dev/null || true
        echo "  ✓ File descriptors: $(ulimit -n)"

        # Increase inotify limits
        if [[ -w /proc/sys/fs/inotify/max_user_instances ]]; then
            echo 512 > /proc/sys/fs/inotify/max_user_instances 2>/dev/null || true
            echo "  ✓ inotify instances: 512"
        fi
    fi

    log "Scale-up analysis complete"
    echo ""
}

# ─── Scale Down: Optimize ──────────────────────────────────────────────────
scale_down() {
    echo ""
    info "Analyzing for scale-down opportunities..."
    echo ""

    local mem_usage cpu_load
    mem_usage=$(get_memory_usage)
    cpu_load=$(get_cpu_load)

    echo -e "${BOLD}Current State:${NC}"
    echo "  CPU Load:   $cpu_load"
    echo "  Memory:     ${mem_usage}% used"
    echo ""

    if [[ "$mem_usage" -lt 30 ]]; then
        log "Memory usage is low (${mem_usage}%) — good candidate for downsizing"
    fi

    # Check for orphaned processes
    echo -e "${BOLD}Cleanup Actions:${NC}"

    # Clear old logs
    if [[ -d "$LOG_DIR" ]]; then
        local log_size
        log_size=$(du -sh "$LOG_DIR" 2>/dev/null | awk '{print $1}')
        info "Log directory: $log_size"

        # Truncate logs older than 7 days
        find "$LOG_DIR" -name "*.log" -mtime +7 -exec truncate -s 0 {} \; 2>/dev/null
        log "Truncated logs older than 7 days"
    fi

    # Clean npm cache
    if command -v npm &>/dev/null; then
        local npm_cache
        npm_cache=$(npm cache ls 2>/dev/null | wc -l || echo "0")
        if [[ "$npm_cache" -gt 100 ]]; then
            npm cache clean --force 2>/dev/null || true
            log "Cleaned npm cache"
        fi
    fi

    # Clean apt cache
    if command -v apt-get &>/dev/null; then
        apt-get clean 2>/dev/null || true
        log "Cleaned apt cache"
    fi

    # Clean tmp
    find /tmp -type f -atime +7 -delete 2>/dev/null || true
    log "Cleaned /tmp files older than 7 days"

    # Show freed space
    echo ""
    echo -e "${BOLD}💡 Downsize Tips:${NC}"
    echo "  • If CPU load < 20%: you can halve your cores"
    echo "  • If Memory < 30%: you can halve your RAM"
    echo "  • Hetzner CX22 (€4.50/mo) is cheapest for small workloads"
    echo ""
}

# ─── Auto-Scaling Daemon ────────────────────────────────────────────────────
enable_auto_scaling() {
    local scale_up_threshold="${1:-85}"
    local scale_down_threshold="${2:-30}"
    local check_interval="${3:-60}"

    mkdir -p "$(dirname "$SCALE_CONFIG")"
    cat > "$SCALE_CONFIG" <<EOF
# agent-deploy auto-scaling configuration
SCALE_UP_THRESHOLD=${scale_up_threshold}
SCALE_DOWN_THRESHOLD=${scale_down_threshold}
CHECK_INTERVAL=${check_interval}
MAX_SCALE_UPS_PER_DAY=2
AUTO_SCALE=true
EOF

    log "Auto-scaling enabled"
    info "  Scale up at: ${scale_up_threshold}% memory"
    info "  Scale down at: ${scale_down_threshold}% memory"
    info "  Check interval: ${check_interval}s"

    info "Starting auto-scaling daemon..."
    info "PID: $$"
    echo "$$" > "$CONFIG_DIR/scaling.pid"

    trap 'rm -f "$CONFIG_DIR/scaling.pid"; exit 0' INT TERM

    local scale_ups_today=0
    local last_scale_date=""

    while true; do
        local today
        today=$(date +%Y-%m-%d)
        if [[ "$today" != "$last_scale_date" ]]; then
            scale_ups_today=0
            last_scale_date="$today"
        fi

        local mem_usage
        mem_usage=$(get_memory_usage)

        if [[ "$mem_usage" -gt "$scale_up_threshold" ]]; then
            if [[ "$scale_ups_today" -lt 2 ]]; then
                warn "Memory at ${mem_usage}% — scaling up!"
                scale_up
                ((scale_ups_today++))
            else
                warn "Memory at ${mem_usage}% but daily scale-up limit reached"
            fi
        elif [[ "$mem_usage" -lt "$scale_down_threshold" ]]; then
            info "Memory at ${mem_usage}% — system is lean"
        fi

        sleep "$check_interval"
    done
}

show_status() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  📈 agent-deploy — Scaling Status                         ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    local mem_usage cpu_load cpu_cores disk_used
    mem_usage=$(get_memory_usage)
    cpu_load=$(get_cpu_load)
    cpu_cores=$(nproc)
    disk_used=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}')

    echo -e "${BOLD}Resource Status:${NC}"
    echo ""

    # CPU bar
    local cpu_pct
    cpu_pct=$(awk "BEGIN {printf \"%.0f\", ($cpu_load / $cpu_cores) * 100}")
    printf "  CPU    [%-30s] %3s%% (%s/%s cores)\n" \
        "$(printf '#%.0s' $(seq 1 $((cpu_pct * 30 / 100))))" \
        "$cpu_pct" "$(printf '%.1f' "$cpu_load")" "$cpu_cores"

    # Memory bar
    printf "  Memory [%-30s] %3s%%\n" \
        "$(printf '#%.0s' $(seq 1 $((mem_usage * 30 / 100))))" \
        "$mem_usage"

    # Disk bar
    printf "  Disk   [%-30s] %3s%%\n" \
        "$(printf '#%.0s' $(seq 1 $((disk_used * 30 / 100))))" \
        "$disk_used"

    echo ""

    # Scaling recommendation
    echo -e "${BOLD}Scaling Recommendation:${NC}"
    if [[ "$mem_usage" -gt 85 ]] || [[ "$cpu_pct" -gt 80 ]]; then
        echo -e "  ${RED}⬆️  SCALE UP${NC} — resources are constrained"
    elif [[ "$mem_usage" -lt 30 ]] && [[ "$cpu_pct" -lt 20 ]]; then
        echo -e "  ${GREEN}⬇️  SCALE DOWN${NC} — resources are under-utilized"
    else
        echo -e "  ${GREEN}✓  OK${NC} — resource usage is balanced"
    fi

    # Auto-scaling status
    if [[ -f "$CONFIG_DIR/scaling.pid" ]]; then
        local pid
        pid=$(cat "$CONFIG_DIR/scaling.pid")
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "  ${GREEN}Auto-scaling: ENABLED${NC} (PID: $pid)"
        else
            echo -e "  ${YELLOW}Auto-scaling: STALE${NC} (process died)"
        fi
    else
        echo -e "  ${YELLOW}Auto-scaling: DISABLED${NC}"
    fi

    echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
agent-deploy — Auto-Scaling

Usage:
  ./scale.sh <command> [options]

Commands:
  up                Analyze and recommend scale-up actions
  down              Clean up and recommend scale-down
  auto [up] [down]  Enable auto-scaling (default: 85%/30% thresholds)
  status            Show current scaling status
  stop              Stop auto-scaling daemon

Examples:
  ./scale.sh up
  ./scale.sh down
  ./scale.sh auto 80 25 30    # Scale up at 80%, down at 25%, check every 30s
  ./scale.sh status
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
        up)      scale_up "${1:-}" ;;
        down)    scale_down ;;
        auto)    enable_auto_scaling "${1:-85}" "${2:-30}" "${3:-60}" ;;
        status)  show_status ;;
        stop)
            if [[ -f "$CONFIG_DIR/scaling.pid" ]]; then
                local pid
                pid=$(cat "$CONFIG_DIR/scaling.pid")
                kill "$pid" 2>/dev/null && log "Auto-scaling stopped" || warn "Process not running"
                rm -f "$CONFIG_DIR/scaling.pid"
            else
                warn "Auto-scaling not running"
            fi
            ;;
        *)       usage; exit 1 ;;
    esac
}

main "$@"
