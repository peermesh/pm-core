#!/bin/bash
# ==============================================================
# Hello Core Module - Start Hook
# ==============================================================
# Purpose: Start the nginx service and wait for it to be healthy
# Called: When module is activated, or via: ./hooks/start.sh
#
# This script demonstrates the start hook pattern:
#   1. Validate the compose file exists
#   2. Start services with docker compose
#   3. Wait for the health check to pass
#   4. Report service status
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (start failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_NAME="hello-core"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"
CONTAINER_NAME="hello-core"

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
# Pre-start Checks
# ==============================================================

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

start_service() {
    log "Starting ${MODULE_NAME}..."

    cd "$MODULE_DIR"

    # Pull the image if not present locally
    docker compose pull --quiet 2>/dev/null || true

    # Start the service
    if docker compose up -d --remove-orphans; then
        log_success "${MODULE_NAME} containers started"
        return 0
    else
        log_error "Failed to start ${MODULE_NAME}"
        return 1
    fi
}

wait_for_healthy() {
    log "Waiting for ${MODULE_NAME} to become healthy..."

    local max_wait=30
    local wait_count=0

    while [[ $wait_count -lt $max_wait ]]; do
        # Check if container is running
        if docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" \
            --format '{{.Names}}' 2>/dev/null | grep -q "${CONTAINER_NAME}"; then

            # Check if health check passes
            local health
            health=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "none")

            if [[ "$health" == "healthy" ]]; then
                log_success "${MODULE_NAME} is healthy"
                return 0
            elif [[ "$health" == "none" ]]; then
                # No health check defined or container just started
                log_success "${MODULE_NAME} is running (no health status yet)"
                return 0
            fi
        fi

        sleep 1
        ((wait_count++))
    done

    log_warn "${MODULE_NAME} did not become healthy within ${max_wait} seconds"
    log_warn "Check logs: docker compose -f ${COMPOSE_FILE} logs"
    return 1
}

show_status() {
    log ""
    log "Service Status:"
    docker ps --filter "name=${CONTAINER_NAME}" \
        --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

    log ""
    log "Access the module:"

    # Try to read DOMAIN from .env
    local domain
    domain=$(grep "^DOMAIN=" "${MODULE_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo "")
    local subdomain
    subdomain=$(grep "^HELLO_CORE_SUBDOMAIN=" "${MODULE_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo "hello-core")

    if [[ -n "$domain" && "$domain" != "example.com" ]]; then
        log "  https://${subdomain}.${domain}/"
    fi
    log "  docker exec ${CONTAINER_NAME} wget -qO- http://127.0.0.1/"
    log ""
    log "View logs:"
    log "  docker compose logs -f"
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Starting ${MODULE_NAME}"
    log "========================================"

    check_compose_file || exit 1

    start_service || exit 1
    wait_for_healthy || exit 1

    show_status

    log "========================================"
    log_success "${MODULE_NAME} started successfully"
    log "========================================"

    exit 0
}

main "$@"
