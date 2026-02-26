#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BASE_COMPOSE="$PROJECT_DIR/docker-compose.yml"
LITE_COMPOSE="$PROJECT_DIR/profiles/observability-lite/docker-compose.observability-lite.yml"

failures=0

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; failures=$((failures + 1)); }

if docker compose -f "$BASE_COMPOSE" config > /tmp/pmdl-observability-base-config.$$ 2>/tmp/pmdl-observability-base-err.$$; then
  if rg -q "pmdl_uptime-kuma|pmdl_netdata" /tmp/pmdl-observability-base-config.$$; then
    fail "Base compose unexpectedly includes observability-lite services"
  else
    pass "Base compose excludes observability-lite services"
  fi
else
  fail "Base compose config failed"
fi

if docker compose -f "$BASE_COMPOSE" -f "$LITE_COMPOSE" config > /tmp/pmdl-observability-lite-config.$$ 2>/tmp/pmdl-observability-lite-err.$$; then
  pass "Compose config with observability-lite overlay resolves"
  if rg -q "pmdl_uptime-kuma|pmdl_netdata" /tmp/pmdl-observability-lite-config.$$; then
    pass "Observability-lite services appear only when overlay is included"
  else
    fail "Observability-lite services missing from overlay config"
  fi
else
  fail "Observability-lite overlay compose config failed"
fi

rm -f /tmp/pmdl-observability-base-config.$$ /tmp/pmdl-observability-base-err.$$ /tmp/pmdl-observability-lite-config.$$ /tmp/pmdl-observability-lite-err.$$

echo
printf 'Observability profile summary: failures=%d\n' "$failures"

if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
