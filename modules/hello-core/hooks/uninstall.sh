#!/bin/bash
# ==============================================================
# Hello Core Module - Uninstall Hook
# ==============================================================
# Purpose: Clean up module resources and optionally remove data
# Called: When module is removed, or via: ./hooks/uninstall.sh
#
# This script demonstrates the uninstall hook pattern:
#   1. Stop services if running
#   2. Remove Docker resources (volumes, networks)
#   3. Preserve data by default (safety first)
#   4. Optionally delete data with --delete-data flag
#
# IMPORTANT: This does NOT delete data by default.
# Use --delete-data to remove volumes (DESTRUCTIVE).
#
# Exit codes:
#   0 - Success
#   1 - Fatal error
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_NAME="hello-core"
DELETE_DATA="${1:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()         { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
# shellcheck disable=SC2329
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ==============================================================
# Cleanup Functions
# ==============================================================

stop_service() {
    log "Stopping ${MODULE_NAME} if running..."

    cd "$MODULE_DIR"

    if docker compose ps -q 2>/dev/null | grep -q .; then
        docker compose down --timeout 30 || true
        log_success "Service stopped"
    else
        log_success "Service not running"
    fi
}

remove_volumes() {
    log "Removing Docker volumes..."

    # List any volumes created by this module
    local volumes
    volumes=$(docker volume ls --filter "name=hello-core" --format '{{.Name}}' 2>/dev/null || echo "")

    if [[ -z "$volumes" ]]; then
        log_success "No module volumes found"
        return 0
    fi

    for vol in $volumes; do
        if docker volume rm "$vol" &> /dev/null; then
            log_success "Removed volume: $vol"
        else
            log_warn "Could not remove volume: $vol (may be in use)"
        fi
    done
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Uninstalling ${MODULE_NAME}"
    log "========================================"

    stop_service

    if [[ "$DELETE_DATA" == "--delete-data" ]]; then
        log_warn "Data deletion requested"
        remove_volumes
    else
        log ""
        log "Data preserved. To also remove Docker volumes:"
        log "  ./hooks/uninstall.sh --delete-data"
        log ""
    fi

    log "========================================"
    log_success "${MODULE_NAME} uninstalled"
    log "========================================"
    log ""
    log "To completely remove the module files:"
    log "  rm -rf ${MODULE_DIR}"
    log ""

    exit 0
}

main "$@"
