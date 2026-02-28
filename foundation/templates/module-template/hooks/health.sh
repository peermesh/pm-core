#!/bin/bash
# ==============================================================
# Module Template - Health Check Hook
# ==============================================================
# Purpose: Check module health and report status
# Called: Periodically or on-demand
#
# Exit codes:
#   0 - Healthy
#   1 - Unhealthy (critical issue)
#   2 - Degraded (non-critical warning)
#
# Output: JSON for dashboard integration (when called with "json" arg)
#
# CUSTOMIZE: Replace this stub with your module's health checks.
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_MODE="${1:-text}"

# ==============================================================
# Health Checks
# ==============================================================

HEALTH_STATUS="healthy"

check_service_running() {
    # CUSTOMIZE: Replace 'my-module-app' with your container name
    local container="my-module-app"

    if docker ps --filter "name=${container}" --filter "status=running" \
        --format '{{.Names}}' | grep -q "$container"; then
        return 0
    else
        HEALTH_STATUS="unhealthy"
        return 1
    fi
}

# ==============================================================
# Output
# ==============================================================

output_json() {
    cat << EOF
{
  "status": "${HEALTH_STATUS}",
  "timestamp": "$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)",
  "module": "my-module",
  "checks": {
    "serviceRunning": $(check_service_running > /dev/null 2>&1 && echo "true" || echo "false")
  }
}
EOF
}

output_text() {
    echo "========================================"
    echo "Module Health Check: my-module"
    echo "========================================"
    echo ""
    echo "Status: ${HEALTH_STATUS^^}"
    echo ""
    echo "========================================"
}

# ==============================================================
# Main
# ==============================================================

main() {
    check_service_running || true

    if [[ "$OUTPUT_MODE" == "json" ]]; then
        output_json
    else
        output_text
    fi

    case "$HEALTH_STATUS" in
        healthy)  exit 0 ;;
        degraded) exit 2 ;;
        *)        exit 1 ;;
    esac
}

main "$@"
