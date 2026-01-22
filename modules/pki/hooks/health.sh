#!/bin/bash
# ==============================================================
# PKI Module - Health Check Hook
# ==============================================================
# Purpose: Check PKI module health and certificate status
# Called: Periodically or on-demand via pmdl module health pki
#
# Exit codes:
#   0 - Healthy
#   1 - Unhealthy (critical issue)
#   2 - Degraded (non-critical warning)
#
# Output format: JSON for dashboard integration
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKI_STORAGE_PATH="${PKI_STORAGE_PATH:-/var/lib/pki}"
PKI_CERTS_OUTPUT_PATH="${PKI_CERTS_OUTPUT_PATH:-/var/lib/pki/certs}"

# Output mode: "json" or "text"
OUTPUT_MODE="${1:-text}"

# Health status tracking
HEALTH_STATUS="healthy"
HEALTH_MESSAGES=()
CA_STATUS="unknown"
ROOT_CA_EXPIRY=""
ISSUED_CERTS_COUNT=0
EXPIRING_CERTS=()
RENEWED_CERTS_COUNT=0

# ==============================================================
# Check Functions
# ==============================================================

check_ca_service_running() {
    local container="pmdl_step_ca"

    if docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
        # Check Docker health status
        local health_status
        health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")

        if [[ "$health_status" == "healthy" ]]; then
            CA_STATUS="running"
            return 0
        elif [[ "$health_status" == "unhealthy" ]]; then
            CA_STATUS="unhealthy"
            HEALTH_STATUS="unhealthy"
            HEALTH_MESSAGES+=("CA service is unhealthy")
            return 1
        else
            CA_STATUS="starting"
            HEALTH_STATUS="degraded"
            HEALTH_MESSAGES+=("CA service is still starting")
            return 0
        fi
    else
        CA_STATUS="stopped"
        HEALTH_STATUS="unhealthy"
        HEALTH_MESSAGES+=("CA service not running")
        return 1
    fi
}

check_renewer_service() {
    local container="pmdl_cert_renewer"

    if docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
        return 0
    else
        # Renewer not running is a warning, not critical
        HEALTH_MESSAGES+=("Certificate renewer service not running")
        if [[ "$HEALTH_STATUS" == "healthy" ]]; then
            HEALTH_STATUS="degraded"
        fi
        return 0
    fi
}

check_root_ca_cert() {
    local container="pmdl_step_ca"
    local root_cert="/home/step/certs/root_ca.crt"

    if ! docker ps --filter "name=${container}" --filter "status=running" -q | grep -q .; then
        return 0
    fi

    # Get root CA expiry date
    local expiry_output
    expiry_output=$(docker exec "$container" step certificate inspect "$root_cert" --format json 2>/dev/null | jq -r '.validity.end' 2>/dev/null || echo "")

    if [[ -n "$expiry_output" && "$expiry_output" != "null" ]]; then
        ROOT_CA_EXPIRY="$expiry_output"

        # Check if root CA is expiring within 30 days
        local expiry_epoch
        expiry_epoch=$(date -d "$expiry_output" +%s 2>/dev/null || gdate -d "$expiry_output" +%s 2>/dev/null || echo 0)
        local now_epoch
        now_epoch=$(date +%s)
        local days_until_expiry=$(( (expiry_epoch - now_epoch) / 86400 ))

        if [[ $days_until_expiry -lt 30 ]]; then
            HEALTH_STATUS="degraded"
            HEALTH_MESSAGES+=("Root CA expires in ${days_until_expiry} days")
        fi
    fi
}

check_issued_certificates() {
    local container="pmdl_step_ca"

    if ! docker ps --filter "name=${container}" --filter "status=running" -q | grep -q .; then
        return 0
    fi

    # Count certificates in the services directory
    local certs_count=0
    local services_dir="/home/step/certs/services"

    certs_count=$(docker exec "$container" find "$services_dir" -name "cert.pem" 2>/dev/null | wc -l || echo 0)
    ISSUED_CERTS_COUNT=$certs_count

    # Check each certificate for expiration
    local cert_list
    cert_list=$(docker exec "$container" find "$services_dir" -name "cert.pem" 2>/dev/null || echo "")

    while IFS= read -r cert_path; do
        if [[ -z "$cert_path" ]]; then
            continue
        fi

        # Extract service name from path
        local service_name
        service_name=$(echo "$cert_path" | sed 's|.*/services/\([^/]*\)/.*|\1|')

        # Check if certificate is expiring within renewal window (default 20 days = 480h)
        if docker exec "$container" step certificate needs-renewal "$cert_path" --expires-in "480h" 2>/dev/null; then
            EXPIRING_CERTS+=("$service_name")
        fi
    done <<< "$cert_list"

    if [[ ${#EXPIRING_CERTS[@]} -gt 0 ]]; then
        if [[ "$HEALTH_STATUS" == "healthy" ]]; then
            HEALTH_STATUS="degraded"
        fi
        HEALTH_MESSAGES+=("${#EXPIRING_CERTS[@]} certificate(s) expiring soon: ${EXPIRING_CERTS[*]}")
    fi
}

check_ca_connectivity() {
    local container="pmdl_step_ca"

    if ! docker ps --filter "name=${container}" --filter "status=running" -q | grep -q .; then
        return 0
    fi

    # Try to get CA health from within the container
    if ! docker exec "$container" step ca health --ca-url https://localhost:9000 --root /home/step/certs/root_ca.crt &>/dev/null; then
        if [[ "$HEALTH_STATUS" == "healthy" ]]; then
            HEALTH_STATUS="degraded"
        fi
        HEALTH_MESSAGES+=("CA health endpoint not responding")
    fi
}

# ==============================================================
# Output Functions
# ==============================================================

output_json() {
    local status_code=0
    [[ "$HEALTH_STATUS" == "degraded" ]] && status_code=2
    [[ "$HEALTH_STATUS" == "unhealthy" ]] && status_code=1

    local messages_json="[]"
    if [[ ${#HEALTH_MESSAGES[@]} -gt 0 ]]; then
        messages_json=$(printf '%s\n' "${HEALTH_MESSAGES[@]}" | jq -R . | jq -s .)
    fi

    local expiring_json="[]"
    if [[ ${#EXPIRING_CERTS[@]} -gt 0 ]]; then
        expiring_json=$(printf '%s\n' "${EXPIRING_CERTS[@]}" | jq -R . | jq -s .)
    fi

    cat << EOF
{
  "status": "${HEALTH_STATUS}",
  "statusCode": ${status_code},
  "timestamp": "$(date -Iseconds)",
  "module": "pki",
  "checks": {
    "caRunning": $([ "$CA_STATUS" == "running" ] && echo "true" || echo "false"),
    "caHealthy": $([ "$CA_STATUS" == "running" ] && echo "true" || echo "false"),
    "renewerRunning": $(docker ps --filter "name=pmdl_cert_renewer" --filter "status=running" -q | grep -q . && echo "true" || echo "false")
  },
  "ca": {
    "status": "${CA_STATUS}",
    "rootCaExpiry": "${ROOT_CA_EXPIRY:-unknown}"
  },
  "certificates": {
    "issued": ${ISSUED_CERTS_COUNT},
    "expiringSoon": ${expiring_json},
    "renewed": ${RENEWED_CERTS_COUNT}
  },
  "messages": ${messages_json}
}
EOF
}

output_text() {
    echo "========================================"
    echo "PKI Module Health Check"
    echo "========================================"
    echo ""
    echo "Status: ${HEALTH_STATUS^^}"
    echo ""
    echo "CA Service:"
    echo "  Status:         ${CA_STATUS}"
    echo "  Root CA Expiry: ${ROOT_CA_EXPIRY:-unknown}"
    echo ""
    echo "Certificates:"
    echo "  Issued:         ${ISSUED_CERTS_COUNT}"
    echo "  Expiring Soon:  ${#EXPIRING_CERTS[@]}"

    if [[ ${#EXPIRING_CERTS[@]} -gt 0 ]]; then
        echo "    Services: ${EXPIRING_CERTS[*]}"
    fi

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
    # Run all checks
    check_ca_service_running
    check_renewer_service
    check_root_ca_cert
    check_issued_certificates
    check_ca_connectivity

    # Output results
    if [[ "$OUTPUT_MODE" == "json" ]]; then
        output_json
    else
        output_text
    fi

    # Return appropriate exit code
    case "$HEALTH_STATUS" in
        healthy)
            exit 0
            ;;
        degraded)
            exit 2
            ;;
        unhealthy)
            exit 1
            ;;
    esac
}

main "$@"
