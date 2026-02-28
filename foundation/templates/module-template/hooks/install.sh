#!/bin/bash
# ==============================================================
# Module Template - Install Hook
# ==============================================================
# Purpose: Initialize module directories and validate configuration
# Called: When module is first installed
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (installation failed)
#
# CUSTOMIZE: Replace this stub with your module's installation logic.
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()         { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ==============================================================
# Pre-flight Checks
# ==============================================================

check_dependencies() {
    log "Checking dependencies..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        return 1
    fi

    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose plugin is not installed"
        return 1
    fi

    log_success "All dependencies available"
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Installing Module: my-module"
    log "========================================"

    check_dependencies || exit 1

    # CUSTOMIZE: Add your module's installation steps here.
    # Examples:
    #   - Create data directories
    #   - Generate secret placeholder files
    #   - Validate configuration
    #   - Create Docker networks

    log_success "Module installed successfully"
    log ""
    log "Next steps:"
    log "  1. Copy .env.example to .env and customize values"
    log "  2. Start the module: ./hooks/start.sh"
    log ""

    exit 0
}

main "$@"
