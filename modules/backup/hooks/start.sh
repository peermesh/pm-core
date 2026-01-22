#!/bin/bash
# ==============================================================
# Backup Module - Start Hook
# ==============================================================
# Purpose: Start the backup scheduler service
# Called: When module is activated via pmdl module start backup
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (start failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# ==============================================================
# Pre-start Checks
# ==============================================================

check_secrets() {
    log "Checking secrets configuration..."

    local configs_dir="${MODULE_DIR}/configs"
    local has_warnings=false

    # Restic password is required for encryption
    local restic_pw="${configs_dir}/restic_password"
    if [[ ! -f "$restic_pw" ]] || grep -q "Replace this" "$restic_pw" 2>/dev/null; then
        log_warn "Restic password not configured"
        log_warn "  Edit: ${restic_pw}"
        has_warnings=true
    else
        log_success "Restic password configured"
    fi

    # S3 credentials are optional
    if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
        local s3_access="${configs_dir}/s3_access_key"
        local s3_secret="${configs_dir}/s3_secret_key"

        if [[ ! -f "$s3_access" ]] || grep -q "Replace this" "$s3_access" 2>/dev/null; then
            log_warn "S3 access key not configured (off-site sync will be skipped)"
            has_warnings=true
        fi

        if [[ ! -f "$s3_secret" ]] || grep -q "Replace this" "$s3_secret" 2>/dev/null; then
            log_warn "S3 secret key not configured (off-site sync will be skipped)"
            has_warnings=true
        fi
    fi

    if [[ "$has_warnings" == true ]]; then
        log_warn "Secrets configuration incomplete - some features may be unavailable"
    fi

    return 0
}

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

start_backup_service() {
    log "Starting backup service..."

    cd "$MODULE_DIR"

    # Pull latest image if needed
    docker compose pull --quiet 2>/dev/null || true

    # Start the service
    if docker compose up -d --remove-orphans; then
        log_success "Backup service started"
        return 0
    else
        log_error "Failed to start backup service"
        return 1
    fi
}

wait_for_healthy() {
    log "Waiting for backup service to be ready..."

    local container="pmdl_backup"
    local max_wait=30
    local wait_count=0

    while [[ $wait_count -lt $max_wait ]]; do
        if docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
            log_success "Backup service is running"
            return 0
        fi
        sleep 1
        ((wait_count++))
    done

    log_error "Backup service did not start within ${max_wait} seconds"
    return 1
}

show_status() {
    local container="pmdl_backup"

    log ""
    log "Service Status:"
    docker ps --filter "name=${container}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

    log ""
    log "Manual backup commands:"
    log "  docker exec ${container} /usr/local/bin/backup-postgres.sh all"
    log "  docker exec ${container} /usr/local/bin/backup-volumes.sh backup --all"
    log "  docker exec ${container} /usr/local/bin/sync-offsite.sh"
    log ""
    log "View logs:"
    log "  docker logs -f ${container}"
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Starting Backup Module"
    log "========================================"

    check_compose_file || exit 1
    check_secrets

    start_backup_service || exit 1
    wait_for_healthy || exit 1

    show_status

    log "========================================"
    log_success "Backup module started successfully"
    log "========================================"

    exit 0
}

main "$@"
