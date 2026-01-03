#!/bin/bash
# ==============================================================
# MongoDB Backup Script
# ==============================================================
# Creates encrypted mongodump backups with verification
#
# Features:
# - Reads credentials from secrets files (never environment)
# - Creates compressed archive with gzip
# - Generates SHA-256 checksum for integrity verification
# - Optional Age encryption for off-site storage
# - Updates 'latest' symlink atomically
#
# Per D2.4: Backup Strategy using mongodump
# Per D3.1: Secrets-aware pattern
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================
CONTAINER_NAME="${CONTAINER_NAME:-pmdl-mongodb}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/peermesh/daily/mongodb}"
SECRET_FILE="${SECRET_FILE:-./secrets/mongodb_root_password}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DATE=$(date +%Y-%m-%d)

# Optional: Age encryption recipient (public key)
AGE_RECIPIENT="${AGE_RECIPIENT:-}"

# Logging function
log() {
    echo "[$(date +%H:%M:%S)] $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

# ==============================================================
# Pre-flight Checks
# ==============================================================
log "=========================================="
log "MongoDB Backup Started"
log "=========================================="

# Check secret file exists
if [[ ! -f "$SECRET_FILE" ]]; then
    error_exit "Secret file not found: $SECRET_FILE"
fi

# Check container is running
if ! docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    error_exit "Container not found: $CONTAINER_NAME"
fi

if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" != "true" ]]; then
    error_exit "Container not running: $CONTAINER_NAME"
fi

# Read password from secret file
PASSWORD=$(cat "$SECRET_FILE")
log "Credentials loaded from secret file"

# Create backup directory
mkdir -p "$BACKUP_DIR"
log "Backup directory: $BACKUP_DIR"

# ==============================================================
# Execute Backup
# ==============================================================
OUTPUT_FILE="$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz"

log "Starting mongodump..."
log "  Container: $CONTAINER_NAME"
log "  Output: $OUTPUT_FILE"

# Execute mongodump with archive and compression
docker exec "$CONTAINER_NAME" mongodump \
    --username mongo \
    --password "$PASSWORD" \
    --authenticationDatabase admin \
    --archive \
    --gzip \
    2>/dev/null \
    > "$OUTPUT_FILE"

# Verify the backup file was created and has content
if [[ ! -s "$OUTPUT_FILE" ]]; then
    error_exit "Backup file is empty: $OUTPUT_FILE"
fi

# Get file size
SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
log "Backup created: $SIZE"

# ==============================================================
# Verification
# ==============================================================
log "Verifying backup integrity..."

# Generate SHA-256 checksum
sha256sum "$OUTPUT_FILE" > "$OUTPUT_FILE.sha256"
log "Checksum generated: $OUTPUT_FILE.sha256"

# Verify gzip integrity (quick check)
if gzip -t "$OUTPUT_FILE" 2>/dev/null; then
    log "Gzip integrity: OK"
else
    error_exit "Backup file failed gzip integrity check"
fi

# ==============================================================
# Optional: Age Encryption
# ==============================================================
if [[ -n "$AGE_RECIPIENT" ]]; then
    log "Encrypting backup with Age..."

    # Check age is installed
    if ! command -v age >/dev/null 2>&1; then
        log "WARNING: age not installed, skipping encryption"
    else
        ENCRYPTED_FILE="$OUTPUT_FILE.age"
        age -r "$AGE_RECIPIENT" "$OUTPUT_FILE" > "$ENCRYPTED_FILE"

        # Generate checksum for encrypted file
        sha256sum "$ENCRYPTED_FILE" > "$ENCRYPTED_FILE.sha256"

        ENCRYPTED_SIZE=$(du -h "$ENCRYPTED_FILE" | cut -f1)
        log "Encrypted backup: $ENCRYPTED_SIZE"

        # Optionally remove unencrypted backup
        # rm "$OUTPUT_FILE" "$OUTPUT_FILE.sha256"
    fi
fi

# ==============================================================
# Update Latest Symlink (Atomic)
# ==============================================================
LATEST_LINK="$BACKUP_DIR/latest"
ln -sf "$(basename "$OUTPUT_FILE")" "$LATEST_LINK.new"
mv "$LATEST_LINK.new" "$LATEST_LINK"
log "Updated 'latest' symlink"

# ==============================================================
# Summary
# ==============================================================
log "=========================================="
log "MongoDB Backup Complete"
log "=========================================="
log ""
log "Backup file: $OUTPUT_FILE"
log "Size: $SIZE"
log "Checksum: $OUTPUT_FILE.sha256"
if [[ -n "$AGE_RECIPIENT" ]] && [[ -f "$OUTPUT_FILE.age" ]]; then
    log "Encrypted: $OUTPUT_FILE.age"
fi
log ""
log "To restore, run:"
log "  ./restore.sh $OUTPUT_FILE"
