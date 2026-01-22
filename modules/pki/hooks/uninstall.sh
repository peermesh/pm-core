#!/bin/bash
# ==============================================================
# PKI Module - Uninstall Hook
# ==============================================================
# Purpose: Remove PKI module and optionally clean up data
# Called: When module is removed via pmdl module uninstall pki
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (uninstall failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Options
REMOVE_DATA="${REMOVE_DATA:-false}"
FORCE="${FORCE:-false}"

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
# Pre-uninstall Checks
# ==============================================================

check_dependent_services() {
    log "Checking for services using PKI certificates..."

    # This is a placeholder - in a full implementation, you would check
    # which services have certificates issued by this CA
    log_warn "Warning: Services using PKI certificates may be affected"
    log_warn "Ensure you have alternative certificates or disable TLS"

    if [[ "$FORCE" != "true" ]]; then
        read -p "Continue with uninstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log "Uninstall cancelled"
            exit 0
        fi
    fi
}

# ==============================================================
# Stop Services
# ==============================================================

stop_services() {
    log "Stopping PKI services..."

    cd "$MODULE_DIR"

    if docker compose ps -q 2>/dev/null | grep -q .; then
        docker compose down --timeout 30 || docker compose down --timeout 10 || true
        log_success "PKI services stopped"
    else
        log_success "PKI services already stopped"
    fi
}

# ==============================================================
# Clean Up
# ==============================================================

remove_networks() {
    log "Removing PKI networks..."

    local networks=("pmdl_pki-internal" "pmdl_pki-external")

    for network in "${networks[@]}"; do
        if docker network inspect "$network" &>/dev/null; then
            if docker network rm "$network" &>/dev/null; then
                log_success "Removed network: $network"
            else
                log_warn "Could not remove network: $network (may be in use)"
            fi
        else
            log_success "Network already removed: $network"
        fi
    done
}

remove_volumes() {
    if [[ "$REMOVE_DATA" != "true" ]]; then
        log_warn "Keeping data volumes (use REMOVE_DATA=true to delete)"
        return 0
    fi

    log "Removing PKI data volumes..."

    local volumes=("pmdl_pki_ca_data" "pmdl_pki_certs")

    for volume in "${volumes[@]}"; do
        if docker volume inspect "$volume" &>/dev/null; then
            if docker volume rm "$volume" &>/dev/null; then
                log_success "Removed volume: $volume"
            else
                log_error "Could not remove volume: $volume"
            fi
        else
            log_success "Volume already removed: $volume"
        fi
    done
}

# ==============================================================
# Main
# ==============================================================

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --remove-data)
                REMOVE_DATA="true"
                shift
                ;;
            --force|-f)
                FORCE="true"
                shift
                ;;
            *)
                shift
                ;;
        esac
    done

    log "========================================"
    log "Uninstalling PKI Module"
    log "========================================"

    if [[ "$REMOVE_DATA" == "true" ]]; then
        log_warn "Data removal enabled - CA keys and certificates will be deleted!"
    fi

    # Check dependencies
    check_dependent_services

    # Stop services
    stop_services

    # Remove networks
    remove_networks

    # Remove volumes if requested
    remove_volumes

    log ""
    log "========================================"
    log_success "PKI module uninstalled"
    log "========================================"

    if [[ "$REMOVE_DATA" != "true" ]]; then
        log ""
        log "Note: CA data and certificates preserved in Docker volumes:"
        log "  - pmdl_pki_ca_data (CA configuration and keys)"
        log "  - pmdl_pki_certs (issued certificates)"
        log ""
        log "To completely remove all data, run:"
        log "  REMOVE_DATA=true ${BASH_SOURCE[0]}"
        log ""
    fi

    exit 0
}

main "$@"
