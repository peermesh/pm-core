#!/bin/bash
# ==============================================================
# MinIO Backup Script
# ==============================================================
# Purpose: Mirror MinIO data to external backup location
# Features:
#   - Secrets-aware (reads from /run/secrets/ or local secrets/)
#   - Supports multiple backup destinations (local, S3, remote)
#   - Generates manifest of backed-up objects
#   - Age encryption for off-site storage (optional)
#
# Profile: minio
# Documentation: profiles/minio/PROFILE-SPEC.md
# Decision Reference: D2.4-BACKUP-RECOVERY.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

# MinIO source
MINIO_ALIAS="${MINIO_ALIAS:-local}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"

# Backup settings
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/minio}"
SECRET_DIR="${SECRET_DIR:-./secrets}"
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

# Timestamps
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DATE=$(date +%Y-%m-%d)
LOG_FILE="${BACKUP_DIR}/logs/backup-${DATE}.log"

# Remote backup destination (S3-compatible)
REMOTE_ALIAS="${REMOTE_ALIAS:-}"
REMOTE_BUCKET="${REMOTE_BUCKET:-minio-backups}"

# Encryption (optional)
AGE_RECIPIENT="${AGE_RECIPIENT:-}"

# Buckets to backup (empty = all buckets)
BACKUP_BUCKETS="${BACKUP_BUCKETS:-}"

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    [[ -d "$(dirname "$LOG_FILE")" ]] && echo "$msg" >> "$LOG_FILE"
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

# Read secret from multiple locations
read_secret() {
    local secret_name="$1"

    # Try Docker secret path first
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

# Setup mc alias with credentials from secrets
setup_mc_alias() {
    local alias_name="$1"
    local endpoint="$2"
    local user_secret="$3"
    local password_secret="$4"

    local user password
    user=$(read_secret "$user_secret")
    password=$(read_secret "$password_secret")

    mc alias set "$alias_name" "$endpoint" "$user" "$password" --quiet
    log "Configured mc alias: $alias_name"
}

# ==============================================================
# Backup Functions
# ==============================================================

# Get list of buckets to backup
get_backup_buckets() {
    if [[ -n "$BACKUP_BUCKETS" ]]; then
        echo "$BACKUP_BUCKETS" | tr ',' ' '
    else
        mc ls "$MINIO_ALIAS/" --json 2>/dev/null | jq -r '.key' | tr -d '/'
    fi
}

# Mirror to local filesystem
backup_to_local() {
    local bucket="$1"
    local dest_dir="${BACKUP_DIR}/data/${bucket}"

    log "Backing up bucket: $bucket to local filesystem"

    ensure_dir "$dest_dir"

    mc mirror "${MINIO_ALIAS}/${bucket}" "$dest_dir" \
        --overwrite \
        --remove \
        --quiet \
        2>> "$LOG_FILE" || {
            log "WARNING: Failed to backup bucket $bucket"
            return 1
        }

    # Get object count
    local count
    count=$(find "$dest_dir" -type f 2>/dev/null | wc -l | tr -d ' ')
    log "  Backed up $count objects from $bucket"

    return 0
}

# Mirror to remote S3-compatible destination
backup_to_remote() {
    local bucket="$1"

    if [[ -z "$REMOTE_ALIAS" ]]; then
        log "Remote backup skipped (REMOTE_ALIAS not set)"
        return 0
    fi

    log "Mirroring bucket: $bucket to remote"

    mc mirror "${MINIO_ALIAS}/${bucket}" "${REMOTE_ALIAS}/${REMOTE_BUCKET}/${bucket}" \
        --overwrite \
        --remove \
        --quiet \
        2>> "$LOG_FILE" || {
            log "WARNING: Failed to mirror bucket $bucket to remote"
            return 1
        }

    log "  Mirrored $bucket to remote"
    return 0
}

# Create tarball of local backup
create_archive() {
    local archive_dir="${BACKUP_DIR}/archives"
    local archive_file="${archive_dir}/minio-${TIMESTAMP}.tar.gz"

    ensure_dir "$archive_dir"

    log "Creating archive: $archive_file"

    tar -czf "$archive_file" \
        -C "${BACKUP_DIR}/data" \
        . \
        2>> "$LOG_FILE" || {
            log "WARNING: Failed to create archive"
            return 1
        }

    # Generate checksum
    sha256sum "$archive_file" > "${archive_file}.sha256"

    local size
    size=$(du -h "$archive_file" | cut -f1)
    log "Archive created: $archive_file ($size)"

    echo "$archive_file"
}

# Encrypt archive if AGE_RECIPIENT is set
encrypt_archive() {
    local archive_file="$1"

    if [[ -z "$AGE_RECIPIENT" ]]; then
        log "Encryption skipped (AGE_RECIPIENT not set)"
        return 0
    fi

    local encrypted_file="${archive_file}.age"

    log "Encrypting archive..."

    age -r "$AGE_RECIPIENT" "$archive_file" > "$encrypted_file" \
        || error_exit "Age encryption failed"

    local size
    size=$(du -h "$encrypted_file" | cut -f1)
    log "Encryption complete: $encrypted_file ($size)"

    # Remove unencrypted archive
    rm -f "$archive_file"

    echo "$encrypted_file"
}

# Generate manifest of objects
generate_manifest() {
    local manifest_file="${BACKUP_DIR}/manifest-${TIMESTAMP}.json"

    log "Generating manifest..."

    {
        echo "{"
        echo "  \"timestamp\": \"$(date -Iseconds)\","
        echo "  \"buckets\": ["

        local first=true
        for bucket in $(get_backup_buckets); do
            if [[ "$first" == "true" ]]; then
                first=false
            else
                echo ","
            fi

            echo "    {"
            echo "      \"name\": \"$bucket\","
            echo -n "      \"objects\": "
            mc ls "${MINIO_ALIAS}/${bucket}" --recursive --json 2>/dev/null | \
                jq -s '[.[] | {key: .key, size: .size, lastModified: .lastModified}]' || echo "[]"
            echo -n "    }"
        done

        echo ""
        echo "  ]"
        echo "}"
    } > "$manifest_file"

    log "Manifest saved: $manifest_file"
}

# Cleanup old backups
cleanup_old_backups() {
    local retention_days="${1:-7}"
    local archive_dir="${BACKUP_DIR}/archives"

    log "Cleaning up archives older than $retention_days days..."

    find "$archive_dir" -name "minio-*.tar.gz*" -mtime "+$retention_days" -delete 2>/dev/null || true
    find "$archive_dir" -name "minio-*.sha256" -mtime "+$retention_days" -delete 2>/dev/null || true

    log "Cleanup complete"
}

# ==============================================================
# Main Execution
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [command] [options]

Commands:
    local       Backup to local filesystem [default]
    remote      Backup to remote S3-compatible storage
    full        Local backup + remote mirror + archive
    archive     Create archive from existing local backup

Options:
    -b, --buckets LIST    Comma-separated bucket list (default: all)
    -e, --encrypt         Encrypt archive with age
    -c, --cleanup DAYS    Delete archives older than DAYS
    -h, --help            Show this help

Environment Variables:
    MINIO_ENDPOINT        MinIO source endpoint
    REMOTE_ALIAS          Remote destination alias
    REMOTE_BUCKET         Remote destination bucket
    AGE_RECIPIENT         Age public key for encryption
    BACKUP_DIR            Local backup directory
    SECRET_DIR            Directory containing secrets

Examples:
    $0 local                        # Backup all buckets locally
    $0 remote -b backups,uploads    # Mirror specific buckets
    $0 full -e                      # Full backup with encryption
    $0 archive -e -c 30             # Archive, encrypt, cleanup

EOF
    exit 0
}

main() {
    local command="${1:-local}"
    local do_encrypt=false
    local cleanup_days=0

    # Parse arguments
    shift || true
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -b|--buckets)
                BACKUP_BUCKETS="$2"
                shift 2
                ;;
            -e|--encrypt)
                do_encrypt=true
                shift
                ;;
            -c|--cleanup)
                cleanup_days="$2"
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
    ensure_dir "${BACKUP_DIR}/data"

    log "========================================"
    log "MinIO Backup Started"
    log "Endpoint: $MINIO_ENDPOINT"
    log "Backup Dir: $BACKUP_DIR"
    log "========================================"

    # Setup MinIO client alias
    setup_mc_alias "$MINIO_ALIAS" "$MINIO_ENDPOINT" "minio_root_user" "minio_root_password"

    # Verify connection
    mc admin info "$MINIO_ALIAS" > /dev/null 2>&1 \
        || error_exit "Cannot connect to MinIO at $MINIO_ENDPOINT"

    # Execute backup based on command
    case "$command" in
        local)
            for bucket in $(get_backup_buckets); do
                backup_to_local "$bucket"
            done
            generate_manifest
            ;;
        remote)
            if [[ -z "$REMOTE_ALIAS" ]]; then
                error_exit "REMOTE_ALIAS not set for remote backup"
            fi
            for bucket in $(get_backup_buckets); do
                backup_to_remote "$bucket"
            done
            ;;
        full)
            for bucket in $(get_backup_buckets); do
                backup_to_local "$bucket"
                backup_to_remote "$bucket"
            done
            generate_manifest

            local archive
            archive=$(create_archive)

            if [[ "$do_encrypt" == true ]]; then
                encrypt_archive "$archive"
            fi
            ;;
        archive)
            local archive
            archive=$(create_archive)

            if [[ "$do_encrypt" == true ]]; then
                encrypt_archive "$archive"
            fi
            ;;
        *)
            error_exit "Unknown command: $command"
            ;;
    esac

    # Cleanup if requested
    if [[ "$cleanup_days" -gt 0 ]]; then
        cleanup_old_backups "$cleanup_days"
    fi

    # Record success timestamp
    date -Iseconds > "${BACKUP_DIR}/.last_successful_backup"

    log "========================================"
    log "MinIO Backup Complete"
    log "========================================"

    exit 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
