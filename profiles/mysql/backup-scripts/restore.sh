#!/bin/bash
# =============================================================
# MySQL Restore Script (Secrets-Aware)
# =============================================================
# Restores MySQL from a mysqldump backup file. Reads credentials
# from file-based secrets per D3.1 Secret Management.
#
# Features:
# - Reads password from secrets file (never environment)
# - Verifies backup integrity before restore
# - Checksum validation when available
# - Supports encrypted (.age) backups
# - Interactive confirmation to prevent accidents
#
# Usage:
#   ./restore.sh <backup_file.sql.gz>
#   ./restore.sh /var/backups/mysql/latest.sql.gz
#   AGE_KEY_FILE=~/.config/age/key.txt ./restore.sh backup.sql.gz.age
#
# =============================================================

set -euo pipefail

# =============================================================
# Configuration
# =============================================================
BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_mysql}"
PROJECT_ROOT="${PROJECT_ROOT:-$(dirname "$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")")}"
SECRET_FILE="${SECRET_FILE:-$PROJECT_ROOT/secrets/mysql_root_password}"
AGE_KEY_FILE="${AGE_KEY_FILE:-$HOME/.config/age/key.txt}"

# =============================================================
# Functions
# =============================================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

show_usage() {
    echo "Usage: $0 <backup_file.sql.gz>"
    echo ""
    echo "Examples:"
    echo "  $0 /var/backups/mysql/mysql-2025-01-01_02-00-00.sql.gz"
    echo "  $0 /var/backups/mysql/latest.sql.gz"
    echo ""
    echo "For encrypted backups:"
    echo "  AGE_KEY_FILE=~/.config/age/key.txt $0 backup.sql.gz.age"
    echo ""
    echo "Available backups:"
    ls -lt /var/backups/mysql/*.sql.gz 2>/dev/null | head -10 || echo "  No backups found in /var/backups/mysql/"
}

# =============================================================
# Argument Validation
# =============================================================

if [[ -z "$BACKUP_FILE" ]]; then
    show_usage
    exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
    # Check if it's a symlink (like 'latest.sql.gz')
    if [[ -L "$BACKUP_FILE" ]]; then
        BACKUP_FILE=$(readlink -f "$BACKUP_FILE")
    else
        error_exit "Backup file not found: $BACKUP_FILE"
    fi
fi

# =============================================================
# Handle Encrypted Backups
# =============================================================

TEMP_DECRYPTED=""
ACTUAL_BACKUP="$BACKUP_FILE"

if [[ "$BACKUP_FILE" == *.age ]]; then
    log "Encrypted backup detected, decrypting..."

    if ! command -v age >/dev/null 2>&1; then
        error_exit "age command not found - required for encrypted backups"
    fi

    if [[ ! -f "$AGE_KEY_FILE" ]]; then
        error_exit "Age key file not found: $AGE_KEY_FILE"
    fi

    TEMP_DECRYPTED=$(mktemp /tmp/mysql-restore-XXXXXX.sql.gz)
    trap "rm -f '$TEMP_DECRYPTED'" EXIT

    age -d -i "$AGE_KEY_FILE" "$BACKUP_FILE" > "$TEMP_DECRYPTED" \
        || error_exit "Decryption failed"

    ACTUAL_BACKUP="$TEMP_DECRYPTED"
    log "Decryption successful."
fi

# =============================================================
# Verification
# =============================================================

log "=== MySQL Restore ==="
log "Backup file: $BACKUP_FILE"
log "Container: $CONTAINER_NAME"
log ""

# Verify backup integrity
log "Verifying backup integrity..."

if ! gzip -t "$ACTUAL_BACKUP" 2>/dev/null; then
    error_exit "Backup file failed gzip integrity check"
fi
log "  Gzip integrity: OK"

# Verify checksum if available
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [[ -f "$CHECKSUM_FILE" ]] && [[ -z "$TEMP_DECRYPTED" ]]; then
    log "Verifying checksum..."
    if sha256sum -c "$CHECKSUM_FILE" --quiet 2>/dev/null; then
        log "  Checksum: OK"
    else
        error_exit "Checksum mismatch!"
    fi
else
    log "  Checksum file not found, skipping checksum verification"
fi

# Verify secret file exists
if [[ ! -f "$SECRET_FILE" ]]; then
    error_exit "Secret file not found: $SECRET_FILE"
fi

# Read password
PASSWORD=$(cat "$SECRET_FILE")
if [[ -z "$PASSWORD" ]]; then
    error_exit "Password file is empty"
fi

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    error_exit "Container not running: $CONTAINER_NAME"
fi

# =============================================================
# Backup Info
# =============================================================

log ""
log "Backup information:"
log "  Size: $(du -h "$ACTUAL_BACKUP" | cut -f1)"
log "  Modified: $(stat -c '%y' "$ACTUAL_BACKUP" 2>/dev/null || stat -f '%Sm' "$ACTUAL_BACKUP")"

# Show databases in backup (first 20 lines of CREATE DATABASE statements)
log ""
log "Databases in backup:"
gunzip -c "$ACTUAL_BACKUP" 2>/dev/null | grep -m 10 "^CREATE DATABASE" | sed 's/.*`\([^`]*\)`.*/  - \1/' || echo "  (unable to parse)"

# =============================================================
# Confirmation
# =============================================================

log ""
log "WARNING: This will OVERWRITE existing databases!"
log ""
echo -n "Type 'RESTORE' to confirm: "
read -r confirm

if [[ "$confirm" != "RESTORE" ]]; then
    log "Aborted by user."
    exit 1
fi

# =============================================================
# Execute Restore
# =============================================================

log ""
log "Starting restore..."

# Restore from backup
gunzip -c "$ACTUAL_BACKUP" | docker exec -i "$CONTAINER_NAME" mysql \
    -u root \
    -p"$PASSWORD" \
    --force \
    2>/dev/null \
    || error_exit "Restore failed"

# =============================================================
# Post-Restore Verification
# =============================================================

log "Restore complete. Verifying..."

# Show databases after restore
docker exec "$CONTAINER_NAME" mysql \
    -u root \
    -p"$PASSWORD" \
    -e "SHOW DATABASES;" \
    2>/dev/null

# Quick sanity check - verify ghost database exists (primary consumer)
if docker exec "$CONTAINER_NAME" mysql \
    -u root \
    -p"$PASSWORD" \
    -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ghost';" \
    --silent 2>/dev/null | grep -q "[0-9]"; then
    log "Ghost database tables: $(docker exec "$CONTAINER_NAME" mysql -u root -p"$PASSWORD" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ghost';" --silent 2>/dev/null)"
fi

# =============================================================
# Summary
# =============================================================

log ""
log "=== Restore Complete ==="
log "Restored from: $BACKUP_FILE"
log ""
log "Next steps:"
log "  1. Restart dependent services: docker compose restart ghost"
log "  2. Verify application functionality"
log "  3. Check application logs for any issues"

exit 0
