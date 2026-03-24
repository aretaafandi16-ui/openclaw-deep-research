#!/usr/bin/env bash
# agent-deploy — Cost optimization for AI agent hosting
# optimize.sh: Analyze spending, compare providers, recommend savings
# Usage: ./optimize.sh <command> [options]
# Dependencies: zero (pure bash, curl for provider APIs)

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
CONFIG_DIR="${AGENT_DEPLOY_CONFIG:-$HOME/.agent-deploy}"
STATE_FILE="$CONFIG_DIR/state.json"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

# ─── Provider Pricing (hardcoded, updated periodically) ─────────────────────
# Prices in USD/month for common instance types
declare -A PRICING

load_pricing() {
    # Format: "provider:size" -> price_usd_per_month
    # DigitalOcean
    PRICING["digitalocean:s-1vcpu-512mb"]="6"
    PRICING["digitalocean:s-1vcpu-1gb"]="12"
    PRICING["digitalocean:s-1vcpu-2gb"]="18"
    PRICING["digitalocean:s-2vcpu-2gb"]="24"
    PRICING["digitalocean:s-2vcpu-4gb"]="48"
    PRICING["digitalocean:s-4vcpu-8gb"]="96"

    # Vultr
    PRICING["vultr:vc2-1c-1gb"]="6"
    PRICING["vultr:vc2-1c-2gb"]="12"
    PRICING["vultr:vc2-2c-4gb"]="24"
    PRICING["vultr:vc2-4c-8gb"]="48"

    # Hetzner
    PRICING["hetzner:cx22"]="4.50"
    PRICING["hetzner:cx32"]="7.50"
    PRICING["hetzner:cx42"]="15"
    PRICING["hetzner:cx52"]="30"

    # AWS (EC2 on-demand, us-east-1)
    PRICING["aws:t3.micro"]="8.35"
    PRICING["aws:t3.small"]="16.70"
    PRICING["aws:t3.medium"]="33.41"
    PRICING["aws:t3.large"]="66.82"

    # Linode/Akamai
    PRICING["linode:g6-nanode"]="5"
    PRICING["linode:g6-standard-1"]="12"
    PRICING["linode:g6-standard-2"]="24"
}

# ─── System Resource Analysis ──────────────────────────────────────────────
analyze_system() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  💰 agent-deploy — Cost Optimization Analysis             ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Current resource usage
    local cpu_cores
    cpu_cores=$(nproc 2>/dev/null || echo "1")
    local mem_total_mb
    mem_total_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "1024")
    local mem_used_pct
    mem_used_pct=$(free | awk '/Mem:/ {printf "%.0f", $3/$2*100}' 2>/dev/null || echo "50")
    local disk_total
    disk_total=$(df -h / | awk 'NR==2 {print $2}' 2>/dev/null || echo "unknown")
    local disk_used_pct
    disk_used_pct=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}' 2>/dev/null || echo "50")
    local load_avg
    load_avg=$(uptime | awk -F'load average:' '{print $2}' | xargs 2>/dev/null || echo "0")
    local provider
    provider=$("$SCRIPT_DIR/deploy.sh" "" --help 2>/dev/null | head -1 || echo "unknown")

    echo -e "${BOLD}Current Server:${NC}"
    echo "  CPU Cores:    $cpu_cores"
    echo "  Memory:       ${mem_total_mb}MB (${mem_used_pct}% used)"
    echo "  Disk:         $disk_total (${disk_used_pct}% used)"
    echo "  Load Average: $load_avg"
    echo ""

    # Resource utilization assessment
    echo -e "${BOLD}Utilization Assessment:${NC}"

    local cpu_score="OK" mem_score="OK" disk_score="OK"

    # CPU assessment
    local load_first
    load_first=$(echo "$load_avg" | cut -d, -f1 | xargs)
    if awk "BEGIN {exit !($load_first < $cpu_cores * 0.2)}" 2>/dev/null; then
        cpu_score="UNDER"
        echo -e "  CPU:    ${GREEN}UNDER-UTILIZED${NC} (load ${load_first} / ${cpu_cores} cores)"
    elif awk "BEGIN {exit !($load_first > $cpu_cores * 0.8)}" 2>/dev/null; then
        cpu_score="OVER"
        echo -e "  CPU:    ${RED}OVER-UTILIZED${NC} (load ${load_first} / ${cpu_cores} cores)"
    else
        echo -e "  CPU:    ${GREEN}OK${NC} (load ${load_first} / ${cpu_cores} cores)"
    fi

    # Memory assessment
    if [[ "$mem_used_pct" -lt 30 ]]; then
        mem_score="UNDER"
        echo -e "  Memory: ${GREEN}UNDER-UTILIZED${NC} (${mem_used_pct}% used)"
    elif [[ "$mem_used_pct" -gt 85 ]]; then
        mem_score="OVER"
        echo -e "  Memory: ${RED}OVER-UTILIZED${NC} (${mem_used_pct}% used)"
    else
        echo -e "  Memory: ${GREEN}OK${NC} (${mem_used_pct}% used)"
    fi

    # Disk assessment
    if [[ "$disk_used_pct" -lt 30 ]]; then
        disk_score="UNDER"
        echo -e "  Disk:   ${GREEN}UNDER-UTILIZED${NC} (${disk_used_pct}% used)"
    elif [[ "$disk_used_pct" -gt 80 ]]; then
        disk_score="OVER"
        echo -e "  Disk:   ${RED}OVER-UTILIZED${NC} (${disk_used_pct}% used)"
    else
        echo -e "  Disk:   ${GREEN}OK${NC} (${disk_used_pct}% used)"
    fi

    echo ""

    # Recommendation
    if [[ "$cpu_score" == "UNDER" ]] && [[ "$mem_score" == "UNDER" ]]; then
        echo -e "${BOLD}💡 Recommendation:${NC} You can likely downsize! See provider comparison below."
    elif [[ "$cpu_score" == "OVER" ]] || [[ "$mem_score" == "OVER" ]]; then
        echo -e "${BOLD}💡 Recommendation:${NC} Consider upgrading your server."
    else
        echo -e "${BOLD}💡 Recommendation:${NC} Current size looks about right."
    fi
    echo ""
}

# ─── Provider Comparison ────────────────────────────────────────────────────
compare_providers() {
    local target_mem="${1:-1024}"  # MB
    local target_cpu="${2:-1}"

    load_pricing

    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  🔄 Provider Price Comparison (≥${target_mem}MB RAM, ≥${target_cpu} CPU)                ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Filter relevant sizes
    declare -A provider_cheapest
    for key in "${!PRICING[@]}"; do
        local provider size price
        provider="${key%%:*}"
        size="${key##*:}"
        price="${PRICING[$key]}"

        # Filter by target resources
        local meets_target=false
        case "$provider" in
            digitalocean)
                case "$size" in
                    *1vcpu*512mb*)  [[ $target_mem -le 512 ]] && meets_target=true ;;
                    *1vcpu*1gb*)    [[ $target_mem -le 1024 ]] && meets_target=true ;;
                    *1vcpu*2gb*)    [[ $target_mem -le 2048 ]] && meets_target=true ;;
                    *2vcpu*2gb*)    [[ $target_mem -le 2048 ]] && meets_target=true ;;
                    *2vcpu*4gb*)    [[ $target_mem -le 4096 ]] && meets_target=true ;;
                    *4vcpu*8gb*)    meets_target=true ;;
                esac
                ;;
            hetzner)
                case "$size" in
                    cx22) [[ $target_mem -le 4096 ]] && meets_target=true ;;
                    cx32) [[ $target_mem -le 8192 ]] && meets_target=true ;;
                    cx42|cx52) meets_target=true ;;
                esac
                ;;
            *)  meets_target=true ;;  # Include all for other providers
        esac

        if $meets_target; then
            local current_best="${provider_cheapest[$provider]:-}"
            if [[ -z "$current_best" ]] || awk "BEGIN {exit !($price < ${PRICING[${provider}:${current_best}]})}" 2>/dev/null; then
                provider_cheapest[$provider]="$size"
            fi
        fi
    done

    printf "${BOLD}%-15s %-20s %-10s${NC}\n" "PROVIDER" "INSTANCE" "$/MONTH"
    echo "$(printf '%.0s─' {1..48})"

    # Sort by price
    local sorted=()
    for provider in "${!provider_cheapest[@]}"; do
        local size="${provider_cheapest[$provider]}"
        local price="${PRICING[${provider}:${size}]}"
        sorted+=("${price}|${provider}|${size}")
    done

    IFS=$'\n' sorted=($(sort -t'|' -k1 -n <<< "${sorted[*]}")); unset IFS

    local cheapest_price="" cheapest_provider=""
    for entry in "${sorted[@]}"; do
        local price provider size
        price="${entry%%|*}"
        entry="${entry#*|}"
        provider="${entry%%|*}"
        size="${entry##*|}"

        local color="$NC"
        if [[ -z "$cheapest_price" ]]; then
            color="$GREEN"
            cheapest_price="$price"
            cheapest_provider="$provider"
        fi

        printf "${color}%-15s %-20s \$%-9s${NC}\n" "$provider" "$size" "$price"
    done

    echo ""
    if [[ -n "$cheapest_provider" ]]; then
        echo -e "${GREEN}💰 Best value: ${cheapest_provider} at \$${cheapest_price}/month${NC}"

        # Calculate savings vs most expensive
        local max_price="${sorted[-1]%%|*}"
        local savings
        savings=$(awk "BEGIN {printf \"%.2f\", $max_price - $cheapest_price}")
        echo -e "   Save up to ${GREEN}\$${savings}/month${NC} vs the most expensive option"
    fi
    echo ""
}

# ─── Per-Agent Resource Usage ──────────────────────────────────────────────
show_agent_costs() {
    echo ""
    echo -e "${BOLD}Per-Agent Resource Usage:${NC}"
    echo ""

    if [[ ! -f "$STATE_FILE" ]]; then
        warn "No agents deployed. Run deploy.sh first."
        return
    fi

    printf "${BOLD}%-15s %-10s %-12s %-8s${NC}\n" "AGENT" "CPU%" "MEMORY" "STATUS"
    echo "$(printf '%.0s─' {1..48})"

    while IFS='|' read -r agent status pid port version ts; do
        local cpu_pct mem_mb agent_status
        cpu_pct=$(ps -o %cpu= -p "$pid" 2>/dev/null | xargs || echo "0")
        mem_mb=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.0f", $1/1024}' || echo "0")
        agent_status=$(kill -0 "$pid" 2>/dev/null && echo "running" || echo "dead")

        local color="$NC"
        [[ "$agent_status" == "dead" ]] && color="$RED"

        printf "${color}%-15s %-10s %-12s %-8s${NC}\n" \
            "$agent" "${cpu_pct}%" "${mem_mb}MB" "$agent_status"
    done < "$STATE_FILE"

    echo ""
}

# ─── Recommendations ────────────────────────────────────────────────────────
recommend() {
    analyze_system
    show_agent_costs

    local mem_total_mb
    mem_total_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "1024")

    echo -e "${BOLD}💡 Smart Recommendations:${NC}"
    echo ""

    # Resource-based recommendations
    local mem_used_pct
    mem_used_pct=$(free | awk '/Mem:/ {printf "%.0f", $3/$2*100}' 2>/dev/null || echo "50")

    if [[ "$mem_used_pct" -lt 30 ]]; then
        local smaller_size=$((mem_total_mb / 2))
        echo "  1. You're using ${mem_used_pct}% of your ${mem_total_mb}MB RAM."
        echo "     Consider downsizing to ${smaller_size}MB to save ~50% on hosting."
        echo ""
    fi

    if [[ "$mem_used_pct" -gt 85 ]]; then
        echo "  1. ⚠️  Memory usage is critical (${mem_used_pct}%)."
        echo "     Upgrade your server or optimize agent memory usage."
        echo ""
    fi

    # Multi-agent consolidation
    local agent_count
    agent_count=$(wc -l < "$STATE_FILE" 2>/dev/null || echo "0")
    if [[ "$agent_count" -gt 1 ]]; then
        echo "  2. Running $agent_count agents on one server."
        echo "     Consolidation saves vs. separate instances."
        echo ""
    fi

    # Provider recommendation
    echo "  3. Best value providers for your workload:"
    load_pricing

    # Find the cheapest option that fits
    local best_price=999999 best_option=""
    for key in "${!PRICING[@]}"; do
        local price="${PRICING[$key]}"
        if awk "BEGIN {exit !($price < $best_price)}" 2>/dev/null; then
            best_price="$price"
            best_option="$key"
        fi
    done

    if [[ -n "$best_option" ]]; then
        echo "     → ${best_option} at \$${best_price}/month"
    fi

    echo ""

    # Scaling tips
    echo -e "${BOLD}General Optimization Tips:${NC}"
    echo "  • Use systemd for auto-restart (saves downtime costs)"
    echo "  • Enable log rotation to prevent disk fill"
    echo "  • Schedule backups during off-peak hours"
    echo "  • Monitor with ./monitor.sh daemon for auto-healing"
    echo "  • Use spot/preemptible instances for non-critical agents"
    echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
agent-deploy — Cost Optimization

Usage:
  ./optimize.sh <command> [options]

Commands:
  analyze             Analyze current server resource usage
  compare [mem] [cpu] Compare provider pricing (default: 1024MB, 1 CPU)
  recommend           Get personalized cost-saving recommendations
  agents              Show per-agent resource usage

Examples:
  ./optimize.sh analyze
  ./optimize.sh compare 2048 2     # For 2GB RAM, 2 CPU
  ./optimize.sh recommend
  ./optimize.sh agents
EOF
}

main() {
    if [[ $# -lt 1 ]]; then
        usage
        exit 0
    fi

    local cmd="$1"; shift

    case "$cmd" in
        analyze)   analyze_system ;;
        compare)   compare_providers "${1:-1024}" "${2:-1}" ;;
        recommend) recommend ;;
        agents)    show_agent_costs ;;
        *)         usage; exit 1 ;;
    esac
}

main "$@"
