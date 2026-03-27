#!/bin/bash
# ==============================================================
# Social Module - Uninstall Hook
# ==============================================================
# Purpose: Clean up module resources and optionally remove data
# Called: When module is removed, or via: ./hooks/uninstall.sh
#
# Actions:
#   1. Stop services if running
#   2. Without --delete-data: preserve volumes and database
#   3. With --delete-data: remove Docker volumes, optionally drop
#      database schemas
#   4. Report cleanup status
#
# IMPORTANT: This does NOT delete data by default.
# Use --delete-data to remove volumes (DESTRUCTIVE).
#
# Exit codes:
#   0 - Success
#   1 - Fatal error
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_NAME="social"
CONTAINER_NAME="social-app"
DELETE_DATA="${1:-}"

# Database defaults
DB_NAME="${SOCIAL_LAB_DB_NAME:-social_lab}"
DB_USER="${SOCIAL_LAB_DB_USER:-social_lab}"
DB_PORT="${SOCIAL_LAB_DB_PORT:-5432}"

# Source .env if present
if [[ -f "${MODULE_DIR}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    source "${MODULE_DIR}/.env"
    set +a
    DB_NAME="${SOCIAL_LAB_DB_NAME:-social_lab}"
    DB_USER="${SOCIAL_LAB_DB_USER:-social_lab}"
    DB_PORT="${SOCIAL_LAB_DB_PORT:-5432}"
fi

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
# Cleanup Functions
# ==============================================================

stop_service() {
    log "Stopping ${MODULE_NAME} if running..."

    cd "$MODULE_DIR"

    if docker compose ps -q 2>/dev/null | grep -q .; then
        docker compose down --timeout 30 || true
        log_success "Service stopped"
    else
        log_success "Service not running"
    fi
}

remove_volumes() {
    log "Removing Docker volumes..."

    # List any volumes created by this module
    local volumes
    volumes=$(docker volume ls --filter "name=social" --format '{{.Name}}' 2>/dev/null || printf "")

    if [[ -z "$volumes" ]]; then
        log_success "No module volumes found"
        return 0
    fi

    for vol in $volumes; do
        if docker volume rm "$vol" &> /dev/null; then
            log_success "Removed volume: $vol"
        else
            log_warn "Could not remove volume: $vol (may be in use)"
        fi
    done
}

drop_database() {
    log "Dropping database schemas and user..."

    # Find PostgreSQL container
    local pg_container
    pg_container=$(docker ps --filter "network=pmdl_db-internal" --filter "status=running" \
        --format '{{.Names}}' 2>/dev/null | grep -i "postgres" | head -1 || printf "")

    if [[ -z "$pg_container" ]]; then
        log_warn "PostgreSQL container not found -- cannot drop database"
        log_warn "Manually drop database '${DB_NAME}' and user '${DB_USER}' if needed"
        return 0
    fi

    local psql_prefix="psql -h 127.0.0.1 -p ${DB_PORT} -U postgres"

    # Drop database
    if docker exec "$pg_container" sh -c "${psql_prefix} -c \"DROP DATABASE IF EXISTS ${DB_NAME};\"" 2>/dev/null; then
        log_success "Dropped database: ${DB_NAME}"
    else
        log_warn "Could not drop database: ${DB_NAME}"
    fi

    # Drop user
    if docker exec "$pg_container" sh -c "${psql_prefix} -c \"DROP USER IF EXISTS ${DB_USER};\"" 2>/dev/null; then
        log_success "Dropped user: ${DB_USER}"
    else
        log_warn "Could not drop user: ${DB_USER}"
    fi
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Uninstalling ${MODULE_NAME}"
    log "========================================"

    stop_service

    if [[ "$DELETE_DATA" == "--delete-data" ]]; then
        log_warn "Data deletion requested"
        remove_volumes
        drop_database
    else
        log ""
        log "Data preserved. To also remove Docker volumes and database:"
        log "  ./hooks/uninstall.sh --delete-data"
        log ""
    fi

    log "========================================"
    log_success "${MODULE_NAME} uninstalled"
    log "========================================"
    log ""
    log "To completely remove the module files:"
    log "  rm -rf ${MODULE_DIR}"
    log ""

    exit 0
}

main "$@"
