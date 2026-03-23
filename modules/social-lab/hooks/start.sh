#!/bin/bash
# ==============================================================
# Social Lab Module - Start Hook
# ==============================================================
# Purpose: Start the social-lab-app container and wait for healthy status
# Called: When module is activated, or via: ./hooks/start.sh
#
# Actions:
#   1. Validate compose file exists
#   2. Pull image if not cached
#   3. docker compose up -d --remove-orphans
#   4. Wait up to 60s for container health check to pass
#   5. Report service status and access URL
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (start failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_NAME="social-lab"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"
CONTAINER_NAME="social-lab-app"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()         { printf "[%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
log_success() { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
log_warn()    { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
log_error()   { printf "${RED}[ERROR]${NC} %s\n" "$*"; }

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

    local max_wait=60
    local wait_count=0

    while [[ $wait_count -lt $max_wait ]]; do
        # Check if container is running
        if docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" \
            --format '{{.Names}}' 2>/dev/null | grep -q "${CONTAINER_NAME}"; then

            # Check if health check passes
            local health
            health=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null || printf "none")

            if [[ "$health" == "healthy" ]]; then
                log_success "${MODULE_NAME} is healthy (${wait_count}s)"
                return 0
            elif [[ "$health" == "none" ]]; then
                # No health check defined -- container is running
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

    # Try to read DOMAIN and subdomain from .env
    local domain=""
    local subdomain=""
    if [[ -f "${MODULE_DIR}/.env" ]]; then
        domain=$(grep "^DOMAIN=" "${MODULE_DIR}/.env" 2>/dev/null | cut -d= -f2- || printf "")
        subdomain=$(grep "^SOCIAL_LAB_SUBDOMAIN=" "${MODULE_DIR}/.env" 2>/dev/null | cut -d= -f2- || printf "")
    fi

    if [[ -n "$domain" && "$domain" != "example.com" ]]; then
        local instance_domain
        if [[ -n "$subdomain" ]]; then
            instance_domain="${subdomain}.${domain}"
        else
            instance_domain="${domain}"
        fi
        log "  https://${instance_domain}/"
        log "  https://${instance_domain}/health"
    fi
    log "  docker exec ${CONTAINER_NAME} wget -qO- http://127.0.0.1:3000/health"
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
