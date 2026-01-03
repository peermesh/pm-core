# Supporting Tech Profile: Redis

**Version**: Redis 7.x (Alpine)
**Image**: `redis:7-alpine`
**Category**: Cache / Session Store / Message Broker
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

### What Is Redis?

Redis is an in-memory data structure store used as a cache, session store, message broker, and lightweight database. It provides sub-millisecond latency for read/write operations and supports various data structures (strings, hashes, lists, sets, sorted sets, streams).

### When to Use This Profile

Use this profile when your application needs:

- [x] Session storage for authentication systems (Authelia, Keycloak)
- [x] Application-level caching (query results, rendered pages)
- [x] Rate limiting and throttling
- [x] Pub/sub messaging between services
- [x] Job queues and background task management
- [x] Temporary data with automatic expiration (TTL)

### When NOT to Use This Profile

Do NOT use this profile if:

- [ ] You need persistent primary data storage (use PostgreSQL instead)
- [ ] Your dataset exceeds available RAM (Redis is memory-bound)
- [ ] You need complex queries or joins (use a relational database)
- [ ] You require ACID transactions across multiple keys (use PostgreSQL)
- [ ] Data loss is completely unacceptable (Redis prioritizes speed over durability)

### Comparison with Alternatives

| Feature | Redis | Memcached | Valkey | KeyDB |
|---------|-------|-----------|--------|-------|
| Best for | Caching + sessions + pub/sub | Pure caching | Redis drop-in (open source) | Multi-threaded Redis |
| Data structures | Rich (hashes, sets, streams) | Simple (key-value) | Same as Redis | Same as Redis |
| Persistence | RDB + AOF | None | RDB + AOF | RDB + AOF |
| Memory footprint | Low-Medium | Very Low | Low-Medium | Medium |
| Pub/Sub | Yes | No | Yes | Yes |
| Clustering | Yes | Consistent hashing | Yes | Yes |

**Recommendation**: Use Redis for session storage, caching, and pub/sub. It's the industry standard, has excellent documentation, and is the expected backend for Authelia and many other applications in this stack. Consider Valkey as a fully open-source alternative if Redis licensing is a concern.

---

## 2. Security Configuration

### 2.1 Non-Root Execution

Redis runs as the `redis` user (UID 999) inside the container:

```yaml
services:
  redis:
    # Redis Alpine image runs as redis user by default (UID 999)
    # No explicit user: directive needed for standard operation
```

**Note**: The official Redis Alpine image handles user permissions automatically. If using custom configuration, ensure files are readable by UID 999.

### 2.2 Authentication Configuration

Redis authentication is optional but **strongly recommended** for any environment where Redis is accessible from multiple containers or networks.

**Option A: No Authentication (Internal-Only)**

For deployments where Redis is on an isolated internal network with no external access:

```yaml
services:
  redis:
    command: redis-server --protected-mode no
    networks:
      - app-internal  # Internal network only
```

**Option B: Password Authentication (Recommended)**

For production or when multiple services access Redis:

```yaml
services:
  redis:
    command: redis-server --requirepass "${REDIS_PASSWORD}"
    secrets:
      - redis_password
    environment:
      REDIS_PASSWORD_FILE: /run/secrets/redis_password

secrets:
  redis_password:
    file: ./secrets/redis_password
```

**Note**: Redis does not natively support `_FILE` suffix for password. Use a wrapper script or inject via command line. See Section 6.2 for the recommended approach.

### 2.3 Dangerous Commands

Disable dangerous commands in production to prevent accidental data loss or security issues:

```yaml
command:
  - redis-server
  - --requirepass
  - "${REDIS_PASSWORD}"
  - --rename-command
  - FLUSHDB
  - ""
  - --rename-command
  - FLUSHALL
  - ""
  - --rename-command
  - CONFIG
  - ""
  - --rename-command
  - DEBUG
  - ""
  - --rename-command
  - SHUTDOWN
  - ""
```

**Commands to Consider Disabling**:

| Command | Risk | Recommendation |
|---------|------|----------------|
| `FLUSHDB` | Deletes all keys in current database | Disable in production |
| `FLUSHALL` | Deletes all keys in all databases | Disable in production |
| `CONFIG` | Can modify runtime configuration | Disable or rename |
| `DEBUG` | Can crash server, expose internals | Disable in production |
| `KEYS` | Can block server with large datasets | Rename (use SCAN instead) |
| `SHUTDOWN` | Stops Redis server | Disable in production |

### 2.4 Network Isolation

Redis should be placed in the `app-internal` network zone (accessed by applications, not directly by reverse proxy):

```yaml
services:
  redis:
    networks:
      - app-internal
    # NO ports exposed to host - internal only
```

**Network Zones** (per D3.3):

| Zone | Access Level | Redis |
|------|--------------|-------|
| `frontend` | Public-facing | No |
| `backend` | App-to-app | Yes (if needed by apps) |
| `app-internal` | Internal services only | Yes (primary) |
| `db-internal` | Database only | Optional |
| `monitoring` | Metrics/logs | Optional (for exporters) |

### 2.5 TLS/Encryption

**In-Transit Encryption**:

- [x] Native TLS support: Yes (Redis 6.0+)
- Configuration method: Mount certificates and configure TLS parameters

```yaml
command:
  - redis-server
  - --tls-port
  - "6379"
  - --port
  - "0"
  - --tls-cert-file
  - /certs/redis.crt
  - --tls-key-file
  - /certs/redis.key
  - --tls-ca-cert-file
  - /certs/ca.crt
volumes:
  - ./certs:/certs:ro
```

**At-Rest Encryption**:

- [ ] Native encryption: No (use volume-level encryption)
- Recommendation: For sensitive data, use LUKS-encrypted volumes or cloud provider encryption. For most cache use cases, at-rest encryption is not required since data is ephemeral.

---

## 3. Performance Tuning

### 3.1 Memory Allocation

**Primary Memory Parameter**: `maxmemory`

**Formula**:

```
maxmemory = available_container_memory * 0.80
```

Reserve 20% for Redis overhead, client connections, and RDB/AOF operations.

**Example Configurations**:

| Container Limit | maxmemory | Use Case |
|-----------------|-----------|----------|
| 128 MB | 100mb | Minimal cache, development |
| 256 MB | 200mb | Small production, sessions |
| 512 MB | 400mb | Medium production |
| 1 GB | 800mb | Large cache, high traffic |
| 2 GB | 1600mb | Heavy workloads |

**Docker Compose Memory Limits**:

```yaml
services:
  redis:
    command: redis-server --maxmemory 400mb --maxmemory-policy allkeys-lru
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### 3.2 Eviction Policies

Choose the eviction policy based on your use case:

| Policy | Behavior | Best For |
|--------|----------|----------|
| `noeviction` | Return errors when memory is full | Session storage (data must not be lost) |
| `allkeys-lru` | Evict least recently used keys | General caching |
| `allkeys-lfu` | Evict least frequently used keys | Popular item caching |
| `volatile-lru` | Evict LRU keys with TTL only | Mixed persistent + cache |
| `volatile-ttl` | Evict keys with shortest TTL first | Time-sensitive cache |
| `allkeys-random` | Random eviction | When LRU overhead is too high |

**Recommended Settings by Use Case**:

| Use Case | Policy | Rationale |
|----------|--------|-----------|
| Authelia sessions | `noeviction` | Sessions must not be lost mid-use |
| Application cache | `allkeys-lru` | Natural cache behavior |
| Rate limiting | `volatile-ttl` | Limits should expire naturally |
| Job queue | `noeviction` | Jobs must not be dropped |

### 3.3 Connection Limits

**Maximum Clients**:

```yaml
command: redis-server --maxclients 1000
```

**Factors**:
- Default: 10,000 connections
- Per-connection memory: ~10-16 KB minimum
- For 100 concurrent connections: ~1-2 MB overhead
- Recommendation: Set to expected peak * 2

**Timeout Settings**:

```yaml
command:
  - redis-server
  - --timeout
  - "300"          # Close idle connections after 5 minutes
  - --tcp-keepalive
  - "60"           # Send keepalive every 60 seconds
```

### 3.4 I/O Optimization

**TCP Backlog** (for high-connection scenarios):

```yaml
command: redis-server --tcp-backlog 511
```

**Persistence I/O** (if using RDB/AOF):

```yaml
command:
  - redis-server
  - --save
  - "900 1"        # Save if 1 key changed in 900 seconds
  - --save
  - "300 10"       # Save if 10 keys changed in 300 seconds
  - --save
  - "60 10000"     # Save if 10000 keys changed in 60 seconds
```

**Disable Persistence** (pure cache mode):

```yaml
command:
  - redis-server
  - --save
  - ""
  - --appendonly
  - "no"
```

---

## 4. Sizing Calculator

### 4.1 Input Variables

Collect these values before sizing:

| Variable | Description | How to Estimate |
|----------|-------------|-----------------|
| `CACHE_SIZE_MB` | Expected cache data size | Sum of all cached objects |
| `SESSION_COUNT` | Number of active sessions | Peak concurrent users |
| `SESSION_SIZE_KB` | Average session size | 1-10 KB typical |
| `QUEUE_DEPTH` | Job queue average depth | Peak pending jobs |

### 4.2 Memory Calculation

```bash
#!/bin/bash
# Redis sizing calculator

CACHE_SIZE_MB=${1:-100}
SESSION_COUNT=${2:-500}
SESSION_SIZE_KB=${3:-5}
QUEUE_DEPTH=${4:-100}

# Cache memory (with 20% overhead for data structures)
CACHE_MEMORY_MB=$(echo "$CACHE_SIZE_MB * 1.2" | bc)

# Session memory
SESSION_MEMORY_MB=$(echo "$SESSION_COUNT * $SESSION_SIZE_KB / 1024 * 1.3" | bc)

# Queue memory (estimate 1KB per job)
QUEUE_MEMORY_MB=$(echo "$QUEUE_DEPTH * 1 / 1024 * 1.5" | bc)

# Base overhead
BASE_OVERHEAD_MB=30

# Total maxmemory setting
MAXMEMORY_MB=$(echo "$CACHE_MEMORY_MB + $SESSION_MEMORY_MB + $QUEUE_MEMORY_MB + $BASE_OVERHEAD_MB" | bc | cut -d. -f1)

# Container limit (maxmemory + 25% buffer)
CONTAINER_LIMIT_MB=$(echo "$MAXMEMORY_MB * 1.25" | bc | cut -d. -f1)

echo "=== Redis Sizing Results ==="
echo "Cache Size: ${CACHE_SIZE_MB} MB"
echo "Sessions: ${SESSION_COUNT} (${SESSION_SIZE_KB} KB each)"
echo "Queue Depth: ${QUEUE_DEPTH}"
echo ""
echo "Memory Breakdown:"
echo "  Cache:       ${CACHE_MEMORY_MB} MB"
echo "  Sessions:    ${SESSION_MEMORY_MB} MB"
echo "  Queue:       ${QUEUE_MEMORY_MB} MB"
echo "  Base:        ${BASE_OVERHEAD_MB} MB"
echo "  ─────────────────────"
echo "  maxmemory:   ${MAXMEMORY_MB} MB"
echo ""
echo "Container memory limit: ${CONTAINER_LIMIT_MB}M"
echo "Command: --maxmemory ${MAXMEMORY_MB}mb"
```

### 4.3 Disk Calculation (for persistent mode)

```bash
# Disk space calculation (if using RDB persistence)

# RDB dump is approximately 1:1 with data size
RDB_SIZE_MB=$MAXMEMORY_MB

# AOF can grow 2-3x before rewrite
AOF_SIZE_MB=$(echo "$MAXMEMORY_MB * 2" | bc)

# Total disk (for RDB + working space)
TOTAL_DISK_MB=$(echo "$RDB_SIZE_MB * 2 + 100" | bc)

echo "Disk Requirements (persistent mode):"
echo "  RDB Size:    ${RDB_SIZE_MB} MB"
echo "  Working:     ${RDB_SIZE_MB} MB (during BGSAVE)"
echo "  Buffer:      100 MB"
echo "  ─────────────────────"
echo "  TOTAL:       ${TOTAL_DISK_MB} MB"
```

### 4.4 Quick Reference Table

| Workload | Sessions | Cache Size | maxmemory | Container Limit |
|----------|----------|------------|-----------|-----------------|
| Development | <100 | 10 MB | 64 MB | 128 MB |
| Small Production | 100-500 | 50 MB | 128 MB | 256 MB |
| Medium Production | 500-2000 | 200 MB | 384 MB | 512 MB |
| Large Production | 2000-10000 | 500 MB | 768 MB | 1 GB |
| High Traffic | 10000+ | 1+ GB | 1536 MB | 2 GB |

---

## 5. Backup Strategy

### 5.1 Backup Method

**Primary Tool**: RDB snapshots via `BGSAVE`

Redis provides two persistence options:

| Method | Description | Use Case |
|--------|-------------|----------|
| **RDB** | Point-in-time snapshots | Backups, fast restart |
| **AOF** | Append-only log of operations | Higher durability, slower recovery |

**Recommended**: Use RDB for backups. Enable AOF only if session/queue durability is critical.

### 5.2 Backup Script (Secrets-Aware)

```bash
#!/bin/bash
# backup-scripts/backup.sh
set -euo pipefail

# Configuration
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_redis}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/redis}"
SECRET_FILE="${SECRET_FILE:-./secrets/redis_password}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# Read password from file if authentication is enabled
if [[ -f "$SECRET_FILE" ]]; then
    REDIS_AUTH="-a $(cat "$SECRET_FILE")"
else
    REDIS_AUTH=""
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Trigger BGSAVE and wait for completion
echo "Triggering Redis BGSAVE..."
docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH BGSAVE

# Wait for background save to complete
echo "Waiting for BGSAVE to complete..."
while true; do
    LASTSAVE_BEFORE=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH LASTSAVE | tail -1)
    sleep 1
    LASTSAVE_AFTER=$(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH LASTSAVE | tail -1)
    if [[ "$LASTSAVE_BEFORE" != "$LASTSAVE_AFTER" ]] || \
       [[ $(docker exec "$CONTAINER_NAME" redis-cli $REDIS_AUTH INFO persistence | grep rdb_bgsave_in_progress:0) ]]; then
        break
    fi
    echo "  Still saving..."
    sleep 2
done

# Copy RDB file from container
echo "Copying RDB file..."
docker cp "$CONTAINER_NAME:/data/dump.rdb" "$BACKUP_DIR/redis-$TIMESTAMP.rdb"

# Compress backup
gzip "$BACKUP_DIR/redis-$TIMESTAMP.rdb"

# Generate checksum
sha256sum "$BACKUP_DIR/redis-$TIMESTAMP.rdb.gz" > "$BACKUP_DIR/redis-$TIMESTAMP.rdb.gz.sha256"

# Update latest symlink
ln -sf "redis-$TIMESTAMP.rdb.gz" "$BACKUP_DIR/redis-latest.rdb.gz"
ln -sf "redis-$TIMESTAMP.rdb.gz.sha256" "$BACKUP_DIR/redis-latest.rdb.gz.sha256"

echo "Backup complete: $BACKUP_DIR/redis-$TIMESTAMP.rdb.gz"
echo "Size: $(du -h "$BACKUP_DIR/redis-$TIMESTAMP.rdb.gz" | cut -f1)"
```

### 5.3 Retention Policy

Follow the standard retention (per D2.4):

| Tier | Retention | Count |
|------|-----------|-------|
| Daily | 7 days | 7 |
| Weekly | 4 weeks | 4 |
| Monthly | 3 months | 3 |

**Note**: For pure cache use cases, backups may not be necessary. Only backup if Redis stores sessions or job queues.

### 5.4 Encryption Requirements

Backups containing session data MUST be encrypted before off-site storage:

```bash
# Using age encryption (per D3.1)
age -r age1publickey... redis-backup.rdb.gz > redis-backup.rdb.gz.age

# Verify encryption
file redis-backup.rdb.gz.age  # Should show "data" not "gzip"
```

### 5.5 Restore Procedure

```bash
#!/bin/bash
# backup-scripts/restore.sh
set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_redis}"

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: $0 <backup_file.rdb.gz>"
    exit 1
fi

# Verify backup integrity
gzip -t "$BACKUP_FILE" || { echo "Backup file is corrupt!"; exit 1; }

# Verify checksum if available
if [[ -f "$BACKUP_FILE.sha256" ]]; then
    sha256sum -c "$BACKUP_FILE.sha256" || { echo "Checksum mismatch!"; exit 1; }
fi

echo "WARNING: This will overwrite existing Redis data!"
read -p "Type 'RESTORE' to confirm: " confirm
[[ "$confirm" == "RESTORE" ]] || { echo "Aborted."; exit 1; }

# Stop Redis (cleanly)
echo "Stopping Redis..."
docker exec "$CONTAINER_NAME" redis-cli SHUTDOWN NOSAVE 2>/dev/null || true
docker compose stop redis

# Decompress and copy RDB file
echo "Restoring RDB file..."
TEMP_RDB=$(mktemp)
gunzip -c "$BACKUP_FILE" > "$TEMP_RDB"

# Get volume path and copy
VOLUME_PATH=$(docker volume inspect pmdl_redis_data --format '{{ .Mountpoint }}')
sudo cp "$TEMP_RDB" "$VOLUME_PATH/dump.rdb"
sudo chown 999:999 "$VOLUME_PATH/dump.rdb"
rm "$TEMP_RDB"

# Start Redis
echo "Starting Redis..."
docker compose up -d redis

echo "Restore complete. Verifying..."
sleep 3
docker exec "$CONTAINER_NAME" redis-cli DBSIZE

echo "Restore verification complete."
```

### 5.6 Restore Testing Procedure

Monthly restore testing (per D2.4):

```bash
#!/bin/bash
# backup-scripts/test-restore.sh

# 1. Create temporary container
docker run -d --name redis-restore-test \
    -v redis_test_data:/data \
    redis:7-alpine

# 2. Wait for container to be ready
sleep 5

# 3. Copy backup to test container
docker cp ./backups/redis-latest.rdb redis-restore-test:/data/dump.rdb
docker exec redis-restore-test chown redis:redis /data/dump.rdb

# 4. Restart to load RDB
docker restart redis-restore-test
sleep 3

# 5. Verify data loaded
docker exec redis-restore-test redis-cli DBSIZE

# 6. Cleanup
docker rm -f redis-restore-test
docker volume rm redis_test_data

echo "Restore test passed."
```

---

## 6. Startup & Health

### 6.1 Healthcheck Configuration

Redis health checks are simple and fast. Use `redis-cli ping`:

```yaml
services:
  redis:
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s
```

**For Password-Protected Redis**:

```yaml
healthcheck:
  test: ["CMD", "/healthcheck.sh"]
  interval: 10s
  timeout: 3s
  retries: 3
  start_period: 5s
volumes:
  - ./profiles/redis/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro
```

### 6.2 Healthcheck Script (Secrets-Aware)

```bash
#!/bin/bash
# healthcheck-scripts/healthcheck.sh

# Read password from secret file if it exists
if [[ -f /run/secrets/redis_password ]]; then
    REDIS_AUTH="-a $(cat /run/secrets/redis_password)"
else
    REDIS_AUTH=""
fi

# Execute ping health check
redis-cli $REDIS_AUTH ping | grep -q PONG
exit $?
```

### 6.3 Startup Script (Secrets-Aware)

Since Redis doesn't natively support `_FILE` suffix for password, use a startup wrapper:

```bash
#!/bin/bash
# init-scripts/01-init-redis.sh
# This script is used as the container entrypoint to load secrets

# Read password from secret file if it exists
if [[ -f /run/secrets/redis_password ]]; then
    REDIS_PASSWORD=$(cat /run/secrets/redis_password)
    exec redis-server \
        --requirepass "$REDIS_PASSWORD" \
        --maxmemory 400mb \
        --maxmemory-policy allkeys-lru \
        --appendonly no \
        --save ""
else
    # No authentication (development/internal-only)
    exec redis-server \
        --protected-mode no \
        --maxmemory 400mb \
        --maxmemory-policy allkeys-lru \
        --appendonly no \
        --save ""
fi
```

**Usage in Compose**:

```yaml
services:
  redis:
    image: redis:7-alpine
    entrypoint: ["/bin/sh", "/init-scripts/01-init-redis.sh"]
    volumes:
      - ./profiles/redis/init-scripts:/init-scripts:ro
    secrets:
      - redis_password
```

### 6.4 depends_on Pattern

Redis starts very quickly (typically <1 second). Applications depending on Redis should still use health checks:

```yaml
services:
  authelia:
    depends_on:
      redis:
        condition: service_healthy

  app:
    depends_on:
      redis:
        condition: service_healthy
```

### 6.5 Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `interval` | 10s | Frequent enough for cache critical path |
| `timeout` | 3s | Ping is fast (<1ms typical); 3s catches issues |
| `retries` | 3 | Quick recovery from transient issues |
| `start_period` | 5s | Redis starts in <1s; 5s is generous buffer |

---

## 7. Storage Options

### 7.1 Ephemeral Mode (Pure Cache)

For pure caching where data loss on restart is acceptable:

```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --save "" --appendonly no
    # No volume mount - data is ephemeral
    tmpfs:
      - /data:size=512M,mode=1777
```

**Use Cases**:
- Application-level page/query cache
- Rate limiting counters
- Temporary data with TTL

### 7.2 Persistent Mode (Sessions/Queues)

For session storage and job queues where data should survive restarts:

```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --save "900 1" --save "300 10" --save "60 10000"
    volumes:
      - pmdl_redis_data:/data

volumes:
  pmdl_redis_data:
    driver: local
```

**Save Directives Explained**:

| Directive | Meaning |
|-----------|---------|
| `save 900 1` | Save if 1+ keys changed in 900 seconds (15 min) |
| `save 300 10` | Save if 10+ keys changed in 300 seconds (5 min) |
| `save 60 10000` | Save if 10000+ keys changed in 60 seconds |

### 7.3 Attached Volume Configuration

For cloud/VPS with block storage:

```yaml
volumes:
  pmdl_redis_data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/block-storage/redis
      o: bind
```

**Pre-requisites**:
1. Mount block storage to `/mnt/block-storage`
2. Create subdirectory: `mkdir -p /mnt/block-storage/redis`
3. Set ownership: `chown 999:999 /mnt/block-storage/redis`

### 7.4 Remote/S3 Considerations

Redis data volumes should NOT be stored on network filesystems due to:

- Latency sensitivity (sub-millisecond operations)
- Fsync requirements for RDB/AOF persistence
- Memory-mapped file considerations

**S3/MinIO is appropriate for**:
- RDB backup storage
- Disaster recovery copies

---

## 8. VPS Integration

### 8.1 Disk Provisioning Guidance

**Minimum Disk Requirements**:

| Mode | Container RAM | Disk Needed |
|------|---------------|-------------|
| Ephemeral | Any | 0 (tmpfs) |
| Persistent (256MB) | 256 MB | 1 GB |
| Persistent (1GB) | 1 GB | 3 GB |
| Persistent (2GB) | 2 GB | 6 GB |

**Formula**: Disk = (maxmemory * 2) + 500MB buffer

This accounts for RDB snapshots during BGSAVE (requires 2x memory for copy-on-write).

### 8.2 Swap Considerations

**Recommendation**: Disable swap for Redis

**Rationale**: Redis is an in-memory database. Swapping causes severe latency degradation and defeats the purpose of using Redis. If Redis needs to swap, you've undersized the container.

**Configuration**:

```yaml
services:
  redis:
    deploy:
      resources:
        limits:
          memory: 512M
    # Compose v3.8+ / Swarm only:
    # mem_swappiness: 0
```

**Host-Level** (if container option not available):

```bash
# Disable swap for the system
sudo swapoff -a

# Or set swappiness very low
echo 'vm.swappiness=1' | sudo tee -a /etc/sysctl.conf
```

### 8.3 Kernel Parameters

Recommended sysctl settings for Redis:

```bash
# /etc/sysctl.d/99-redis.conf

# Memory overcommit - Redis needs this for BGSAVE
vm.overcommit_memory = 1

# Increase TCP backlog for high-connection scenarios
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# Disable Transparent Huge Pages (Redis recommendation)
# Note: This is often done via kernel boot param or script
```

**Disable Transparent Huge Pages** (important for Redis performance):

```bash
# /etc/rc.local or systemd service
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag
```

### 8.4 Monitoring Hooks

**Key Metrics to Monitor**:

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| `used_memory` vs `maxmemory` | 80% | 95% |
| `connected_clients` | 80% of maxclients | 95% of maxclients |
| `blocked_clients` | >10 | >50 |
| `evicted_keys` | >0 (if unexpected) | N/A |
| `rejected_connections` | >0 | >10/min |
| `rdb_last_bgsave_status` | N/A | != ok |

**Prometheus Exporter**:

```yaml
services:
  redis-exporter:
    image: oliver006/redis_exporter:latest
    environment:
      REDIS_ADDR: "redis:6379"
      REDIS_PASSWORD_FILE: /run/secrets/redis_password
    secrets:
      - redis_password
    networks:
      - app-internal
      - monitoring
    ports:
      - "127.0.0.1:9121:9121"
```

**Built-in Monitoring Commands**:

```bash
# Memory usage
redis-cli INFO memory

# Connected clients
redis-cli INFO clients

# Persistence status
redis-cli INFO persistence

# Overall stats
redis-cli INFO stats
```

---

## 9. Compose Fragment

### 9.1 Complete Service Definition

Copy this entire block to your `docker-compose.yml`:

```yaml
# ==============================================================
# Redis 7 - Supporting Tech Profile
# ==============================================================
# Profile Version: 1.0
# Documentation: profiles/redis/PROFILE-SPEC.md
# ==============================================================

services:
  redis:
    image: redis:7-alpine
    container_name: pmdl_redis

    # Use init script for secrets-aware startup
    entrypoint: ["/bin/sh", "/init-scripts/01-init-redis.sh"]

    # Secrets configuration
    secrets:
      - redis_password

    # Volumes
    volumes:
      - pmdl_redis_data:/data
      - ./profiles/redis/init-scripts:/init-scripts:ro
      - ./profiles/redis/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro

    # Health check (secrets-compatible)
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s

    # Network isolation
    networks:
      - app-internal

    # Resource limits
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M

    # Restart policy
    restart: unless-stopped

    # Logging: Prevent unbounded log growth
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

# Secrets definitions
secrets:
  redis_password:
    file: ./secrets/redis_password

# Volumes
volumes:
  pmdl_redis_data:
    driver: local

# Networks (reference existing or define)
networks:
  app-internal:
    internal: true
    name: pmdl_app-internal
```

### 9.2 Ephemeral Cache Configuration (No Persistence)

For pure caching without persistence:

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: pmdl_redis
    command:
      - redis-server
      - --protected-mode
      - "no"
      - --maxmemory
      - "400mb"
      - --maxmemory-policy
      - "allkeys-lru"
      - --save
      - ""
      - --appendonly
      - "no"

    # Use tmpfs instead of volume
    tmpfs:
      - /data:size=512M,mode=1777

    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s

    networks:
      - app-internal

    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M

    restart: unless-stopped

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 9.3 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_PASSWORD_FILE` | No | - | Path to password file (via init script) |
| `maxmemory` | Recommended | No limit | Maximum memory usage |
| `maxmemory-policy` | Recommended | noeviction | Eviction policy when full |
| `maxclients` | No | 10000 | Maximum concurrent connections |
| `timeout` | No | 0 | Idle connection timeout (seconds) |

### 9.4 Secret Files Required

Generate these before starting:

```bash
# scripts/generate-secrets.sh additions

# Redis password (optional but recommended)
openssl rand -hex 24 > ./secrets/redis_password
chmod 600 ./secrets/redis_password
```

---

## 10. Troubleshooting

### Common Issues

#### Issue 1: Redis Rejects Connections with "NOAUTH"

**Symptoms**: Applications get "NOAUTH Authentication required" error

**Cause**: Redis has password protection but client isn't authenticating

**Solution**:
```bash
# Verify Redis has password set
docker exec pmdl_redis redis-cli CONFIG GET requirepass

# Test authentication
docker exec pmdl_redis redis-cli AUTH <password> PING

# Check application connection string includes password
# redis://:<password>@redis:6379/0
```

#### Issue 2: "OOM command not allowed when used memory > 'maxmemory'"

**Symptoms**: Write operations fail with OOM error

**Cause**: Redis hit maxmemory limit with `noeviction` policy

**Solution**:
```bash
# Check memory usage
docker exec pmdl_redis redis-cli INFO memory | grep used_memory_human

# Option 1: Increase maxmemory
docker exec pmdl_redis redis-cli CONFIG SET maxmemory 600mb

# Option 2: Change eviction policy (if cache, not sessions)
docker exec pmdl_redis redis-cli CONFIG SET maxmemory-policy allkeys-lru

# Option 3: Clear old keys manually
docker exec pmdl_redis redis-cli KEYS "cache:*" | xargs redis-cli DEL
```

#### Issue 3: BGSAVE Fails with "Can't save in background: fork: Cannot allocate memory"

**Symptoms**: RDB snapshots fail, logs show fork memory error

**Cause**: System doesn't allow memory overcommit needed for copy-on-write

**Solution**:
```bash
# Enable memory overcommit
sudo sysctl vm.overcommit_memory=1
echo 'vm.overcommit_memory = 1' | sudo tee -a /etc/sysctl.conf

# Or increase container memory limit to allow for fork overhead
```

#### Issue 4: High Latency on KEYS Command

**Symptoms**: Application hangs when running KEYS pattern

**Cause**: KEYS is O(N) and blocks Redis

**Solution**:
```bash
# Use SCAN instead of KEYS (non-blocking iterator)
docker exec pmdl_redis redis-cli SCAN 0 MATCH "pattern:*" COUNT 100

# Disable KEYS in production
# Add to redis command: --rename-command KEYS ""
```

#### Issue 5: Health Check Fails with Authentication

**Symptoms**: Container shows `unhealthy`, but Redis is running

**Cause**: Health check not using authentication

**Solution**: Use the healthcheck script that reads from secrets:
```yaml
healthcheck:
  test: ["CMD", "/healthcheck.sh"]
volumes:
  - ./profiles/redis/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro
```

### Log Analysis

**View logs**:
```bash
docker logs pmdl_redis --tail 100 -f
```

**Common log patterns**:

| Pattern | Meaning | Action |
|---------|---------|--------|
| `Ready to accept connections` | Successful startup | None |
| `WARNING: no config file specified` | Using defaults | Provide config or command args |
| `WARNING overcommit_memory is set to 0!` | Persistence may fail | Set vm.overcommit_memory=1 |
| `Background saving error` | RDB save failed | Check disk space, overcommit |
| `Client closed connection` | Normal disconnect | None unless excessive |
| `Max number of clients reached` | Connection limit hit | Increase maxclients |

---

## 11. References

### Official Documentation

- [Redis Documentation](https://redis.io/documentation)
- [Redis Docker Hub](https://hub.docker.com/_/redis)
- [Redis Configuration](https://redis.io/docs/management/config/)
- [Redis Persistence](https://redis.io/docs/management/persistence/)
- [Redis Security](https://redis.io/docs/management/security/)

### Foundation Decisions Referenced

| Decision | Relevance |
|----------|-----------|
| D3.1 Secret Management | File-based secrets pattern (via wrapper script) |
| D4.1 Health Checks | Timing parameters, YAML anchors |
| D4.2 Resource Constraints | Memory limits, profile budgets |
| D3.3 Network Isolation | Zone placement (app-internal) |
| D2.4 Backup Recovery | RDB backup tools, retention policy |
| D9 Storage Strategy | Volume configuration |
| D10 Resource Calculator | Redis sizing formula |

### Related Profiles

- **PostgreSQL**: Primary database that often uses Redis as cache layer
- **Authelia**: Authentication system that requires Redis for session storage
- **MongoDB**: Document store that may use Redis for query caching

### Related Services in Stack

| Service | Uses Redis For |
|---------|---------------|
| Authelia | Session storage, rate limiting |
| LibreChat | Session cache, rate limiting |
| Custom Apps | General caching, pub/sub |

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-12-31 | Initial creation | AI Agent |

---

*Profile Template Version: 1.0*
*Last Updated: 2025-12-31*
*Part of Peer Mesh Docker Lab*
