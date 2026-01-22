#!/bin/bash
# ==============================================================
# PKI Module - Certificate Revocation Script
# ==============================================================
# Purpose: Revoke certificates for decommissioned services
#
# Usage:
#   ./revoke-cert.sh <service-name> [--reason <reason>]
#
# Options:
#   --reason <reason>   Reason for revocation (default: superseded)
#   --force             Skip confirmation prompt
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CA_CONTAINER="pmdl_step_ca"

PKI_CERTS_OUTPUT_PATH="${PKI_CERTS_OUTPUT_PATH:-/home/step/certs/services}"

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
Usage: $(basename "$0") <service-name> [options]

Revoke a service's TLS certificate.

Arguments:
  service-name    Name of the service whose certificate to revoke

Options:
  --reason <r>    Reason for revocation:
                    - unspecified (default)
                    - key-compromise
                    - superseded
                    - cessation-of-operation
  --force         Skip confirmation prompt
  -h, --help      Show this help message

Examples:
  $(basename "$0") old-service --reason cessation-of-operation
  $(basename "$0") postgres --force

EOF
    exit 0
}

# ==============================================================
# Argument Parsing
# ==============================================================

SERVICE_NAME=""
REVOKE_REASON="unspecified"
FORCE="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        --reason)
            REVOKE_REASON="$2"
            shift 2
            ;;
        --force)
            FORCE="true"
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

if [[ -z "$SERVICE_NAME" ]]; then
    log_error "Service name is required"
    usage
fi

# ==============================================================
# Certificate Revocation
# ==============================================================

check_ca_running() {
    if ! docker ps --filter "name=${CA_CONTAINER}" --filter "status=running" -q | grep -q .; then
        log_error "CA container is not running: ${CA_CONTAINER}"
        exit 1
    fi
}

revoke_certificate() {
    local service="$1"
    local reason="$2"
    local cert_dir="${PKI_CERTS_OUTPUT_PATH}/${service}"
    local cert_file="${cert_dir}/cert.pem"

    # Check if certificate exists
    if ! docker exec "${CA_CONTAINER}" test -f "${cert_file}" 2>/dev/null; then
        log_error "Certificate not found for ${service}: ${cert_file}"
        exit 1
    fi

    # Show certificate info before revocation
    log "Certificate to revoke:"
    local cert_info
    cert_info=$(docker exec "${CA_CONTAINER}" step certificate inspect "${cert_file}" --format json 2>/dev/null || echo "{}")

    local subject
    subject=$(echo "$cert_info" | jq -r '.subject.common_name // "unknown"' 2>/dev/null || echo "unknown")

    local not_after
    not_after=$(echo "$cert_info" | jq -r '.validity.end // "unknown"' 2>/dev/null || echo "unknown")

    log "  Service: ${service}"
    log "  Subject: ${subject}"
    log "  Expires: ${not_after}"
    log "  Reason:  ${reason}"
    log ""

    # Confirm revocation
    if [[ "$FORCE" != "true" ]]; then
        log_warn "This action cannot be undone!"
        read -p "Are you sure you want to revoke this certificate? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log "Revocation cancelled"
            exit 0
        fi
    fi

    # Perform revocation
    local provisioner_password
    provisioner_password=$(cat "${MODULE_DIR}/configs/provisioner_password" 2>/dev/null || echo "")

    if [[ -z "$provisioner_password" ]]; then
        log_error "Provisioner password not found"
        exit 1
    fi

    log "Revoking certificate..."

    if docker exec "${CA_CONTAINER}" step ca revoke \
        --cert "${cert_file}" \
        --key "${cert_dir}/key.pem" \
        --reason "${reason}" \
        --ca-url https://localhost:9000 \
        --root /home/step/certs/root_ca.crt \
        2>/dev/null; then

        log_success "Certificate revoked successfully"

        # Optionally remove the certificate files
        log "Removing certificate files..."
        docker exec "${CA_CONTAINER}" rm -rf "${cert_dir}"
        log_success "Certificate files removed"

        return 0
    else
        log_error "Failed to revoke certificate"
        exit 1
    fi
}

# ==============================================================
# Main
# ==============================================================

main() {
    check_ca_running
    revoke_certificate "$SERVICE_NAME" "$REVOKE_REASON"

    log ""
    log "========================================"
    log_success "Certificate revocation complete"
    log "========================================"
}

main
