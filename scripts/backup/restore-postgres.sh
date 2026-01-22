#!/bin/bash
# ==============================================================
# PostgreSQL Restore Script (Unified)
# ==============================================================
# Purpose: Restore PostgreSQL databases from backup files
# Features:
#   - Backup integrity verification (checksum + format)
#   - Support for both pg_dumpall (SQL) and pg_dump (custom format)
#   - Age decryption for encrypted backups
#   - Restic snapshot restore support
#   - S3/MinIO download capability
#   - Interactive confirmation to prevent accidents
#   - Dry-run mode for testing
#   - Point-in-time listing of available backups
#
# Documentation: scripts/backup/README.md
# Decision Reference: docs/decisions/0102-backup-architecture.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

CONTAINER_NAME="${CONTAINER_NAME:-pmdl_postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/postgres}"
AGE_KEY_FILE="${AGE_KEY_FILE:-${HOME}/.config/age/key.txt}"
SECRET_DIR="${SECRET_DIR:-./secrets}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Restic settings (optional)
RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-}"

# S3 settings (optional)
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_ACCESS_KEY_FILE="${S3_ACCESS_KEY_FILE:-}"
S3_SECRET_KEY_FILE="${S3_SECRET_KEY_FILE:-}"

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

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
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

# ==============================================================
# Decryption Functions
# ==============================================================

decrypt_backup() {
    local encrypted_file="$1"
    local decrypted_file="${encrypted_file%.age}"

    # Check for age key file
    if [[ ! -f "$AGE_KEY_FILE" ]]; then
        # Try to find key in secrets
        if [[ -f "${SECRET_DIR}/age_key" ]]; then
            AGE_KEY_FILE="${SECRET_DIR}/age_key"
        elif [[ -f "${PROJECT_ROOT}/secrets/age_key" ]]; then
            AGE_KEY_FILE="${PROJECT_ROOT}/secrets/age_key"
        else
            error_exit "Age key file not found. Set AGE_KEY_FILE or place key in secrets/age_key"
        fi
    fi

    log "Decrypting backup..."
    age -d -i "$AGE_KEY_FILE" "$encrypted_file" > "$decrypted_file" \
        || error_exit "Decryption failed"

    log "Decrypted to: $decrypted_file"
    echo "$decrypted_file"
}

# ==============================================================
# Verification Functions
# ==============================================================

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

# ==============================================================
# Download Functions
# ==============================================================

download_from_s3() {
    local s3_path="$1"
    local local_path="$2"

    if [[ -z "$S3_ENDPOINT" ]] || [[ -z "$S3_BUCKET" ]]; then
        error_exit "S3_ENDPOINT and S3_BUCKET required for S3 download"
    fi

    log "Downloading from S3: $s3_path"

    if command_exists aws; then
        # Read credentials
        local access_key=""
        local secret_key=""

        if [[ -n "$S3_ACCESS_KEY_FILE" ]] && [[ -f "$S3_ACCESS_KEY_FILE" ]]; then
            access_key=$(cat "$S3_ACCESS_KEY_FILE")
        fi
        if [[ -n "$S3_SECRET_KEY_FILE" ]] && [[ -f "$S3_SECRET_KEY_FILE" ]]; then
            secret_key=$(cat "$S3_SECRET_KEY_FILE")
        fi

        AWS_ACCESS_KEY_ID="$access_key" \
        AWS_SECRET_ACCESS_KEY="$secret_key" \
        aws --endpoint-url "$S3_ENDPOINT" \
            s3 cp "s3://${S3_BUCKET}/${s3_path}" "$local_path" \
            || error_exit "S3 download failed"
    elif command_exists mc; then
        mc cp "pmdl-backup/${S3_BUCKET}/${s3_path}" "$local_path" \
            || error_exit "S3 download failed"
    elif command_exists rclone; then
        rclone copy "pmdl-s3:${S3_BUCKET}/${s3_path}" "$(dirname "$local_path")/" \
            || error_exit "S3 download failed"
    else
        error_exit "No S3 client found (aws, mc, or rclone)"
    fi

    log "Downloaded: $local_path"
}

restore_from_restic() {
    local snapshot="${1:-latest}"
    local target_dir="${2:-/tmp/restic-restore}"

    if [[ -z "$RESTIC_REPOSITORY" ]]; then
        error_exit "RESTIC_REPOSITORY required for restic restore"
    fi

    if ! command_exists restic; then
        error_exit "restic command not found"
    fi

    export RESTIC_REPOSITORY
    [[ -n "$RESTIC_PASSWORD_FILE" ]] && export RESTIC_PASSWORD_FILE

    log "Restoring from restic snapshot: $snapshot"

    mkdir -p "$target_dir"

    restic restore "$snapshot" \
        --target "$target_dir" \
        --tag postgres \
        || error_exit "Restic restore failed"

    # Find the backup file in restored data
    local backup_file=$(find "$target_dir" -name "*.sql.gz" -o -name "*.dump" | head -1)

    if [[ -z "$backup_file" ]]; then
        error_exit "No backup file found in restic snapshot"
    fi

    log "Restored backup file: $backup_file"
    echo "$backup_file"
}

# ==============================================================
# List Functions
# ==============================================================

list_backups() {
    log "Available backups:"
    echo ""

    # Local backups
    echo "=== Local Daily Backups ==="
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

    # Restic snapshots
    if [[ -n "$RESTIC_REPOSITORY" ]] && command_exists restic; then
        echo "=== Restic Snapshots ==="
        export RESTIC_REPOSITORY
        [[ -n "$RESTIC_PASSWORD_FILE" ]] && export RESTIC_PASSWORD_FILE
        restic snapshots --tag postgres 2>/dev/null || echo "  (unable to connect)"
        echo ""
    fi

    # S3 backups
    if [[ -n "$S3_ENDPOINT" ]] && [[ -n "$S3_BUCKET" ]]; then
        echo "=== S3 Backups ==="
        if command_exists aws; then
            local access_key=""
            local secret_key=""
            if [[ -n "$S3_ACCESS_KEY_FILE" ]] && [[ -f "$S3_ACCESS_KEY_FILE" ]]; then
                access_key=$(cat "$S3_ACCESS_KEY_FILE")
            fi
            if [[ -n "$S3_SECRET_KEY_FILE" ]] && [[ -f "$S3_SECRET_KEY_FILE" ]]; then
                secret_key=$(cat "$S3_SECRET_KEY_FILE")
            fi
            AWS_ACCESS_KEY_ID="$access_key" \
            AWS_SECRET_ACCESS_KEY="$secret_key" \
            aws --endpoint-url "$S3_ENDPOINT" \
                s3 ls "s3://${S3_BUCKET}/postgres/" 2>/dev/null | tail -10 || echo "  (unable to list)"
        elif command_exists mc; then
            mc ls "pmdl-backup/${S3_BUCKET}/postgres/" 2>/dev/null | tail -10 || echo "  (unable to list)"
        else
            echo "  (no S3 client available)"
        fi
        echo ""
    fi
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

    # Check if database exists, create if not
    if ! docker exec "$CONTAINER_NAME" psql -U postgres -lqt | cut -d \| -f 1 | grep -qw "$db_name"; then
        log "Creating database: $db_name"
        docker exec "$CONTAINER_NAME" psql -U postgres -c "CREATE DATABASE $db_name;" \
            || error_exit "Failed to create database"
    fi

    # Restore single database
    docker exec -i "$CONTAINER_NAME" pg_restore \
        -U postgres \
        -d "$db_name" \
        --clean \
        --if-exists \
        < "$backup_file" \
        2>&1 | grep -v "already exists" || true  # Ignore "already exists" warnings

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
    download    Download backup from S3

Options:
    -f, --file PATH        Backup file to restore (local path)
    -d, --database NAME    Target database (for custom format only)
    -s, --s3-path PATH     S3 path to download (e.g., postgres/backup.sql.gz)
    -r, --restic SNAPSHOT  Restore from restic snapshot (default: latest)
    --dry-run              Show what would be done without executing
    --no-confirm           Skip confirmation prompt (dangerous!)
    -h, --help             Show this help

Environment Variables:
    CONTAINER_NAME         PostgreSQL container name (default: pmdl_postgres)
    BACKUP_DIR             Backup source directory
    AGE_KEY_FILE           Path to age private key for decryption
    RESTIC_REPOSITORY      Restic repository URL
    RESTIC_PASSWORD_FILE   Path to restic password file
    S3_ENDPOINT            S3-compatible endpoint URL
    S3_BUCKET              S3 bucket name
    S3_ACCESS_KEY_FILE     Path to S3 access key
    S3_SECRET_KEY_FILE     Path to S3 secret key

Examples:
    $0 list                                      # List all available backups
    $0 verify -f /path/to/backup.sql.gz          # Verify backup integrity
    $0 restore -f /path/to/backup.sql.gz         # Restore full backup
    $0 restore -f synapse.dump -d synapse        # Restore single database
    $0 restore -f backup.sql.gz.age              # Decrypt and restore
    $0 restore --restic latest                   # Restore from restic
    $0 download -s postgres/backup.sql.gz        # Download from S3

EOF
    exit 0
}

main() {
    local command="${1:-restore}"
    local backup_file=""
    local db_name=""
    local s3_path=""
    local restic_snapshot=""
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
            -s|--s3-path)
                s3_path="$2"
                shift 2
                ;;
            -r|--restic)
                restic_snapshot="${2:-latest}"
                shift
                [[ "$1" != -* ]] && shift || true
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

        download)
            [[ -z "$s3_path" ]] && error_exit "S3 path required (-s flag)"
            local local_path="${BACKUP_DIR}/downloads/$(basename "$s3_path")"
            mkdir -p "$(dirname "$local_path")"
            download_from_s3 "$s3_path" "$local_path"
            echo "Downloaded to: $local_path"
            exit 0
            ;;

        restore)
            # Handle different restore sources
            local restore_file=""

            if [[ -n "$restic_snapshot" ]]; then
                # Restore from restic
                restore_file=$(restore_from_restic "$restic_snapshot")
            elif [[ -n "$s3_path" ]]; then
                # Download from S3 first
                local local_path="${BACKUP_DIR}/downloads/$(basename "$s3_path")"
                mkdir -p "$(dirname "$local_path")"
                download_from_s3 "$s3_path" "$local_path"
                restore_file="$local_path"
            elif [[ -n "$backup_file" ]]; then
                restore_file="$backup_file"
            else
                echo "No backup source specified. Available backups:"
                echo ""
                list_backups
                echo ""
                error_exit "Use -f, -s, or -r to specify backup source"
            fi

            [[ -f "$restore_file" ]] || error_exit "File not found: $restore_file"

            # Verify container is running
            docker inspect "$CONTAINER_NAME" > /dev/null 2>&1 \
                || error_exit "Container not found: $CONTAINER_NAME"

            log "========================================"
            log "PostgreSQL Restore Started"
            log "Container: $CONTAINER_NAME"
            log "Backup: $restore_file"
            log "========================================"

            # Handle encrypted backups
            if [[ "$restore_file" == *.age ]]; then
                restore_file=$(decrypt_backup "$restore_file")
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
            if [[ "$dry_run" != true ]]; then
                log "Running post-restore verification..."
                docker exec "$CONTAINER_NAME" psql -U postgres -c \
                    "SELECT count(*) as databases FROM pg_database WHERE datistemplate = false;" \
                    || warn "Post-restore verification failed"
            fi

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
