#!/bin/bash
# ==============================================================
# Module Template - Uninstall Hook
# ==============================================================
# Purpose: Clean up module resources
# Called: When module is removed
#
# IMPORTANT: This does NOT delete persistent data by default.
# Use --delete-data flag to remove data (DESTRUCTIVE).
#
# Exit codes:
#   0 - Success
#   1 - Fatal error
#
# CUSTOMIZE: Replace this stub with your module's cleanup logic.
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DELETE_DATA="${1:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()         { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Uninstalling Module: my-module"
    log "========================================"

    cd "$MODULE_DIR"

    # Stop service if running
    if docker compose ps -q 2>/dev/null | grep -q .; then
        docker compose down --timeout 30 || true
        log_success "Service stopped"
    fi

    # CUSTOMIZE: Add cleanup logic here.
    # Examples:
    #   - Remove Docker networks
    #   - Remove Docker volumes (with --delete-data flag)
    #   - Clean up temporary files

    if [[ "$DELETE_DATA" == "--delete-data" ]]; then
        log_warn "Data deletion requested -- add your cleanup logic here"
    else
        log "Persistent data preserved. Use --delete-data to remove."
    fi

    log "========================================"
    log_success "Module uninstalled"
    log "========================================"

    exit 0
}

main "$@"
