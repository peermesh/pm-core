#!/bin/bash
# ==============================================================
# PKI Module - List Certificates Script
# ==============================================================
# Purpose: List all issued certificates and their status
#
# Usage:
#   ./list-certs.sh [options]
#
# Options:
#   --json        Output in JSON format
#   --expiring    Show only certificates expiring soon
# ==============================================================

set -euo pipefail

CA_CONTAINER="pmdl_step_ca"
PKI_CERTS_OUTPUT_PATH="${PKI_CERTS_OUTPUT_PATH:-/home/step/certs/services}"
PKI_RENEWAL_WINDOW="${PKI_RENEWAL_WINDOW:-480h}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Options
JSON_OUTPUT="false"
EXPIRING_ONLY="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            JSON_OUTPUT="true"
            shift
            ;;
        --expiring)
            EXPIRING_ONLY="true"
            shift
            ;;
        -h|--help)
            echo "Usage: $(basename "$0") [--json] [--expiring]"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# ==============================================================
# Check CA
# ==============================================================

if ! docker ps --filter "name=${CA_CONTAINER}" --filter "status=running" -q | grep -q .; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        echo '{"error": "CA container not running", "certificates": []}'
    else
        echo "Error: CA container not running"
    fi
    exit 1
fi

# ==============================================================
# List Certificates
# ==============================================================

list_certificates() {
    local services
    services=$(docker exec "${CA_CONTAINER}" ls -1 "${PKI_CERTS_OUTPUT_PATH}" 2>/dev/null || echo "")

    if [[ -z "$services" ]]; then
        if [[ "$JSON_OUTPUT" == "true" ]]; then
            echo '{"certificates": []}'
        else
            echo "No certificates found"
        fi
        return 0
    fi

    local certs=()

    while IFS= read -r service; do
        if [[ -z "$service" ]]; then
            continue
        fi

        local cert_file="${PKI_CERTS_OUTPUT_PATH}/${service}/cert.pem"

        if ! docker exec "${CA_CONTAINER}" test -f "${cert_file}" 2>/dev/null; then
            continue
        fi

        # Get certificate info
        local cert_info
        cert_info=$(docker exec "${CA_CONTAINER}" step certificate inspect "${cert_file}" --format json 2>/dev/null || echo "{}")

        local subject
        subject=$(echo "$cert_info" | jq -r '.subject.common_name // "unknown"' 2>/dev/null || echo "unknown")

        local not_after
        not_after=$(echo "$cert_info" | jq -r '.validity.end // "unknown"' 2>/dev/null || echo "unknown")

        local not_before
        not_before=$(echo "$cert_info" | jq -r '.validity.start // "unknown"' 2>/dev/null || echo "unknown")

        local sans
        sans=$(echo "$cert_info" | jq -r '.extensions.subject_alt_name.dns_names // [] | join(", ")' 2>/dev/null || echo "")

        # Check if expiring
        local needs_renewal="false"
        if docker exec "${CA_CONTAINER}" step certificate needs-renewal "${cert_file}" --expires-in "${PKI_RENEWAL_WINDOW}" 2>/dev/null; then
            needs_renewal="true"
        fi

        # Skip if only showing expiring and this one isn't
        if [[ "$EXPIRING_ONLY" == "true" && "$needs_renewal" != "true" ]]; then
            continue
        fi

        # Calculate days until expiry
        local days_until_expiry="unknown"
        if [[ "$not_after" != "unknown" ]]; then
            local expiry_epoch
            expiry_epoch=$(date -d "$not_after" +%s 2>/dev/null || gdate -d "$not_after" +%s 2>/dev/null || echo 0)
            local now_epoch
            now_epoch=$(date +%s)
            if [[ $expiry_epoch -gt 0 ]]; then
                days_until_expiry=$(( (expiry_epoch - now_epoch) / 86400 ))
            fi
        fi

        if [[ "$JSON_OUTPUT" == "true" ]]; then
            certs+=("{\"service\": \"${service}\", \"subject\": \"${subject}\", \"notBefore\": \"${not_before}\", \"notAfter\": \"${not_after}\", \"daysUntilExpiry\": ${days_until_expiry}, \"needsRenewal\": ${needs_renewal}, \"sans\": \"${sans}\"}")
        else
            # Determine status color
            local status_color="${GREEN}"
            local status_text="Valid"

            if [[ "$needs_renewal" == "true" ]]; then
                if [[ "$days_until_expiry" != "unknown" && $days_until_expiry -lt 7 ]]; then
                    status_color="${RED}"
                    status_text="Expiring!"
                else
                    status_color="${YELLOW}"
                    status_text="Renewing soon"
                fi
            fi

            printf "%-20s %-30s ${status_color}%-15s${NC} %s\n" \
                "$service" "$not_after" "$status_text" "${days_until_expiry}d"
        fi
    done <<< "$services"

    if [[ "$JSON_OUTPUT" == "true" ]]; then
        local certs_json
        if [[ ${#certs[@]} -eq 0 ]]; then
            certs_json="[]"
        else
            certs_json="[$(IFS=,; echo "${certs[*]}")]"
        fi
        echo "{\"certificates\": ${certs_json}, \"timestamp\": \"$(date -Iseconds)\"}"
    fi
}

# ==============================================================
# Main
# ==============================================================

if [[ "$JSON_OUTPUT" != "true" ]]; then
    echo "========================================"
    echo "PKI Certificates"
    echo "========================================"
    echo ""
    printf "%-20s %-30s %-15s %s\n" "SERVICE" "EXPIRES" "STATUS" "DAYS"
    printf "%-20s %-30s %-15s %s\n" "-------" "-------" "------" "----"
fi

list_certificates

if [[ "$JSON_OUTPUT" != "true" ]]; then
    echo ""
    echo "========================================"
fi
