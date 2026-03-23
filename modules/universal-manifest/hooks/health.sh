#!/bin/bash
# ==============================================================
# Universal Manifest Module - Health Check Hook
# ==============================================================
# Purpose: Check module health and report status as JSON or text
# Called: Periodically or on-demand, via: ./hooks/health.sh [json|text]
#
# Checks:
#   1. Container um is running
#   2. HTTP endpoint /health responds 200
#   3. Database connectivity (via app health endpoint)
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
MODULE_NAME="universal-manifest"
CONTAINER_NAME="um"

# Output mode: "json" or "text"
OUTPUT_MODE="${1:-text}"

# Health status tracking
HEALTH_STATUS="healthy"
HEALTH_MESSAGES=()
HTTP_STATUS=""
DATABASE_STATUS=""
CONTAINER_RUNNING=false
UPTIME=""

# ==============================================================
# Check Functions
# ==============================================================

check_container_running() {
    if docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" \
        --format '{{.Names}}' 2>/dev/null | grep -q "${CONTAINER_NAME}"; then
        CONTAINER_RUNNING=true

        UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "${CONTAINER_NAME}" 2>/dev/null || printf "unknown")
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
        DATABASE_STATUS="unreachable"
        return 1
    fi

    local response
    response=$(docker exec "${CONTAINER_NAME}" wget --quiet --tries=1 --timeout=5 -O - "http://127.0.0.1:4200/health" 2>/dev/null || printf "")

    if [[ -n "$response" ]]; then
        HTTP_STATUS="ok"

        if printf "%s" "$response" | grep -q '"connected"' 2>/dev/null; then
            DATABASE_STATUS="ok"
        elif printf "%s" "$response" | grep -q '"database"' 2>/dev/null; then
            DATABASE_STATUS="degraded"
            if [[ "$HEALTH_STATUS" == "healthy" ]]; then
                HEALTH_STATUS="degraded"
            fi
            HEALTH_MESSAGES+=("Database connectivity issue detected in health response")
        else
            DATABASE_STATUS="unknown"
        fi

        return 0
    else
        HTTP_STATUS="failed"
        HEALTH_STATUS="unhealthy"
        HEALTH_MESSAGES+=("HTTP /health endpoint not responding")
        return 1
    fi
}

# ==============================================================
# Output Functions
# ==============================================================

output_json() {
    local messages_json="[]"
    if [[ ${#HEALTH_MESSAGES[@]} -gt 0 ]]; then
        messages_json="["
        local first=true
        for msg in "${HEALTH_MESSAGES[@]}"; do
            if [[ "$first" == true ]]; then
                first=false
            else
                messages_json+=","
            fi
            local escaped="${msg//\"/\\\"}"
            messages_json+="\"${escaped}\""
        done
        messages_json+="]"
    fi

    local timestamp
    timestamp=$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)

    printf '{\n'
    printf '  "status": "%s",\n' "$HEALTH_STATUS"
    printf '  "timestamp": "%s",\n' "$timestamp"
    printf '  "module": "%s",\n' "$MODULE_NAME"
    printf '  "checks": {\n'
    printf '    "containerRunning": %s,\n' "$CONTAINER_RUNNING"
    printf '    "http": "%s",\n' "${HTTP_STATUS:-unknown}"
    printf '    "database": "%s"\n' "${DATABASE_STATUS:-unknown}"
    printf '  },\n'
    printf '  "uptime": "%s",\n' "${UPTIME:-unknown}"
    printf '  "messages": %s\n' "$messages_json"
    printf '}\n'
}

output_text() {
    printf "========================================\n"
    printf "Health Check: %s\n" "$MODULE_NAME"
    printf "========================================\n"
    printf "\n"
    printf "Status:    %s\n" "${HEALTH_STATUS^^}"
    if [[ "$CONTAINER_RUNNING" == true ]]; then
        printf "Container: running\n"
    else
        printf "Container: stopped\n"
    fi
    printf "HTTP:      %s\n" "${HTTP_STATUS:-unknown}"
    printf "Database:  %s\n" "${DATABASE_STATUS:-unknown}"
    printf "Uptime:    %s\n" "${UPTIME:-unknown}"
    printf "\n"

    if [[ ${#HEALTH_MESSAGES[@]} -gt 0 ]]; then
        printf "Messages:\n"
        for msg in "${HEALTH_MESSAGES[@]}"; do
            printf "  - %s\n" "$msg"
        done
        printf "\n"
    fi

    printf "========================================\n"
}

# ==============================================================
# Main
# ==============================================================

main() {
    check_container_running || true
    check_http_endpoint || true

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
