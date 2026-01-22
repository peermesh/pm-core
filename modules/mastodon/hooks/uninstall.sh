#!/bin/bash
# ==============================================================
# Mastodon Module - Uninstall Hook
# ==============================================================
# Purpose: Remove Mastodon module and optionally clean up data
# Called: When module is uninstalled via pmdl module uninstall mastodon
#
# Options:
#   --keep-data    Keep volumes and database (default)
#   --purge        Remove all data including volumes and database
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (uninstall failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "${MODULE_DIR}/../.." && pwd)"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"
SECRETS_DIR="${PROJECT_ROOT}/secrets"

# Parse arguments
PURGE_DATA=false
for arg in "$@"; do
    case $arg in
        --purge)
            PURGE_DATA=true
            shift
            ;;
        --keep-data)
            PURGE_DATA=false
            shift
            ;;
    esac
done

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

stop_services() {
    log "Stopping Mastodon services..."

    cd "$MODULE_DIR"

    # Stop and remove containers
    if docker compose down --remove-orphans 2>/dev/null; then
        log_success "Services stopped and containers removed"
    else
        log_warn "Some containers may not have been removed"
    fi
}

# ==============================================================
# Data Cleanup
# ==============================================================

remove_volumes() {
    log "Removing Docker volumes..."

    local volumes=(
        "pmdl_mastodon_opensearch_data"
        "pmdl_mastodon_system"
        "pmdl_mastodon_assets"
    )

    for volume in "${volumes[@]}"; do
        if docker volume inspect "$volume" &> /dev/null; then
            if docker volume rm "$volume" 2>/dev/null; then
                log_success "Removed volume: $volume"
            else
                log_warn "Could not remove volume: $volume (may be in use)"
            fi
        else
            log_info "Volume not found: $volume"
        fi
    done
}

remove_database() {
    log "Removing Mastodon database..."

    local db_name="${MASTODON_DB_NAME:-mastodon}"
    local db_user="${MASTODON_DB_USER:-mastodon}"

    # Check if PostgreSQL is running
    if ! docker ps --filter "name=pmdl_postgres" --filter "status=running" --format '{{.Names}}' | grep -q "pmdl_postgres"; then
        log_warn "PostgreSQL is not running - skipping database removal"
        log_info "To remove manually, start PostgreSQL and run:"
        log_info "  docker exec pmdl_postgres psql -U postgres -c 'DROP DATABASE ${db_name};'"
        log_info "  docker exec pmdl_postgres psql -U postgres -c 'DROP USER ${db_user};'"
        return 0
    fi

    # Drop database
    if docker exec pmdl_postgres psql -U postgres -c "DROP DATABASE IF EXISTS ${db_name};" 2>/dev/null; then
        log_success "Dropped database: ${db_name}"
    else
        log_warn "Could not drop database: ${db_name}"
    fi

    # Drop user
    if docker exec pmdl_postgres psql -U postgres -c "DROP USER IF EXISTS ${db_user};" 2>/dev/null; then
        log_success "Dropped user: ${db_user}"
    else
        log_warn "Could not drop user: ${db_user}"
    fi
}

remove_secrets() {
    log "Removing secret files..."

    local secret_files=(
        "${SECRETS_DIR}/mastodon_secret_key_base"
        "${SECRETS_DIR}/mastodon_otp_secret"
        "${SECRETS_DIR}/mastodon_db_password"
    )

    for secret_file in "${secret_files[@]}"; do
        if [[ -f "$secret_file" ]]; then
            rm -f "$secret_file"
            log_success "Removed: $secret_file"
        fi
    done

    # Remove configs directory
    if [[ -d "${MODULE_DIR}/configs" ]]; then
        rm -rf "${MODULE_DIR}/configs"
        log_success "Removed: ${MODULE_DIR}/configs"
    fi
}

remove_env_file() {
    log "Removing environment file..."

    if [[ -f "${MODULE_DIR}/.env" ]]; then
        rm -f "${MODULE_DIR}/.env"
        log_success "Removed: ${MODULE_DIR}/.env"
    fi
}

# ==============================================================
# Confirmation
# ==============================================================

confirm_purge() {
    if [[ "$PURGE_DATA" != "true" ]]; then
        return 0
    fi

    echo ""
    echo -e "${RED}WARNING: You are about to permanently delete:${NC}"
    echo "  - All Mastodon media files (avatars, headers, attachments)"
    echo "  - The Mastodon database and all posts"
    echo "  - OpenSearch index data"
    echo "  - All secret keys and configuration"
    echo ""
    echo "This action CANNOT be undone!"
    echo ""
    read -p "Type 'DELETE' to confirm: " confirmation

    if [[ "$confirmation" != "DELETE" ]]; then
        log_info "Uninstall cancelled"
        exit 0
    fi
}

# ==============================================================
# Summary
# ==============================================================

show_summary() {
    log ""
    log "========================================"
    log "Uninstall Summary"
    log "========================================"

    if [[ "$PURGE_DATA" == "true" ]]; then
        log_success "Mastodon module completely removed (including all data)"
    else
        log_success "Mastodon module uninstalled"
        log ""
        log "The following data was preserved:"
        log "  - Docker volumes (media, assets, search index)"
        log "  - Database in PostgreSQL"
        log "  - Secret keys in ${SECRETS_DIR}/"
        log ""
        log "To completely remove all data, run:"
        log "  ./hooks/uninstall.sh --purge"
    fi

    log ""
    log "To reinstall the module:"
    log "  ./hooks/install.sh"
    log "========================================"
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Uninstalling Mastodon Module"
    log "========================================"

    if [[ "$PURGE_DATA" == "true" ]]; then
        log_warn "PURGE mode enabled - all data will be deleted"
        confirm_purge
    fi

    # Stop services first
    stop_services

    if [[ "$PURGE_DATA" == "true" ]]; then
        remove_volumes
        remove_database
        remove_secrets
        remove_env_file
    fi

    show_summary

    log "========================================"
    log_success "Mastodon module uninstalled"
    log "========================================"

    exit 0
}

main "$@"
