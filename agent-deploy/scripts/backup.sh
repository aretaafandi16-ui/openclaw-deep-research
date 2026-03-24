#!/usr/bin/env bash
# agent-deploy — Backup & Restore for AI agents
# backup.sh: Create, list, restore, and schedule backups
# Usage: ./backup.sh <command> [options]
# Dependencies: zero (pure bash)

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
CONFIG_DIR="${AGENT_DEPLOY_CONFIG:-$HOME/.agent-deploy}"
STATE_FILE="$CONFIG_DIR/state.json"
BACKUP_DIR="$CONFIG_DIR/backups"
LOG_DIR="$CONFIG_DIR/logs"
MAX_BACKUPS="${MAX_BACKUPS:-10}"

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

# ─── Backup Targets ─────────────────────────────────────────────────────────
get_backup_targets() {
    local targets=()

    # OpenClaw config/data
    [[ -d "$HOME/.openclaw" ]] && targets+=("$HOME/.openclaw:openclaw-config")

    # Agent deploy state
    [[ -f "$STATE_FILE" ]] && targets+=("$CONFIG_DIR:agent-deploy-state")

    # Common agent directories
    for dir in /opt/agents/*; do
        [[ -d "$dir" ]] && targets+=("$dir:$(basename "$dir")")
    done

    # User-specified targets from config
    if [[ -f "$CONFIG_DIR/backup-targets.txt" ]]; then
        while IFS=: read -r path label; do
            [[ -d "$path" || -f "$path" ]] && targets+=("$path:${label:-$(basename "$path")}")
        done < "$CONFIG_DIR/backup-targets.txt"
    fi

    printf '%s\n' "${targets[@]}"
}

# ─── Create Backup ──────────────────────────────────────────────────────────
create_backup() {
    local label="${1:-manual}"
    local ts
    ts="$(date +%Y%m%d-%H%M%S)"
    local backup_name="backup-${label}-${ts}"
    local backup_path="$BACKUP_DIR/$backup_name"
    local manifest="$backup_path/manifest.txt"

    mkdir -p "$backup_path"

    echo ""
    info "Creating backup: $backup_name"
    echo ""

    local total_size=0
    local count=0

    while IFS=: read -r src name; do
        local dest="$backup_path/$name"

        if [[ -d "$src" ]]; then
            # Use rsync if available, otherwise tar
            if command -v rsync &>/dev/null; then
                rsync -a --quiet "$src/" "$dest/"
            else
                mkdir -p "$dest"
                tar -czf "$dest.tar.gz" -C "$(dirname "$src")" "$(basename "$src")" 2>/dev/null
            fi
        elif [[ -f "$src" ]]; then
            mkdir -p "$(dirname "$dest")"
            cp "$src" "$dest"
        fi

        local size
        size=$(du -sb "$dest" 2>/dev/null | awk '{print $1}' || echo "0")
        total_size=$((total_size + size))
        ((count++))

        echo "  ✓ $name ($(numfmt --to=iec "$size" 2>/dev/null || echo "${size}B"))"
    done < <(get_backup_targets)

    # Write manifest
    cat > "$manifest" <<EOF
backup_name: $backup_name
created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
label: $label
targets: $count
total_size: $total_size
total_size_human: $(numfmt --to=iec "$total_size" 2>/dev/null || echo "${total_size}B")
hostname: $(hostname)
user: $(whoami)
EOF

    # Create compressed archive
    local archive="$BACKUP_DIR/${backup_name}.tar.gz"
    tar -czf "$archive" -C "$BACKUP_DIR" "$backup_name" 2>/dev/null
    rm -rf "$backup_path"

    local archive_size
    archive_size=$(stat -c%s "$archive" 2>/dev/null || stat -f%z "$archive" 2>/dev/null || echo "0")

    echo ""
    log "Backup complete: ${backup_name}.tar.gz"
    info "Size: $(numfmt --to=iec "$archive_size" 2>/dev/null || echo "${archive_size}B") | Targets: $count"
    echo ""

    # Cleanup old backups
    cleanup_old_backups

    echo "$archive"
}

# ─── List Backups ───────────────────────────────────────────────────────────
list_backups() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  📦 agent-deploy — Backups                               ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    local backups
    backups=$(ls -1t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null)

    if [[ -z "$backups" ]]; then
        warn "No backups found."
        info "Run './scripts/backup.sh create' to create your first backup."
        echo ""
        return
    fi

    printf "${BOLD}%-45s %-12s %-20s${NC}\n" "BACKUP" "SIZE" "DATE"
    echo "$(printf '%.0s─' {1..80})"

    while IFS= read -r archive; do
        local name size date_str
        name=$(basename "$archive")
        size=$(stat -c%s "$archive" 2>/dev/null || stat -f%z "$archive" 2>/dev/null || echo "0")
        date_str=$(stat -c%y "$archive" 2>/dev/null | cut -d. -f1 || echo "unknown")

        printf "%-45s %-12s %-20s\n" \
            "$name" \
            "$(numfmt --to=iec "$size" 2>/dev/null || echo "${size}B")" \
            "$date_str"
    done <<< "$backups"

    local total
    total=$(du -sh "$BACKUP_DIR" 2>/dev/null | awk '{print $1}')
    echo ""
    info "Total backup storage: $total"
    echo ""
}

# ─── Restore Backup ─────────────────────────────────────────────────────────
restore_backup() {
    local backup="${1:-}"

    if [[ -z "$backup" ]]; then
        # Restore the latest
        backup=$(ls -1t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | head -1)
        if [[ -z "$backup" ]]; then
            err "No backups found to restore"
            exit 1
        fi
        info "Restoring latest backup: $(basename "$backup")"
    elif [[ ! -f "$backup" ]]; then
        # Try as filename in backup dir
        backup="$BACKUP_DIR/$backup"
        [[ ! "$backup" == *.tar.gz ]] && backup="${backup}.tar.gz"
        if [[ ! -f "$backup" ]]; then
            err "Backup not found: $1"
            exit 1
        fi
    fi

    echo ""
    warn "This will overwrite existing data. Continue? (y/N)"
    read -r confirm
    [[ "$confirm" != "y" && "$confirm" != "Y" ]] && { info "Cancelled."; exit 0; }

    local restore_dir
    restore_dir=$(mktemp -d)
    tar -xzf "$backup" -C "$restore_dir" 2>/dev/null

    local backup_name
    backup_name=$(ls "$restore_dir")

    info "Restoring from $backup_name..."

    # Read manifest
    if [[ -f "$restore_dir/$backup_name/manifest.txt" ]]; then
        cat "$restore_dir/$backup_name/manifest.txt"
        echo ""
    fi

    # Restore each target
    for item in "$restore_dir/$backup_name"/*; do
        [[ "$(basename "$item")" == "manifest.txt" ]] && continue
        [[ "$(basename "$item")" == "agent-deploy-state" ]] && continue

        local item_name
        item_name=$(basename "$item")

        if [[ "$item_name" == "openclaw-config" ]]; then
            if [[ -d "$item" ]]; then
                cp -r "$item/"* "$HOME/.openclaw/" 2>/dev/null || true
                log "Restored OpenClaw config"
            fi
        else
            local dest="/opt/agents/$item_name"
            mkdir -p "$dest"
            if [[ -d "$item" ]]; then
                cp -r "$item/"* "$dest/" 2>/dev/null || true
            elif [[ -f "${item}.tar.gz" ]]; then
                tar -xzf "${item}.tar.gz" -C "$dest" 2>/dev/null || true
            fi
            log "Restored $item_name to $dest"
        fi
    done

    rm -rf "$restore_dir"
    echo ""
    log "Restore complete!"
    echo ""
}

# ─── Cleanup Old Backups ────────────────────────────────────────────────────
cleanup_old_backups() {
    local count
    count=$(ls -1 "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | wc -l)

    if [[ $count -gt $MAX_BACKUPS ]]; then
        local to_remove=$((count - MAX_BACKUPS))
        info "Cleaning up $to_remove old backup(s) (max: $MAX_BACKUPS)..."
        ls -1t "$BACKUP_DIR"/backup-*.tar.gz | tail -n "$to_remove" | xargs rm -f
    fi
}

# ─── Schedule Backups ───────────────────────────────────────────────────────
schedule_backup() {
    local schedule="${1:-daily}"
    local cron_expr

    case "$schedule" in
        hourly)  cron_expr="0 * * * *" ;;
        daily)   cron_expr="0 3 * * *" ;;
        weekly)  cron_expr="0 3 * * 0 ;;
        *)       cron_expr="$schedule" ;;
    esac

    local script_path
    script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup.sh"
    local cron_line="${cron_expr} ${script_path} create scheduled >> ${LOG_DIR}/backup-cron.log 2>&1"

    # Check existing crontab
    if crontab -l 2>/dev/null | grep -qF "backup.sh create"; then
        warn "Backup cron job already exists. Updating..."
        crontab -l 2>/dev/null | grep -vF "backup.sh create" | {
            cat
            echo "$cron_line"
        } | crontab -
    else
        (crontab -l 2>/dev/null; echo "$cron_line") | crontab -
    fi

    log "Backup scheduled: $schedule ($cron_expr)"
    info "Cron: $cron_line"
}

# ─── Main ────────────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
agent-deploy — Backup & Restore

Usage:
  ./backup.sh <command> [options]

Commands:
  create [label]        Create a new backup
  list                  List all backups
  restore [backup]      Restore backup (default: latest)
  schedule [interval]   Schedule automatic backups (daily/hourly/weekly)
  add-target <path>     Add custom backup target

Examples:
  ./backup.sh create
  ./backup.sh create pre-upgrade
  ./backup.sh list
  ./backup.sh restore
  ./backup.sh restore backup-manual-20260324-120000.tar.gz
  ./backup.sh schedule daily
  ./backup.sh add-target /home/user/data:my-data
EOF
}

main() {
    mkdir -p "$BACKUP_DIR" "$LOG_DIR"

    if [[ $# -lt 1 ]]; then
        usage
        exit 0
    fi

    local cmd="$1"; shift

    case "$cmd" in
        create)   create_backup "${1:-manual}" ;;
        list)     list_backups ;;
        restore)  restore_backup "${1:-}" ;;
        schedule) schedule_backup "${1:-daily}" ;;
        add-target)
            local path="${1:?Path required}"
            local label="${2:-$(basename "$1")}"
            echo "${path}:${label}" >> "$CONFIG_DIR/backup-targets.txt"
            log "Added backup target: $path ($label)"
            ;;
        *)        usage; exit 1 ;;
    esac
}

main "$@"
