#!/bin/bash
# ==============================================================
# MongoDB Restore Script
# ==============================================================
# Restores from mongodump archive backups with verification
#
# Features:
# - Reads credentials from secrets files (never environment)
# - Verifies backup integrity before restore
# - Supports encrypted (.age) backups
# - Requires explicit confirmation before destructive action
# - Uses --drop to replace existing data
#
# Per D2.4: Backup/Recovery Strategy
# Per D3.1: Secrets-aware pattern
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================
BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-pmdl-mongodb}"
SECRET_FILE="${SECRET_FILE:-./secrets/mongodb_root_password}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/peermesh/daily/mongodb}"

# Age decryption key (if using encrypted backups)
AGE_KEY_FILE="${AGE_KEY_FILE:-}"

# Logging function
log() {
    echo "[$(date +%H:%M:%S)] $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

# ==============================================================
# Usage
# ==============================================================
if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: $0 <backup_file.archive.gz>"
    echo ""
    echo "Available backups:"
    if [[ -d "$BACKUP_DIR" ]]; then
        ls -lt "$BACKUP_DIR"/*.archive.gz 2>/dev/null | head -10 || echo "  No backups found"
    else
        echo "  Backup directory not found: $BACKUP_DIR"
    fi
    echo ""
    echo "Options:"
    echo "  CONTAINER_NAME   Container to restore to (default: pmdl-mongodb)"
    echo "  SECRET_FILE      Path to root password secret (default: ./secrets/mongodb_root_password)"
    echo "  AGE_KEY_FILE     Path to Age private key for encrypted backups"
    exit 1
fi

# ==============================================================
# Pre-flight Checks
# ==============================================================
log "=========================================="
log "MongoDB Restore"
log "=========================================="

# Check backup file exists
if [[ ! -f "$BACKUP_FILE" ]]; then
    error_exit "Backup file not found: $BACKUP_FILE"
fi

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

# ==============================================================
# Handle Encrypted Backups
# ==============================================================
RESTORE_FILE="$BACKUP_FILE"

if [[ "$BACKUP_FILE" == *.age ]]; then
    log "Encrypted backup detected"

    if [[ -z "$AGE_KEY_FILE" ]]; then
        error_exit "AGE_KEY_FILE required for encrypted backups"
    fi

    if [[ ! -f "$AGE_KEY_FILE" ]]; then
        error_exit "Age key file not found: $AGE_KEY_FILE"
    fi

    # Decrypt to temporary file
    TEMP_FILE=$(mktemp)
    trap "rm -f $TEMP_FILE" EXIT

    log "Decrypting backup..."
    age -d -i "$AGE_KEY_FILE" "$BACKUP_FILE" > "$TEMP_FILE"
    RESTORE_FILE="$TEMP_FILE"
    log "Decryption complete"
fi

# ==============================================================
# Verify Backup Integrity
# ==============================================================
log "Verifying backup integrity..."

# Check checksum if available
CHECKSUM_FILE="${BACKUP_FILE%.age}.sha256"
if [[ -f "$CHECKSUM_FILE" ]] && [[ "$BACKUP_FILE" != *.age ]]; then
    log "Verifying checksum..."
    if sha256sum -c "$CHECKSUM_FILE" >/dev/null 2>&1; then
        log "Checksum: OK"
    else
        error_exit "Checksum verification failed!"
    fi
else
    log "No checksum file found, skipping verification"
fi

# Get backup size
SIZE=$(du -h "$RESTORE_FILE" | cut -f1)
log "Backup size: $SIZE"

# ==============================================================
# Confirmation
# ==============================================================
echo ""
echo "=========================================="
echo "WARNING: DESTRUCTIVE OPERATION"
echo "=========================================="
echo ""
echo "This will:"
echo "  1. DROP existing databases in $CONTAINER_NAME"
echo "  2. Restore data from: $BACKUP_FILE"
echo ""
echo "Backup size: $SIZE"
echo ""
echo "Type 'RESTORE' to confirm (all uppercase):"
read -r confirm

if [[ "$confirm" != "RESTORE" ]]; then
    log "Aborted by user"
    exit 1
fi

# ==============================================================
# Execute Restore
# ==============================================================
log ""
log "Starting restore..."

# Use --drop to replace existing collections
cat "$RESTORE_FILE" | docker exec -i "$CONTAINER_NAME" mongorestore \
    --username mongo \
    --password "$PASSWORD" \
    --authenticationDatabase admin \
    --archive \
    --gzip \
    --drop

RESTORE_EXIT=$?

if [[ $RESTORE_EXIT -ne 0 ]]; then
    error_exit "Restore command failed with exit code: $RESTORE_EXIT"
fi

# ==============================================================
# Post-Restore Verification
# ==============================================================
log ""
log "Verifying restore..."

# List databases to confirm restore
docker exec "$CONTAINER_NAME" mongosh \
    --username mongo \
    --password "$PASSWORD" \
    --authenticationDatabase admin \
    --quiet \
    --eval "printjson(db.adminCommand('listDatabases').databases.map(d => ({name: d.name, sizeOnDisk: d.sizeOnDisk})))"

# ==============================================================
# Summary
# ==============================================================
log ""
log "=========================================="
log "MongoDB Restore Complete"
log "=========================================="
log ""
log "Restored from: $BACKUP_FILE"
log "Target container: $CONTAINER_NAME"
log ""
log "Recommended post-restore actions:"
log "  1. Verify application connectivity"
log "  2. Check data integrity with sample queries"
log "  3. Review MongoDB logs for any errors"
