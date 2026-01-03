#!/bin/bash
# ==============================================================
# [TECHNOLOGY] Backup Script Template
# ==============================================================
#
# This script creates a database backup using native tools.
# It reads credentials from secret files, NEVER environment variables.
#
# Usage:
#   ./backup.sh                    # Backup to default location
#   ./backup.sh /custom/backup/dir # Backup to custom location
#
# Environment Variables:
#   CONTAINER_NAME  - Container to backup (default: [tech])
#   SECRET_FILE     - Path to password file (default: ./secrets/[tech]_password)
#   BACKUP_DIR      - Backup destination (default: /var/backups/[tech])
#
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

CONTAINER_NAME="${CONTAINER_NAME:-[tech]}"
SECRET_FILE="${SECRET_FILE:-./secrets/[tech]_password}"
BACKUP_DIR="${1:-${BACKUP_DIR:-/var/backups/[tech]}}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DATE=$(date +%Y-%m-%d)

# Log file
LOG_DIR="$BACKUP_DIR/logs"
LOG_FILE="$LOG_DIR/backup-$DATE.log"

# ==============================================================
# Functions
# ==============================================================

log() {
    echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

# ==============================================================
# Pre-flight Checks
# ==============================================================

# Ensure log directory exists
mkdir -p "$LOG_DIR"

log "=== [TECHNOLOGY] Backup Started ==="
log "Container: $CONTAINER_NAME"
log "Backup Dir: $BACKUP_DIR"

# Check container is running
if ! docker inspect "$CONTAINER_NAME" &>/dev/null; then
    error_exit "Container '$CONTAINER_NAME' not found. Is it running?"
fi

if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" != "true" ]]; then
    error_exit "Container '$CONTAINER_NAME' is not running."
fi

# Check secret file exists
if [[ ! -f "$SECRET_FILE" ]]; then
    error_exit "Secret file not found: $SECRET_FILE"
fi

# Read password from secret file
# CRITICAL: Never read from environment variable, always from file
PASSWORD=$(cat "$SECRET_FILE")
if [[ -z "$PASSWORD" ]]; then
    error_exit "Secret file is empty: $SECRET_FILE"
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# ==============================================================
# Execute Backup
# ==============================================================

OUTPUT_FILE="$BACKUP_DIR/[tech]-$TIMESTAMP.dump.gz"
CHECKSUM_FILE="$OUTPUT_FILE.sha256"

log "Creating backup: $OUTPUT_FILE"

# ==============================================================
# REPLACE THIS SECTION WITH TECHNOLOGY-SPECIFIC COMMANDS
# ==============================================================

# PostgreSQL example:
# docker exec "$CONTAINER_NAME" pg_dumpall \
#     -U postgres \
#     --clean \
#     --if-exists \
#     | gzip > "$OUTPUT_FILE" 2>> "$LOG_FILE" \
#     || error_exit "Backup command failed"

# MySQL example:
# docker exec "$CONTAINER_NAME" mysqldump \
#     -u root \
#     -p"$PASSWORD" \
#     --all-databases \
#     --single-transaction \
#     --routines \
#     --triggers \
#     --events \
#     2>> "$LOG_FILE" \
#     | gzip > "$OUTPUT_FILE" \
#     || error_exit "Backup command failed"

# MongoDB example:
# docker exec "$CONTAINER_NAME" mongodump \
#     --username root \
#     --password "$PASSWORD" \
#     --authenticationDatabase admin \
#     --archive \
#     --gzip \
#     2>> "$LOG_FILE" \
#     > "$OUTPUT_FILE" \
#     || error_exit "Backup command failed"

# Placeholder for template - remove and replace with actual command:
echo "PLACEHOLDER: Replace with actual backup command" > "$OUTPUT_FILE"
log "WARNING: Using placeholder backup command - replace with actual implementation"

# ==============================================================
# END OF TECHNOLOGY-SPECIFIC SECTION
# ==============================================================

# ==============================================================
# Verification
# ==============================================================

log "Verifying backup integrity..."

# Check file exists and has size
if [[ ! -s "$OUTPUT_FILE" ]]; then
    error_exit "Backup file is empty or does not exist"
fi

# Verify gzip integrity
if ! gzip -t "$OUTPUT_FILE" 2>/dev/null; then
    error_exit "Backup file is not a valid gzip archive"
fi

# Generate checksum
sha256sum "$OUTPUT_FILE" > "$CHECKSUM_FILE"
log "Checksum generated: $CHECKSUM_FILE"

# Get file size
FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
log "Backup size: $FILE_SIZE"

# ==============================================================
# Update Latest Symlink
# ==============================================================

LATEST_LINK="$BACKUP_DIR/latest"
ln -sf "$(basename "$OUTPUT_FILE")" "$LATEST_LINK.new"
mv "$LATEST_LINK.new" "$LATEST_LINK"
log "Updated 'latest' symlink"

# ==============================================================
# Completion
# ==============================================================

log "=== Backup Complete ==="
log "File: $OUTPUT_FILE"
log "Size: $FILE_SIZE"
log ""

# Write success timestamp for monitoring
date -Iseconds > "$BACKUP_DIR/.last_successful_backup"

exit 0
