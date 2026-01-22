#!/bin/bash
# ==============================================================
# PKI Module - Stop Hook
# ==============================================================
# Purpose: Gracefully stop the step-ca Certificate Authority
# Called: When module is deactivated via pmdl module stop pki
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (stop failed)
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
# Pre-stop Checks
# ==============================================================

check_pending_operations() {
    log "Checking for pending certificate operations..."

    local container="pmdl_step_ca"

    # Check if CA is processing any requests
    # This is a simplified check - step-ca doesn't expose pending operations easily
    if docker ps --filter "name=${container}" --filter "status=running" -q | grep -q .; then
        log_success "CA service is running, proceeding with graceful shutdown"
    else
        log_warn "CA service is not running"
    fi

    return 0
}

# ==============================================================
# Stop Service
# ==============================================================

stop_pki_service() {
    log "Stopping PKI services..."

    cd "$MODULE_DIR"

    # Stop with graceful timeout (allow time for pending requests)
    if docker compose down --timeout 30; then
        log_success "PKI services stopped"
        return 0
    else
        log_error "Failed to stop PKI services gracefully"

        # Force stop if needed
        log "Attempting forced stop..."
        docker compose down --timeout 10 || true
        return 0
    fi
}

verify_stopped() {
    local containers=("pmdl_step_ca" "pmdl_cert_renewer")
    local running=()

    for container in "${containers[@]}"; do
        if docker ps --filter "name=${container}" --format '{{.Names}}' | grep -q "$container"; then
            running+=("$container")
        fi
    done

    if [[ ${#running[@]} -gt 0 ]]; then
        log_error "Containers still running: ${running[*]}"
        return 1
    fi

    log_success "PKI services confirmed stopped"
    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Stopping PKI Module"
    log "========================================"

    # Check for pending operations
    check_pending_operations

    # Stop the services
    stop_pki_service || exit 1

    # Verify they stopped
    verify_stopped || exit 1

    log ""
    log "========================================"
    log_success "PKI module stopped successfully"
    log "========================================"
    log ""
    log "Note: CA data and certificates remain at:"
    log "  - Docker volumes: pmdl_pki_ca_data, pmdl_pki_certs"
    log "  - Config files: ${MODULE_DIR}/configs/"
    log ""
    log "Services using PKI certificates will continue to work"
    log "until their certificates expire."
    log ""

    exit 0
}

main "$@"
