#!/bin/bash
# ==============================================================
# Redis Backup Script (Secrets-Aware)
# ==============================================================
# Creates point-in-time RDB snapshot backups of Redis data
#
# Features:
# - Triggers BGSAVE and waits for completion
# - Reads authentication from secrets mount
# - Compresses backup with gzip
# - Generates SHA-256 checksum
# - Maintains "latest" symlink
# - Optional encryption with age
#
# Usage:
#   ./backup.sh
#   CONTAINER_NAME=my_redis ./backup.sh
#   ENCRYPT=true AGE_RECIPIENT="age1..." ./backup.sh
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

# Container and paths
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_redis}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/redis}"
SECRET_FILE="${SECRET_FILE:-./secrets/redis_password}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# Encryption (optional)
ENCRYPT="${ENCRYPT:-false}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"

# Timeouts
BGSAVE_TIMEOUT="${BGSAVE_TIMEOUT:-300}"  # 5 minutes max wait

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
    exit 1
}

cleanup() {
    # Clean up temporary files on exit
    if [ -n "${TEMP_RDB:-}" ] && [ -f "$TEMP_RDB" ]; then
        rm -f "$TEMP_RDB"
    fi
}

trap cleanup EXIT

# ==============================================================
# Pre-flight Checks
# ==============================================================

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    error "Container '$CONTAINER_NAME' is not running"
fi

# Build Redis authentication argument
REDIS_AUTH=""
if [ -f "$SECRET_FILE" ]; then
    REDIS_AUTH="-a $(cat "$SECRET_FILE")"
    log "Using authentication from secrets file"
elif docker exec "$CONTAINER_NAME" redis-cli PING 2>/dev/null | grep -q PONG; then
    log "No authentication required"
else
    error "Cannot connect to Redis. Check if authentication is required."
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# ==============================================================
# Trigger Background Save
# ==============================================================

log "Triggering Redis BGSAVE..."

# Get last save time before triggering new save
LASTSAVE_BEFORE=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH LASTSAVE 2>/dev/null | tail -1)

# Trigger background save
BGSAVE_RESULT=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH BGSAVE 2>/dev/null)
if ! echo "$BGSAVE_RESULT" | grep -q "Background saving started\|already in progress"; then
    error "BGSAVE failed: $BGSAVE_RESULT"
fi

log "BGSAVE initiated, waiting for completion..."

# ==============================================================
# Wait for BGSAVE to Complete
# ==============================================================

WAIT_COUNT=0
WAIT_INTERVAL=2

while true; do
    # Check if still saving
    RDB_STATUS=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH INFO persistence 2>/dev/null | grep rdb_bgsave_in_progress)

    if echo "$RDB_STATUS" | grep -q "rdb_bgsave_in_progress:0"; then
        # Verify timestamp changed (save completed)
        LASTSAVE_AFTER=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH LASTSAVE 2>/dev/null | tail -1)

        if [ "$LASTSAVE_BEFORE" != "$LASTSAVE_AFTER" ]; then
            log "BGSAVE completed successfully"
            break
        fi
    fi

    WAIT_COUNT=$((WAIT_COUNT + WAIT_INTERVAL))
    if [ $WAIT_COUNT -ge $BGSAVE_TIMEOUT ]; then
        error "BGSAVE timeout after ${BGSAVE_TIMEOUT} seconds"
    fi

    log "  Still saving... (${WAIT_COUNT}s elapsed)"
    sleep $WAIT_INTERVAL
done

# ==============================================================
# Copy and Compress RDB File
# ==============================================================

BACKUP_FILE="$BACKUP_DIR/redis-$TIMESTAMP.rdb"
TEMP_RDB=$(mktemp)

log "Copying RDB file from container..."
docker cp "$CONTAINER_NAME:/data/dump.rdb" "$TEMP_RDB" || error "Failed to copy dump.rdb from container"

# Check if RDB file has content
if [ ! -s "$TEMP_RDB" ]; then
    log "WARNING: RDB file is empty (no data in Redis)"
fi

log "Compressing backup..."
gzip -c "$TEMP_RDB" > "$BACKUP_FILE.gz"
rm -f "$TEMP_RDB"

# ==============================================================
# Generate Checksum
# ==============================================================

log "Generating checksum..."
sha256sum "$BACKUP_FILE.gz" > "$BACKUP_FILE.gz.sha256"

# ==============================================================
# Optional Encryption
# ==============================================================

FINAL_BACKUP="$BACKUP_FILE.gz"

if [ "$ENCRYPT" = "true" ]; then
    if [ -z "$AGE_RECIPIENT" ]; then
        error "Encryption requested but AGE_RECIPIENT not set"
    fi

    if ! command -v age &> /dev/null; then
        error "age encryption tool not found. Install with: apt install age"
    fi

    log "Encrypting backup with age..."
    age -r "$AGE_RECIPIENT" "$BACKUP_FILE.gz" > "$BACKUP_FILE.gz.age"
    sha256sum "$BACKUP_FILE.gz.age" > "$BACKUP_FILE.gz.age.sha256"

    # Keep encrypted version as primary
    FINAL_BACKUP="$BACKUP_FILE.gz.age"

    log "Encrypted backup created: $BACKUP_FILE.gz.age"
fi

# ==============================================================
# Update Latest Symlink
# ==============================================================

log "Updating latest symlink..."
LATEST_LINK="$BACKUP_DIR/redis-latest"

if [ "$ENCRYPT" = "true" ]; then
    ln -sf "redis-$TIMESTAMP.rdb.gz.age" "$LATEST_LINK.rdb.gz.age"
    ln -sf "redis-$TIMESTAMP.rdb.gz.age.sha256" "$LATEST_LINK.rdb.gz.age.sha256"
fi

ln -sf "redis-$TIMESTAMP.rdb.gz" "$LATEST_LINK.rdb.gz"
ln -sf "redis-$TIMESTAMP.rdb.gz.sha256" "$LATEST_LINK.rdb.gz.sha256"

# ==============================================================
# Summary
# ==============================================================

BACKUP_SIZE=$(du -h "$FINAL_BACKUP" | cut -f1)
DBSIZE=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH DBSIZE 2>/dev/null | cut -d: -f2)

log "====================================="
log "Backup completed successfully"
log "====================================="
log "File: $FINAL_BACKUP"
log "Size: $BACKUP_SIZE"
log "Keys: $DBSIZE"
log "Checksum: $(cat "$FINAL_BACKUP.sha256" 2>/dev/null | cut -d' ' -f1 || echo 'N/A')"
if [ "$ENCRYPT" = "true" ]; then
    log "Encryption: Enabled (age)"
fi
log "====================================="

exit 0
