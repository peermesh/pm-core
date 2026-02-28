#!/bin/bash
# ==============================================================
# Module Template - Start Hook
# ==============================================================
# Purpose: Start the module's Docker Compose services
# Called: When module is activated
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (start failed)
#
# CUSTOMIZE: Replace this stub with your module's start logic.
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()         { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Starting Module: my-module"
    log "========================================"

    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log_error "Compose file not found: ${COMPOSE_FILE}"
        exit 1
    fi

    cd "$MODULE_DIR"

    if docker compose up -d --remove-orphans; then
        log_success "Module started"
    else
        log_error "Failed to start module"
        exit 1
    fi

    # CUSTOMIZE: Add health wait logic here if your service
    # needs time to become ready.

    log "========================================"
    log_success "Module started successfully"
    log "========================================"

    exit 0
}

main "$@"
