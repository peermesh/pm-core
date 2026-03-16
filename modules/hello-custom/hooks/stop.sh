#!/bin/bash
# ==============================================================
# Hello Custom Module - Stop Hook
# ==============================================================
# Purpose: Gracefully stop the nginx service
# Called: When module is deactivated, or via: ./hooks/stop.sh
#
# This script demonstrates the stop hook pattern:
#   1. Gracefully stop the compose services
#   2. Verify the container is stopped
#   3. Report final status
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (stop failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_NAME="hello-custom"
CONTAINER_NAME="hello-custom"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()         { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
# shellcheck disable=SC2329
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ==============================================================
# Stop Service
# ==============================================================

stop_service() {
    log "Stopping ${MODULE_NAME}..."

    cd "$MODULE_DIR"

    # Graceful shutdown with 30-second timeout
    if docker compose down --timeout 30; then
        log_success "${MODULE_NAME} stopped"
        return 0
    else
        log_error "Failed to stop ${MODULE_NAME} gracefully"

        # Force stop as fallback
        log "Attempting forced stop..."
        docker compose down --timeout 10 || true
        return 0
    fi
}

verify_stopped() {
    if docker ps --filter "name=${CONTAINER_NAME}" --format '{{.Names}}' 2>/dev/null | grep -q "${CONTAINER_NAME}"; then
        log_error "Container still running: ${CONTAINER_NAME}"
        return 1
    fi

    log_success "${MODULE_NAME} confirmed stopped"
    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Stopping ${MODULE_NAME}"
    log "========================================"

    stop_service || exit 1
    verify_stopped || exit 1

    log ""
    log "========================================"
    log_success "${MODULE_NAME} stopped successfully"
    log "========================================"

    exit 0
}

main "$@"
