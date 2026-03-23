#!/usr/bin/env bash
# sysinfo.sh — Quick system health snapshot (one-liner friendly)
# Usage: bash sysinfo.sh [--json]

set -euo pipefail

JSON=false
[[ "${1:-}" == "--json" ]] && JSON=true

# Gather metrics
HOSTNAME=$(hostname)
UPTIME=$(uptime -p 2>/dev/null || uptime | sed 's/.*up /up /' | sed 's/,.*//')
LOAD=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
CPU_CORES=$(nproc 2>/dev/null || echo "?")
MEM_TOTAL=$(free -m | awk '/Mem:/{print $2}')
MEM_USED=$(free -m | awk '/Mem:/{print $3}')
MEM_PCT=$(( MEM_USED * 100 / MEM_TOTAL ))
DISK_USED=$(df -h / | awk 'NR==2{print $3}')
DISK_AVAIL=$(df -h / | awk 'NR==2{print $4}')
DISK_PCT=$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5}')
TOP_PROCS=$(ps aux --sort=-%mem | awk 'NR>1 && NR<=6{printf "  %-8s %s%% %s\n", $1, $4, $11}')

if $JSON; then
  cat << EJSON
{"host":"$HOSTNAME","uptime":"$UPTIME","load":"$LOAD","cpu_cores":$CPU_CORES,"mem_total_mb":$MEM_TOTAL,"mem_used_mb":$MEM_USED,"mem_pct":$MEM_PCT,"disk_used":"$DISK_USED","disk_avail":"$DISK_AVAIL","disk_pct":$DISK_PCT}
EJSON
else
  echo "╔══════════════════════════════════════╗"
  echo "║  🐋 SysInfo — $HOSTNAME"
  echo "╠══════════════════════════════════════╣"
  echo "║  ⏱  Uptime:    $UPTIME"
  echo "║  📊 Load:      $LOAD ($CPU_CORES cores)"
  echo "║  🧠 Memory:    ${MEM_USED}M / ${MEM_TOTAL}M (${MEM_PCT}%)"
  echo "║  💾 Disk:      ${DISK_USED} used, ${DISK_AVAIL} free (${DISK_PCT}%)"
  echo "║  🔝 Top procs:"
  echo "$TOP_PROCS" | head -5
  echo "╚══════════════════════════════════════╝"
fi
