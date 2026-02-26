#!/bin/bash
# ==============================================================
# NATS + JetStream Restore Script
# ==============================================================
# Purpose: Restore JetStream data from backup
# Method: Replace JetStream data directory and restart container
# Features:
#   - Verifies backup integrity before restore
#   - Validates checksums
#   - Requires explicit confirmation (destructive operation)
#   - Secrets-aware (no credentials in logs)
#
# Usage:
#   ./restore-nats.sh <backup_file.tar.gz>
#
# Environment Variables:
#   CONTAINER_NAME   - NATS container name (default: pmdl_nats)
#   SKIP_CONFIRMATION - Skip confirmation prompt (default: false, USE WITH CAUTION)
#
# Profile: nats
# Documentation: profiles/nats/PROFILE-SPEC.md
# Decision Reference: D2.4-BACKUP-RECOVERY.md
# ==============================================================

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: ./restore-nats.sh <backup_file.tar.gz>

Environment Variables:
  CONTAINER_NAME    NATS container name (default: pmdl_nats)
  SKIP_CONFIRMATION Skip destructive confirmation prompt (default: false)
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
fi

checksum_verify() {
    local checksum_file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum -c "$checksum_file" >/dev/null
    else
        local expected actual target
        expected=$(awk '{print $1}' "$checksum_file")
        target=$(awk '{print $2}' "$checksum_file")
        target="${target#./}"
        # If checksum file stores an absolute path, use it; otherwise resolve relative to checksum location.
        if [[ "$target" != /* ]]; then
            target="$(dirname "$checksum_file")/$target"
        fi
        actual=$(shasum -a 256 "$target" | awk '{print $1}')
        [[ "$expected" == "$actual" ]]
    fi
}

# ==============================================================
# Configuration
# ==============================================================

# Backup file to restore (required argument)
BACKUP_FILE="${1:-}"

# Container name
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_nats}"

# Skip confirmation (for automated restores)
SKIP_CONFIRMATION="${SKIP_CONFIRMATION:-false}"

# ==============================================================
# Pre-flight Checks
# ==============================================================

echo "=== NATS + JetStream Restore ==="
echo ""

# Check if backup file was provided
if [[ -z "$BACKUP_FILE" ]]; then
    echo "ERROR: No backup file specified"
    echo ""
    echo "Usage: $0 <backup_file.tar.gz>"
    echo ""
    echo "Example:"
    echo "  $0 /var/backups/nats/nats-jetstream-2026-02-22_10-30-00.tar.gz"
    echo ""
    exit 1
fi

# Check if backup file exists
if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "Backup file: $BACKUP_FILE"
echo "Container: $CONTAINER_NAME"
echo ""

# ==============================================================
# Verify Backup Integrity
# ==============================================================

echo "Verifying backup integrity..."

# Check if backup is a valid gzip file
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
    echo "ERROR: Backup file is corrupt (gzip test failed)"
    exit 1
fi

# Verify checksum if available
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [[ -f "$CHECKSUM_FILE" ]]; then
    echo "Verifying checksum..."
    if ! checksum_verify "$CHECKSUM_FILE"; then
        echo "ERROR: Checksum verification failed!"
        echo "The backup file may be corrupted or tampered with."
        exit 1
    fi
    echo "Checksum verified successfully."
else
    echo "WARNING: No checksum file found, skipping checksum verification"
fi

# ==============================================================
# Confirmation Prompt
# ==============================================================

if [[ "$SKIP_CONFIRMATION" != "true" ]]; then
    echo ""
    echo "WARNING: This will OVERWRITE all existing JetStream data!"
    echo "All current streams, consumers, and messages will be LOST."
    echo ""
    echo "Current container status:"
    docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.State}}"
    echo ""
    read -p "Type 'RESTORE' to confirm: " confirm
    if [[ "$confirm" != "RESTORE" ]]; then
        echo "Restore aborted."
        exit 1
    fi
fi

# ==============================================================
# Stop NATS Container
# ==============================================================

echo ""
echo "Stopping NATS container..."

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker stop "$CONTAINER_NAME"
    echo "Container stopped."
else
    echo "Container is not running."
fi

# ==============================================================
# Extract Backup
# ==============================================================

echo "Extracting backup..."

# Create temporary directory for extraction
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Extract backup to temp directory
tar xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# ==============================================================
# Restore Data to Container
# ==============================================================

echo "Restoring data to container..."

# Remove existing JetStream data
docker run --rm \
    -v pmdl_nats_data:/data \
    alpine sh -c "rm -rf /data/jetstream/*" 2>/dev/null || true

# Copy restored data into container volume
if [[ -d "$TEMP_DIR/jetstream" ]]; then
    # Backup contained jetstream directory
    docker run --rm \
        -v pmdl_nats_data:/data \
        -v "$TEMP_DIR:/restore:ro" \
        alpine sh -c "cp -a /restore/jetstream/* /data/jetstream/ 2>/dev/null || cp -a /restore/jetstream /data/"
elif [[ -d "$TEMP_DIR/data" ]]; then
    # Backup contained full data directory
    docker run --rm \
        -v pmdl_nats_data:/data \
        -v "$TEMP_DIR:/restore:ro" \
        alpine sh -c "cp -a /restore/data/* /data/"
else
    # Backup is raw jetstream files
    docker run --rm \
        -v pmdl_nats_data:/data \
        -v "$TEMP_DIR:/restore:ro" \
        alpine sh -c "mkdir -p /data/jetstream && cp -a /restore/* /data/jetstream/"
fi

# Fix permissions (nats user is UID 999)
docker run --rm \
    -v pmdl_nats_data:/data \
    alpine sh -c "chown -R 999:999 /data"

# ==============================================================
# Start NATS Container
# ==============================================================

echo "Starting NATS container..."
docker start "$CONTAINER_NAME" || {
    echo "ERROR: Failed to start container"
    echo "Check logs with: docker logs $CONTAINER_NAME"
    exit 1
}

# ==============================================================
# Wait for Health Check
# ==============================================================

echo "Waiting for NATS to become healthy..."
RETRY_COUNT=0
MAX_RETRIES=30

while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
    if docker inspect "$CONTAINER_NAME" --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
        echo "NATS is healthy."
        break
    fi

    sleep 2
    ((RETRY_COUNT++))

    if [[ $RETRY_COUNT -eq $MAX_RETRIES ]]; then
        echo "WARNING: NATS did not become healthy within expected time"
        echo "Check container status with: docker ps"
        echo "Check logs with: docker logs $CONTAINER_NAME"
    fi
done

# ==============================================================
# Verification
# ==============================================================

echo ""
echo "=== Restore Complete ==="
echo ""
echo "Verification steps:"
echo "  1. Check container status: docker ps --filter name=$CONTAINER_NAME"
echo "  2. Check logs: docker logs $CONTAINER_NAME"
echo "  3. List streams: docker exec $CONTAINER_NAME nats stream ls"
echo "  4. Verify stream data: docker exec $CONTAINER_NAME nats stream info <STREAM_NAME>"
echo ""

# Optional: Attempt to list streams if nats CLI is available
if docker exec "$CONTAINER_NAME" which nats &>/dev/null; then
    echo "Current streams:"
    docker exec "$CONTAINER_NAME" nats stream ls 2>/dev/null || echo "  (nats CLI not available or no streams found)"
    echo ""
fi

exit 0
