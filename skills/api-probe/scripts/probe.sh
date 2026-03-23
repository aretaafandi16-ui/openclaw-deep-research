#!/usr/bin/env bash
# api-probe: Probe HTTP endpoints for health, latency, and response validation
# Usage: probe.sh [OPTIONS] <URL>
#   -m METHOD     HTTP method (default: GET)
#   -H HEADER     Add header (repeatable): -H "Authorization: Bearer xyz"
#   -d DATA       Request body (string or @file)
#   -t TIMEOUT    Timeout in seconds (default: 10)
#   -e EXPECT     Expected status code (e.g. 200, 201)
#   -j JQ_FILTER  jq filter to validate response body
#   -c            Check JSON validity
#   -q            Quiet mode — exit code only
#   -s            Silent — no output at all (just exit code)

set -euo pipefail

METHOD="GET"
HEADERS=()
DATA=""
TIMEOUT=10
EXPECT=""
JQ_FILTER=""
CHECK_JSON=false
QUIET=false
SILENT=false

while getopts "m:H:d:t:e:j:cqs" opt; do
  case $opt in
    m) METHOD="$OPTARG" ;;
    H) HEADERS+=(-H "$OPTARG") ;;
    d) DATA="$OPTARG" ;;
    t) TIMEOUT="$OPTARG" ;;
    e) EXPECT="$OPTARG" ;;
    j) JQ_FILTER="$OPTARG" ;;
    c) CHECK_JSON=true ;;
    q) QUIET=true ;;
    s) SILENT=true ;;
    *) echo "Usage: probe.sh [-m METHOD] [-H HEADER] [-d DATA] [-t TIMEOUT] [-e EXPECTED_STATUS] [-j JQ_FILTER] [-c] [-q] [-s] <URL>" >&2; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "Error: URL required" >&2
  exit 1
fi

# Build curl args
CURL_ARGS=(-s -o /tmp/api-probe-body.$$ -w '%{http_code} %{time_total} %{size_download}' --max-time "$TIMEOUT" -X "$METHOD")
for h in "${HEADERS[@]+"${HEADERS[@]}"}"; do
  CURL_ARGS+=("$h")
done
if [[ -n "$DATA" ]]; then
  if [[ "$DATA" == @* ]]; then
    CURL_ARGS+=(-d "@${DATA#@}")
  else
    CURL_ARGS+=(-d "$DATA")
  fi
fi
CURL_ARGS+=("$URL")

# Execute
START=$(date +%s%N)
RESULT=$(curl "${CURL_ARGS[@]}" 2>/tmp/api-probe-err.$$) || true
END=$(date +%s%N)

HTTP_CODE=$(echo "$RESULT" | awk '{print $1}')
TIME_SEC=$(echo "$RESULT" | awk '{print $2}')
SIZE=$(echo "$RESULT" | awk '{print $3}')
CURL_EXIT=$?
ELAPSED_MS=$(( (END - START) / 1000000 ))

ERROR_MSG=""
if [[ $CURL_EXIT -ne 0 ]] && [[ -z "$HTTP_CODE" ]]; then
  ERROR_MSG=$(cat /tmp/api-probe-err.$$ 2>/dev/null || echo "curl failed with exit $CURL_EXIT")
  HTTP_CODE="000"
fi

# Validate
EXIT_CODE=0
VALIDATION=""

if [[ -n "$EXPECT" ]] && [[ "$HTTP_CODE" != "$EXPECT" ]]; then
  VALIDATION="FAIL: expected $EXPECT, got $HTTP_CODE"
  EXIT_CODE=1
elif [[ -n "$EXPECT" ]]; then
  VALIDATION="PASS: status $HTTP_CODE"
fi

if $CHECK_JSON && [[ -f /tmp/api-probe-body.$$ ]]; then
  if jq empty /tmp/api-probe-body.$$ 2>/dev/null; then
    [[ -z "$VALIDATION" ]] && VALIDATION="PASS: valid JSON"
  else
    VALIDATION="FAIL: invalid JSON body"
    EXIT_CODE=1
  fi
fi

if [[ -n "$JQ_FILTER" ]] && [[ -f /tmp/api-probe-body.$$ ]]; then
  JQ_OUT=$(jq -r "$JQ_FILTER" /tmp/api-probe-body.$$ 2>/dev/null) || true
  if [[ $? -ne 0 ]] || [[ -z "$JQ_OUT" ]] || [[ "$JQ_OUT" == "null" ]]; then
    VALIDATION="${VALIDATION:+$VALIDATION | }FAIL: jq '$JQ_FILTER' returned empty/null"
    EXIT_CODE=1
  else
    VALIDATION="${VALIDATION:+$VALIDATION | }PASS: jq '$JQ_FILTER' = $JQ_OUT"
  fi
fi

# Output
if $SILENT; then
  :
elif $QUIET; then
  echo "$EXIT_CODE"
else
  echo "=== API Probe ==="
  echo "URL:       $URL"
  echo "Method:    $METHOD"
  echo "Status:    $HTTP_CODE"
  echo "Time:      ${TIME_SEC}s (${ELAPSED_MS}ms)"
  echo "Size:      ${SIZE} bytes"
  [[ -n "$ERROR_MSG" ]] && echo "Error:     $ERROR_MSG"
  [[ -n "$VALIDATION" ]] && echo "Validate:  $VALIDATION"
  if [[ -f /tmp/api-probe-body.$$ ]] && [[ "$SIZE" -gt 0 ]] && [[ "$SIZE" -lt 10240 ]]; then
    echo "--- Response Body ---"
    if jq empty /tmp/api-probe-body.$$ 2>/dev/null; then
      jq . /tmp/api-probe-body.$$
    else
      cat /tmp/api-probe-body.$$
    fi
  elif [[ -f /tmp/api-probe-body.$$ ]] && [[ "$SIZE" -ge 10240 ]]; then
    echo "--- Response Body (first 200 lines) ---"
    head -200 /tmp/api-probe-body.$$
  fi
  echo "==================="
fi

rm -f /tmp/api-probe-body.$$ /tmp/api-probe-err.$$
exit $EXIT_CODE
