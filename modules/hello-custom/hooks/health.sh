#!/bin/bash
# ==============================================================
# Hello Custom Module - Health Check Hook
# ==============================================================
# Purpose: Check module health and report status as JSON
# Called: Periodically or on-demand, via: ./hooks/health.sh [json|text]
#
# This script demonstrates the health hook pattern:
#   1. Check if the container is running
#   2. Check if the HTTP endpoint responds
#   3. Output results as JSON (for dashboard) or text (for humans)
#
# Exit codes:
#   0 - Healthy
#   1 - Unhealthy (critical issue)
#   2 - Degraded (non-critical warning)
#
# Output format:
#   text (default) - Human-readable status report
#   json           - Machine-readable JSON for dashboard integration
# ==============================================================

set -euo pipefail

# shellcheck disable=SC2034
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_NAME="hello-custom"
CONTAINER_NAME="hello-custom"

# Output mode: "json" or "text"
OUTPUT_MODE="${1:-text}"

# Health status tracking
HEALTH_STATUS="healthy"
HEALTH_MESSAGES=()
HTTP_STATUS=""
NGINX_STATUS=""
CONTAINER_RUNNING=false
UPTIME=""

# ==============================================================
# Check Functions
# ==============================================================

check_container_running() {
    if docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" \
        --format '{{.Names}}' 2>/dev/null | grep -q "${CONTAINER_NAME}"; then
        CONTAINER_RUNNING=true

        # Get uptime
        UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "${CONTAINER_NAME}" 2>/dev/null || echo "unknown")
        return 0
    else
        CONTAINER_RUNNING=false
        HEALTH_STATUS="unhealthy"
        HEALTH_MESSAGES+=("Container ${CONTAINER_NAME} is not running")
        return 1
    fi
}

check_http_endpoint() {
    if [[ "$CONTAINER_RUNNING" != true ]]; then
        HTTP_STATUS="unreachable"
        return 1
    fi

    # Check HTTP response from inside the container
    if docker exec "${CONTAINER_NAME}" wget --quiet --tries=1 --spider "http://127.0.0.1/" 2>/dev/null; then
        HTTP_STATUS="ok"
        return 0
    else
        HTTP_STATUS="failed"
        HEALTH_STATUS="unhealthy"
        HEALTH_MESSAGES+=("HTTP endpoint not responding")
        return 1
    fi
}

check_nginx_process() {
    if [[ "$CONTAINER_RUNNING" != true ]]; then
        NGINX_STATUS="unreachable"
        return 1
    fi

    # Verify nginx master process is running inside the container.
    # Busybox images may not include pgrep; fall back to ps+grep.
    if docker exec "${CONTAINER_NAME}" sh -c "pgrep -x nginx >/dev/null 2>&1 || ps w 2>/dev/null | grep -q '[n]ginx'"; then
        NGINX_STATUS="ok"
        return 0
    else
        NGINX_STATUS="failed"
        HEALTH_STATUS="degraded"
        HEALTH_MESSAGES+=("nginx process not found in container")
        return 1
    fi
}

# ==============================================================
# Output Functions
# ==============================================================

output_json() {
    local messages_json="[]"
    if [[ ${#HEALTH_MESSAGES[@]} -gt 0 ]]; then
        # Build JSON array manually (no jq dependency)
        messages_json="["
        local first=true
        for msg in "${HEALTH_MESSAGES[@]}"; do
            if [[ "$first" == true ]]; then
                first=false
            else
                messages_json+=","
            fi
            # Escape double quotes in message
            local escaped="${msg//\"/\\\"}"
            messages_json+="\"${escaped}\""
        done
        messages_json+="]"
    fi

    local timestamp
    timestamp=$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)

    cat << EOF
{
  "status": "${HEALTH_STATUS}",
  "timestamp": "${timestamp}",
  "module": "${MODULE_NAME}",
  "checks": {
    "containerRunning": ${CONTAINER_RUNNING},
    "http": "${HTTP_STATUS:-unknown}",
    "nginx": "${NGINX_STATUS:-unknown}"
  },
  "uptime": "${UPTIME:-unknown}",
  "messages": ${messages_json}
}
EOF
}

output_text() {
    echo "========================================"
    echo "Health Check: ${MODULE_NAME}"
    echo "========================================"
    echo ""
    echo "Status:    ${HEALTH_STATUS^^}"
    echo "Container: $(if [[ "$CONTAINER_RUNNING" == true ]]; then echo "running"; else echo "stopped"; fi)"
    echo "HTTP:      ${HTTP_STATUS:-unknown}"
    echo "Uptime:    ${UPTIME:-unknown}"
    echo ""

    if [[ ${#HEALTH_MESSAGES[@]} -gt 0 ]]; then
        echo "Messages:"
        for msg in "${HEALTH_MESSAGES[@]}"; do
            echo "  - $msg"
        done
        echo ""
    fi

    echo "========================================"
}

# ==============================================================
# Main
# ==============================================================

main() {
    # Run all checks (continue even if individual checks fail)
    check_container_running || true
    check_http_endpoint || true
    check_nginx_process || true

    # Output results
    if [[ "$OUTPUT_MODE" == "json" ]]; then
        output_json
    else
        output_text
    fi

    # Return appropriate exit code
    case "$HEALTH_STATUS" in
        healthy)  exit 0 ;;
        degraded) exit 2 ;;
        *)        exit 1 ;;
    esac
}

main "$@"
