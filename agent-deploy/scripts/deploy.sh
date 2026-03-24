#!/usr/bin/env bash
# agent-deploy — One-click AI agent deployment toolkit
# deploy.sh: Install, configure, and run AI agents on any VPS
# Usage: ./deploy.sh <agent> [options]
# Dependencies: zero (pure bash)

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="${AGENT_DEPLOY_CONFIG:-$HOME/.agent-deploy}"
CONFIG_FILE="$CONFIG_DIR/config.yaml"
STATE_FILE="$CONFIG_DIR/state.json"
LOG_DIR="$CONFIG_DIR/logs"
MAX_LOG_SIZE=$((10 * 1024 * 1024))  # 10MB

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*" >&2; }
info()  { echo -e "${CYAN}[i]${NC} $*"; }
step()  { echo -e "${BLUE}[→]${NC} $*"; }

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

ensure_dirs() {
    mkdir -p "$CONFIG_DIR" "$LOG_DIR"
    touch "$STATE_FILE"
}

log_event() {
    local agent="$1" event="$2" details="${3:-}"
    local ts
    ts="$(timestamp)"
    echo "$ts|$event|$agent|$details" >> "$LOG_DIR/deploy.log"
}

# ─── State Management (JSONL-based, no jq required) ────────────────────────
get_state() {
    local agent="$1" field="$2"
    grep "^${agent}|" "$STATE_FILE" 2>/dev/null | tail -1 | cut -d'|' -f"$field"
}

set_state() {
    local agent="$1" status="$2" pid="${3:-0}" port="${4:-0}" version="${5:-}"
    # Remove old state for this agent
    if [[ -f "$STATE_FILE" ]]; then
        grep -v "^${agent}|" "$STATE_FILE" > "${STATE_FILE}.tmp" 2>/dev/null || true
        mv "${STATE_FILE}.tmp" "$STATE_FILE"
    fi
    echo "${agent}|${status}|${pid}|${port}|${version}|$(timestamp)" >> "$STATE_FILE"
}

# ─── Agent Definitions ──────────────────────────────────────────────────────
declare -A AGENT_REPO AGENT_BRANCH AGENT_INSTALL_CMD AGENT_START_CMD AGENT_PORT AGENT_SYSTEMD

setup_agent_defs() {
    AGENT_REPO[openclaw]="https://registry.npmjs.org/openclaw"
    AGENT_INSTALL_CMD[openclaw]="npm install -g openclaw"
    AGENT_START_CMD[openclaw]="openclaw gateway start"
    AGENT_PORT[openclaw]="3000"
    AGENT_SYSTEMD[openclaw]="openclaw-gateway"

    AGENT_REPO[autogpt]="https://github.com/Significant-Gravitas/AutoGPT.git"
    AGENT_BRANCH[autogpt]="stable"
    AGENT_INSTALL_CMD[autogpt]="pip install -r requirements.txt"
    AGENT_START_CMD[autogpt]="python -m autogpt"
    AGENT_PORT[autogpt]="8000"

    AGENT_REPO[elizaos]="https://github.com/elizaOS/eliza.git"
    AGENT_BRANCH[elizaos]="main"
    AGENT_INSTALL_CMD[elizaos]="npm install && npm run build"
    AGENT_START_CMD[elizaos]="npm start"
    AGENT_PORT[elizaos]="3001"
}

# ─── Dependency Checks ──────────────────────────────────────────────────────
check_deps() {
    local missing=()
    for cmd in curl git; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        err "Missing dependencies: ${missing[*]}"
        err "Install with: apt-get install -y ${missing[*]}"
        exit 1
    fi
}

install_node_if_needed() {
    if ! command -v node &>/dev/null; then
        step "Installing Node.js 22.x..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash - &>/dev/null
        apt-get install -y nodejs &>/dev/null
        log "Node.js $(node -v) installed"
    fi
    if ! command -v npm &>/dev/null; then
        err "npm not found after Node.js install"
        exit 1
    fi
}

install_python_if_needed() {
    if ! command -v python3 &>/dev/null; then
        step "Installing Python 3..."
        apt-get install -y python3 python3-pip python3-venv &>/dev/null
        log "Python $(python3 --version) installed"
    fi
}

# ─── Systemd Service Creation ───────────────────────────────────────────────
create_systemd_service() {
    local name="$1" exec_start="$2" workdir="$3" user="${4:-$(whoami)}"
    local service_file="/etc/systemd/system/${name}.service"

    if [[ ! -w /etc/systemd/system ]]; then
        warn "Cannot write systemd service (not root?). Skipping auto-start."
        return 0
    fi

    cat > "$service_file" <<EOF
[Unit]
Description=Agent Deploy: ${name}
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${workdir}
ExecStart=${exec_start}
Restart=on-failure
RestartSec=10
StandardOutput=append:${LOG_DIR}/${name}.stdout.log
StandardError=append:${LOG_DIR}/${name}.stderr.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$name" &>/dev/null
    log "Systemd service '${name}' created"
}

# ─── Health Check ────────────────────────────────────────────────────────────
wait_for_port() {
    local port="$1" timeout="${2:-30}" elapsed=0
    info "Waiting for port $port to be ready (timeout: ${timeout}s)..."
    while [[ $elapsed -lt $timeout ]]; do
        if ss -tlnp 2>/dev/null | grep -q ":${port} " || \
           netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
            log "Port $port is ready (${elapsed}s)"
            return 0
        fi
        sleep 1
        ((elapsed++))
    done
    err "Port $port not ready after ${timeout}s"
    return 1
}

# ─── OpenClaw Deploy ────────────────────────────────────────────────────────
deploy_openclaw() {
    local deploy_dir="$1"
    local version="${VERSION:-latest}"

    install_node_if_needed

    step "Installing OpenClaw (version: $version)..."
    if [[ "$version" == "latest" ]]; then
        npm install -g openclaw 2>&1 | tail -3
    else
        npm install -g "openclaw@${version}" 2>&1 | tail -3
    fi

    local actual_version
    actual_version="$(openclaw --version 2>/dev/null || echo 'unknown')"
    log "OpenClaw $actual_version installed"

    # Initialize if not already done
    if [[ ! -f "$HOME/.openclaw/config.yaml" ]]; then
        step "Initializing OpenClaw..."
        openclaw init --non-interactive 2>/dev/null || true
    fi

    # Setup systemd
    local exec_cmd
    exec_cmd="$(which openclaw) gateway start"
    create_systemd_service "openclaw-gateway" "$exec_cmd" "$HOME" "$(whoami)"

    # Start the service
    step "Starting OpenClaw gateway..."
    if systemctl is-active openclaw-gateway &>/dev/null; then
        systemctl restart openclaw-gateway
    else
        openclaw gateway start &>/dev/null || systemctl start openclaw-gateway &>/dev/null || true
    fi

    set_state "openclaw" "running" "$$" "3000" "$actual_version"
    log_event "openclaw" "deploy" "version=$actual_version"
    log "OpenClaw deployed and running!"
}

# ─── Git-based Agent Deploy ─────────────────────────────────────────────────
deploy_git_agent() {
    local agent="$1" deploy_dir="$2"
    local repo="${AGENT_REPO[$agent]}"
    local branch="${AGENT_BRANCH[$agent]:-main}"

    install_python_if_needed
    command -v node &>/dev/null || install_node_if_needed

    step "Cloning $agent from $repo (branch: $branch)..."
    if [[ -d "$deploy_dir/.git" ]]; then
        info "Repo exists, pulling latest..."
        cd "$deploy_dir" && git pull origin "$branch" 2>/dev/null || true
    else
        git clone --depth 1 -b "$branch" "$repo" "$deploy_dir" 2>&1 | tail -3
    fi

    cd "$deploy_dir"

    # Install dependencies
    step "Installing dependencies..."
    eval "${AGENT_INSTALL_CMD[$agent]}" 2>&1 | tail -5

    # Start agent
    step "Starting $agent..."
    local start_cmd="${AGENT_START_CMD[$agent]}"
    nohup bash -c "$start_cmd" >> "$LOG_DIR/${agent}.log" 2>&1 &
    local pid=$!

    wait_for_port "${AGENT_PORT[$agent]}" 30

    set_state "$agent" "running" "$pid" "${AGENT_PORT[$agent]}" "git"
    log_event "$agent" "deploy" "pid=$pid port=${AGENT_PORT[$agent]}"
    log "$agent deployed and running on port ${AGENT_PORT[$agent]} (PID: $pid)"
}

# ─── Custom Agent Deploy ────────────────────────────────────────────────────
deploy_custom() {
    local deploy_dir="$1"
    shift
    local commands=("$@")

    if [[ ${#commands[@]} -eq 0 ]]; then
        err "Custom deploy requires install commands"
        echo "Usage: ./deploy.sh custom --dir /path/to/project --cmd 'npm install' --cmd 'npm start'"
        exit 1
    fi

    step "Running custom deployment..."
    cd "$deploy_dir"

    for cmd in "${commands[@]}"; do
        step "Executing: $cmd"
        eval "$cmd"
    done

    set_state "custom" "running" "$$" "0" "custom"
    log_event "custom" "deploy" "dir=$deploy_dir"
    log "Custom agent deployed!"
}

# ─── SSL Setup ──────────────────────────────────────────────────────────────
setup_ssl() {
    local domain="$1"
    if ! command -v certbot &>/dev/null; then
        step "Installing certbot..."
        apt-get install -y certbot 2>/dev/null || pip3 install certbot 2>/dev/null
    fi

    step "Obtaining SSL certificate for $domain..."
    certbot certonly --standalone -d "$domain" --non-interactive --agree-tos \
        --email "admin@${domain}" 2>&1 | tail -5

    log "SSL certificate obtained for $domain"
}

# ─── Provider-specific Setup ────────────────────────────────────────────────
detect_provider() {
    if [[ -f /etc/digitalocean ]]; then
        echo "digitalocean"
    elif curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/ &>/dev/null; then
        echo "aws"
    elif curl -s --connect-timeout 2 -H "Metadata-Flavor: Google" http://metadata.google.internal/ &>/dev/null; then
        echo "gcp"
    elif [[ -f /etc/vultr ]]; then
        echo "vultr"
    elif dmidecode -s system-manufacturer 2>/dev/null | grep -qi hetzner; then
        echo "hetzner"
    else
        echo "unknown"
    fi
}

# ─── Main ────────────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
agent-deploy — One-click AI agent deployment toolkit

Usage:
  ./deploy.sh <agent> [options]

Agents:
  openclaw          Deploy OpenClaw AI assistant
  autogpt           Deploy AutoGPT agent
  elizaos           Deploy ElizaOS agent
  custom            Deploy custom project

Options:
  --dir <path>         Deploy directory (default: /opt/agents/<agent>)
  --version <ver>      Agent version (default: latest)
  --domain <domain>    Setup SSL for this domain
  --port <port>        Override default port
  --no-systemd         Don't create systemd service
  --cmd <command>      Custom install command (repeatable, for 'custom')
  --provider <name>    Force provider detection
  --help               Show this help

Examples:
  ./deploy.sh openclaw
  ./deploy.sh openclaw --version 0.15.0 --domain myagent.com
  ./deploy.sh custom --dir ./my-project --cmd 'npm install' --cmd 'npm start'
EOF
}

main() {
    if [[ $# -lt 1 ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        usage
        exit 0
    fi

    local agent="$1"; shift

    # Parse options
    local deploy_dir="" version="latest" domain="" port="" no_systemd=false
    local custom_cmds=()
    local provider=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dir)      deploy_dir="$2"; shift 2 ;;
            --version)  version="$2"; VERSION="$version"; shift 2 ;;
            --domain)   domain="$2"; shift 2 ;;
            --port)     port="$2"; shift 2 ;;
            --no-systemd) no_systemd=true; shift ;;
            --cmd)      custom_cmds+=("$2"); shift 2 ;;
            --provider) provider="$2"; shift 2 ;;
            *)          err "Unknown option: $1"; usage; exit 1 ;;
        esac
    done

    ensure_dirs
    check_deps
    setup_agent_defs

    # Default deploy dir
    [[ -z "$deploy_dir" ]] && deploy_dir="/opt/agents/${agent}"
    mkdir -p "$deploy_dir"

    local detected_provider
    detected_provider="${provider:-$(detect_provider)}"
    info "Provider: $detected_provider | Agent: $agent | Dir: $deploy_dir"

    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   🚀 agent-deploy — Deploying $agent${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    case "$agent" in
        openclaw)
            deploy_openclaw "$deploy_dir"
            ;;
        autogpt|elizaos)
            deploy_git_agent "$agent" "$deploy_dir"
            ;;
        custom)
            deploy_custom "$deploy_dir" "${custom_cmds[@]}"
            ;;
        *)
            err "Unknown agent: $agent"
            err "Supported: openclaw, autogpt, elizaos, custom"
            exit 1
            ;;
    esac

    # SSL setup if domain provided
    if [[ -n "$domain" ]]; then
        setup_ssl "$domain"
    fi

    echo ""
    log "Deployment complete!"
    echo ""
    info "Run './scripts/monitor.sh status' to check agent health"
    echo ""
}

main "$@"
