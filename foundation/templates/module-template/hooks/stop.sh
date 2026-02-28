#!/bin/bash
# ==============================================================
# Module Template - Stop Hook
# ==============================================================
# Purpose: Gracefully stop the module's Docker Compose services
# Called: When module is deactivated
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (stop failed)
#
# CUSTOMIZE: Replace this stub with your module's stop logic.
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log()         { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Stopping Module: my-module"
    log "========================================"

    cd "$MODULE_DIR"

    # CUSTOMIZE: Add pre-stop logic here if your module needs
    # to complete in-progress operations before shutting down.

    if docker compose down --timeout 30; then
        log_success "Module stopped"
    else
        log_error "Failed to stop module gracefully"
        docker compose down --timeout 10 || true
    fi

    log "========================================"
    log_success "Module stopped successfully"
    log "========================================"

    exit 0
}

main "$@"
