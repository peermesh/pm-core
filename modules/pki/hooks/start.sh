#!/bin/bash
# ==============================================================
# PKI Module - Start Hook
# ==============================================================
# Purpose: Start the step-ca Certificate Authority service
# Called: When module is activated via pmdl module start pki
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (start failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# ==============================================================
# Pre-start Checks
# ==============================================================

check_secrets() {
    log "Checking secrets configuration..."

    local configs_dir="${MODULE_DIR}/configs"
    local has_errors=false

    # CA password is required
    local ca_pw="${configs_dir}/ca_password"
    if [[ ! -f "$ca_pw" ]] || [[ ! -s "$ca_pw" ]]; then
        log_error "CA password not configured"
        log_error "  Run install.sh first or create: ${ca_pw}"
        has_errors=true
    else
        log_success "CA password configured"
    fi

    # Provisioner password is required
    local prov_pw="${configs_dir}/provisioner_password"
    if [[ ! -f "$prov_pw" ]] || [[ ! -s "$prov_pw" ]]; then
        log_error "Provisioner password not configured"
        log_error "  Run install.sh first or create: ${prov_pw}"
        has_errors=true
    else
        log_success "Provisioner password configured"
    fi

    if [[ "$has_errors" == true ]]; then
        return 1
    fi

    return 0
}

check_compose_file() {
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log_error "Compose file not found: ${COMPOSE_FILE}"
        return 1
    fi
    return 0
}

# ==============================================================
# Start Service
# ==============================================================

start_pki_service() {
    log "Starting PKI services..."

    cd "$MODULE_DIR"

    # Pull latest images if needed
    docker compose pull --quiet 2>/dev/null || true

    # Start the services
    if docker compose up -d --remove-orphans; then
        log_success "PKI services started"
        return 0
    else
        log_error "Failed to start PKI services"
        return 1
    fi
}

wait_for_healthy() {
    log "Waiting for step-ca to be ready..."

    local container="pmdl_step_ca"
    local max_wait=60
    local wait_count=0

    while [[ $wait_count -lt $max_wait ]]; do
        # Check if container is running
        if ! docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
            sleep 2
            ((wait_count+=2))
            continue
        fi

        # Check if healthcheck passes
        local health_status
        health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")

        if [[ "$health_status" == "healthy" ]]; then
            log_success "Step-CA is healthy and ready"
            return 0
        fi

        if [[ "$health_status" == "unhealthy" ]]; then
            log_warn "Step-CA reported unhealthy, checking logs..."
            docker logs --tail 20 "$container" 2>&1 || true
        fi

        sleep 2
        ((wait_count+=2))
        echo -n "."
    done

    echo ""
    log_error "Step-CA did not become healthy within ${max_wait} seconds"
    log "Checking container logs..."
    docker logs --tail 30 "$container" 2>&1 || true
    return 1
}

extract_root_ca() {
    log "Extracting root CA certificate..."

    local container="pmdl_step_ca"
    local certs_dir="${MODULE_DIR}/configs/certs"

    mkdir -p "$certs_dir"

    # Wait a moment for CA to fully initialize
    sleep 2

    # Extract root CA certificate
    if docker exec "$container" cat /home/step/certs/root_ca.crt > "${certs_dir}/root_ca.crt" 2>/dev/null; then
        chmod 644 "${certs_dir}/root_ca.crt"
        log_success "Root CA certificate extracted to: ${certs_dir}/root_ca.crt"
    else
        log_warn "Could not extract root CA certificate (CA may still be initializing)"
    fi

    # Extract CA fingerprint
    if docker exec "$container" step certificate fingerprint /home/step/certs/root_ca.crt > "${certs_dir}/root_ca.fingerprint" 2>/dev/null; then
        log_success "CA fingerprint: $(cat "${certs_dir}/root_ca.fingerprint")"
    fi
}

show_status() {
    local container="pmdl_step_ca"

    log ""
    log "Service Status:"
    docker ps --filter "name=pmdl_step_ca" --filter "name=pmdl_cert_renewer" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

    log ""
    log "CA Information:"
    log "  CA URL:        https://localhost:9000"
    log "  CA DNS Name:   ${PKI_CA_DNS_NAME:-ca.pmdl.local}"
    log ""
    log "Certificate Commands:"
    log "  Provision PostgreSQL cert:"
    log "    ${MODULE_DIR}/scripts/provision-cert.sh postgres"
    log ""
    log "  Provision Redis cert:"
    log "    ${MODULE_DIR}/scripts/provision-cert.sh redis"
    log ""
    log "  Provision custom service cert:"
    log "    ${MODULE_DIR}/scripts/provision-cert.sh <service-name>"
    log ""
    log "View logs:"
    log "  docker logs -f ${container}"
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Starting PKI Module"
    log "========================================"

    check_compose_file || exit 1
    check_secrets || exit 1

    start_pki_service || exit 1
    wait_for_healthy || exit 1
    extract_root_ca

    show_status

    log "========================================"
    log_success "PKI module started successfully"
    log "========================================"

    exit 0
}

main "$@"
