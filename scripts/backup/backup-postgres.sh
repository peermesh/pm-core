#!/bin/bash
# ==============================================================
# PostgreSQL Backup Script (Unified)
# ==============================================================
# Purpose: Create compressed, verified backups of PostgreSQL databases
# Features:
#   - Secrets-aware (reads from /run/secrets/ or local secrets/)
#   - Supports both pg_dumpall (full) and pg_dump (per-database)
#   - Optional restic integration for dedup/encryption
#   - SHA-256 checksum generation
#   - Compression with gzip
#   - Age encryption for off-site storage (optional)
#   - S3/MinIO upload capability
#
# Documentation: scripts/backup/README.md
# Decision Reference: docs/decisions/0102-backup-architecture.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

# Container and paths
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/postgres}"
SECRET_DIR="${SECRET_DIR:-./secrets}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Backup settings
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DATE=$(date +%Y-%m-%d)
LOG_FILE="${BACKUP_DIR}/logs/backup-${DATE}.log"

# Encryption (optional)
AGE_RECIPIENT="${AGE_RECIPIENT:-}"  # age1... public key for encryption

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
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    if [[ -d "$(dirname "$LOG_FILE")" ]]; then
        echo "$msg" >> "$LOG_FILE"
    fi
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

warn() {
    log "WARNING: $*"
}

ensure_dir() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        log "Created directory: $dir"
    fi
}

# Read password from secrets (container secrets or local file)
read_secret() {
    local secret_name="$1"

    # Try Docker secret path first (when running inside container)
    if [[ -f "/run/secrets/${secret_name}" ]]; then
        cat "/run/secrets/${secret_name}"
        return
    fi

    # Try local secrets directory
    if [[ -f "${SECRET_DIR}/${secret_name}" ]]; then
        cat "${SECRET_DIR}/${secret_name}"
        return
    fi

    # Try project root secrets
    if [[ -f "${PROJECT_ROOT}/secrets/${secret_name}" ]]; then
        cat "${PROJECT_ROOT}/secrets/${secret_name}"
        return
    fi

    # Return empty if not found (let caller decide if required)
    echo ""
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Update atomic symlink
update_symlink() {
    local target="$1"
    local link_path="$2"

    ln -sf "$(basename "$target")" "${link_path}.new"
    mv "${link_path}.new" "$link_path"
}

# ==============================================================
# Backup Functions
# ==============================================================

backup_all_databases() {
    log "Starting full database backup (pg_dumpall)..."

    local output_file="${BACKUP_DIR}/daily/postgres-all-${TIMESTAMP}.sql.gz"
    local checksum_file="${output_file}.sha256"

    ensure_dir "${BACKUP_DIR}/daily"

    # Execute pg_dumpall via docker exec
    # Using --clean for DROP statements, --if-exists for safety
    docker exec "$CONTAINER_NAME" pg_dumpall \
        -U postgres \
        --clean \
        --if-exists \
        2>> "$LOG_FILE" \
        | gzip > "$output_file" \
        || error_exit "pg_dumpall failed"

    # Generate checksum
    sha256sum "$output_file" > "$checksum_file"

    # Verify backup integrity
    gzip -t "$output_file" || error_exit "Backup verification failed - corrupt gzip"

    # Get file size for logging
    local size=$(du -h "$output_file" | cut -f1)

    log "Full backup complete: $output_file ($size)"

    # Update latest symlink
    update_symlink "$output_file" "${BACKUP_DIR}/daily/postgres-all-latest.sql.gz"

    echo "$output_file"
}

backup_single_database() {
    local db_name="$1"
    log "Backing up database: $db_name..."

    local output_file="${BACKUP_DIR}/daily/${db_name}-${TIMESTAMP}.dump"
    local checksum_file="${output_file}.sha256"

    ensure_dir "${BACKUP_DIR}/daily"

    # Execute pg_dump with custom format (-Fc)
    # Custom format allows parallel restore and is compressed by default
    docker exec "$CONTAINER_NAME" pg_dump \
        -U postgres \
        -d "$db_name" \
        -Fc \
        --no-owner \
        --no-acl \
        2>> "$LOG_FILE" \
        > "$output_file" \
        || error_exit "pg_dump failed for $db_name"

    # Generate checksum
    sha256sum "$output_file" > "$checksum_file"

    # Custom format can be verified with pg_restore --list
    docker exec -i "$CONTAINER_NAME" pg_restore --list < "$output_file" > /dev/null 2>&1 \
        || error_exit "Backup verification failed - corrupt dump"

    local size=$(du -h "$output_file" | cut -f1)
    log "Database backup complete: $output_file ($size)"

    # Update latest symlink
    update_symlink "$output_file" "${BACKUP_DIR}/daily/${db_name}-latest.dump"

    echo "$output_file"
}

backup_predeploy() {
    log "Creating pre-deploy backup..."

    local output_dir="${BACKUP_DIR}/pre-deploy"
    local output_file="${output_dir}/predeploy-${TIMESTAMP}.sql.gz"

    ensure_dir "$output_dir"

    # Quick full backup
    docker exec "$CONTAINER_NAME" pg_dumpall \
        -U postgres \
        --clean \
        --if-exists \
        2>> "$LOG_FILE" \
        | gzip > "$output_file"

    sha256sum "$output_file" > "${output_file}.sha256"

    local size=$(du -h "$output_file" | cut -f1)
    log "Pre-deploy backup complete: $output_file ($size)"

    # Keep only 5 most recent pre-deploy backups
    ls -t "${output_dir}"/*.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
    ls -t "${output_dir}"/*.sha256 2>/dev/null | tail -n +6 | xargs -r rm -f

    echo "$output_file"
}

# ==============================================================
# Encryption Functions
# ==============================================================

encrypt_backup() {
    local backup_file="$1"

    if [[ -z "$AGE_RECIPIENT" ]]; then
        log "Encryption skipped (AGE_RECIPIENT not set)"
        echo "$backup_file"
        return
    fi

    if ! command_exists age; then
        warn "age command not found, skipping encryption"
        echo "$backup_file"
        return
    fi

    log "Encrypting backup with age..."

    local encrypted_file="${backup_file}.age"

    # Encrypt using age
    age -r "$AGE_RECIPIENT" "$backup_file" > "$encrypted_file" \
        || error_exit "Age encryption failed"

    # Verify encryption
    file "$encrypted_file" | grep -q "data" \
        || error_exit "Encrypted file verification failed"

    local size=$(du -h "$encrypted_file" | cut -f1)
    log "Encryption complete: $encrypted_file ($size)"

    echo "$encrypted_file"
}

# ==============================================================
# Restic Integration
# ==============================================================

backup_to_restic() {
    local backup_file="$1"

    if [[ -z "$RESTIC_REPOSITORY" ]]; then
        log "Restic upload skipped (RESTIC_REPOSITORY not set)"
        return
    fi

    if ! command_exists restic; then
        warn "restic command not found, skipping restic backup"
        return
    fi

    export RESTIC_REPOSITORY
    [[ -n "$RESTIC_PASSWORD_FILE" ]] && export RESTIC_PASSWORD_FILE

    # Check if repository exists, initialize if not
    if ! restic snapshots >/dev/null 2>&1; then
        log "Initializing restic repository: $RESTIC_REPOSITORY"
        restic init || error_exit "Failed to initialize restic repository"
    fi

    log "Backing up to restic repository..."

    restic backup "$backup_file" \
        --tag "postgres" \
        --tag "database" \
        --tag "host:$(hostname)" \
        2>> "$LOG_FILE" \
        || error_exit "Restic backup failed"

    log "Restic backup complete"
}

# ==============================================================
# S3 Upload
# ==============================================================

upload_to_s3() {
    local backup_file="$1"

    if [[ -z "$S3_ENDPOINT" ]] || [[ -z "$S3_BUCKET" ]]; then
        log "S3 upload skipped (S3_ENDPOINT or S3_BUCKET not set)"
        return
    fi

    # Try different S3 clients
    if command_exists aws; then
        upload_with_aws "$backup_file"
    elif command_exists mc; then
        upload_with_mc "$backup_file"
    elif command_exists rclone; then
        upload_with_rclone "$backup_file"
    else
        warn "No S3 client found (aws, mc, or rclone). Skipping S3 upload."
    fi
}

upload_with_aws() {
    local backup_file="$1"
    local filename=$(basename "$backup_file")

    # Read credentials
    local access_key=""
    local secret_key=""

    if [[ -n "$S3_ACCESS_KEY_FILE" ]] && [[ -f "$S3_ACCESS_KEY_FILE" ]]; then
        access_key=$(cat "$S3_ACCESS_KEY_FILE")
    fi
    if [[ -n "$S3_SECRET_KEY_FILE" ]] && [[ -f "$S3_SECRET_KEY_FILE" ]]; then
        secret_key=$(cat "$S3_SECRET_KEY_FILE")
    fi

    if [[ -z "$access_key" ]] || [[ -z "$secret_key" ]]; then
        warn "S3 credentials not configured, skipping upload"
        return
    fi

    log "Uploading to S3 with aws-cli..."

    AWS_ACCESS_KEY_ID="$access_key" \
    AWS_SECRET_ACCESS_KEY="$secret_key" \
    aws --endpoint-url "$S3_ENDPOINT" \
        s3 cp "$backup_file" "s3://${S3_BUCKET}/postgres/${filename}" \
        2>> "$LOG_FILE" \
        || { warn "S3 upload failed"; return; }

    log "S3 upload complete: s3://${S3_BUCKET}/postgres/${filename}"
}

upload_with_mc() {
    local backup_file="$1"
    local filename=$(basename "$backup_file")

    log "Uploading to S3 with minio-client..."

    # Configure mc alias (if not already configured)
    mc alias set pmdl-backup "$S3_ENDPOINT" \
        "$(cat "$S3_ACCESS_KEY_FILE" 2>/dev/null)" \
        "$(cat "$S3_SECRET_KEY_FILE" 2>/dev/null)" \
        2>/dev/null || true

    mc cp "$backup_file" "pmdl-backup/${S3_BUCKET}/postgres/${filename}" \
        2>> "$LOG_FILE" \
        || { warn "S3 upload failed"; return; }

    log "S3 upload complete"
}

upload_with_rclone() {
    local backup_file="$1"
    local filename=$(basename "$backup_file")

    log "Uploading to S3 with rclone..."

    # Rclone expects config to exist
    rclone copy "$backup_file" "pmdl-s3:${S3_BUCKET}/postgres/" \
        2>> "$LOG_FILE" \
        || { warn "S3 upload failed (check rclone config)"; return; }

    log "S3 upload complete"
}

# ==============================================================
# Retention Policy
# ==============================================================

apply_retention() {
    local days="${1:-7}"

    log "Applying retention policy: keep ${days} days"

    # Remove backups older than retention period
    find "${BACKUP_DIR}/daily" -name "*.sql.gz" -mtime "+${days}" -type f -delete 2>/dev/null || true
    find "${BACKUP_DIR}/daily" -name "*.dump" -mtime "+${days}" -type f -delete 2>/dev/null || true
    find "${BACKUP_DIR}/daily" -name "*.sha256" -mtime "+${days}" -type f -delete 2>/dev/null || true
    find "${BACKUP_DIR}/daily" -name "*.age" -mtime "+${days}" -type f -delete 2>/dev/null || true

    # Also apply restic retention if configured
    if [[ -n "$RESTIC_REPOSITORY" ]] && command_exists restic; then
        export RESTIC_REPOSITORY
        [[ -n "$RESTIC_PASSWORD_FILE" ]] && export RESTIC_PASSWORD_FILE

        restic forget \
            --keep-daily "$days" \
            --keep-weekly 4 \
            --keep-monthly 3 \
            --prune \
            --tag postgres \
            2>> "$LOG_FILE" \
            || warn "Restic retention cleanup failed"
    fi

    log "Retention policy applied"
}

# ==============================================================
# List Databases
# ==============================================================

list_databases() {
    log "Listing databases in $CONTAINER_NAME..."

    docker exec "$CONTAINER_NAME" psql -U postgres -t -c \
        "SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres';" \
        2>/dev/null \
        | tr -d ' ' \
        | grep -v '^$' \
        || echo "(none)"
}

# ==============================================================
# Main Execution
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [command] [options]

Commands:
    all         Backup all databases (pg_dumpall) [default]
    database    Backup single database (requires -d flag)
    predeploy   Quick backup before deployment
    list        List available databases
    retention   Apply retention policy

Options:
    -d, --database NAME    Database name for single backup
    -e, --encrypt          Encrypt backup with age
    -r, --restic           Also backup to restic repository
    -s, --s3               Also upload to S3/MinIO
    --days DAYS            Retention days (default: 7)
    -h, --help             Show this help

Environment Variables:
    CONTAINER_NAME         PostgreSQL container name (default: pmdl_postgres)
    BACKUP_DIR             Backup destination directory
    SECRET_DIR             Directory containing secrets
    AGE_RECIPIENT          Age public key for encryption
    RESTIC_REPOSITORY      Restic repository URL
    RESTIC_PASSWORD_FILE   Path to restic password file
    S3_ENDPOINT            S3-compatible endpoint URL
    S3_BUCKET              S3 bucket name
    S3_ACCESS_KEY_FILE     Path to S3 access key
    S3_SECRET_KEY_FILE     Path to S3 secret key

Examples:
    $0 all                           # Full backup of all databases
    $0 database -d synapse           # Backup synapse database only
    $0 all -e                        # Full backup with encryption
    $0 all -r -s                     # Full backup + restic + S3
    $0 predeploy                     # Quick pre-deployment backup
    $0 list                          # List databases
    $0 retention --days 7            # Apply retention policy

EOF
    exit 0
}

main() {
    local command="${1:-all}"
    local db_name=""
    local do_encrypt=false
    local do_restic=false
    local do_s3=false
    local retention_days=7

    # Parse arguments
    shift || true
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -d|--database)
                db_name="$2"
                shift 2
                ;;
            -e|--encrypt)
                do_encrypt=true
                shift
                ;;
            -r|--restic)
                do_restic=true
                shift
                ;;
            -s|--s3)
                do_s3=true
                shift
                ;;
            --days)
                retention_days="$2"
                shift 2
                ;;
            -h|--help)
                usage
                ;;
            *)
                error_exit "Unknown option: $1"
                ;;
        esac
    done

    # Ensure directories exist
    ensure_dir "${BACKUP_DIR}/logs"
    ensure_dir "${BACKUP_DIR}/daily"

    case "$command" in
        list)
            list_databases
            exit 0
            ;;
        retention)
            apply_retention "$retention_days"
            exit 0
            ;;
    esac

    log "========================================"
    log "PostgreSQL Backup Started"
    log "Container: $CONTAINER_NAME"
    log "Backup Dir: $BACKUP_DIR"
    log "========================================"

    # Verify container is running
    docker inspect "$CONTAINER_NAME" > /dev/null 2>&1 \
        || error_exit "Container not found: $CONTAINER_NAME"

    # Execute backup based on command
    local backup_file=""
    case "$command" in
        all)
            backup_file=$(backup_all_databases)
            ;;
        database)
            [[ -z "$db_name" ]] && error_exit "Database name required (-d flag)"
            backup_file=$(backup_single_database "$db_name")
            ;;
        predeploy)
            backup_file=$(backup_predeploy)
            ;;
        *)
            error_exit "Unknown command: $command"
            ;;
    esac

    # Encrypt if requested
    if [[ "$do_encrypt" == true ]]; then
        backup_file=$(encrypt_backup "$backup_file")
    fi

    # Upload to restic if requested
    if [[ "$do_restic" == true ]]; then
        backup_to_restic "$backup_file"
    fi

    # Upload to S3 if requested
    if [[ "$do_s3" == true ]]; then
        upload_to_s3 "$backup_file"
    fi

    # Record success timestamp
    date -Iseconds > "${BACKUP_DIR}/.last_successful_backup"

    log "========================================"
    log "PostgreSQL Backup Complete"
    log "========================================"

    exit 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
