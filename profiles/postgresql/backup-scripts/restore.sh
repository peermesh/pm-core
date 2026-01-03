#!/bin/bash
# ==============================================================
# PostgreSQL Restore Script
# ==============================================================
# Purpose: Restore PostgreSQL databases from backup files
# Features:
#   - Backup integrity verification (checksum + format)
#   - Support for both pg_dumpall (SQL) and pg_dump (custom format)
#   - Age decryption for encrypted backups
#   - Interactive confirmation to prevent accidents
#   - Dry-run mode for testing
#
# Profile: postgresql
# Documentation: profiles/postgresql/PROFILE-SPEC.md
# Decision Reference: D2.4-BACKUP-RECOVERY.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

CONTAINER_NAME="${CONTAINER_NAME:-pmdl_postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/postgres}"
AGE_KEY_FILE="${AGE_KEY_FILE:-~/.config/age/key.txt}"

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

warn() {
    log "WARNING: $*"
}

# Detect backup type from filename
detect_backup_type() {
    local file="$1"

    if [[ "$file" == *.sql.gz ]] || [[ "$file" == *.sql.gz.age ]]; then
        echo "sql"  # pg_dumpall format
    elif [[ "$file" == *.dump ]] || [[ "$file" == *.dump.age ]]; then
        echo "custom"  # pg_dump -Fc format
    else
        error_exit "Unknown backup format: $file"
    fi
}

# Decrypt age-encrypted file
decrypt_backup() {
    local encrypted_file="$1"
    local decrypted_file="${encrypted_file%.age}"

    if [[ ! -f "$AGE_KEY_FILE" ]]; then
        error_exit "Age key file not found: $AGE_KEY_FILE"
    fi

    log "Decrypting backup..."
    age -d -i "$AGE_KEY_FILE" "$encrypted_file" > "$decrypted_file" \
        || error_exit "Decryption failed"

    log "Decrypted to: $decrypted_file"
    echo "$decrypted_file"
}

# Verify backup integrity
verify_backup() {
    local backup_file="$1"
    local checksum_file="${backup_file}.sha256"

    log "Verifying backup integrity..."

    # Check checksum if available
    if [[ -f "$checksum_file" ]]; then
        log "  Verifying checksum..."
        sha256sum -c "$checksum_file" || error_exit "Checksum verification failed!"
        log "  Checksum: OK"
    else
        warn "No checksum file found: $checksum_file"
    fi

    # Verify format based on type
    local backup_type=$(detect_backup_type "$backup_file")

    case "$backup_type" in
        sql)
            log "  Verifying gzip format..."
            gzip -t "$backup_file" || error_exit "Gzip verification failed!"
            log "  Format: OK (gzip-compressed SQL)"
            ;;
        custom)
            log "  Verifying custom format..."
            docker exec -i "$CONTAINER_NAME" pg_restore --list < "$backup_file" > /dev/null 2>&1 \
                || error_exit "pg_restore verification failed!"
            log "  Format: OK (pg_dump custom)"
            ;;
    esac

    log "Backup verification complete"
}

# List available backups
list_backups() {
    log "Available backups in ${BACKUP_DIR}:"
    echo ""

    # Daily backups
    echo "=== Daily Backups ==="
    if [[ -d "${BACKUP_DIR}/daily" ]]; then
        ls -lh "${BACKUP_DIR}/daily"/*.gz "${BACKUP_DIR}/daily"/*.dump 2>/dev/null | tail -10 || echo "  (none)"
    else
        echo "  (directory not found)"
    fi
    echo ""

    # Pre-deploy backups
    echo "=== Pre-Deploy Backups ==="
    if [[ -d "${BACKUP_DIR}/pre-deploy" ]]; then
        ls -lh "${BACKUP_DIR}/pre-deploy"/*.gz 2>/dev/null | tail -5 || echo "  (none)"
    else
        echo "  (directory not found)"
    fi
    echo ""

    # Weekly/Monthly
    for tier in weekly monthly; do
        echo "=== ${tier^} Backups ==="
        if [[ -d "${BACKUP_DIR}/${tier}" ]]; then
            ls -lh "${BACKUP_DIR}/${tier}"/*.gz 2>/dev/null | tail -5 || echo "  (none)"
        else
            echo "  (directory not found)"
        fi
        echo ""
    done
}

# ==============================================================
# Restore Functions
# ==============================================================

restore_sql_dump() {
    local backup_file="$1"
    local dry_run="${2:-false}"

    log "Restoring from SQL dump: $backup_file"

    if [[ "$dry_run" == true ]]; then
        log "DRY RUN: Would execute: gunzip -c $backup_file | docker exec -i $CONTAINER_NAME psql -U postgres"
        return 0
    fi

    # Restore all databases
    gunzip -c "$backup_file" | docker exec -i "$CONTAINER_NAME" psql -U postgres \
        || error_exit "SQL restore failed"

    log "SQL restore complete"
}

restore_custom_dump() {
    local backup_file="$1"
    local db_name="$2"
    local dry_run="${3:-false}"

    log "Restoring custom dump to database: $db_name"

    if [[ "$dry_run" == true ]]; then
        log "DRY RUN: Would execute: docker exec -i $CONTAINER_NAME pg_restore -U postgres -d $db_name --clean --if-exists < $backup_file"
        return 0
    fi

    # Restore single database
    docker exec -i "$CONTAINER_NAME" pg_restore \
        -U postgres \
        -d "$db_name" \
        --clean \
        --if-exists \
        < "$backup_file" \
        || error_exit "Custom format restore failed"

    log "Custom format restore complete"
}

# ==============================================================
# Interactive Confirmation
# ==============================================================

confirm_restore() {
    local backup_file="$1"
    local backup_type="$2"

    echo ""
    echo "============================================"
    echo "         RESTORE CONFIRMATION"
    echo "============================================"
    echo ""
    echo "Backup file: $backup_file"
    echo "Backup type: $backup_type"
    echo "Container:   $CONTAINER_NAME"
    echo ""

    if [[ "$backup_type" == "sql" ]]; then
        echo "WARNING: This will DROP and recreate ALL databases!"
    else
        echo "WARNING: This will overwrite the target database!"
    fi

    echo ""
    echo "This action cannot be undone."
    echo ""
    read -p "Type 'RESTORE' to confirm: " confirm

    if [[ "$confirm" != "RESTORE" ]]; then
        log "Restore cancelled by user"
        exit 0
    fi
}

# ==============================================================
# Main Execution
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [command] [options]

Commands:
    restore     Restore from backup file [default]
    list        List available backups
    verify      Verify backup integrity without restoring

Options:
    -f, --file PATH        Backup file to restore
    -d, --database NAME    Target database (for custom format only)
    --dry-run              Show what would be done without executing
    --no-confirm           Skip confirmation prompt (dangerous!)
    -h, --help             Show this help

Environment Variables:
    CONTAINER_NAME    PostgreSQL container name (default: pmdl_postgres)
    BACKUP_DIR        Backup source directory
    AGE_KEY_FILE      Path to age private key for decryption

Examples:
    $0 list                                    # List available backups
    $0 verify -f /path/to/backup.sql.gz        # Verify backup integrity
    $0 restore -f /path/to/backup.sql.gz       # Restore full backup
    $0 restore -f synapse.dump -d synapse      # Restore single database
    $0 restore -f backup.sql.gz.age            # Decrypt and restore

EOF
    exit 0
}

main() {
    local command="${1:-restore}"
    local backup_file=""
    local db_name=""
    local dry_run=false
    local skip_confirm=false

    # Parse arguments
    shift || true
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -f|--file)
                backup_file="$2"
                shift 2
                ;;
            -d|--database)
                db_name="$2"
                shift 2
                ;;
            --dry-run)
                dry_run=true
                shift
                ;;
            --no-confirm)
                skip_confirm=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                error_exit "Unknown option: $1"
                ;;
        esac
    done

    case "$command" in
        list)
            list_backups
            exit 0
            ;;
        verify)
            [[ -z "$backup_file" ]] && error_exit "Backup file required (-f flag)"
            [[ -f "$backup_file" ]] || error_exit "File not found: $backup_file"
            verify_backup "$backup_file"
            exit 0
            ;;
        restore)
            # Validate inputs
            [[ -z "$backup_file" ]] && {
                echo "No backup file specified. Available backups:"
                echo ""
                list_backups
                echo ""
                error_exit "Use -f flag to specify backup file"
            }

            [[ -f "$backup_file" ]] || error_exit "File not found: $backup_file"

            # Verify container is running
            docker inspect "$CONTAINER_NAME" > /dev/null 2>&1 \
                || error_exit "Container not found: $CONTAINER_NAME"

            log "========================================"
            log "PostgreSQL Restore Started"
            log "Container: $CONTAINER_NAME"
            log "Backup: $backup_file"
            log "========================================"

            # Handle encrypted backups
            local restore_file="$backup_file"
            if [[ "$backup_file" == *.age ]]; then
                restore_file=$(decrypt_backup "$backup_file")
            fi

            # Verify backup
            verify_backup "$restore_file"

            # Detect backup type
            local backup_type=$(detect_backup_type "$restore_file")

            # Confirm with user
            if [[ "$skip_confirm" != true ]] && [[ "$dry_run" != true ]]; then
                confirm_restore "$restore_file" "$backup_type"
            fi

            # Execute restore
            case "$backup_type" in
                sql)
                    restore_sql_dump "$restore_file" "$dry_run"
                    ;;
                custom)
                    [[ -z "$db_name" ]] && error_exit "Database name required for custom format (-d flag)"
                    restore_custom_dump "$restore_file" "$db_name" "$dry_run"
                    ;;
            esac

            # Cleanup decrypted file if we created one
            if [[ "$backup_file" == *.age ]] && [[ -f "$restore_file" ]]; then
                log "Cleaning up decrypted file..."
                rm -f "$restore_file"
            fi

            log "========================================"
            log "PostgreSQL Restore Complete"
            log "========================================"

            # Post-restore verification
            log "Running post-restore verification..."
            docker exec "$CONTAINER_NAME" psql -U postgres -c "SELECT count(*) as databases FROM pg_database WHERE datistemplate = false;" \
                || warn "Post-restore verification failed"

            log "Restore finished successfully"
            ;;
        *)
            error_exit "Unknown command: $command"
            ;;
    esac

    exit 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
