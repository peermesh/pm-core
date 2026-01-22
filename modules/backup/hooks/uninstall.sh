#!/bin/bash
# ==============================================================
# Backup Module - Uninstall Hook
# ==============================================================
# Purpose: Clean up backup module resources
# Called: When module is removed via pmdl module uninstall backup
#
# IMPORTANT: This does NOT delete backup data by default.
# Use --delete-data flag to remove backups (DESTRUCTIVE).
#
# Exit codes:
#   0 - Success
#   1 - Fatal error
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_LOCAL_PATH="${BACKUP_LOCAL_PATH:-/var/backups/pmdl}"
DELETE_DATA="${1:-}"

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
# Cleanup Functions
# ==============================================================

stop_service() {
    log "Stopping backup service if running..."

    cd "$MODULE_DIR"

    if docker compose ps -q 2>/dev/null | grep -q .; then
        docker compose down --timeout 30 || true
        log_success "Service stopped"
    else
        log_success "Service not running"
    fi
}

remove_network() {
    log "Removing backup network..."

    local network="pmdl_backup-internal"

    if docker network inspect "$network" &> /dev/null; then
        docker network rm "$network" &> /dev/null || true
        log_success "Network removed: $network"
    else
        log_success "Network does not exist: $network"
    fi
}

clean_configs() {
    log "Cleaning up module configs..."

    local configs_dir="${MODULE_DIR}/configs"

    if [[ -d "$configs_dir" ]]; then
        # Remove placeholder secrets (keep real ones as backup)
        for secret_file in "${configs_dir}"/*; do
            if [[ -f "$secret_file" ]] && grep -q "Replace this" "$secret_file" 2>/dev/null; then
                rm -f "$secret_file"
                log_success "Removed placeholder: $(basename "$secret_file")"
            fi
        done

        # Remove empty configs directory
        rmdir "$configs_dir" 2>/dev/null || true
    fi
}

warn_about_data() {
    log ""
    log_warn "========================================"
    log_warn "BACKUP DATA NOT DELETED"
    log_warn "========================================"
    log ""
    log "Backup data remains at: ${BACKUP_LOCAL_PATH}"
    log ""
    log "To delete backup data (DESTRUCTIVE):"
    log "  rm -rf ${BACKUP_LOCAL_PATH}"
    log ""
    log "Or re-run with --delete-data flag (not recommended)"
    log ""
}

delete_backup_data() {
    log ""
    log_error "========================================"
    log_error "DELETING BACKUP DATA"
    log_error "========================================"
    log ""

    if [[ -d "$BACKUP_LOCAL_PATH" ]]; then
        log_warn "This will permanently delete all backups!"
        log_warn "Path: ${BACKUP_LOCAL_PATH}"
        log ""
        read -p "Type 'DELETE' to confirm: " confirm

        if [[ "$confirm" == "DELETE" ]]; then
            rm -rf "$BACKUP_LOCAL_PATH"
            log_success "Backup data deleted"
        else
            log "Deletion cancelled"
        fi
    else
        log_success "No backup data found"
    fi
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Uninstalling Backup Module"
    log "========================================"

    stop_service
    remove_network
    clean_configs

    if [[ "$DELETE_DATA" == "--delete-data" ]]; then
        delete_backup_data
    else
        warn_about_data
    fi

    log "========================================"
    log_success "Backup module uninstalled"
    log "========================================"

    exit 0
}

main "$@"
