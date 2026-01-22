#!/bin/bash
# ==============================================================
# PKI Module - Certificate Provisioning Script
# ==============================================================
# Purpose: Provision TLS certificates for services using step-ca
#
# Usage:
#   ./provision-cert.sh <service-name> [options]
#   ./provision-cert.sh postgres
#   ./provision-cert.sh redis
#   ./provision-cert.sh custom-service --san custom.pmdl.local
#
# Options:
#   --san <name>      Additional Subject Alternative Name
#   --duration <time> Certificate duration (default: 720h)
#   --output <dir>    Output directory for certificates
#   --force           Overwrite existing certificates
#   --json            Output in JSON format
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CA_CONTAINER="pmdl_step_ca"

# Default configuration
PKI_CA_URL="${PKI_CA_URL:-https://step-ca:9000}"
PKI_CERT_DURATION="${PKI_CERT_DURATION:-720h}"
PKI_CERTS_OUTPUT_PATH="${PKI_CERTS_OUTPUT_PATH:-/home/step/certs/services}"

# Service presets
declare -A SERVICE_PRESETS=(
    ["postgres"]="postgres.pmdl.local,postgres,localhost"
    ["redis"]="redis.pmdl.local,redis,localhost"
    ["traefik"]="traefik.pmdl.local,traefik,localhost"
    ["dashboard"]="dashboard.pmdl.local,dashboard,localhost"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*" >&2
}

usage() {
    cat << EOF
Usage: $(basename "$0") <service-name> [options]

Provision TLS certificates for services using the internal step-ca.

Arguments:
  service-name    Name of the service (e.g., postgres, redis, custom-service)

Options:
  --san <name>      Additional Subject Alternative Name (can be repeated)
  --duration <time> Certificate duration (default: 720h)
  --output <dir>    Output directory for certificates
  --force           Overwrite existing certificates
  --json            Output result in JSON format
  -h, --help        Show this help message

Preset Services:
  postgres    - postgres.pmdl.local,postgres,localhost
  redis       - redis.pmdl.local,redis,localhost
  traefik     - traefik.pmdl.local,traefik,localhost
  dashboard   - dashboard.pmdl.local,dashboard,localhost

Examples:
  $(basename "$0") postgres
  $(basename "$0") my-service --san my-service.pmdl.local --san my-service
  $(basename "$0") api-gateway --duration 168h --force

EOF
    exit 0
}

# ==============================================================
# Argument Parsing
# ==============================================================

SERVICE_NAME=""
ADDITIONAL_SANS=()
DURATION="${PKI_CERT_DURATION}"
OUTPUT_DIR=""
FORCE="false"
JSON_OUTPUT="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        --san)
            ADDITIONAL_SANS+=("$2")
            shift 2
            ;;
        --duration)
            DURATION="$2"
            shift 2
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
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
            if [[ -z "$SERVICE_NAME" ]]; then
                SERVICE_NAME="$1"
            else
                log_error "Unexpected argument: $1"
                usage
            fi
            shift
            ;;
    esac
done

if [[ -z "$SERVICE_NAME" ]]; then
    log_error "Service name is required"
    usage
fi

# ==============================================================
# Pre-flight Checks
# ==============================================================

check_ca_running() {
    if ! docker ps --filter "name=${CA_CONTAINER}" --filter "status=running" -q | grep -q .; then
        log_error "CA container is not running: ${CA_CONTAINER}"
        log_error "Start the PKI module first: ./modules/pki/hooks/start.sh"
        exit 1
    fi
}

check_ca_healthy() {
    local health_status
    health_status=$(docker inspect --format='{{.State.Health.Status}}' "${CA_CONTAINER}" 2>/dev/null || echo "unknown")

    if [[ "$health_status" != "healthy" ]]; then
        log_warn "CA is not healthy (status: ${health_status})"
        log_warn "Certificate provisioning may fail"
    fi
}

# ==============================================================
# Certificate Provisioning
# ==============================================================

build_san_list() {
    local service="$1"
    local san_list=""

    # Start with preset if available
    if [[ -n "${SERVICE_PRESETS[$service]:-}" ]]; then
        san_list="${SERVICE_PRESETS[$service]}"
    else
        # Default SAN for custom services
        san_list="${service}.pmdl.local,${service},localhost"
    fi

    # Add additional SANs
    for san in "${ADDITIONAL_SANS[@]}"; do
        san_list="${san_list},${san}"
    done

    echo "$san_list"
}

provision_certificate() {
    local service="$1"
    local san_list="$2"
    local duration="$3"

    local cert_dir="${PKI_CERTS_OUTPUT_PATH}/${service}"
    local cert_file="${cert_dir}/cert.pem"
    local key_file="${cert_dir}/key.pem"

    log "Provisioning certificate for: ${service}"
    log_info "SANs: ${san_list}"
    log_info "Duration: ${duration}"

    # Check if certificate already exists
    if docker exec "${CA_CONTAINER}" test -f "${cert_file}" 2>/dev/null; then
        if [[ "$FORCE" != "true" ]]; then
            # Check if it needs renewal
            if docker exec "${CA_CONTAINER}" step certificate needs-renewal "${cert_file}" --expires-in "168h" 2>/dev/null; then
                log_info "Certificate exists but will expire soon, renewing..."
            else
                log_warn "Certificate already exists: ${cert_file}"
                log_warn "Use --force to overwrite"

                if [[ "$JSON_OUTPUT" == "true" ]]; then
                    output_json "existing" "${cert_file}" "${key_file}"
                fi
                return 0
            fi
        else
            log_info "Overwriting existing certificate (--force)"
        fi
    fi

    # Create certificate directory
    docker exec "${CA_CONTAINER}" mkdir -p "${cert_dir}"

    # Build SAN arguments
    local san_args=""
    IFS=',' read -ra SANS <<< "$san_list"
    for san in "${SANS[@]}"; do
        san_args="${san_args} --san ${san}"
    done

    # Request certificate from CA
    # Using the built-in provisioner with password from secrets
    local provisioner_password
    provisioner_password=$(cat "${MODULE_DIR}/configs/provisioner_password" 2>/dev/null || echo "")

    if [[ -z "$provisioner_password" ]]; then
        log_error "Provisioner password not found"
        exit 1
    fi

    # Execute certificate request inside the CA container
    if docker exec "${CA_CONTAINER}" sh -c "
        cd /home/step && \
        step ca certificate '${service}.pmdl.local' \
            '${cert_file}' '${key_file}' \
            --provisioner '${PKI_PROVISIONER_NAME:-pmdl-provisioner}' \
            --provisioner-password-file /run/secrets/provisioner_password \
            --not-after '${duration}' \
            ${san_args} \
            --force \
            --ca-url https://localhost:9000 \
            --root /home/step/certs/root_ca.crt
    "; then
        log_success "Certificate provisioned successfully"

        # Set appropriate permissions
        docker exec "${CA_CONTAINER}" chmod 644 "${cert_file}"
        docker exec "${CA_CONTAINER}" chmod 600 "${key_file}"

        # Show certificate info
        show_certificate_info "${cert_file}"

        if [[ "$JSON_OUTPUT" == "true" ]]; then
            output_json "provisioned" "${cert_file}" "${key_file}"
        fi

        return 0
    else
        log_error "Failed to provision certificate"
        exit 1
    fi
}

show_certificate_info() {
    local cert_file="$1"

    log ""
    log "Certificate Information:"

    # Get certificate details
    local cert_info
    cert_info=$(docker exec "${CA_CONTAINER}" step certificate inspect "${cert_file}" --format json 2>/dev/null || echo "{}")

    local subject
    subject=$(echo "$cert_info" | jq -r '.subject.common_name // "unknown"' 2>/dev/null || echo "unknown")

    local not_after
    not_after=$(echo "$cert_info" | jq -r '.validity.end // "unknown"' 2>/dev/null || echo "unknown")

    local sans
    sans=$(echo "$cert_info" | jq -r '.extensions.subject_alt_name.dns_names // [] | join(", ")' 2>/dev/null || echo "")

    log "  Subject:     ${subject}"
    log "  Expires:     ${not_after}"
    log "  SANs:        ${sans}"
}

output_json() {
    local status="$1"
    local cert_file="$2"
    local key_file="$3"

    local cert_info
    cert_info=$(docker exec "${CA_CONTAINER}" step certificate inspect "${cert_file}" --format json 2>/dev/null || echo "{}")

    local expiry
    expiry=$(echo "$cert_info" | jq -r '.validity.end // null' 2>/dev/null)

    cat << EOF
{
  "status": "${status}",
  "service": "${SERVICE_NAME}",
  "certificate": {
    "path": "${cert_file}",
    "keyPath": "${key_file}",
    "expiry": ${expiry:-null}
  },
  "timestamp": "$(date -Iseconds)"
}
EOF
}

# ==============================================================
# Copy Certificates to Host
# ==============================================================

copy_to_output() {
    if [[ -z "$OUTPUT_DIR" ]]; then
        return 0
    fi

    log "Copying certificates to: ${OUTPUT_DIR}"

    local cert_dir="${PKI_CERTS_OUTPUT_PATH}/${SERVICE_NAME}"

    mkdir -p "${OUTPUT_DIR}"

    # Copy from container to host
    docker cp "${CA_CONTAINER}:${cert_dir}/cert.pem" "${OUTPUT_DIR}/cert.pem"
    docker cp "${CA_CONTAINER}:${cert_dir}/key.pem" "${OUTPUT_DIR}/key.pem"

    # Also copy root CA
    docker cp "${CA_CONTAINER}:/home/step/certs/root_ca.crt" "${OUTPUT_DIR}/root_ca.crt"

    chmod 644 "${OUTPUT_DIR}/cert.pem" "${OUTPUT_DIR}/root_ca.crt"
    chmod 600 "${OUTPUT_DIR}/key.pem"

    log_success "Certificates copied to: ${OUTPUT_DIR}"
    log "  cert.pem     - Service certificate"
    log "  key.pem      - Private key (keep secure!)"
    log "  root_ca.crt  - CA certificate for verification"
}

# ==============================================================
# Main
# ==============================================================

main() {
    check_ca_running
    check_ca_healthy

    local san_list
    san_list=$(build_san_list "$SERVICE_NAME")

    provision_certificate "$SERVICE_NAME" "$san_list" "$DURATION"

    copy_to_output

    if [[ "$JSON_OUTPUT" != "true" ]]; then
        log ""
        log "========================================"
        log_success "Certificate provisioning complete"
        log "========================================"
        log ""
        log "To use this certificate in your service:"
        log "  1. Mount the certificate volume: pmdl_pki_certs"
        log "  2. Configure your service with:"
        log "     - Certificate: ${PKI_CERTS_OUTPUT_PATH}/${SERVICE_NAME}/cert.pem"
        log "     - Key:         ${PKI_CERTS_OUTPUT_PATH}/${SERVICE_NAME}/key.pem"
        log "     - CA:          /home/step/certs/root_ca.crt"
        log ""
    fi
}

main
