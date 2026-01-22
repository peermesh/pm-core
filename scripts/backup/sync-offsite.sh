#!/bin/bash
# ==============================================================
# Off-Site Backup Sync Script
# ==============================================================
# Purpose: Sync local backups to S3/MinIO or restic repository
# Features:
#   - Supports restic, rclone, aws-cli, and minio-client
#   - Deduplication with restic
#   - Bandwidth limiting
#   - Verification after sync
#
# Documentation: scripts/backup/README.md
# Decision Reference: docs/decisions/0102-backup-architecture.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl}"
LOG_FILE="${BACKUP_DIR}/logs/sync-$(date +%Y-%m-%d).log"

# Restic settings
RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-}"

# S3 settings
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_ACCESS_KEY_FILE="${S3_ACCESS_KEY_FILE:-}"
S3_SECRET_KEY_FILE="${S3_SECRET_KEY_FILE:-}"

# Bandwidth limit (KB/s, 0 = unlimited)
BANDWIDTH_LIMIT="${BANDWIDTH_LIMIT:-0}"

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

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

ensure_dir() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        log "Created directory: $dir"
    fi
}

# ==============================================================
# Sync Functions
# ==============================================================

sync_with_restic() {
    log "Syncing to restic repository: $RESTIC_REPOSITORY"

    if ! command_exists restic; then
        error_exit "restic command not found"
    fi

    export RESTIC_REPOSITORY
    [[ -n "$RESTIC_PASSWORD_FILE" ]] && export RESTIC_PASSWORD_FILE

    # Check repository exists
    if ! restic snapshots >/dev/null 2>&1; then
        log "Initializing restic repository..."
        restic init || error_exit "Failed to initialize restic repository"
    fi

    # Backup PostgreSQL dumps
    if [[ -d "${BACKUP_DIR}/postgres/daily" ]]; then
        log "Backing up PostgreSQL dumps..."
        restic backup "${BACKUP_DIR}/postgres/daily" \
            --tag "postgres" \
            --tag "sync" \
            --tag "host:$(hostname)" \
            ${BANDWIDTH_LIMIT:+--limit-upload "$BANDWIDTH_LIMIT"} \
            2>> "$LOG_FILE" \
            || warn "PostgreSQL backup to restic failed"
    fi

    # Backup volume tars
    if [[ -d "${BACKUP_DIR}/volumes/tar" ]]; then
        log "Backing up volume archives..."
        restic backup "${BACKUP_DIR}/volumes/tar" \
            --tag "volumes" \
            --tag "sync" \
            --tag "host:$(hostname)" \
            ${BANDWIDTH_LIMIT:+--limit-upload "$BANDWIDTH_LIMIT"} \
            2>> "$LOG_FILE" \
            || warn "Volume backup to restic failed"
    fi

    # Apply retention policy
    log "Applying restic retention policy..."
    restic forget \
        --keep-daily "${BACKUP_RETENTION_DAILY:-7}" \
        --keep-weekly "${BACKUP_RETENTION_WEEKLY:-4}" \
        --keep-monthly "${BACKUP_RETENTION_MONTHLY:-3}" \
        --prune \
        2>> "$LOG_FILE" \
        || warn "Restic retention cleanup failed"

    # Verify repository integrity
    log "Verifying restic repository..."
    restic check --read-data-subset=5% 2>> "$LOG_FILE" || warn "Restic verification found issues"

    log "Restic sync complete"
}

sync_with_s3() {
    log "Syncing to S3: ${S3_ENDPOINT}/${S3_BUCKET}"

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
        warn "S3 credentials not configured, skipping S3 sync"
        return 1
    fi

    # Choose sync method based on available tools
    if command_exists rclone; then
        sync_s3_rclone "$access_key" "$secret_key"
    elif command_exists aws; then
        sync_s3_aws "$access_key" "$secret_key"
    elif command_exists mc; then
        sync_s3_mc "$access_key" "$secret_key"
    else
        error_exit "No S3 client found (rclone, aws, or mc)"
    fi
}

sync_s3_rclone() {
    local access_key="$1"
    local secret_key="$2"

    log "Using rclone for S3 sync..."

    # Create rclone config
    local config_file=$(mktemp)
    cat > "$config_file" << EOF
[pmdl-s3]
type = s3
provider = Other
env_auth = false
access_key_id = ${access_key}
secret_access_key = ${secret_key}
endpoint = ${S3_ENDPOINT}
acl = private
EOF

    # Sync PostgreSQL backups
    if [[ -d "${BACKUP_DIR}/postgres/daily" ]]; then
        log "Syncing PostgreSQL backups..."
        rclone sync "${BACKUP_DIR}/postgres/daily" "pmdl-s3:${S3_BUCKET}/postgres/daily" \
            --config "$config_file" \
            --checksum \
            ${BANDWIDTH_LIMIT:+--bwlimit "${BANDWIDTH_LIMIT}k"} \
            2>> "$LOG_FILE" \
            || warn "PostgreSQL sync failed"
    fi

    # Sync volume backups
    if [[ -d "${BACKUP_DIR}/volumes/tar" ]]; then
        log "Syncing volume backups..."
        rclone sync "${BACKUP_DIR}/volumes/tar" "pmdl-s3:${S3_BUCKET}/volumes/tar" \
            --config "$config_file" \
            --checksum \
            ${BANDWIDTH_LIMIT:+--bwlimit "${BANDWIDTH_LIMIT}k"} \
            2>> "$LOG_FILE" \
            || warn "Volume sync failed"
    fi

    rm -f "$config_file"
    log "rclone sync complete"
}

sync_s3_aws() {
    local access_key="$1"
    local secret_key="$2"

    log "Using aws-cli for S3 sync..."

    export AWS_ACCESS_KEY_ID="$access_key"
    export AWS_SECRET_ACCESS_KEY="$secret_key"

    # Sync PostgreSQL backups
    if [[ -d "${BACKUP_DIR}/postgres/daily" ]]; then
        log "Syncing PostgreSQL backups..."
        aws --endpoint-url "$S3_ENDPOINT" \
            s3 sync "${BACKUP_DIR}/postgres/daily" "s3://${S3_BUCKET}/postgres/daily" \
            --delete \
            2>> "$LOG_FILE" \
            || warn "PostgreSQL sync failed"
    fi

    # Sync volume backups
    if [[ -d "${BACKUP_DIR}/volumes/tar" ]]; then
        log "Syncing volume backups..."
        aws --endpoint-url "$S3_ENDPOINT" \
            s3 sync "${BACKUP_DIR}/volumes/tar" "s3://${S3_BUCKET}/volumes/tar" \
            --delete \
            2>> "$LOG_FILE" \
            || warn "Volume sync failed"
    fi

    log "aws-cli sync complete"
}

sync_s3_mc() {
    local access_key="$1"
    local secret_key="$2"

    log "Using minio-client for S3 sync..."

    # Configure mc alias
    mc alias set pmdl-backup "$S3_ENDPOINT" "$access_key" "$secret_key" 2>/dev/null || true

    # Sync PostgreSQL backups
    if [[ -d "${BACKUP_DIR}/postgres/daily" ]]; then
        log "Syncing PostgreSQL backups..."
        mc mirror "${BACKUP_DIR}/postgres/daily" "pmdl-backup/${S3_BUCKET}/postgres/daily" \
            --remove \
            2>> "$LOG_FILE" \
            || warn "PostgreSQL sync failed"
    fi

    # Sync volume backups
    if [[ -d "${BACKUP_DIR}/volumes/tar" ]]; then
        log "Syncing volume backups..."
        mc mirror "${BACKUP_DIR}/volumes/tar" "pmdl-backup/${S3_BUCKET}/volumes/tar" \
            --remove \
            2>> "$LOG_FILE" \
            || warn "Volume sync failed"
    fi

    log "minio-client sync complete"
}

# ==============================================================
# Main Execution
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [options]

Sync local backups to off-site storage (restic repository or S3).

Options:
    --restic           Sync to restic repository
    --s3               Sync to S3/MinIO
    --all              Sync to all configured destinations (default)
    --limit KB         Bandwidth limit in KB/s
    -h, --help         Show this help

Environment Variables:
    BACKUP_DIR              Local backup directory
    RESTIC_REPOSITORY       Restic repository URL
    RESTIC_PASSWORD_FILE    Restic password file
    S3_ENDPOINT             S3-compatible endpoint
    S3_BUCKET               S3 bucket name
    S3_ACCESS_KEY_FILE      S3 access key file
    S3_SECRET_KEY_FILE      S3 secret key file
    BANDWIDTH_LIMIT         Bandwidth limit in KB/s

Examples:
    $0                       # Sync to all configured destinations
    $0 --restic              # Sync to restic only
    $0 --s3 --limit 1000     # Sync to S3 with 1MB/s limit

EOF
    exit 0
}

main() {
    local do_restic=false
    local do_s3=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --restic)
                do_restic=true
                shift
                ;;
            --s3)
                do_s3=true
                shift
                ;;
            --all)
                do_restic=true
                do_s3=true
                shift
                ;;
            --limit)
                BANDWIDTH_LIMIT="$2"
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

    # Default to all if nothing specified
    if [[ "$do_restic" == false ]] && [[ "$do_s3" == false ]]; then
        do_restic=true
        do_s3=true
    fi

    ensure_dir "$(dirname "$LOG_FILE")"

    log "========================================"
    log "Off-Site Backup Sync Started"
    log "========================================"

    local sync_count=0

    # Sync to restic if configured
    if [[ "$do_restic" == true ]] && [[ -n "$RESTIC_REPOSITORY" ]]; then
        sync_with_restic && ((sync_count++)) || true
    fi

    # Sync to S3 if configured
    if [[ "$do_s3" == true ]] && [[ -n "$S3_ENDPOINT" ]] && [[ -n "$S3_BUCKET" ]]; then
        sync_with_s3 && ((sync_count++)) || true
    fi

    if [[ $sync_count -eq 0 ]]; then
        log "No off-site destinations configured. Set RESTIC_REPOSITORY or S3_ENDPOINT/S3_BUCKET."
        exit 0
    fi

    # Record success timestamp
    date -Iseconds > "${BACKUP_DIR}/.last_offsite_sync"

    log "========================================"
    log "Off-Site Backup Sync Complete"
    log "========================================"

    exit 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
