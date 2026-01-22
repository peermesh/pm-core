#!/bin/bash
# ==============================================================
# PKI Module - Certificate Renewal Script
# ==============================================================
# Purpose: Manually renew certificates for services
#
# Usage:
#   ./renew-cert.sh <service-name>
#   ./renew-cert.sh --all
#   ./renew-cert.sh postgres
#
# Options:
#   --all         Renew all certificates that need renewal
#   --force       Force renewal even if not expiring soon
#   --json        Output result in JSON format
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CA_CONTAINER="pmdl_step_ca"

PKI_CERTS_OUTPUT_PATH="${PKI_CERTS_OUTPUT_PATH:-/home/step/certs/services}"
PKI_RENEWAL_WINDOW="${PKI_RENEWAL_WINDOW:-480h}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

usage() {
    cat << EOF
Usage: $(basename "$0") <service-name|--all> [options]

Renew TLS certificates for services.

Arguments:
  service-name    Name of the service to renew
  --all           Renew all certificates that need renewal

Options:
  --force         Force renewal even if certificate is not expiring soon
  --json          Output result in JSON format
  -h, --help      Show this help message

Examples:
  $(basename "$0") postgres
  $(basename "$0") --all
  $(basename "$0") redis --force

EOF
    exit 0
}

# ==============================================================
# Argument Parsing
# ==============================================================

SERVICE_NAME=""
RENEW_ALL="false"
FORCE="false"
JSON_OUTPUT="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        --all)
            RENEW_ALL="true"
            shift
            ;;
        --force)
            FORCE="true"
            shift
            ;;
        --json)
            JSON_OUTPUT="true"
            shift
            ;;
        -*)
            log_error "Unknown option: $1"
            usage
            ;;
        *)
            SERVICE_NAME="$1"
            shift
            ;;
    esac
done

if [[ "$RENEW_ALL" != "true" && -z "$SERVICE_NAME" ]]; then
    log_error "Service name or --all is required"
    usage
fi

# ==============================================================
# Certificate Renewal
# ==============================================================

check_ca_running() {
    if ! docker ps --filter "name=${CA_CONTAINER}" --filter "status=running" -q | grep -q .; then
        log_error "CA container is not running: ${CA_CONTAINER}"
        exit 1
    fi
}

needs_renewal() {
    local cert_file="$1"

    if [[ "$FORCE" == "true" ]]; then
        return 0
    fi

    if docker exec "${CA_CONTAINER}" step certificate needs-renewal "${cert_file}" --expires-in "${PKI_RENEWAL_WINDOW}" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

renew_certificate() {
    local service="$1"
    local cert_dir="${PKI_CERTS_OUTPUT_PATH}/${service}"
    local cert_file="${cert_dir}/cert.pem"
    local key_file="${cert_dir}/key.pem"

    # Check if certificate exists
    if ! docker exec "${CA_CONTAINER}" test -f "${cert_file}" 2>/dev/null; then
        log_warn "Certificate not found for ${service}: ${cert_file}"
        return 1
    fi

    # Check if renewal is needed
    if ! needs_renewal "${cert_file}"; then
        log "Certificate for ${service} does not need renewal yet"
        return 0
    fi

    log "Renewing certificate for: ${service}"

    # Perform renewal
    if docker exec "${CA_CONTAINER}" step ca renew \
        "${cert_file}" "${key_file}" \
        --ca-url https://localhost:9000 \
        --root /home/step/certs/root_ca.crt \
        --force \
        2>/dev/null; then

        log_success "Certificate renewed for: ${service}"

        # Get new expiry
        local new_expiry
        new_expiry=$(docker exec "${CA_CONTAINER}" step certificate inspect "${cert_file}" --format json 2>/dev/null | jq -r '.validity.end' 2>/dev/null || echo "unknown")
        log "  New expiry: ${new_expiry}"

        return 0
    else
        log_error "Failed to renew certificate for: ${service}"
        return 1
    fi
}

renew_all() {
    log "Checking all certificates for renewal..."

    local renewed=0
    local failed=0
    local skipped=0

    # List all service directories
    local services
    services=$(docker exec "${CA_CONTAINER}" ls -1 "${PKI_CERTS_OUTPUT_PATH}" 2>/dev/null || echo "")

    if [[ -z "$services" ]]; then
        log_warn "No certificates found"
        return 0
    fi

    while IFS= read -r service; do
        if [[ -z "$service" ]]; then
            continue
        fi

        local cert_file="${PKI_CERTS_OUTPUT_PATH}/${service}/cert.pem"

        if docker exec "${CA_CONTAINER}" test -f "${cert_file}" 2>/dev/null; then
            if needs_renewal "${cert_file}"; then
                if renew_certificate "$service"; then
                    ((renewed++))
                else
                    ((failed++))
                fi
            else
                ((skipped++))
            fi
        fi
    done <<< "$services"

    log ""
    log "Renewal Summary:"
    log "  Renewed: ${renewed}"
    log "  Skipped: ${skipped} (not expiring soon)"
    log "  Failed:  ${failed}"

    if [[ "$JSON_OUTPUT" == "true" ]]; then
        cat << EOF
{
  "renewed": ${renewed},
  "skipped": ${skipped},
  "failed": ${failed},
  "timestamp": "$(date -Iseconds)"
}
EOF
    fi

    if [[ $failed -gt 0 ]]; then
        return 1
    fi
    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    check_ca_running

    if [[ "$RENEW_ALL" == "true" ]]; then
        renew_all
    else
        renew_certificate "$SERVICE_NAME"
    fi
}

main
