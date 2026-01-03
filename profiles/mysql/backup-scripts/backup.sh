#!/bin/bash
# =============================================================
# MySQL Backup Script (Secrets-Aware)
# =============================================================
# Uses mysqldump with --single-transaction for consistent
# hot backups without locking. Reads credentials from file-based
# secrets per D3.1 Secret Management.
#
# Features:
# - Reads password from secrets file (never environment)
# - Consistent snapshot via --single-transaction
# - Includes routines, triggers, and events
# - Generates SHA-256 checksum
# - Verifies backup integrity
# - Supports age encryption for off-site storage
#
# Usage:
#   ./backup.sh
#   BACKUP_DIR=/custom/path ./backup.sh
#   ENCRYPT=true AGE_RECIPIENT=age1... ./backup.sh
#
# =============================================================

set -euo pipefail

# =============================================================
# Configuration
# =============================================================
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_mysql}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mysql}"
PROJECT_ROOT="${PROJECT_ROOT:-$(dirname "$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")")}"
SECRET_FILE="${SECRET_FILE:-$PROJECT_ROOT/secrets/mysql_root_password}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="${BACKUP_DIR}/logs/backup.log"

# Encryption settings
ENCRYPT="${ENCRYPT:-false}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"

# =============================================================
# Functions
# =============================================================

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

# =============================================================
# Pre-flight Checks
# =============================================================

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR/logs"

log "=== MySQL Backup Started ==="
log "Container: $CONTAINER_NAME"
log "Backup directory: $BACKUP_DIR"

# Verify secret file exists
if [[ ! -f "$SECRET_FILE" ]]; then
    error_exit "Secret file not found: $SECRET_FILE"
fi

# Read password from file (NEVER from environment variable)
PASSWORD=$(cat "$SECRET_FILE")
if [[ -z "$PASSWORD" ]]; then
    error_exit "Password file is empty: $SECRET_FILE"
fi

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    error_exit "Container not running: $CONTAINER_NAME"
fi

# =============================================================
# Execute Backup
# =============================================================

OUTPUT_FILE="$BACKUP_DIR/mysql-$TIMESTAMP.sql.gz"
CHECKSUM_FILE="$OUTPUT_FILE.sha256"

log "Starting mysqldump..."

# Execute backup with --single-transaction for consistent snapshot
# Options:
#   --all-databases: Backup all databases including system
#   --single-transaction: Consistent snapshot without locking (InnoDB)
#   --routines: Include stored procedures
#   --triggers: Include triggers
#   --events: Include scheduled events
#   --set-gtid-purged=OFF: Avoid GTID issues on restore to different server

docker exec "$CONTAINER_NAME" mysqldump \
    -u root \
    -p"$PASSWORD" \
    --all-databases \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --set-gtid-purged=OFF \
    2>/dev/null \
    | gzip > "$OUTPUT_FILE" \
    || error_exit "mysqldump failed"

# =============================================================
# Verification
# =============================================================

# Check file was created and has content
if [[ ! -s "$OUTPUT_FILE" ]]; then
    error_exit "Backup file is empty or was not created"
fi

# Generate checksum
sha256sum "$OUTPUT_FILE" > "$CHECKSUM_FILE"
log "Checksum generated: $(cat "$CHECKSUM_FILE")"

# Verify gzip integrity
if ! gzip -t "$OUTPUT_FILE" 2>/dev/null; then
    error_exit "Backup file failed gzip integrity check"
fi

log "Backup integrity verified."

# =============================================================
# Optional Encryption
# =============================================================

if [[ "$ENCRYPT" == "true" ]]; then
    if [[ -z "$AGE_RECIPIENT" ]]; then
        log "WARNING: ENCRYPT=true but AGE_RECIPIENT not set, skipping encryption"
    else
        log "Encrypting backup with age..."
        if command -v age >/dev/null 2>&1; then
            age -r "$AGE_RECIPIENT" "$OUTPUT_FILE" > "$OUTPUT_FILE.age" \
                || error_exit "age encryption failed"

            # Generate checksum for encrypted file
            sha256sum "$OUTPUT_FILE.age" > "$OUTPUT_FILE.age.sha256"

            log "Encrypted backup: $OUTPUT_FILE.age"
        else
            log "WARNING: age command not found, skipping encryption"
        fi
    fi
fi

# =============================================================
# Update Latest Symlink
# =============================================================

LATEST_LINK="$BACKUP_DIR/latest.sql.gz"
ln -sf "$(basename "$OUTPUT_FILE")" "$LATEST_LINK.new"
mv "$LATEST_LINK.new" "$LATEST_LINK"

# =============================================================
# Summary
# =============================================================

BACKUP_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)

log "=== Backup Complete ==="
log "File: $OUTPUT_FILE"
log "Size: $BACKUP_SIZE"
log "Latest: $LATEST_LINK -> $(basename "$OUTPUT_FILE")"

# Write success timestamp for monitoring
date -Iseconds > "$BACKUP_DIR/.last_successful_backup"

exit 0
