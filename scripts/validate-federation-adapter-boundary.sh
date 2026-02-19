#!/usr/bin/env bash
# ==============================================================
# Federation Adapter Boundary Validator
# ==============================================================
# Verifies that federation adapter capabilities remain optional,
# non-disruptive to core runtime, and deployable when explicitly enabled.
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_COMPOSE="$PROJECT_DIR/docker-compose.yml"
ADAPTER_COMPOSE="$PROJECT_DIR/modules/federation-adapter/docker-compose.yml"
ADAPTER_MODULE_JSON="$PROJECT_DIR/modules/federation-adapter/module.json"

FAILURES=0

fail() {
    echo "[FAIL] $1"
    FAILURES=$((FAILURES + 1))
}

pass() {
    echo "[PASS] $1"
}

if [[ ! -f "$ROOT_COMPOSE" ]]; then
    fail "Missing root compose file: $ROOT_COMPOSE"
fi

if [[ ! -f "$ADAPTER_COMPOSE" ]]; then
    fail "Missing adapter compose file: $ADAPTER_COMPOSE"
fi

if [[ ! -f "$ADAPTER_MODULE_JSON" ]]; then
    fail "Missing adapter module manifest: $ADAPTER_MODULE_JSON"
fi

if [[ "$FAILURES" -gt 0 ]]; then
    echo "Boundary validation failed before runtime checks"
    exit 1
fi

if docker compose -f "$ROOT_COMPOSE" config -q; then
    pass "Core runtime config validates without adapter compose"
else
    fail "Core runtime config failed without adapter compose"
fi

if docker compose -f "$ROOT_COMPOSE" config --services | grep -qx 'federation-adapter'; then
    fail "Adapter service leaked into root compose defaults"
else
    pass "Adapter service is absent from root compose defaults"
fi

if FEDERATION_ADAPTER_ENABLED=true docker compose -f "$ROOT_COMPOSE" -f "$ADAPTER_COMPOSE" --profile federation-adapter config -q; then
    pass "Adapter compose validates when explicitly included"
else
    fail "Adapter compose failed explicit validation"
fi

if FEDERATION_ADAPTER_ENABLED=true docker compose -f "$ROOT_COMPOSE" -f "$ADAPTER_COMPOSE" --profile federation-adapter config --services | grep -qx 'federation-adapter'; then
    pass "Adapter service appears only in explicit adapter-included config"
else
    fail "Adapter service missing when adapter compose is explicitly included"
fi

if command -v jq >/dev/null 2>&1; then
    module_id="$(jq -r '.id' "$ADAPTER_MODULE_JSON" 2>/dev/null || echo '')"
    enabled_env="$(jq -r '.config.properties.enabled.env' "$ADAPTER_MODULE_JSON" 2>/dev/null || echo '')"
    if [[ "$module_id" == "federation-adapter" && "$enabled_env" == "FEDERATION_ADAPTER_ENABLED" ]]; then
        pass "Adapter manifest includes explicit enablement boundary"
    else
        fail "Adapter manifest missing explicit enablement boundary fields"
    fi
else
    pass "jq not available; skipped manifest field validation"
fi

echo ""
echo "Federation adapter boundary summary: failures=${FAILURES}"

if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
fi

exit 0
