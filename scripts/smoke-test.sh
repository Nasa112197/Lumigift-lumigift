#!/usr/bin/env bash
# =============================================================================
# scripts/smoke-test.sh
#
# Post-deploy smoke tests for Lumigift (issues #100).
# Verifies: health endpoint, database/redis/horizon checks, auth 401 gates,
# webhook auth gate, and read-only gift list auth gate.
#
# Usage:
#   BASE_URL=https://lumigift.app ./scripts/smoke-test.sh
#   BASE_URL=https://staging.lumigift.app ./scripts/smoke-test.sh
#
# Exit codes:
#   0  — all checks passed
#   1  — one or more checks failed (caller should trigger rollback)
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TIMEOUT=10   # seconds per request
PASS=0
FAIL=0
FAILURES=()

# ── Helpers ──────────────────────────────────────────────────────────────────

green()  { printf '\033[0;32m✅  %s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m❌  %s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m⚠️   %s\033[0m\n' "$*"; }
header() { printf '\n\033[1;34m══ %s ══\033[0m\n' "$*"; }

pass() {
  green "$1"
  PASS=$((PASS + 1))
}

fail() {
  red "$1"
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
}

# curl wrapper — returns HTTP status code, prints body to stderr on error
http_status() {
  local url="$1"
  local method="${2:-GET}"
  local data="${3:-}"
  local extra_headers="${4:-}"

  if [ -n "$data" ]; then
    curl -s -o /tmp/smoke_body.txt -w '%{http_code}' \
      --max-time "$TIMEOUT" \
      -X "$method" \
      -H "Content-Type: application/json" \
      ${extra_headers:+-H "$extra_headers"} \
      -d "$data" \
      "$url" 2>/dev/null || echo "000"
  else
    curl -s -o /tmp/smoke_body.txt -w '%{http_code}' \
      --max-time "$TIMEOUT" \
      -X "$method" \
      ${extra_headers:+-H "$extra_headers"} \
      "$url" 2>/dev/null || echo "000"
  fi
}

body() { cat /tmp/smoke_body.txt 2>/dev/null || true; }

# ── Smoke Checks ─────────────────────────────────────────────────────────────

header "Smoke Tests — ${BASE_URL}"
echo "Started at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# 1. Health endpoint — must return 200 with status ok or degraded
header "Check 1: Health endpoint"
STATUS=$(http_status "${BASE_URL}/api/health")
if [ "$STATUS" = "200" ]; then
  HEALTH_BODY=$(body)
  HEALTH_STATUS=$(echo "$HEALTH_BODY" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
  if [ "$HEALTH_STATUS" = "ok" ]; then
    pass "GET /api/health → 200 (status: ok)"
  elif [ "$HEALTH_STATUS" = "degraded" ]; then
    yellow "GET /api/health → 200 (status: degraded — some dependencies unhealthy)"
    # degraded is a warning not a hard failure; individual sub-checks below catch hard failures
    PASS=$((PASS + 1))
  else
    fail "GET /api/health → 200 but unexpected status: ${HEALTH_STATUS}"
  fi
elif [ "$STATUS" = "503" ]; then
  fail "GET /api/health → 503 (all dependency checks failed)"
elif [ "$STATUS" = "000" ]; then
  fail "GET /api/health → connection refused / timeout (is the app running?)"
else
  fail "GET /api/health → unexpected HTTP ${STATUS}"
fi

# 2. Health sub-checks — db, redis, horizon must all be 'ok'
header "Check 2: Dependency sub-checks"
HEALTH_BODY=$(curl -s --max-time "$TIMEOUT" "${BASE_URL}/api/health" 2>/dev/null || echo '{}')

for DEP in db redis horizon; do
  DEP_STATUS=$(echo "$HEALTH_BODY" | grep -o "\"${DEP}\":\"[^\"]*\"" | cut -d'"' -f4 || echo "unknown")
  if [ "$DEP_STATUS" = "ok" ]; then
    pass "  ${DEP}: ok"
  else
    fail "  ${DEP}: ${DEP_STATUS:-unknown} (expected ok)"
  fi
done

# 3. Auth gate — GET /api/v1/gifts without session must return 401
header "Check 3: Auth gate (GET /api/v1/gifts)"
STATUS=$(http_status "${BASE_URL}/api/v1/gifts")
if [ "$STATUS" = "401" ]; then
  pass "GET /api/v1/gifts (unauthenticated) → 401"
elif [ "$STATUS" = "403" ]; then
  pass "GET /api/v1/gifts (unauthenticated) → 403 (acceptable auth rejection)"
else
  fail "GET /api/v1/gifts (unauthenticated) → ${STATUS} (expected 401/403)"
fi

# 4. Cron auth gate — GET /api/v1/cron/unlock without auth must return 401
header "Check 4: Cron auth gate (GET /api/v1/cron/unlock)"
STATUS=$(http_status "${BASE_URL}/api/v1/cron/unlock")
if [ "$STATUS" = "401" ]; then
  pass "GET /api/v1/cron/unlock (no token) → 401"
else
  fail "GET /api/v1/cron/unlock (no token) → ${STATUS} (expected 401)"
fi

# 5. Cron auth gate with wrong token — must return 401
header "Check 5: Cron auth gate (wrong token)"
STATUS=$(http_status "${BASE_URL}/api/v1/cron/unlock" "GET" "" "Authorization: Bearer wrong-token-smoke-test")
if [ "$STATUS" = "401" ]; then
  pass "GET /api/v1/cron/unlock (wrong token) → 401"
else
  fail "GET /api/v1/cron/unlock (wrong token) → ${STATUS} (expected 401)"
fi

# 6. Paystack webhook auth gate — POST without signature must return 400/401
header "Check 6: Webhook auth gate (POST /api/v1/payments)"
STATUS=$(http_status "${BASE_URL}/api/v1/payments" "POST" '{"event":"charge.success"}')
if [ "$STATUS" = "400" ] || [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  pass "POST /api/v1/payments (no signature) → ${STATUS} (auth rejected)"
elif [ "$STATUS" = "405" ]; then
  pass "POST /api/v1/payments → 405 (method not allowed — no unauthenticated POST accepted)"
else
  fail "POST /api/v1/payments (no signature) → ${STATUS} (expected 400/401/403/405)"
fi

# 7. CSRF route — GET /api/v1/csrf must return 200
header "Check 7: CSRF token endpoint"
STATUS=$(http_status "${BASE_URL}/api/v1/csrf")
if [ "$STATUS" = "200" ]; then
  pass "GET /api/v1/csrf → 200"
else
  fail "GET /api/v1/csrf → ${STATUS} (expected 200)"
fi

# 8. Unknown route — must return 404, not 500
header "Check 8: 404 handling"
STATUS=$(http_status "${BASE_URL}/api/v1/this-route-does-not-exist-smoke-check")
if [ "$STATUS" = "404" ]; then
  pass "GET /api/v1/unknown → 404"
else
  fail "GET /api/v1/unknown → ${STATUS} (expected 404, not 500)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

header "Results"
echo "Passed : ${PASS}"
echo "Failed : ${FAIL}"

if [ "${FAIL}" -gt 0 ]; then
  echo ""
  red "Smoke tests FAILED — rollback should be triggered."
  echo ""
  echo "Failed checks:"
  for F in "${FAILURES[@]}"; do
    echo "  • ${F}"
  done
  exit 1
fi

green "All smoke tests passed — deployment is healthy."
exit 0
