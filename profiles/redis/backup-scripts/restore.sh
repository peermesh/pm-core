#!/bin/bash
# ==============================================================
# Redis Restore Script (Secrets-Aware)
# ==============================================================
# Restores Redis data from an RDB backup file
#
# Features:
# - Verifies backup integrity (gzip test + checksum)
# - Supports encrypted backups (age)
# - Gracefully stops Redis before restore
# - Copies RDB to correct volume location
# - Verifies restore by checking key count
#
# Usage:
#   ./restore.sh /path/to/redis-backup.rdb.gz
#   ./restore.sh /path/to/redis-backup.rdb.gz.age  # Encrypted
#   CONTAINER_NAME=my_redis ./restore.sh backup.rdb.gz
#
# WARNING: This will OVERWRITE existing Redis data!
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_redis}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SECRET_FILE="${SECRET_FILE:-./secrets/redis_password}"

# Age decryption key (for encrypted backups)
AGE_KEY_FILE="${AGE_KEY_FILE:-$HOME/.config/age/key.txt}"

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
    if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}

trap cleanup EXIT

# ==============================================================
# Validate Arguments
# ==============================================================

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 <backup_file.rdb.gz|backup_file.rdb.gz.age>"
    echo ""
    echo "Options:"
    echo "  CONTAINER_NAME    Redis container name (default: pmdl_redis)"
    echo "  COMPOSE_FILE      Docker compose file path (default: docker-compose.yml)"
    echo "  SECRET_FILE       Path to Redis password file (default: ./secrets/redis_password)"
    echo "  AGE_KEY_FILE      Path to age private key (default: ~/.config/age/key.txt)"
    echo ""
    echo "Examples:"
    echo "  $0 /var/backups/redis/redis-latest.rdb.gz"
    echo "  CONTAINER_NAME=my_redis $0 backup.rdb.gz.age"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    error "Backup file not found: $BACKUP_FILE"
fi

# ==============================================================
# Detect Backup Type and Decrypt if Needed
# ==============================================================

TEMP_DIR=$(mktemp -d)
WORK_FILE="$TEMP_DIR/dump.rdb.gz"

if [[ "$BACKUP_FILE" == *.age ]]; then
    log "Detected encrypted backup, decrypting..."

    if [ ! -f "$AGE_KEY_FILE" ]; then
        error "Age private key not found at $AGE_KEY_FILE"
    fi

    if ! command -v age &> /dev/null; then
        error "age encryption tool not found. Install with: apt install age"
    fi

    age -d -i "$AGE_KEY_FILE" "$BACKUP_FILE" > "$WORK_FILE" || error "Decryption failed"
    log "Decryption successful"

    # Check for corresponding checksum (for encrypted file)
    if [ -f "$BACKUP_FILE.sha256" ]; then
        log "Verifying encrypted file checksum..."
        cd "$(dirname "$BACKUP_FILE")"
        sha256sum -c "$(basename "$BACKUP_FILE").sha256" || error "Encrypted file checksum mismatch!"
        cd - > /dev/null
    fi
else
    cp "$BACKUP_FILE" "$WORK_FILE"
fi

# ==============================================================
# Verify Backup Integrity
# ==============================================================

log "Verifying backup integrity..."

# Gzip integrity test
if ! gzip -t "$WORK_FILE" 2>/dev/null; then
    error "Backup file is corrupt (gzip test failed)"
fi

# Checksum verification (for unencrypted files)
CHECKSUM_FILE="${BACKUP_FILE%.age}.sha256"
if [ -f "$CHECKSUM_FILE" ] && [[ "$BACKUP_FILE" != *.age ]]; then
    log "Verifying checksum..."
    cd "$(dirname "$BACKUP_FILE")"
    sha256sum -c "$(basename "$CHECKSUM_FILE")" || error "Checksum verification failed!"
    cd - > /dev/null
fi

log "Backup integrity verified"

# ==============================================================
# Confirmation
# ==============================================================

echo ""
echo "========================================"
echo "WARNING: Redis Data Restore"
echo "========================================"
echo ""
echo "This operation will:"
echo "  1. Stop Redis container: $CONTAINER_NAME"
echo "  2. OVERWRITE existing Redis data"
echo "  3. Restart Redis with restored data"
echo ""
echo "Backup file: $BACKUP_FILE"
echo "Backup size: $(du -h "$WORK_FILE" | cut -f1) (compressed)"
echo ""

read -p "Type 'RESTORE' to confirm: " confirm
if [ "$confirm" != "RESTORE" ]; then
    log "Aborted by user"
    exit 0
fi

echo ""

# ==============================================================
# Stop Redis
# ==============================================================

log "Stopping Redis container..."

# Try graceful shutdown first
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    # Build auth argument
    REDIS_AUTH=""
    if [ -f "$SECRET_FILE" ]; then
        REDIS_AUTH="-a $(cat "$SECRET_FILE")"
    fi

    # Graceful shutdown (save data, then stop)
    docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH SHUTDOWN NOSAVE 2>/dev/null || true
    sleep 2
fi

# Stop via compose if still running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker compose -f "$COMPOSE_FILE" stop redis 2>/dev/null || docker stop "$CONTAINER_NAME" 2>/dev/null || true
fi

# Verify stopped
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    error "Failed to stop Redis container"
fi

log "Redis stopped"

# ==============================================================
# Restore RDB File
# ==============================================================

log "Restoring RDB file..."

# Decompress RDB
RDB_FILE="$TEMP_DIR/dump.rdb"
gunzip -c "$WORK_FILE" > "$RDB_FILE"

# Get volume path
VOLUME_NAME="pmdl_redis_data"
VOLUME_PATH=$(docker volume inspect "$VOLUME_NAME" --format '{{ .Mountpoint }}' 2>/dev/null) || true

if [ -z "$VOLUME_PATH" ] || [ ! -d "$VOLUME_PATH" ]; then
    # Volume might not exist yet, create temporary container to access it
    log "Volume not found, creating via temporary container..."

    docker run --rm -v "$VOLUME_NAME:/data" -v "$TEMP_DIR:/restore:ro" alpine sh -c '
        cp /restore/dump.rdb /data/dump.rdb
        chown 999:999 /data/dump.rdb
        chmod 660 /data/dump.rdb
    '
else
    # Direct copy to volume
    sudo cp "$RDB_FILE" "$VOLUME_PATH/dump.rdb"
    sudo chown 999:999 "$VOLUME_PATH/dump.rdb"
    sudo chmod 660 "$VOLUME_PATH/dump.rdb"
fi

log "RDB file restored"

# ==============================================================
# Start Redis
# ==============================================================

log "Starting Redis..."

docker compose -f "$COMPOSE_FILE" up -d redis 2>/dev/null || docker start "$CONTAINER_NAME" 2>/dev/null

# Wait for Redis to be ready
WAIT_COUNT=0
while [ $WAIT_COUNT -lt 30 ]; do
    if docker exec "$CONTAINER_NAME" redis-cli ${REDIS_AUTH:-} PING 2>/dev/null | grep -q PONG; then
        break
    fi
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

if [ $WAIT_COUNT -ge 30 ]; then
    error "Redis failed to start after restore"
fi

log "Redis started"

# ==============================================================
# Verify Restore
# ==============================================================

log "Verifying restore..."

# Build auth argument
REDIS_AUTH=""
if [ -f "$SECRET_FILE" ]; then
    REDIS_AUTH="-a $(cat "$SECRET_FILE")"
fi

# Check database size
DBSIZE=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH DBSIZE 2>/dev/null | cut -d: -f2)

# Check last save time
LASTSAVE=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH LASTSAVE 2>/dev/null | tail -1)
LASTSAVE_DATE=$(date -d @"$LASTSAVE" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "$LASTSAVE" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "Unknown")

# ==============================================================
# Summary
# ==============================================================

echo ""
log "====================================="
log "Restore completed successfully"
log "====================================="
log "Container: $CONTAINER_NAME"
log "Keys restored: $DBSIZE"
log "RDB timestamp: $LASTSAVE_DATE"
log "====================================="
echo ""

exit 0
