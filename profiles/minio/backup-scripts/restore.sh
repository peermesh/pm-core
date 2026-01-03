#!/bin/bash
# ==============================================================
# MinIO Restore Script
# ==============================================================
# Purpose: Restore MinIO data from backup
# Features:
#   - Secrets-aware (reads from /run/secrets/ or local secrets/)
#   - Supports restore from local filesystem or remote S3
#   - Archive extraction support
#   - Selective bucket restoration
#   - Age decryption support
#
# Profile: minio
# Documentation: profiles/minio/PROFILE-SPEC.md
# Decision Reference: D2.4-BACKUP-RECOVERY.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

# MinIO destination
MINIO_ALIAS="${MINIO_ALIAS:-local}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"

# Backup settings
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/minio}"
SECRET_DIR="${SECRET_DIR:-./secrets}"
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

# Log file
LOG_FILE="${BACKUP_DIR}/logs/restore-$(date +%Y-%m-%d).log"

# Age decryption key
AGE_KEY_FILE="${AGE_KEY_FILE:-}"

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
    fi
}

# Read secret from multiple locations
read_secret() {
    local secret_name="$1"

    if [[ -f "/run/secrets/${secret_name}" ]]; then
        cat "/run/secrets/${secret_name}"
        return
    fi

    if [[ -f "${SECRET_DIR}/${secret_name}" ]]; then
        cat "${SECRET_DIR}/${secret_name}"
        return
    fi

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
# Restore Functions
# ==============================================================

# Decrypt archive if encrypted
decrypt_archive() {
    local encrypted_file="$1"
    local output_file="${encrypted_file%.age}"

    if [[ -z "$AGE_KEY_FILE" ]]; then
        error_exit "AGE_KEY_FILE not set for decryption"
    fi

    if [[ ! -f "$AGE_KEY_FILE" ]]; then
        error_exit "Age key file not found: $AGE_KEY_FILE"
    fi

    log "Decrypting archive..."

    age -d -i "$AGE_KEY_FILE" "$encrypted_file" > "$output_file" \
        || error_exit "Decryption failed"

    log "Decryption complete: $output_file"
    echo "$output_file"
}

# Extract archive
extract_archive() {
    local archive_file="$1"
    local extract_dir="$2"

    ensure_dir "$extract_dir"

    log "Extracting archive: $archive_file"

    # Verify integrity if checksum exists
    if [[ -f "${archive_file}.sha256" ]]; then
        log "Verifying checksum..."
        (cd "$(dirname "$archive_file")" && sha256sum -c "$(basename "${archive_file}.sha256")") \
            || error_exit "Checksum verification failed"
    fi

    # Verify archive integrity
    gzip -t "$archive_file" 2>/dev/null \
        || error_exit "Archive is corrupt"

    # Extract
    tar -xzf "$archive_file" -C "$extract_dir" \
        || error_exit "Extraction failed"

    log "Extraction complete: $extract_dir"
}

# Restore bucket from local directory
restore_bucket_from_local() {
    local bucket="$1"
    local source_dir="$2"

    if [[ ! -d "$source_dir" ]]; then
        log "WARNING: Source directory not found: $source_dir"
        return 1
    fi

    log "Restoring bucket: $bucket from $source_dir"

    # Create bucket if it doesn't exist
    mc mb "${MINIO_ALIAS}/${bucket}" --ignore-existing --quiet

    # Mirror data to MinIO
    mc mirror "$source_dir" "${MINIO_ALIAS}/${bucket}" \
        --overwrite \
        --quiet \
        2>> "$LOG_FILE" || {
            log "WARNING: Failed to restore bucket $bucket"
            return 1
        }

    # Get object count
    local count
    count=$(mc ls "${MINIO_ALIAS}/${bucket}" --recursive --json 2>/dev/null | wc -l)
    log "  Restored $count objects to $bucket"

    return 0
}

# Restore from remote S3
restore_from_remote() {
    local remote_alias="$1"
    local remote_bucket="$2"
    local target_bucket="${3:-}"

    log "Restoring from remote: ${remote_alias}/${remote_bucket}"

    if [[ -z "$target_bucket" ]]; then
        # Restore all buckets from remote
        local buckets
        buckets=$(mc ls "${remote_alias}/${remote_bucket}/" --json 2>/dev/null | jq -r '.key' | tr -d '/')

        for bucket in $buckets; do
            mc mb "${MINIO_ALIAS}/${bucket}" --ignore-existing --quiet
            mc mirror "${remote_alias}/${remote_bucket}/${bucket}" "${MINIO_ALIAS}/${bucket}" \
                --overwrite \
                --quiet \
                2>> "$LOG_FILE"
            log "  Restored bucket: $bucket"
        done
    else
        # Restore specific bucket
        mc mb "${MINIO_ALIAS}/${target_bucket}" --ignore-existing --quiet
        mc mirror "${remote_alias}/${remote_bucket}" "${MINIO_ALIAS}/${target_bucket}" \
            --overwrite \
            --quiet \
            2>> "$LOG_FILE"
        log "  Restored bucket: $target_bucket"
    fi
}

# List available backups
list_backups() {
    log "Available local backups:"
    echo ""

    echo "=== Archives ==="
    ls -lh "${BACKUP_DIR}/archives/"*.tar.gz* 2>/dev/null || echo "  No archives found"
    echo ""

    echo "=== Live Data ==="
    ls -1 "${BACKUP_DIR}/data/" 2>/dev/null || echo "  No live backup data"
    echo ""

    echo "=== Manifests ==="
    ls -lh "${BACKUP_DIR}/"manifest-*.json 2>/dev/null | head -5 || echo "  No manifests found"
}

# ==============================================================
# Main Execution
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [command] [options]

Commands:
    local           Restore from local backup directory [default]
    archive         Restore from specific archive file
    remote          Restore from remote S3 backup
    list            List available backups

Options:
    -f, --file PATH       Archive file to restore
    -b, --bucket NAME     Restore specific bucket only
    -s, --source DIR      Source directory for local restore
    -r, --remote ALIAS    Remote alias for S3 restore
    --remote-bucket NAME  Remote bucket name
    --decrypt             Decrypt archive before restore
    -h, --help            Show this help

Environment Variables:
    MINIO_ENDPOINT        MinIO destination endpoint
    AGE_KEY_FILE          Path to age private key for decryption
    BACKUP_DIR            Local backup directory
    SECRET_DIR            Directory containing secrets

Examples:
    $0 list                                       # Show available backups
    $0 local -b uploads                           # Restore 'uploads' bucket
    $0 archive -f minio-2024-01-15.tar.gz        # Restore from archive
    $0 archive -f backup.tar.gz.age --decrypt    # Decrypt and restore
    $0 remote -r s3backup --remote-bucket backups # Restore from remote

EOF
    exit 0
}

main() {
    local command="${1:-local}"
    local archive_file=""
    local bucket=""
    local source_dir="${BACKUP_DIR}/data"
    local remote_alias=""
    local remote_bucket=""
    local do_decrypt=false

    # Parse arguments
    shift || true
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -f|--file)
                archive_file="$2"
                shift 2
                ;;
            -b|--bucket)
                bucket="$2"
                shift 2
                ;;
            -s|--source)
                source_dir="$2"
                shift 2
                ;;
            -r|--remote)
                remote_alias="$2"
                shift 2
                ;;
            --remote-bucket)
                remote_bucket="$2"
                shift 2
                ;;
            --decrypt)
                do_decrypt=true
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

    # Handle list command early
    if [[ "$command" == "list" ]]; then
        list_backups
        exit 0
    fi

    ensure_dir "$(dirname "$LOG_FILE")"

    log "========================================"
    log "MinIO Restore Started"
    log "Endpoint: $MINIO_ENDPOINT"
    log "========================================"

    # Confirmation
    echo ""
    echo "WARNING: This will restore data to MinIO at $MINIO_ENDPOINT"
    echo "Existing objects may be overwritten."
    echo ""
    read -p "Type 'RESTORE' to confirm: " confirm
    [[ "$confirm" == "RESTORE" ]] || { echo "Aborted."; exit 1; }

    # Setup MinIO client
    setup_mc_alias "$MINIO_ALIAS" "$MINIO_ENDPOINT" "minio_root_user" "minio_root_password"

    # Verify connection
    mc admin info "$MINIO_ALIAS" > /dev/null 2>&1 \
        || error_exit "Cannot connect to MinIO at $MINIO_ENDPOINT"

    # Execute restore based on command
    case "$command" in
        local)
            if [[ -n "$bucket" ]]; then
                restore_bucket_from_local "$bucket" "${source_dir}/${bucket}"
            else
                for bucket_dir in "${source_dir}"/*/; do
                    bucket_name=$(basename "$bucket_dir")
                    restore_bucket_from_local "$bucket_name" "$bucket_dir"
                done
            fi
            ;;
        archive)
            [[ -z "$archive_file" ]] && error_exit "Archive file required (-f flag)"
            [[ -f "$archive_file" ]] || error_exit "Archive not found: $archive_file"

            # Decrypt if needed
            if [[ "$do_decrypt" == true ]] || [[ "$archive_file" == *.age ]]; then
                archive_file=$(decrypt_archive "$archive_file")
            fi

            # Extract to temp directory
            local temp_dir
            temp_dir=$(mktemp -d)
            extract_archive "$archive_file" "$temp_dir"

            # Restore from extracted data
            if [[ -n "$bucket" ]]; then
                restore_bucket_from_local "$bucket" "${temp_dir}/${bucket}"
            else
                for bucket_dir in "${temp_dir}"/*/; do
                    bucket_name=$(basename "$bucket_dir")
                    restore_bucket_from_local "$bucket_name" "$bucket_dir"
                done
            fi

            # Cleanup temp
            rm -rf "$temp_dir"
            ;;
        remote)
            [[ -z "$remote_alias" ]] && error_exit "Remote alias required (-r flag)"
            [[ -z "$remote_bucket" ]] && error_exit "Remote bucket required (--remote-bucket)"

            restore_from_remote "$remote_alias" "$remote_bucket" "$bucket"
            ;;
        *)
            error_exit "Unknown command: $command"
            ;;
    esac

    log "========================================"
    log "MinIO Restore Complete"
    log "========================================"

    exit 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
