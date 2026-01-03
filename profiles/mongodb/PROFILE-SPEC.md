# Supporting Tech Profile: MongoDB

**Version**: mongo:7.0
**Category**: Database
**Status**: Complete
**Last Updated**: 2025-12-31

---

## Table of Contents

1. [Overview & Use Cases](#1-overview--use-cases)
2. [Security Configuration](#2-security-configuration)
3. [Performance Tuning](#3-performance-tuning)
4. [Sizing Calculator](#4-sizing-calculator)
5. [Backup Strategy](#5-backup-strategy)
6. [Startup & Health](#6-startup--health)
7. [Storage Options](#7-storage-options)
8. [VPS Integration](#8-vps-integration)
9. [Compose Fragment](#9-compose-fragment)
10. [Troubleshooting](#10-troubleshooting)
11. [References](#11-references)

---

## 1. Overview & Use Cases

### What Is MongoDB?

MongoDB is a document-oriented NoSQL database that stores data in flexible, JSON-like BSON documents. It excels at storing unstructured or semi-structured data with dynamic schemas, making it ideal for modern applications requiring flexible data models.

### When to Use This Profile

Use this profile when your application needs:

- [x] Document storage with flexible schemas (LibreChat conversations, user preferences)
- [x] JSON-native data structures without ORM overhead
- [x] High write throughput for logging, events, or conversation history
- [x] Embedded documents and arrays for hierarchical data

### When NOT to Use This Profile

Do NOT use this profile if:

- [x] You need ACID transactions across multiple documents/collections (use PostgreSQL)
- [x] Your data has strict relational integrity requirements (foreign keys)
- [x] You need complex JOINs or aggregations across normalized tables
- [x] Your application already uses PostgreSQL and doesn't require document storage

### Comparison with Alternatives

| Feature | MongoDB | PostgreSQL (JSONB) | Redis |
|---------|---------|-------------------|-------|
| Best for | Document storage, flexible schemas | Relational + JSON hybrid | Caching, sessions |
| Memory footprint | Medium (WiredTiger cache) | Higher (shared_buffers + work_mem) | Lower |
| Scaling model | Horizontal (replica sets) | Vertical (single node) | Horizontal (cluster) |
| Learning curve | Low for document ops | Medium (SQL + JSON syntax) | Low |

**Recommendation**: Use MongoDB when applications specifically require document storage (e.g., LibreChat). For applications that can work with PostgreSQL JSONB, consolidate on PostgreSQL to reduce operational complexity.

---

## 2. Security Configuration

### 2.1 Non-Root Execution

MongoDB official image runs as non-root by default (mongodb user, UID 999):

```yaml
services:
  mongodb:
    image: mongo:7.0
    # No explicit user required - image default is secure
```

**Note**: If using bind mounts, ensure directory ownership matches UID 999.

### 2.2 Secrets via `_FILE` Suffix

All credentials MUST use file-based secrets, never environment variables with raw values.

**Supported Secret Variables**:

| Variable | `_FILE` Equivalent | Purpose |
|----------|-------------------|---------|
| `MONGO_INITDB_ROOT_USERNAME` | N/A (plain text OK for username) | Admin username |
| `MONGO_INITDB_ROOT_PASSWORD` | `MONGO_INITDB_ROOT_PASSWORD_FILE` | Admin password |

**Important**: MongoDB's official image supports `_FILE` suffix for the root password. Application-specific users are created in init scripts that read from `/run/secrets/`.

**Compose Configuration**:

```yaml
services:
  mongodb:
    secrets:
      - mongodb_root_password
      - librechat_mongo_password
    environment:
      MONGO_INITDB_ROOT_USERNAME: mongo
      MONGO_INITDB_ROOT_PASSWORD_FILE: /run/secrets/mongodb_root_password

secrets:
  mongodb_root_password:
    file: ./secrets/mongodb_root_password
  librechat_mongo_password:
    file: ./secrets/librechat_mongo_password
```

### 2.3 Network Isolation

This service should be placed in the `db-internal` network zone:

```yaml
services:
  mongodb:
    networks:
      - db-internal    # For database access from apps
      # NOT exposed to frontend or internet networks
```

**Network Zones** (per D3.3):

| Zone | Access Level | This Service |
|------|--------------|--------------|
| `frontend` | Public-facing | No |
| `backend` | App-to-app | No |
| `db-internal` | Database only | Yes |
| `monitoring` | Metrics/logs | Optional (exporter) |

### 2.4 Authentication Enforcement

**Default Authentication**: Disabled in vanilla MongoDB, ENABLED when `MONGO_INITDB_ROOT_USERNAME` is set.

**Required Configuration**:

```yaml
services:
  mongodb:
    command:
      - "mongod"
      - "--auth"  # Enforces authentication
```

**Connection String Pattern**:

```
mongodb://[user]:[password]@mongodb:27017/[database]?authSource=admin
```

Or for application users authenticated against their own database:

```
mongodb://[user]:[password]@mongodb:27017/[database]?authSource=[database]
```

### 2.5 TLS/Encryption

**In-Transit Encryption**:

- [x] Native TLS support: Yes
- [x] Configuration method: Certificate files mounted to container

```yaml
command:
  - "mongod"
  - "--tlsMode=requireTLS"
  - "--tlsCertificateKeyFile=/etc/ssl/mongodb.pem"
```

**At-Rest Encryption**:

- [ ] Native encryption: Enterprise feature only
- [x] Recommendation: Use volume-level encryption (LUKS) or encrypted backup storage

---

## 3. Performance Tuning

### 3.1 Memory Allocation

**Primary Memory Parameter**: `wiredTigerCacheSizeGB`

**Formula**:

```
wiredTigerCacheSizeGB = container_memory_gb * 0.5
```

WiredTiger (MongoDB's storage engine) has a dangerous default: `(RAM - 1GB) / 2`. On an 8GB host, this would claim 3.5GB, potentially starving other containers. Always set explicitly.

**Example Configurations**:

| Container Memory | wiredTigerCacheSizeGB | Connection Overhead | Total Expected Usage |
|------------------|----------------------|---------------------|---------------------|
| 512 MB | 0.25 | ~50 MB | ~400 MB |
| 1 GB | 0.5 | ~100 MB | ~750 MB |
| 2 GB | 1.0 | ~200 MB | ~1.5 GB |
| 4 GB | 2.0 | ~300 MB | ~3 GB |

**Docker Compose Memory Limits**:

```yaml
services:
  mongodb:
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M
```

### 3.2 Connection Limits

**Maximum Connections Formula**:

```
max_connections = concurrent_users * 2
```

**Factors**:
- Per-connection memory overhead: ~1 MB
- Connection pooling recommendation: Yes (use application-side connection pooling)
- Timeout settings: Default 30s for socket, adjust for slow clients

**Configuration**:

```yaml
command:
  - "mongod"
  - "--maxConns=200"  # Adjust based on expected load
```

### 3.3 I/O Optimization

**Disk I/O Settings**:

```yaml
# For SSDs (recommended for production)
command:
  - "mongod"
  - "--wiredTigerCacheSizeGB=0.5"
  - "--quiet"  # Reduce logging I/O
```

For HDDs (not recommended for production):
- Consider reducing journal commit interval
- WiredTiger performs poorly on spinning disks

### 3.4 Query/Operation Optimization

**Index Recommendations**:
- Create indexes on frequently queried fields during init scripts
- Use `createIndex` with `background: true` for large collections
- LibreChat typical indexes: `userId`, `conversationId`, `createdAt`

**Journal Configuration**:

```yaml
command:
  - "mongod"
  - "--journal"  # Default on, ensure durability
```

---

## 4. Sizing Calculator

### 4.1 Input Variables

Collect these values before sizing:

| Variable | Description | How to Estimate |
|----------|-------------|-----------------|
| `DATA_SIZE_GB` | Expected data footprint | Sum of collection sizes + 30% for indexes |
| `PEAK_CONNECTIONS` | Maximum concurrent connections | concurrent_users * 2 (pooling factor) |
| `DOCUMENTS_PER_DAY` | Write volume | Messages/day * average_message_size |
| `WRITE_PERCENTAGE` | % of writes vs reads | Chat apps: 40-60% writes |

### 4.2 Memory Calculation

```bash
#!/bin/bash
# MongoDB sizing calculator

DATA_SIZE_GB=${1:-5}
PEAK_CONNECTIONS=${2:-100}

# WiredTiger cache - 20% of data for working set
# Minimum 256MB for reasonable performance
WIREDTIGER_CACHE_MB=$(echo "scale=0; ($DATA_SIZE_GB * 1024 * 0.20) / 1" | bc)
if [ $WIREDTIGER_CACHE_MB -lt 256 ]; then
    WIREDTIGER_CACHE_MB=256
fi

# Connection overhead - ~1MB per connection
CONNECTION_MEMORY_MB=$PEAK_CONNECTIONS

# Base process overhead
BASE_MEMORY_MB=200

# Journaling and aggregation buffer
JOURNAL_BUFFER_MB=100

# Total
TOTAL_MB=$((WIREDTIGER_CACHE_MB + CONNECTION_MEMORY_MB + BASE_MEMORY_MB + JOURNAL_BUFFER_MB))

echo "=== MongoDB Sizing Results ==="
echo "Data Size: ${DATA_SIZE_GB} GB"
echo "Peak Connections: ${PEAK_CONNECTIONS}"
echo ""
echo "Memory Breakdown:"
echo "  WiredTiger Cache: ${WIREDTIGER_CACHE_MB} MB"
echo "  Connections:      ${CONNECTION_MEMORY_MB} MB"
echo "  Base Process:     ${BASE_MEMORY_MB} MB"
echo "  Journal/Buffers:  ${JOURNAL_BUFFER_MB} MB"
echo "  ---------------------"
echo "  TOTAL:            ${TOTAL_MB} MB"
echo ""
echo "Docker memory limit: ${TOTAL_MB}m"
echo "wiredTigerCacheSizeGB: $(echo "scale=2; $WIREDTIGER_CACHE_MB / 1024" | bc)"
```

### 4.3 Disk Calculation

```bash
# Disk space calculation for MongoDB

DATA_SIZE_GB=${1:-5}

# Index overhead (typically 20-30% of data)
INDEX_OVERHEAD_GB=$(echo "scale=1; $DATA_SIZE_GB * 0.25" | bc)

# Journal files (typically 1-2GB minimum)
JOURNAL_GB=2

# Backup space (at least 1x data for local mongodump)
BACKUP_GB=$DATA_SIZE_GB

# WiredTiger overhead (pre-allocation, free space)
WT_OVERHEAD_GB=$(echo "scale=1; $DATA_SIZE_GB * 0.15" | bc)

# Total
TOTAL_GB=$(echo "scale=1; $DATA_SIZE_GB + $INDEX_OVERHEAD_GB + $JOURNAL_GB + $BACKUP_GB + $WT_OVERHEAD_GB" | bc)

echo "Disk Requirements:"
echo "  Data:       ${DATA_SIZE_GB} GB"
echo "  Indexes:    ${INDEX_OVERHEAD_GB} GB"
echo "  Journal:    ${JOURNAL_GB} GB"
echo "  Backups:    ${BACKUP_GB} GB"
echo "  WT Overhead: ${WT_OVERHEAD_GB} GB"
echo "  ---------------------"
echo "  TOTAL:      ${TOTAL_GB} GB"
```

### 4.4 Quick Reference Table

| Workload | Data Size | Connections | Memory | Disk |
|----------|-----------|-------------|--------|------|
| Development | <1 GB | <20 | 512 MB | 5 GB |
| Small Production | 1-5 GB | 20-50 | 1 GB | 15 GB |
| Medium Production | 5-20 GB | 50-150 | 2 GB | 50 GB |
| Large Production | 20-100 GB | 150-500 | 4 GB | 200 GB |

---

## 5. Backup Strategy

### 5.1 Backup Method

**Primary Tool**: `mongodump`

**Recommended Command**:

```bash
docker exec mongodb mongodump \
    --username mongo \
    --password "$MONGO_PASSWORD" \
    --authenticationDatabase admin \
    --archive \
    --gzip \
    > backup.archive.gz
```

**Options Explained**:

| Option | Purpose | Required |
|--------|---------|----------|
| `--archive` | Stream output to stdout (single file) | Yes |
| `--gzip` | Compress output | Yes |
| `--authenticationDatabase admin` | Authenticate against admin DB | Yes |
| `--oplog` | Point-in-time backup (replica set only) | No (single node) |

### 5.2 Backup Script (Secrets-Aware)

```bash
#!/bin/bash
# backup-scripts/backup.sh
set -euo pipefail

# Configuration
CONTAINER_NAME="${CONTAINER_NAME:-mongodb}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mongodb}"
SECRET_FILE="${SECRET_FILE:-./secrets/mongodb_root_password}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# Read secret from file (NEVER from environment variable)
if [[ ! -f "$SECRET_FILE" ]]; then
    echo "ERROR: Secret file not found: $SECRET_FILE"
    exit 1
fi
PASSWORD=$(cat "$SECRET_FILE")

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Execute backup
echo "Starting MongoDB backup..."
docker exec "$CONTAINER_NAME" mongodump \
    --username mongo \
    --password "$PASSWORD" \
    --authenticationDatabase admin \
    --archive \
    --gzip \
    > "$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz"

# Generate checksum
sha256sum "$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz" > "$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz.sha256"

# Get file size for logging
SIZE=$(du -h "$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz" | cut -f1)

echo "Backup complete: $BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz ($SIZE)"

# Update latest symlink atomically
ln -sf "mongodb-$TIMESTAMP.archive.gz" "$BACKUP_DIR/latest.new"
mv "$BACKUP_DIR/latest.new" "$BACKUP_DIR/latest"
```

### 5.3 Retention Policy

Follow the standard retention (per D2.4):

| Tier | Retention | Count |
|------|-----------|-------|
| Daily | 7 days | 7 |
| Weekly | 4 weeks | 4 |
| Monthly | 3 months | 3 |

### 5.4 Encryption Requirements

Backups containing sensitive data MUST be encrypted before off-site storage:

```bash
# Using age encryption
age -r age1publickey... "$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz" \
    > "$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz.age"

# Upload encrypted file only
rclone copy "$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz.age" remote:backups/mongodb/
```

### 5.5 Restore Procedure

```bash
#!/bin/bash
# backup-scripts/restore.sh
set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-mongodb}"
SECRET_FILE="${SECRET_FILE:-./secrets/mongodb_root_password}"

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: $0 <backup_file.archive.gz>"
    echo ""
    echo "Available backups:"
    ls -lt /var/backups/mongodb/*.archive.gz 2>/dev/null | head -10 || echo "No backups found"
    exit 1
fi

# Verify backup exists
if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Verify checksum if available
if [[ -f "$BACKUP_FILE.sha256" ]]; then
    echo "Verifying checksum..."
    sha256sum -c "$BACKUP_FILE.sha256" || { echo "Checksum mismatch!"; exit 1; }
fi

# Read secret from file
PASSWORD=$(cat "$SECRET_FILE")

echo "WARNING: This will DROP existing data and restore from backup!"
echo "Backup file: $BACKUP_FILE"
read -p "Type 'RESTORE' to confirm: " confirm
[[ "$confirm" == "RESTORE" ]] || { echo "Aborted."; exit 1; }

# Execute restore
echo "Restoring from backup..."
cat "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" mongorestore \
    --username mongo \
    --password "$PASSWORD" \
    --authenticationDatabase admin \
    --archive \
    --gzip \
    --drop

echo "Restore complete."
```

### 5.6 Restore Testing Procedure

Monthly restore testing (per D2.4):

```bash
#!/bin/bash
# backup-scripts/test-restore.sh

BACKUP_FILE="${1:-$(ls -t /var/backups/mongodb/*.archive.gz | head -1)}"
TEST_CONTAINER="mongodb-restore-test"
SECRET_FILE="${SECRET_FILE:-./secrets/mongodb_root_password}"

echo "=== MongoDB Restore Test ==="
echo "Backup: $BACKUP_FILE"

# 1. Create temporary container
docker run -d --name "$TEST_CONTAINER" \
    -e MONGO_INITDB_ROOT_USERNAME=mongo \
    -e MONGO_INITDB_ROOT_PASSWORD="$(cat "$SECRET_FILE")" \
    mongo:7.0

# 2. Wait for container to be ready
echo "Waiting for MongoDB to start..."
sleep 30

# 3. Restore backup to temp container
echo "Restoring backup..."
PASSWORD=$(cat "$SECRET_FILE")
cat "$BACKUP_FILE" | docker exec -i "$TEST_CONTAINER" mongorestore \
    --username mongo \
    --password "$PASSWORD" \
    --authenticationDatabase admin \
    --archive \
    --gzip \
    --drop

# 4. Run verification queries
echo "Verifying restore..."
docker exec "$TEST_CONTAINER" mongosh \
    -u mongo \
    -p "$PASSWORD" \
    --authenticationDatabase admin \
    --eval "printjson(db.adminCommand('listDatabases'))"

# 5. Cleanup
docker rm -f "$TEST_CONTAINER"

echo "=== Restore test complete ==="
```

---

## 6. Startup & Health

### 6.1 Healthcheck Configuration

**CRITICAL**: Health checks must work with `_FILE` secrets. The MongoDB official image handles password files correctly, but healthcheck commands run in the container context after startup.

```yaml
services:
  mongodb:
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s
```

### 6.2 Healthcheck Script (Secrets-Aware)

```bash
#!/bin/bash
# healthcheck-scripts/healthcheck.sh

# Read password from secret file mounted by Docker secrets
if [[ -f /run/secrets/mongodb_root_password ]]; then
    PASSWORD=$(cat /run/secrets/mongodb_root_password)
elif [[ -n "${MONGO_INITDB_ROOT_PASSWORD:-}" ]]; then
    # Fallback for development without secrets
    PASSWORD="$MONGO_INITDB_ROOT_PASSWORD"
else
    echo "ERROR: No password available for health check"
    exit 1
fi

# Execute health check
mongosh \
    --username "${MONGO_INITDB_ROOT_USERNAME:-mongo}" \
    --password "$PASSWORD" \
    --authenticationDatabase admin \
    --quiet \
    --eval "db.adminCommand('ping')" \
    || exit 1

exit 0
```

**Alternative: Direct Command (simpler, works for most cases)**:

```yaml
healthcheck:
  test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 60s
```

This simpler version works when MongoDB allows localhost connections without auth (default behavior), but the script version is more robust for authenticated setups.

### 6.3 depends_on Pattern

```yaml
services:
  librechat:
    depends_on:
      mongodb:
        condition: service_healthy
```

### 6.4 Init Scripts (Secrets-Aware)

Init scripts that create users or databases MUST read secrets from files:

```bash
#!/bin/bash
# init-scripts/01-init-databases.sh

set -e

# CRITICAL: Read secrets from mounted files, NEVER hardcode
if [[ -f /run/secrets/librechat_mongo_password ]]; then
    LIBRECHAT_PASSWORD=$(cat /run/secrets/librechat_mongo_password)
else
    echo "ERROR: librechat_mongo_password secret not mounted"
    exit 1
fi

# Read root password for authentication
if [[ -f /run/secrets/mongodb_root_password ]]; then
    ROOT_PASSWORD=$(cat /run/secrets/mongodb_root_password)
elif [[ -n "${MONGO_INITDB_ROOT_PASSWORD:-}" ]]; then
    ROOT_PASSWORD="$MONGO_INITDB_ROOT_PASSWORD"
else
    echo "ERROR: No root password available"
    exit 1
fi

# Create LibreChat user and database
mongosh \
    --username "${MONGO_INITDB_ROOT_USERNAME:-mongo}" \
    --password "$ROOT_PASSWORD" \
    --authenticationDatabase admin \
    <<EOF
// Switch to librechat database
db = db.getSiblingDB('librechat');

// Check if user already exists (idempotency)
var existingUser = db.getUser('librechat');
if (!existingUser) {
    db.createUser({
        user: 'librechat',
        pwd: '$LIBRECHAT_PASSWORD',
        roles: [
            { role: 'readWrite', db: 'librechat' },
            { role: 'dbAdmin', db: 'librechat' }
        ]
    });
    print('Created librechat user');
} else {
    print('librechat user already exists, skipping');
}

// Create indexes for common LibreChat queries
db.conversations.createIndex({ 'userId': 1, 'updatedAt': -1 });
db.messages.createIndex({ 'conversationId': 1, 'createdAt': 1 });
db.users.createIndex({ 'email': 1 }, { unique: true, sparse: true });

print('MongoDB initialization complete');
EOF

echo "MongoDB initialization complete"
```

**NEVER DO THIS**:

```bash
# WRONG - Hardcoded password
mongosh --eval "db.createUser({user: 'app', pwd: 'CHANGEME123', ...})"
```

### 6.5 Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `interval` | 10s | Fast enough to detect issues, light overhead |
| `timeout` | 5s | mongosh should respond quickly |
| `retries` | 5 | Allow transient failures during load |
| `start_period` | 60s | Account for init scripts and WiredTiger cache warmup |

---

## 7. Storage Options

### 7.1 Local Disk Configuration

For development and simple deployments:

```yaml
services:
  mongodb:
    volumes:
      - pmdl_mongodb_data:/data/db

volumes:
  pmdl_mongodb_data:
    driver: local
```

**Directory Permissions** (if using bind mounts):

```bash
# If using bind mounts instead of named volumes
mkdir -p ./data/mongodb
chown 999:999 ./data/mongodb  # mongodb user UID
chmod 700 ./data/mongodb
```

### 7.2 Attached Volume Configuration

For cloud/VPS with block storage:

```yaml
volumes:
  pmdl_mongodb_data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/block-storage/mongodb
      o: bind
```

**Pre-requisites**:
1. Mount block storage to `/mnt/block-storage`
2. Create subdirectory: `mkdir -p /mnt/block-storage/mongodb`
3. Set ownership: `chown 999:999 /mnt/block-storage/mongodb`

### 7.3 Remote/S3 Considerations

MongoDB data volumes should NOT be stored on network filesystems like S3/MinIO for primary data due to:

- POSIX filesystem requirements (fsync, file locking)
- Latency sensitivity for WiredTiger journal operations
- Write performance requirements

**S3 is appropriate for**:
- Backups (via mongodump + rclone)
- Archived exports
- GridFS blob migration (if moving to S3-backed object storage)

### 7.4 Volume Backup Procedure

```bash
# Stop service before volume backup (cold backup)
docker compose stop mongodb

# Backup volume
docker run --rm \
    -v pmdl_mongodb_data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine tar czf /backup/volume-mongodb-$(date +%Y%m%d).tar.gz -C /data .

# Restart service
docker compose start mongodb
```

**Note**: Hot backups with `mongodump` are preferred as they don't require stopping the service.

---

## 8. VPS Integration

### 8.1 Disk Provisioning Guidance

**Minimum Disk Requirements**:

| Workload | Data Disk | System Disk | Total |
|----------|-----------|-------------|-------|
| Development | 10 GB | 20 GB | 30 GB |
| Small Prod | 30 GB | 20 GB | 50 GB |
| Medium Prod | 100 GB | 20 GB | 120 GB |

**VPS Provider Notes**:

- **DigitalOcean**: Block storage volumes, attach before deployment
- **Hetzner**: Cloud volumes or local NVMe (local NVMe is faster)
- **Vultr**: Block storage recommended for production

### 8.2 Swap Considerations

**Recommendation**: Disable swap for MongoDB

**Rationale**: MongoDB's WiredTiger cache is designed to stay in RAM. Swapping WiredTiger pages to disk causes severe performance degradation. The cache is already sized smaller than available memory to avoid this.

**Configuration**:

```bash
# Disable swap for MongoDB container
# In docker-compose.yml:
services:
  mongodb:
    mem_swappiness: 0
```

Or at system level:

```bash
# Reduce system swappiness
echo 'vm.swappiness=1' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### 8.3 Kernel Parameters

Recommended sysctl settings for MongoDB:

```bash
# /etc/sysctl.d/99-mongodb.conf

# Increase max open files (MongoDB opens many files)
fs.file-max = 100000

# Reduce swap usage
vm.swappiness = 1

# Disable Transparent Huge Pages (per MongoDB docs)
# Note: This is typically done at boot, not via sysctl
```

**Transparent Huge Pages (THP)**: MongoDB recommends disabling THP:

```bash
# Add to /etc/rc.local or systemd service
echo 'never' > /sys/kernel/mm/transparent_hugepage/enabled
echo 'never' > /sys/kernel/mm/transparent_hugepage/defrag
```

### 8.4 Monitoring Hooks

**Key Metrics to Monitor**:

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| WiredTiger cache fill % | 80% | 95% |
| Connections active | 80% of max | 95% of max |
| Operations/sec | Baseline + 50% | Baseline + 100% |
| Disk usage | 70% | 85% |
| Memory usage | 80% | 95% |

**MongoDB Exporter for Prometheus**:

```yaml
services:
  mongodb-exporter:
    image: percona/mongodb_exporter:0.40
    environment:
      MONGODB_URI: "mongodb://exporter:$${EXPORTER_PASSWORD}@mongodb:27017/admin"
    ports:
      - "127.0.0.1:9216:9216"
    networks:
      - db-internal
      - monitoring
```

**Note**: Create an exporter user with minimal read permissions.

**Health Check Integration**:

```bash
# For external monitoring (check if mongosh is responsive)
docker exec mongodb mongosh --quiet --eval "db.adminCommand('ping')" || exit 1
```

---

## 9. Compose Fragment

### 9.1 Complete Service Definition

Copy this entire block to your `docker-compose.yml`:

```yaml
# ==============================================================
# MongoDB 7.0 - Supporting Tech Profile
# ==============================================================
# Profile Version: 1.0
# Documentation: .dev/profiles/mongodb/PROFILE-SPEC.md
# ==============================================================

services:
  mongodb:
    image: mongo:7.0
    container_name: pmdl-mongodb
    restart: unless-stopped

    # Secrets configuration
    secrets:
      - mongodb_root_password
      - librechat_mongo_password

    # Environment (using _FILE suffix for password)
    environment:
      MONGO_INITDB_ROOT_USERNAME: mongo
      MONGO_INITDB_ROOT_PASSWORD_FILE: /run/secrets/mongodb_root_password

    # Command with performance tuning
    command:
      - "mongod"
      - "--auth"
      - "--wiredTigerCacheSizeGB=0.5"
      - "--quiet"

    # Volumes
    volumes:
      - pmdl_mongodb_data:/data/db
      - ./profiles/mongodb/init-scripts:/docker-entrypoint-initdb.d:ro
      - ./profiles/mongodb/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro

    # Health check (uses script for secrets compatibility)
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s

    # Network isolation
    networks:
      - db-internal

    # Resource limits (adjust wiredTigerCacheSizeGB proportionally)
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M

    # Disable swap for WiredTiger performance
    mem_swappiness: 0

    # Logging: Prevent unbounded log growth
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

# Secrets definitions
secrets:
  mongodb_root_password:
    file: ./secrets/mongodb_root_password
  librechat_mongo_password:
    file: ./secrets/librechat_mongo_password

# Volumes
volumes:
  pmdl_mongodb_data:
    driver: local

# Networks (reference existing or define)
networks:
  db-internal:
    external: true  # Or define inline if not using shared network
```

### 9.2 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_INITDB_ROOT_USERNAME` | Yes | - | Admin username |
| `MONGO_INITDB_ROOT_PASSWORD_FILE` | Yes | - | Path to admin password file |
| `--wiredTigerCacheSizeGB` | Yes | Dangerous default | WiredTiger cache size |
| `--auth` | Yes | - | Enable authentication |

### 9.3 Secret Files Required

Generate these before starting:

```bash
# scripts/generate-secrets.sh additions

generate_db_password "mongodb_root_password"
generate_db_password "librechat_mongo_password"
```

Where `generate_db_password` creates alphanumeric passwords:

```bash
generate_db_password() {
    local name="$1"
    local file="./secrets/$name"

    if [[ -f "$file" ]]; then
        echo "Secret $name exists, skipping"
        return 0
    fi

    openssl rand -hex 24 > "$file"
    chmod 600 "$file"
    echo "Generated $name"
}
```

---

## 10. Troubleshooting

### Common Issues

#### Issue 1: WiredTiger Cache Uses All Memory

**Symptoms**: Container OOM killed, other containers starved

**Cause**: Missing `--wiredTigerCacheSizeGB` command argument

**Solution**:
```yaml
command:
  - "mongod"
  - "--wiredTigerCacheSizeGB=0.5"  # REQUIRED - always set explicitly
```

#### Issue 2: Health Check Fails with Authentication Error

**Symptoms**: Container shows `unhealthy`, logs show "Authentication failed"

**Cause**: Health check using wrong credentials or secrets not mounted

**Solution**:
```bash
# Verify secret is mounted
docker exec mongodb cat /run/secrets/mongodb_root_password

# Test authentication manually
docker exec -it mongodb mongosh -u mongo -p $(cat ./secrets/mongodb_root_password) --authenticationDatabase admin
```

#### Issue 3: Permission Denied on Data Directory

**Symptoms**: Container fails to start, logs show "permission denied"

**Cause**: Bind mount directory not owned by mongodb user (UID 999)

**Solution**:
```bash
# For bind mounts
chown 999:999 ./data/mongodb

# For named volumes, recreate
docker volume rm pmdl_mongodb_data
docker compose up -d mongodb
```

#### Issue 4: Init Script Doesn't Run

**Symptoms**: Database/users not created, but container starts

**Cause**: Init scripts only run on empty data volume

**Solution**:
```bash
# Remove existing data to trigger init
docker compose down mongodb
docker volume rm pmdl_mongodb_data
docker compose up -d mongodb
```

#### Issue 5: Slow Queries After Restart

**Symptoms**: First queries after restart are slow

**Cause**: WiredTiger cache is cold (needs to reload data from disk)

**Solution**: This is expected behavior. Cache warms up over time. Ensure `start_period` is sufficient for dependent services.

### Log Analysis

**View logs**:
```bash
docker logs pmdl-mongodb --tail 100 -f
```

**Common log patterns**:

| Pattern | Meaning | Action |
|---------|---------|--------|
| `WiredTiger evicting` | Cache pressure | Consider increasing cache size |
| `connection accepted` | New client connection | Normal operation |
| `Authentication failed` | Wrong credentials | Check secrets mounting |
| `Index build completed` | Index created | Normal during init |
| `Slow query` | Query exceeded threshold | Check indexes |

---

## 11. References

### Official Documentation

- [MongoDB Docker Hub](https://hub.docker.com/_/mongo)
- [MongoDB WiredTiger Configuration](https://www.mongodb.com/docs/manual/reference/configuration-options/#mongodb-setting-storage.wiredTiger.engineConfig.cacheSizeGB)
- [MongoDB Security Checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/)

### Foundation Decisions Referenced

| Decision | Relevance |
|----------|-----------|
| D3.1 Secret Management | File-based secrets pattern via `_FILE` suffix |
| D4.1 Health Checks | Timing parameters, mongosh health check pattern |
| D4.3 Startup Ordering | depends_on: service_healthy pattern |
| D3.3 Network Isolation | db-internal zone placement |
| D2.4 Backup Recovery | mongodump command, retention policy |
| D4.2 Resource Constraints | Memory limits, WiredTiger sizing |
| D9 Storage Strategy | Volume naming, storage tiers |
| D10 Resource Calculator | Memory formulas for MongoDB |
| D2.1 Database Selection | MongoDB 7.0 image selection |
| D2.2 Database Memory | wiredTigerCacheSizeGB values per profile |

### Related Profiles

- PostgreSQL Profile: Primary relational database for apps requiring SQL
- Redis Profile: Session caching, often used alongside MongoDB

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-12-31 | Initial creation | AI Agent |

---

*Profile Version: 1.0*
*Last Updated: 2025-12-31*
*Part of Peer Mesh Docker Lab*
