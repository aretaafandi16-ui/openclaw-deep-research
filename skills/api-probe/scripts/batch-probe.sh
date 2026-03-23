#!/usr/bin/env bash
# batch-probe: Check multiple endpoints from a config file
# Usage: batch-probe.sh <config.json>
#
# Config format (JSON array):
# [
#   { "url": "https://api.example.com/health", "expect": 200 },
#   { "url": "https://api.example.com/data", "method": "POST", "data": "{}",
#     "headers": {"Content-Type": "application/json"}, "expect": 201, "jq": ".id" }
# ]

set -euo pipefail

CONFIG="${1:-}"
if [[ -z "$CONFIG" ]] || [[ ! -f "$CONFIG" ]]; then
  echo "Usage: batch-probe.sh <config.json>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL=0
PASSED=0
FAILED=0
RESULTS=()

echo "=== Batch API Probe ==="
echo "Config: $CONFIG"
echo ""

LEN=$(jq length "$CONFIG")
for i in $(seq 0 $((LEN - 1))); do
  URL=$(jq -r ".[$i].url" "$CONFIG")
  METHOD=$(jq -r ".[$i].method // \"GET\"" "$CONFIG")
  EXPECT=$(jq -r ".[$i].expect // \"\"" "$CONFIG")
  JQ=$(jq -r ".[$i].jq // \"\"" "$CONFIG")
  DATA=$(jq -r ".[$i].data // \"\"" "$CONFIG")
  TIMEOUT=$(jq -r ".[$i].timeout // 10" "$CONFIG")

  ARGS=(-m "$METHOD" -t "$TIMEOUT")
  [[ -n "$EXPECT" ]] && ARGS+=(-e "$EXPECT")
  [[ -n "$JQ" ]] && ARGS+=(-j "$JQ")
  [[ -n "$DATA" ]] && ARGS+=(-d "$DATA")

  # Extract headers
  HAS_HEADERS=$(jq -r ".[$i].headers // {} | length > 0" "$CONFIG")
  if [[ "$HAS_HEADERS" == "true" ]]; then
    for key in $(jq -r ".[$i].headers | keys[]" "$CONFIG"); do
      val=$(jq -r ".[$i].headers[\"$key\"]" "$CONFIG")
      ARGS+=(-H "$key: $val")
    done
  fi

  TOTAL=$((TOTAL + 1))
  printf "[%d/%d] %s %s ... " "$TOTAL" "$LEN" "$METHOD" "$URL"
  
  if bash "$SCRIPT_DIR/probe.sh" -q "${ARGS[@]}" "$URL" >/dev/null 2>&1; then
    echo "✓ PASS"
    PASSED=$((PASSED + 1))
  else
    echo "✗ FAIL"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "=== Summary ==="
echo "Total: $TOTAL | Passed: $PASSED | Failed: $FAILED"
[[ $FAILED -eq 0 ]] && exit 0 || exit 1
