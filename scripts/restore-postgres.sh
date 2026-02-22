#!/bin/bash
# ==============================================================
# PostgreSQL Restore Script (Top-Level Operational)
# ==============================================================
# Purpose: Restore PostgreSQL databases from a gzip-compressed
#          SQL dump file with integrity verification and
#          interactive confirmation.
#
# Usage:   ./scripts/restore-postgres.sh <backup_file.dump.gz>
#          ./scripts/restore-postgres.sh --no-confirm <backup_file>
#
# Referenced by:
#   - docs/DEPLOYMENT.md
#   - docs/system-design-docs/06-operations/OPERATIONAL-RUNBOOK.md
#   - docs/system-design-docs/06-operations/BACKUP-RECOVERY-PROCEDURES.md
#   - docs/system-design-docs/06-operations/INCIDENT-RESPONSE-PLAN.md
# ==============================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONTAINER_NAME="${CONTAINER_NAME:-pmdl_postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/daily/postgres}"

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

usage() {
    cat <<EOF
Usage: $0 [--no-confirm] <backup_file.dump.gz>

Restore a PostgreSQL database from a gzip-compressed SQL dump.

Arguments:
    backup_file       Path to .dump.gz backup file

Options:
    --no-confirm      Skip interactive confirmation (for DR automation)
    -h, --help        Show this help

If no backup file is specified, the 10 most recent backups from
${BACKUP_DIR} are listed.

Environment Variables:
    CONTAINER_NAME    PostgreSQL container (default: pmdl_postgres)
    BACKUP_DIR        Backup search directory

Examples:
    $0                                                # List recent backups
    $0 /var/backups/pmdl/daily/postgres/pg-2026.dump.gz
    $0 --no-confirm /var/backups/pmdl/daily/postgres/pg-2026.dump.gz

EOF
    exit 0
}

list_recent_backups() {
    echo ""
    echo "=== Recent PostgreSQL Backups ==="
    echo "Directory: ${BACKUP_DIR}"
    echo ""
    if [[ -d "$BACKUP_DIR" ]]; then
        ls -lht "$BACKUP_DIR"/*.gz 2>/dev/null | head -10 || echo "  (no .gz backups found)"
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
        echo "Usage: $0 [--no-confirm] <backup_file.dump.gz>"
        list_recent_backups
        exit 1
    fi

    # Validate file exists
    [[ -f "$backup_file" ]] || error_exit "Backup file not found: $backup_file"

    # Get file info
    local file_size
    file_size="$(du -h "$backup_file" | cut -f1)"

    echo ""
    echo "=== PostgreSQL Recovery ==="
    echo "Backup file: $backup_file"
    echo "Size: $file_size"
    echo "Container: $CONTAINER_NAME"
    echo ""

    # Integrity checks
    log "Verifying gzip integrity..."
    gzip -t "$backup_file" || error_exit "Gzip integrity check failed: $backup_file"
    log "Gzip integrity: OK"

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
        echo "WARNING: This will restore the PostgreSQL database from the backup above."
        echo "         Existing data will be overwritten."
        echo ""
        read -p "Type RESTORE to confirm: " confirm
        if [[ "$confirm" != "RESTORE" ]]; then
            log "Restore cancelled by user"
            exit 0
        fi
        echo ""
    fi

    # Execute restore
    log "Starting PostgreSQL restore..."
    gunzip -c "$backup_file" | docker exec -i "$CONTAINER_NAME" psql -U postgres \
        || error_exit "PostgreSQL restore failed"

    echo ""
    echo "=== PostgreSQL Recovery Complete ==="
    echo ""
    log "Restore finished successfully"
    echo ""
    echo "Suggested verification commands:"
    echo "  docker exec $CONTAINER_NAME psql -U postgres -c '\\l'"
    echo "  docker exec $CONTAINER_NAME psql -U postgres -c 'SELECT count(*) FROM pg_database WHERE datistemplate = false;'"
    echo ""
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
