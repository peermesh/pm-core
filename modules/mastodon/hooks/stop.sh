#!/bin/bash
# ==============================================================
# Mastodon Module - Stop Hook
# ==============================================================
# Purpose: Gracefully stop all Mastodon services
# Called: When module is deactivated via pmdl module stop mastodon
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (stop failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

# ==============================================================
# Stop Services
# ==============================================================

check_running_containers() {
    local containers=("pmdl_mastodon_web" "pmdl_mastodon_streaming" "pmdl_mastodon_sidekiq" "pmdl_mastodon_opensearch")
    local running=()

    for container in "${containers[@]}"; do
        if docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
            running+=("$container")
        fi
    done

    if [[ ${#running[@]} -eq 0 ]]; then
        log_info "No Mastodon containers are currently running"
        return 1
    fi

    log "Running containers: ${running[*]}"
    return 0
}

wait_for_sidekiq_drain() {
    log "Waiting for Sidekiq to finish active jobs..."

    local container="pmdl_mastodon_sidekiq"
    local max_wait=30
    local wait_count=0

    # Send TSTP signal to stop accepting new jobs
    docker kill --signal=TSTP "$container" 2>/dev/null || true

    # Wait for active jobs to complete (with timeout)
    while [[ $wait_count -lt $max_wait ]]; do
        # Check if sidekiq process is still busy
        local busy
        busy=$(docker exec "$container" ps aux 2>/dev/null | grep -c "sidekiq.*busy" || echo "0")

        if [[ "$busy" == "0" ]] || [[ "$busy" == "" ]]; then
            log_success "Sidekiq drained successfully"
            return 0
        fi

        sleep 1
        ((wait_count++))

        if [[ $((wait_count % 10)) -eq 0 ]]; then
            log_info "Still waiting for Sidekiq... (${wait_count}s)"
        fi
    done

    log_warn "Sidekiq drain timeout - forcing stop"
    return 0
}

stop_services() {
    log "Stopping Mastodon services..."

    cd "$MODULE_DIR"

    # First try graceful stop
    if docker compose stop --timeout 30; then
        log_success "Services stopped gracefully"
        return 0
    else
        log_warn "Graceful stop failed - forcing stop"
    fi

    # Force stop if needed
    if docker compose kill; then
        log_success "Services killed"
        return 0
    else
        log_error "Failed to stop services"
        return 1
    fi
}

remove_containers() {
    log "Removing stopped containers..."

    cd "$MODULE_DIR"

    # Remove containers but keep volumes
    if docker compose rm -f 2>/dev/null; then
        log_success "Containers removed"
    else
        log_warn "Some containers could not be removed"
    fi

    return 0
}

show_status() {
    log ""
    log "========================================"
    log "Service Status"
    log "========================================"

    local containers=("pmdl_mastodon_web" "pmdl_mastodon_streaming" "pmdl_mastodon_sidekiq" "pmdl_mastodon_opensearch")

    for container in "${containers[@]}"; do
        local status
        status=$(docker ps -a --filter "name=${container}" --format '{{.Status}}' 2>/dev/null || echo "not found")
        if [[ -z "$status" ]]; then
            status="not found"
        fi
        echo "  ${container}: ${status}"
    done

    log ""
    log "Data volumes preserved:"
    docker volume ls --filter "name=pmdl_mastodon" --format "  {{.Name}}" 2>/dev/null || true

    log ""
    log "To restart: ./hooks/start.sh"
    log "To remove data: docker compose down -v"
    log ""
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Stopping Mastodon Module"
    log "========================================"

    # Check if anything is running
    if ! check_running_containers; then
        log_success "Mastodon module is already stopped"
        exit 0
    fi

    # Graceful shutdown sequence
    wait_for_sidekiq_drain
    stop_services || exit 1

    # Optionally remove containers (keeps volumes)
    if [[ "${MASTODON_REMOVE_CONTAINERS:-true}" == "true" ]]; then
        remove_containers
    fi

    show_status

    log "========================================"
    log_success "Mastodon module stopped successfully"
    log "========================================"

    exit 0
}

main "$@"
