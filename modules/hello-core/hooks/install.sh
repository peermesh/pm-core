#!/bin/bash
# ==============================================================
# Hello Core Module - Install Hook
# ==============================================================
# Purpose: Validate environment and prepare the module for first run
# Called: Before first deployment, or via: ./hooks/install.sh
#
# This script demonstrates the install hook pattern:
#   1. Check dependencies (Docker, Docker Compose)
#   2. Validate configuration (.env file, DOMAIN variable)
#   3. Create required directories
#   4. Report readiness
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (installation failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_NAME="hello-core"

# Auto-create .env from .env.example if not present
if [[ -f "${MODULE_DIR}/.env.example" ]] && [[ ! -f "${MODULE_DIR}/.env" ]]; then
    cp "${MODULE_DIR}/.env.example" "${MODULE_DIR}/.env"
    echo "Created .env from .env.example"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()         { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }
log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }

# ==============================================================
# Pre-flight Checks
# ==============================================================

check_dependencies() {
    log "Checking dependencies..."

    local missing=()

    # Check for Docker
    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi

    # Check for Docker Compose plugin
    if ! docker compose version &> /dev/null; then
        missing+=("docker-compose-plugin")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing dependencies: ${missing[*]}"
        log_error "Install Docker and the Compose plugin before continuing."
        return 1
    fi

    log_success "Docker and Docker Compose available"
    return 0
}

check_foundation() {
    log "Checking foundation stack..."

    # Check if the proxy-external network exists (created by foundation)
    if docker network inspect pmdl_proxy-external &> /dev/null; then
        log_success "Foundation network pmdl_proxy-external exists"
    else
        log_warn "Foundation network pmdl_proxy-external not found"
        log_warn "Make sure the foundation stack is running before starting this module"
    fi

    # Check if Traefik is running
    if docker ps --filter "name=traefik" --filter "status=running" -q 2>/dev/null | grep -q .; then
        log_success "Traefik is running"
    else
        log_warn "Traefik does not appear to be running"
        log_warn "The module will start but HTTPS routing will not work until Traefik is up"
    fi
}

check_configuration() {
    log "Checking configuration..."

    local warnings=0

    # Check for .env file
    if [[ -f "${MODULE_DIR}/.env" ]]; then
        log_success ".env file exists"

        # Check DOMAIN is set
        if grep -q "^DOMAIN=" "${MODULE_DIR}/.env" 2>/dev/null; then
            local domain
            domain=$(grep "^DOMAIN=" "${MODULE_DIR}/.env" | cut -d= -f2-)
            if [[ "$domain" == "example.com" ]]; then
                log_warn "DOMAIN is still set to example.com -- update it to your actual domain"
                ((warnings++))
            else
                log_success "DOMAIN configured: ${domain}"
            fi
        else
            log_warn "DOMAIN not set in .env -- Traefik routing will not work"
            ((warnings++))
        fi
    else
        log_warn ".env file not found"
        log_info "Create it from the template: cp .env.example .env"
        ((warnings++))
    fi

    # Check that HTML content exists
    if [[ -f "${MODULE_DIR}/html/index.html" ]]; then
        log_success "Static HTML content exists"
    else
        log_error "html/index.html not found -- the module has no content to serve"
        return 1
    fi

    if [[ $warnings -gt 0 ]]; then
        log_warn "Configuration has ${warnings} warning(s) -- review before starting"
    else
        log_success "Configuration validated"
    fi

    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Installing ${MODULE_NAME}"
    log "========================================"
    log ""

    local errors=0

    # Pre-flight checks
    check_dependencies || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "Pre-flight checks failed"
        exit 1
    fi

    check_foundation
    check_configuration || ((errors++))

    log ""
    log "========================================"

    if [[ $errors -gt 0 ]]; then
        log_error "Installation completed with ${errors} error(s)"
        exit 1
    fi

    log_success "${MODULE_NAME} installed successfully"
    log ""
    log "Next steps:"
    log "  1. Copy and customize the env file:"
    log "     cp .env.example .env && \$EDITOR .env"
    log ""
    log "  2. Start the module:"
    log "     ./hooks/start.sh"
    log "     # or: docker compose up -d"
    log ""
    log "  3. Verify it works:"
    log "     ./hooks/health.sh"
    log "     # or: curl http://localhost:8080/"
    log ""
    log "========================================"

    exit 0
}

main "$@"
