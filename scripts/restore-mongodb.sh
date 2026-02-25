#!/bin/bash
# ==============================================================
# MongoDB Restore Script (Top-Level Operational)
# ==============================================================
# Purpose: Restore MongoDB databases from a gzip-compressed
#          mongodump archive with integrity verification and
#          interactive confirmation.
#
# Usage:   ./scripts/restore-mongodb.sh <backup_file.archive.gz>
#          ./scripts/restore-mongodb.sh --no-confirm <backup_file>
#
# Referenced by:
#   - docs/DEPLOYMENT.md
#   - docs/system-design-docs/06-operations/OPERATIONAL-RUNBOOK.md
#   - docs/system-design-docs/06-operations/BACKUP-RECOVERY-PROCEDURES.md
#   - docs/system-design-docs/06-operations/INCIDENT-RESPONSE-PLAN.md
# ==============================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONTAINER_NAME="${CONTAINER_NAME:-pmdl_mongodb}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/daily/mongodb}"

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

# Read MongoDB root password from secrets
read_mongo_password() {
    local password=""

    if [[ -f "/opt/peermesh/secrets/mongodb_root_password" ]]; then
        password="$(cat /opt/peermesh/secrets/mongodb_root_password)"
    elif [[ -f "${PROJECT_ROOT}/secrets/mongodb_root_password" ]]; then
        password="$(cat "${PROJECT_ROOT}/secrets/mongodb_root_password")"
    fi

    if [[ -z "$password" ]]; then
        error_exit "MongoDB root password not found. Checked:
  /opt/peermesh/secrets/mongodb_root_password
  ${PROJECT_ROOT}/secrets/mongodb_root_password"
    fi

    echo "$password"
}

usage() {
    cat <<EOF
Usage: $0 [--no-confirm] <backup_file>

Restore MongoDB databases from a gzip-compressed mongodump archive.

Arguments:
    backup_file       Path to mongodump archive file (gzip-compressed)

Options:
    --no-confirm      Skip interactive confirmation (for DR automation)
    -h, --help        Show this help

If no backup file is specified, the 10 most recent backups from
${BACKUP_DIR} are listed.

Environment Variables:
    CONTAINER_NAME    MongoDB container (default: pmdl_mongodb)
    BACKUP_DIR        Backup search directory

Examples:
    $0                                                    # List recent backups
    $0 /var/backups/pmdl/daily/mongodb/mongo-2026.archive.gz
    $0 --no-confirm /var/backups/pmdl/daily/mongodb/mongo-2026.archive.gz

EOF
    exit 0
}

list_recent_backups() {
    echo ""
    echo "=== Recent MongoDB Backups ==="
    echo "Directory: ${BACKUP_DIR}"
    echo ""
    if [[ -d "$BACKUP_DIR" ]]; then
        ls -lht "$BACKUP_DIR"/* 2>/dev/null | head -10 || echo "  (no backups found)"
    else
        echo "  (directory not found: ${BACKUP_DIR})"
    fi
    echo ""
}

# ==============================================================
# Main Execution
# ==============================================================

main() {
    local backup_file=""
    local no_confirm=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --no-confirm)
                no_confirm=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            -*)
                error_exit "Unknown option: $1"
                ;;
            *)
                backup_file="$1"
                shift
                ;;
        esac
    done

    # If no backup file specified, show usage and list backups
    if [[ -z "$backup_file" ]]; then
        echo "Usage: $0 [--no-confirm] <backup_file>"
        list_recent_backups
        exit 1
    fi

    # Validate file exists
    [[ -f "$backup_file" ]] || error_exit "Backup file not found: $backup_file"

    # Read MongoDB password
    local MONGO_PASSWORD
    MONGO_PASSWORD="$(read_mongo_password)"

    # Get file info
    local file_size
    file_size="$(du -h "$backup_file" | cut -f1)"

    echo ""
    echo "=== MongoDB Recovery ==="
    echo "Backup file: $backup_file"
    echo "Size: $file_size"
    echo "Container: $CONTAINER_NAME"
    echo ""

    # Integrity checks
    # Note: mongodump --archive --gzip files are not standard gzip; the
    # --gzip flag applies compression inside the archive stream. If the
    # file itself is also wrapped in gzip (double-compressed), test it.
    if file "$backup_file" | grep -q gzip; then
        log "Verifying outer gzip integrity..."
        gzip -t "$backup_file" || error_exit "Gzip integrity check failed: $backup_file"
        log "Gzip integrity: OK"
    else
        log "File is a mongodump --gzip archive (not outer gzip); skipping gzip -t"
    fi

    local checksum_file="${backup_file}.sha256"
    if [[ -f "$checksum_file" ]]; then
        log "Verifying SHA-256 checksum..."
        (cd "$(dirname "$backup_file")" && sha256sum -c "$checksum_file") \
            || error_exit "SHA-256 checksum verification failed"
        log "Checksum: OK"
    else
        log "No .sha256 checksum file found; skipping checksum verification"
    fi

    # Verify container is running
    docker inspect "$CONTAINER_NAME" > /dev/null 2>&1 \
        || error_exit "Container not running: $CONTAINER_NAME"

    # Interactive confirmation
    if [[ "$no_confirm" != true ]]; then
        echo ""
        echo "WARNING: This will restore MongoDB from the backup above."
        echo "         Existing collections will be dropped and replaced (--drop)."
        echo ""
        read -p "Type RESTORE to confirm: " confirm
        if [[ "$confirm" != "RESTORE" ]]; then
            log "Restore cancelled by user"
            exit 0
        fi
        echo ""
    fi

    # Execute restore
    log "Starting MongoDB restore..."
    cat "$backup_file" | docker exec -i "$CONTAINER_NAME" mongorestore \
        --username mongo \
        --password "$MONGO_PASSWORD" \
        --authenticationDatabase admin \
        --archive \
        --gzip \
        --drop \
        || error_exit "MongoDB restore failed"

    echo ""
    echo "=== MongoDB Recovery Complete ==="
    echo ""
    log "Restore finished successfully"
    echo ""
    echo "Suggested verification commands:"
    echo "  docker exec $CONTAINER_NAME mongosh -u mongo -p \"\$(cat /opt/peermesh/secrets/mongodb_root_password)\" --authenticationDatabase admin --eval 'db.adminCommand({listDatabases: 1})'"
    echo "  docker exec $CONTAINER_NAME mongosh -u mongo -p \"\$(cat /opt/peermesh/secrets/mongodb_root_password)\" --authenticationDatabase admin --eval 'db.serverStatus().connections'"
    echo ""
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
