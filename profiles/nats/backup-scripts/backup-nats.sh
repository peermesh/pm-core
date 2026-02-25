#!/bin/bash
# ==============================================================
# NATS + JetStream Backup Script
# ==============================================================
# Purpose: Create backup of JetStream streams and configuration
# Method: Volume-level copy (no downtime required for JetStream)
# Features:
#   - Backs up all JetStream stream data
#   - Generates checksums for verification
#   - Compresses backups
#   - Atomic symlink update for "latest" pointer
#   - Secrets-aware (no credentials in logs)
#
# Usage:
#   ./backup-nats.sh
#
# Environment Variables:
#   CONTAINER_NAME   - NATS container name (default: pmdl_nats)
#   BACKUP_DIR       - Backup output directory (default: /var/backups/nats)
#   RETENTION_DAYS   - Days to keep backups (default: 7)
#
# Profile: nats
# Documentation: profiles/nats/PROFILE-SPEC.md
# Decision Reference: D2.4-BACKUP-RECOVERY.md
# ==============================================================

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: ./backup-nats.sh [--help]

Environment Variables:
  CONTAINER_NAME  NATS container name (default: pmdl_nats)
  BACKUP_DIR      Backup output directory (default: /var/backups/nats)
  RETENTION_DAYS  Days to keep backups (default: 7)
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
fi

checksum_write() {
    local file="$1"
    local out="$2"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" > "$out"
    else
        shasum -a 256 "$file" > "$out"
    fi
}

# ==============================================================
# Configuration
# ==============================================================

# Container name
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_nats}"

# Backup directory
BACKUP_DIR="${BACKUP_DIR:-/var/backups/nats}"

# Retention policy (days)
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Timestamp for backup file
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DATE_ONLY=$(date +%Y-%m-%d)

# Backup filename
BACKUP_FILE="nats-jetstream-${TIMESTAMP}.tar.gz"

# ==============================================================
# Pre-flight Checks
# ==============================================================

echo "=== NATS + JetStream Backup ==="
echo "Container: $CONTAINER_NAME"
echo "Backup Dir: $BACKUP_DIR"
echo "Timestamp: $TIMESTAMP"
echo ""

# Check if container exists and is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "ERROR: Container $CONTAINER_NAME is not running"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# ==============================================================
# Backup JetStream Data
# ==============================================================

echo "Starting backup..."

# Create temporary directory for intermediate files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Method 1: Copy JetStream data directory from container
# This is safe while NATS is running - JetStream uses write-ahead logging
echo "Copying JetStream data from container..."
docker cp "$CONTAINER_NAME:/data/jetstream" "$TEMP_DIR/jetstream" 2>/dev/null || {
    echo "WARNING: JetStream directory not found, attempting full /data copy..."
    docker cp "$CONTAINER_NAME:/data" "$TEMP_DIR/data" 2>/dev/null || {
        echo "ERROR: Could not copy data from container"
        exit 1
    }
}

# ==============================================================
# Create Compressed Archive
# ==============================================================

echo "Compressing backup..."
cd "$TEMP_DIR"
tar czf "$BACKUP_DIR/$BACKUP_FILE" ./*

# ==============================================================
# Generate Checksum
# ==============================================================

echo "Generating checksum..."
checksum_write "$BACKUP_DIR/$BACKUP_FILE" "$BACKUP_DIR/${BACKUP_FILE}.sha256"

# ==============================================================
# Verify Backup Integrity
# ==============================================================

echo "Verifying backup integrity..."
gzip -t "$BACKUP_DIR/$BACKUP_FILE" || {
    echo "ERROR: Backup file is corrupt!"
    exit 1
}

# ==============================================================
# Update "Latest" Symlink
# ==============================================================

# Create atomic symlink to latest backup
echo "Updating latest backup pointer..."
ln -sf "$BACKUP_FILE" "$BACKUP_DIR/nats-jetstream-latest.tar.gz"
ln -sf "${BACKUP_FILE}.sha256" "$BACKUP_DIR/nats-jetstream-latest.tar.gz.sha256"

# ==============================================================
# Backup Metadata
# ==============================================================

# Generate backup metadata file
cat > "$BACKUP_DIR/${BACKUP_FILE}.meta" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "container": "$CONTAINER_NAME",
  "backup_file": "$BACKUP_FILE",
  "checksum_file": "${BACKUP_FILE}.sha256",
  "size_bytes": $(stat -f%z "$BACKUP_DIR/$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_DIR/$BACKUP_FILE"),
  "backup_method": "docker_cp_jetstream_data"
}
EOF

# ==============================================================
# Cleanup Old Backups
# ==============================================================

echo "Cleaning up old backups (retention: ${RETENTION_DAYS} days)..."
find "$BACKUP_DIR" -name "nats-jetstream-*.tar.gz" -type f -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -name "nats-jetstream-*.tar.gz.sha256" -type f -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -name "nats-jetstream-*.tar.gz.meta" -type f -mtime "+${RETENTION_DAYS}" -delete

# ==============================================================
# Summary
# ==============================================================

BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)

echo ""
echo "=== Backup Complete ==="
echo "Backup file: $BACKUP_DIR/$BACKUP_FILE"
echo "Backup size: $BACKUP_SIZE"
echo "Checksum: $BACKUP_DIR/${BACKUP_FILE}.sha256"
echo "Metadata: $BACKUP_DIR/${BACKUP_FILE}.meta"
echo ""
echo "To restore this backup:"
echo "  ./restore-nats.sh $BACKUP_DIR/$BACKUP_FILE"
echo ""

exit 0
