#!/bin/bash
# ==============================================================
# [TECHNOLOGY] Restore Script Template
# ==============================================================
#
# This script restores a database from a backup file.
# It reads credentials from secret files, NEVER environment variables.
#
# Usage:
#   ./restore.sh <backup_file>           # Restore specific backup
#   ./restore.sh latest                  # Restore most recent backup
#
# Environment Variables:
#   CONTAINER_NAME  - Container to restore to (default: [tech])
#   SECRET_FILE     - Path to password file (default: ./secrets/[tech]_password)
#   BACKUP_DIR      - Backup source directory (default: /var/backups/[tech])
#
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

CONTAINER_NAME="${CONTAINER_NAME:-[tech]}"
SECRET_FILE="${SECRET_FILE:-./secrets/[tech]_password}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/[tech]}"
BACKUP_FILE="${1:-}"

# ==============================================================
# Functions
# ==============================================================

log() {
    echo "[$(date +%H:%M:%S)] $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

show_usage() {
    echo "Usage: $0 <backup_file>"
    echo ""
    echo "Arguments:"
    echo "  backup_file   Path to backup file, or 'latest' for most recent"
    echo ""
    echo "Available backups:"
    if [[ -d "$BACKUP_DIR" ]]; then
        ls -lt "$BACKUP_DIR"/*.gz 2>/dev/null | head -10 || echo "  No backups found"
    else
        echo "  Backup directory not found: $BACKUP_DIR"
    fi
    exit 1
}

# ==============================================================
# Argument Validation
# ==============================================================

if [[ -z "$BACKUP_FILE" ]]; then
    show_usage
fi

# Handle 'latest' argument
if [[ "$BACKUP_FILE" == "latest" ]]; then
    if [[ -L "$BACKUP_DIR/latest" ]]; then
        BACKUP_FILE="$BACKUP_DIR/$(readlink "$BACKUP_DIR/latest")"
    else
        BACKUP_FILE=$(ls -t "$BACKUP_DIR"/*.gz 2>/dev/null | head -1)
        if [[ -z "$BACKUP_FILE" ]]; then
            error_exit "No backups found in $BACKUP_DIR"
        fi
    fi
fi

# Check backup file exists
if [[ ! -f "$BACKUP_FILE" ]]; then
    error_exit "Backup file not found: $BACKUP_FILE"
fi

# ==============================================================
# Pre-flight Checks
# ==============================================================

log "=== [TECHNOLOGY] Restore ==="
log "Backup file: $BACKUP_FILE"
log "Container: $CONTAINER_NAME"
log ""

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
PASSWORD=$(cat "$SECRET_FILE")
if [[ -z "$PASSWORD" ]]; then
    error_exit "Secret file is empty: $SECRET_FILE"
fi

# ==============================================================
# Verify Backup Integrity
# ==============================================================

log "Verifying backup integrity..."

# Verify gzip integrity
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
    error_exit "Backup file is not a valid gzip archive"
fi
log "  Gzip integrity: OK"

# Verify checksum if available
CHECKSUM_FILE="$BACKUP_FILE.sha256"
if [[ -f "$CHECKSUM_FILE" ]]; then
    if sha256sum -c "$CHECKSUM_FILE" --quiet 2>/dev/null; then
        log "  Checksum: OK"
    else
        error_exit "Checksum verification failed!"
    fi
else
    log "  Checksum: SKIPPED (no checksum file)"
fi

# ==============================================================
# Confirmation
# ==============================================================

log ""
log "WARNING: This will overwrite existing data!"
log ""
log "Backup file: $BACKUP_FILE"
log "Backup size: $(du -h "$BACKUP_FILE" | cut -f1)"
log "Backup date: $(stat -c %y "$BACKUP_FILE" 2>/dev/null || stat -f %Sm "$BACKUP_FILE")"
log ""

read -p "Type 'RESTORE' to confirm: " confirm
if [[ "$confirm" != "RESTORE" ]]; then
    log "Aborted by user."
    exit 1
fi

# ==============================================================
# Execute Restore
# ==============================================================

log ""
log "Starting restore..."

# ==============================================================
# REPLACE THIS SECTION WITH TECHNOLOGY-SPECIFIC COMMANDS
# ==============================================================

# PostgreSQL example:
# gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U postgres \
#     || error_exit "Restore command failed"

# MySQL example:
# gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" mysql \
#     -u root \
#     -p"$PASSWORD" \
#     || error_exit "Restore command failed"

# MongoDB example:
# cat "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" mongorestore \
#     --username root \
#     --password "$PASSWORD" \
#     --authenticationDatabase admin \
#     --archive \
#     --gzip \
#     --drop \
#     || error_exit "Restore command failed"

# Placeholder for template - remove and replace with actual command:
log "PLACEHOLDER: Replace with actual restore command"
log "WARNING: Using placeholder restore command - replace with actual implementation"

# ==============================================================
# END OF TECHNOLOGY-SPECIFIC SECTION
# ==============================================================

# ==============================================================
# Post-Restore Verification
# ==============================================================

log ""
log "Verifying restore..."

# Add technology-specific verification here
# Example: Check connection, count tables, etc.

log "Verification complete."

# ==============================================================
# Completion
# ==============================================================

log ""
log "=== Restore Complete ==="
log "Restored from: $BACKUP_FILE"
log ""
log "Recommended post-restore steps:"
log "  1. Verify application connectivity"
log "  2. Check data integrity"
log "  3. Test critical queries/operations"

exit 0
