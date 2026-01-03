#!/bin/bash
# ==============================================================
# PostgreSQL Backup Script
# ==============================================================
# Purpose: Create compressed, verified backups of PostgreSQL databases
# Features:
#   - Secrets-aware (reads from /run/secrets/ or local secrets/)
#   - SHA-256 checksum generation
#   - Compression with gzip
#   - Atomic symlink updates for "latest" pointer
#   - Age encryption for off-site storage (optional)
#
# Profile: postgresql
# Documentation: profiles/postgresql/PROFILE-SPEC.md
# Decision Reference: D2.4-BACKUP-RECOVERY.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

# Container and paths
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/postgres}"
SECRET_DIR="${SECRET_DIR:-./secrets}"
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

# Backup settings
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DATE=$(date +%Y-%m-%d)
LOG_FILE="${BACKUP_DIR}/logs/backup-${DATE}.log"

# Encryption (optional)
AGE_RECIPIENT="${AGE_RECIPIENT:-}"  # age1... public key for encryption

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    [[ -f "$LOG_FILE" ]] && echo "$msg" >> "$LOG_FILE"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

ensure_dir() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        log "Created directory: $dir"
    fi
}

# Read password from secrets (container secrets or local file)
read_password() {
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

    error_exit "Secret not found: ${secret_name}"
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
    update_symlink "$output_file" "${BACKUP_DIR}/daily/latest"

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

    echo "$output_file"
}

encrypt_backup() {
    local backup_file="$1"

    if [[ -z "$AGE_RECIPIENT" ]]; then
        log "Encryption skipped (AGE_RECIPIENT not set)"
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
# Pre-Deploy Backup
# ==============================================================

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
# Main Execution
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [command] [options]

Commands:
    all         Backup all databases (pg_dumpall) [default]
    database    Backup single database (requires -d flag)
    predeploy   Quick backup before deployment

Options:
    -d, --database NAME    Database name for single backup
    -e, --encrypt          Encrypt backup with age
    -h, --help             Show this help

Environment Variables:
    CONTAINER_NAME    PostgreSQL container name (default: pmdl_postgres)
    BACKUP_DIR        Backup destination directory
    SECRET_DIR        Directory containing secrets
    AGE_RECIPIENT     Age public key for encryption

Examples:
    $0 all                      # Full backup of all databases
    $0 database -d synapse      # Backup synapse database only
    $0 all -e                   # Full backup with encryption
    $0 predeploy                # Quick pre-deployment backup

EOF
    exit 0
}

main() {
    local command="${1:-all}"
    local db_name=""
    local do_encrypt=false

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
        encrypt_backup "$backup_file"
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
