#!/bin/bash
# ==============================================================
# Backup Module - Stop Hook
# ==============================================================
# Purpose: Gracefully stop the backup scheduler service
# Called: When module is deactivated via pmdl module stop backup
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
# Pre-stop Checks
# ==============================================================

check_running_backup() {
    log "Checking for running backup jobs..."

    local container="pmdl_backup"

    # Check if a backup is currently running
    if docker exec "$container" pgrep -f "backup-postgres.sh\|backup-volumes.sh\|sync-offsite.sh" &> /dev/null; then
        log_warn "Backup job is currently running"
        log_warn "Waiting for backup to complete (up to 5 minutes)..."

        local max_wait=300
        local wait_count=0

        while [[ $wait_count -lt $max_wait ]]; do
            if ! docker exec "$container" pgrep -f "backup-postgres.sh\|backup-volumes.sh\|sync-offsite.sh" &> /dev/null; then
                log_success "Backup job completed"
                return 0
            fi
            sleep 5
            ((wait_count+=5))
            log "  Still waiting... (${wait_count}s / ${max_wait}s)"
        done

        log_warn "Backup job did not complete within timeout"
        log_warn "Proceeding with graceful shutdown anyway"
    else
        log_success "No backup jobs running"
    fi

    return 0
}

# ==============================================================
# Stop Service
# ==============================================================

stop_backup_service() {
    log "Stopping backup service..."

    cd "$MODULE_DIR"

    # Stop with graceful timeout
    if docker compose down --timeout 30; then
        log_success "Backup service stopped"
        return 0
    else
        log_error "Failed to stop backup service gracefully"

        # Force stop if needed
        log "Attempting forced stop..."
        docker compose down --timeout 10 || true
        return 0
    fi
}

verify_stopped() {
    local container="pmdl_backup"

    if docker ps --filter "name=${container}" --format '{{.Names}}' | grep -q "$container"; then
        log_error "Container still running: ${container}"
        return 1
    fi

    log_success "Backup service confirmed stopped"
    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Stopping Backup Module"
    log "========================================"

    # Check for running backups
    check_running_backup

    # Stop the service
    stop_backup_service || exit 1

    # Verify it stopped
    verify_stopped || exit 1

    log ""
    log "========================================"
    log_success "Backup module stopped successfully"
    log "========================================"
    log ""
    log "Note: Backup data remains at: ${BACKUP_LOCAL_PATH:-/var/backups/pmdl}"
    log ""

    exit 0
}

main "$@"
