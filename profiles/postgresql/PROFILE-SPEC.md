# Supporting Tech Profile: PostgreSQL

**Version**: PostgreSQL 16.x with pgvector
**Image**: `pgvector/pgvector:pg16`
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

### What Is PostgreSQL?

PostgreSQL is an advanced open-source relational database known for its reliability, feature completeness, and extensibility. This profile uses the `pgvector/pgvector:pg16` image which includes the pgvector extension for vector similarity search, enabling AI/RAG applications.

### When to Use This Profile

Use this profile when your application needs:

- [x] ACID-compliant relational data storage
- [x] Complex queries with joins, transactions, and constraints
- [x] Vector embeddings for AI/RAG applications (via pgvector)
- [x] JSON/JSONB document storage with SQL queryability
- [x] Federation-compatible identity storage (Matrix Synapse)
- [x] Full-text search capabilities

### When NOT to Use This Profile

Do NOT use this profile if:

- [ ] You need simple key-value storage only (use Redis instead)
- [ ] Your data is purely document-oriented without relational needs (consider MongoDB)
- [ ] You are building a Ghost CMS deployment (Ghost requires MySQL)
- [ ] Vector dataset exceeds 10 million embeddings (consider dedicated vector DB)

### Comparison with Alternatives

| Feature | PostgreSQL | MySQL | MongoDB |
|---------|------------|-------|---------|
| Best for | Relational + vectors | Ghost CMS, WordPress | Document storage |
| Memory footprint | Medium-High | Medium | High |
| Scaling model | Read replicas | Read replicas | Sharding |
| Learning curve | Moderate | Easy | Easy |
| Vector support | Native (pgvector) | None | Atlas only |

**Recommendation**: Use PostgreSQL as your primary database when you need relational capabilities, complex queries, or vector similarity search. Add MySQL only if Ghost CMS is required.

---

## 2. Security Configuration

### 2.1 Non-Root Execution

PostgreSQL runs as the `postgres` user (UID 999) inside the container:

```yaml
services:
  postgres:
    # PostgreSQL image runs as postgres user by default (UID 999)
    # No explicit user: directive needed
```

**Note**: The official PostgreSQL images handle user permissions automatically. Data directories are owned by the postgres user inside the container.

### 2.2 Secrets via `_FILE` Suffix

All credentials MUST use file-based secrets, never environment variables with raw values.

**Supported Secret Variables**:

| Variable | `_FILE` Equivalent | Purpose |
|----------|-------------------|---------|
| `POSTGRES_PASSWORD` | `POSTGRES_PASSWORD_FILE` | Superuser password |
| App-specific passwords | Read in init scripts | Application database passwords |

**Compose Configuration**:

```yaml
services:
  postgres:
    secrets:
      - postgres_password
      - synapse_db_password
      - librechat_db_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      POSTGRES_USER: postgres
      POSTGRES_DB: postgres

secrets:
  postgres_password:
    file: ./secrets/postgres_password
  synapse_db_password:
    file: ./secrets/synapse_db_password
  librechat_db_password:
    file: ./secrets/librechat_db_password
```

### 2.3 Network Isolation

PostgreSQL should be placed in the `db-internal` network zone:

```yaml
services:
  postgres:
    networks:
      - db-internal
    # NOT exposed to frontend or internet networks
    # No ports: directive - internal only
```

**Network Zones** (per D3.3):

| Zone | Access Level | PostgreSQL |
|------|--------------|------------|
| `frontend` | Public-facing | No |
| `backend` | App-to-app | No |
| `db-internal` | Database only | Yes |
| `monitoring` | Metrics/logs | Optional (for exporters) |

### 2.4 Authentication Enforcement

**Default Authentication**: Enabled (password required)

PostgreSQL enforces authentication through:

1. `POSTGRES_PASSWORD_FILE` environment variable
2. pg_hba.conf default configuration (md5/scram-sha-256)

**Connection String Pattern**:

```
postgresql://[user]:[password]@postgres:5432/[database]
```

**pg_hba.conf Hardening** (optional, via custom config):

```
# Allow local socket connections without password
local   all             postgres                                peer
# Require password for all network connections
host    all             all             0.0.0.0/0               scram-sha-256
host    all             all             ::/0                    scram-sha-256
```

### 2.5 TLS/Encryption

**In-Transit Encryption**:

- [x] Native TLS support: Yes
- Configuration method: Mount certificates and configure `ssl_*` parameters

```yaml
command:
  - "postgres"
  - "-c"
  - "ssl=on"
  - "-c"
  - "ssl_cert_file=/certs/server.crt"
  - "-c"
  - "ssl_key_file=/certs/server.key"
```

**At-Rest Encryption**:

- [ ] Native encryption: No (use volume-level encryption)
- Recommendation: Use LUKS-encrypted volumes or cloud provider encryption

---

## 3. Performance Tuning

### 3.1 Memory Allocation

**Primary Memory Parameters**:

| Parameter | Purpose | Formula |
|-----------|---------|---------|
| `shared_buffers` | Dedicated cache for frequently accessed data | 25% of container limit |
| `effective_cache_size` | Planner hint for total cacheable memory | 70-75% of container limit |
| `work_mem` | Per-operation sort/hash memory | 4-16 MB (multiply by active queries) |
| `maintenance_work_mem` | VACUUM, CREATE INDEX operations | 64-256 MB |

**Formulas (from D10)**:

```
shared_buffers = MIN(container_memory_mb * 0.25, 2048)
effective_cache_size = container_memory_mb * 0.75
work_mem = 4 to 64 MB (default 32 MB for typical workloads)
maintenance_work_mem = MIN(container_memory_mb * 0.125, 256)
```

**Example Configurations**:

| Container RAM | shared_buffers | effective_cache_size | work_mem | maintenance_work_mem |
|---------------|----------------|----------------------|----------|---------------------|
| 1 GB | 256 MB | 768 MB | 4 MB | 64 MB |
| 2 GB | 512 MB | 1536 MB | 8 MB | 128 MB |
| 4 GB | 1024 MB | 3072 MB | 16 MB | 256 MB |
| 8 GB | 2048 MB | 6144 MB | 32 MB | 256 MB |

**Docker Compose Memory Limits**:

```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 1G
    shm_size: 256mb  # Required for PostgreSQL inter-process communication
```

### 3.2 Connection Limits

**Maximum Connections Formula**:

```
max_connections = concurrent_users * 2 + 10
```

**Factors**:
- Per-connection memory overhead: ~2 MB
- Connection pooling recommendation: Yes, via PgBouncer for >100 connections
- Timeout settings: `idle_in_transaction_session_timeout = 30min`

**Configuration**:

```yaml
command:
  - "postgres"
  - "-c"
  - "max_connections=100"
```

**Connection Limits by Profile**:

| Profile | Container | max_connections | Rationale |
|---------|-----------|-----------------|-----------|
| core | 1 GB | 50 | Conservative for memory |
| full | 2 GB | 100 | Standard production |
| large | 4+ GB | 200 | Heavy workloads |

### 3.3 I/O Optimization

**For SSDs (recommended)**:

```yaml
command:
  - "-c"
  - "random_page_cost=1.1"        # Lower for SSDs (default 4.0 is for HDDs)
  - "-c"
  - "effective_io_concurrency=200" # Higher for SSDs
```

**For HDDs**:

```yaml
command:
  - "-c"
  - "random_page_cost=4.0"        # Default
  - "-c"
  - "effective_io_concurrency=2"   # Lower for spinning disks
```

### 3.4 Query/Operation Optimization

**Autovacuum Tuning**:

```yaml
command:
  - "-c"
  - "autovacuum_vacuum_scale_factor=0.1"
  - "-c"
  - "autovacuum_analyze_scale_factor=0.05"
```

**Statement Statistics** (for monitoring):

```yaml
command:
  - "-c"
  - "shared_preload_libraries=pg_stat_statements"
  - "-c"
  - "pg_stat_statements.track=all"
```

---

## 4. Sizing Calculator

### 4.1 Input Variables

Collect these values before sizing:

| Variable | Description | How to Estimate |
|----------|-------------|-----------------|
| `DATA_SIZE_GB` | Expected data footprint | Existing DB size or schema analysis |
| `PEAK_CONNECTIONS` | Maximum concurrent connections | Concurrent users * 2 |
| `VECTOR_COUNT` | Number of vector embeddings | RAG document count |
| `VECTOR_DIMENSIONS` | Embedding dimensions | 1536 for OpenAI, 384 for sentence transformers |

### 4.2 Memory Calculation

```bash
#!/bin/bash
# PostgreSQL sizing calculator

DATA_SIZE_GB=${1:-5}
PEAK_CONNECTIONS=${2:-50}
VECTOR_COUNT=${3:-0}
VECTOR_DIMENSIONS=${4:-1536}

# Shared buffers: 25% of data size, capped at 2GB
SHARED_BUFFERS_MB=$(echo "$DATA_SIZE_GB * 256" | bc)
if [ "$SHARED_BUFFERS_MB" -gt 2048 ]; then
  SHARED_BUFFERS_MB=2048
fi

# Work memory pool estimate: 32MB * 10% of connections
WORK_MEM_POOL_MB=$(echo "32 * $PEAK_CONNECTIONS * 0.1" | bc | cut -d. -f1)

# Connection overhead: 2MB per connection
CONN_OVERHEAD_MB=$(echo "$PEAK_CONNECTIONS * 2" | bc)

# Base PostgreSQL overhead
BASE_MB=150

# Vector overhead (if using pgvector)
if [ "$VECTOR_COUNT" -gt 0 ]; then
  # Formula: (vector_count / 1000000) * dimensions * 4 bytes * 1.5 overhead
  VECTOR_MB=$(echo "$VECTOR_COUNT * $VECTOR_DIMENSIONS * 4 * 1.5 / 1024 / 1024" | bc)
else
  VECTOR_MB=0
fi

# Total PostgreSQL memory
TOTAL_MB=$(echo "$SHARED_BUFFERS_MB + $WORK_MEM_POOL_MB + $CONN_OVERHEAD_MB + $BASE_MB + $VECTOR_MB" | bc)

echo "=== PostgreSQL Sizing Results ==="
echo "Data Size: ${DATA_SIZE_GB} GB"
echo "Peak Connections: ${PEAK_CONNECTIONS}"
echo "Vector Count: ${VECTOR_COUNT}"
echo ""
echo "Memory Breakdown:"
echo "  shared_buffers:    ${SHARED_BUFFERS_MB} MB"
echo "  work_mem pool:     ${WORK_MEM_POOL_MB} MB"
echo "  Connection overhead: ${CONN_OVERHEAD_MB} MB"
echo "  Base overhead:     ${BASE_MB} MB"
echo "  Vector overhead:   ${VECTOR_MB} MB"
echo "  ─────────────────────"
echo "  TOTAL:             ${TOTAL_MB} MB"
echo ""
echo "Recommended container limit: $(echo "$TOTAL_MB * 1.2" | bc | cut -d. -f1) MB"
echo "shared_buffers setting: ${SHARED_BUFFERS_MB}MB"
echo "effective_cache_size: $(echo "$TOTAL_MB * 0.75" | bc | cut -d. -f1)MB"
```

### 4.3 Disk Calculation

```bash
# Disk space calculation

DATA_DISK_GB=$DATA_SIZE_GB

# Index overhead (typically 30-50% of data)
INDEX_OVERHEAD_GB=$(echo "$DATA_SIZE_GB * 0.4" | bc)

# WAL logs (2-4 GB minimum)
WAL_DISK_GB=4

# Backup space (at least 1x data for local dumps)
BACKUP_DISK_GB=$DATA_SIZE_GB

# Vector storage (if applicable)
if [ "$VECTOR_COUNT" -gt 0 ]; then
  # 6KB per vector for 1536 dimensions
  VECTOR_DISK_GB=$(echo "$VECTOR_COUNT * 6 / 1024 / 1024" | bc)
else
  VECTOR_DISK_GB=0
fi

TOTAL_DISK_GB=$(echo "$DATA_DISK_GB + $INDEX_OVERHEAD_GB + $WAL_DISK_GB + $BACKUP_DISK_GB + $VECTOR_DISK_GB" | bc)

echo "Disk Requirements:"
echo "  Data:    ${DATA_DISK_GB} GB"
echo "  Indexes: ${INDEX_OVERHEAD_GB} GB"
echo "  WAL:     ${WAL_DISK_GB} GB"
echo "  Backups: ${BACKUP_DISK_GB} GB"
echo "  Vectors: ${VECTOR_DISK_GB} GB"
echo "  ─────────────────────"
echo "  TOTAL:   ${TOTAL_DISK_GB} GB"
```

### 4.4 Quick Reference Table

| Workload | Data Size | Connections | Memory | Disk |
|----------|-----------|-------------|--------|------|
| Development | <1 GB | <10 | 512 MB | 10 GB |
| Small Production | 1-5 GB | 10-50 | 1 GB | 25 GB |
| Medium Production | 5-20 GB | 50-100 | 2 GB | 60 GB |
| Large Production | 20-50 GB | 100-200 | 4 GB | 150 GB |
| RAG/AI (100k vectors) | +600 MB | - | +1 GB | +1 GB |
| RAG/AI (1M vectors) | +6 GB | - | +10 GB | +10 GB |

---

## 5. Backup Strategy

### 5.1 Backup Method

**Primary Tool**: `pg_dump` / `pg_dumpall`

**Recommended Command**:

```bash
docker exec postgres pg_dumpall \
    -U postgres \
    --clean \
    --if-exists \
    | gzip > backup.sql.gz
```

**Per-Database Backup** (custom format for parallel restore):

```bash
docker exec postgres pg_dump \
    -U postgres \
    -d database_name \
    -Fc \
    --no-owner \
    --no-acl \
    > database.dump
```

**Options Explained**:

| Option | Purpose | Required |
|--------|---------|----------|
| `-Fc` | Custom format (parallel restore, compression) | Recommended |
| `--clean` | Include DROP statements before CREATE | Yes |
| `--if-exists` | Add IF EXISTS to DROP | Yes |
| `--no-owner` | Omit ownership commands | For portability |
| `--no-acl` | Omit permissions | For portability |

### 5.2 Backup Script (Secrets-Aware)

See `backup-scripts/backup.sh` for the complete implementation.

Key features:
- Reads passwords from `/run/secrets/` (never environment variables)
- Generates SHA-256 checksums
- Compresses output with gzip
- Atomic symlink update for "latest" pointer

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
# Using age encryption (per D3.1)
age -r age1publickey... backup.sql.gz > backup.sql.gz.age

# Verify encryption
file backup.sql.gz.age  # Should show "data" not "gzip"

# Decrypt
age -d -i ~/.config/age/key.txt backup.sql.gz.age > backup.sql.gz
```

### 5.5 Restore Procedure

See `backup-scripts/restore.sh` for the complete implementation.

**Quick Restore**:

```bash
# Verify backup integrity
gzip -t backup.sql.gz

# Restore all databases
gunzip -c backup.sql.gz | docker exec -i postgres psql -U postgres

# Restore single database (custom format)
docker exec -i postgres pg_restore \
    -U postgres \
    -d database_name \
    --clean \
    --if-exists \
    < database.dump
```

### 5.6 Restore Testing Procedure

Monthly restore testing (per D2.4):

```bash
# 1. Create temporary container
docker run -d --name postgres-restore-test \
    -e POSTGRES_PASSWORD=test \
    pgvector/pgvector:pg16

# 2. Wait for container to be ready
sleep 30

# 3. Restore backup to temp container
gunzip -c backup.sql.gz | docker exec -i postgres-restore-test psql -U postgres

# 4. Run verification queries
docker exec postgres-restore-test psql -U postgres -c "SELECT count(*) FROM pg_database;"

# 5. Cleanup
docker rm -f postgres-restore-test
```

### 5.7 WAL Archiving (Optional PITR)

For point-in-time recovery capability:

```yaml
command:
  - "postgres"
  - "-c"
  - "archive_mode=on"
  - "-c"
  - "archive_command=cp %p /var/lib/postgresql/wal_archive/%f"
  - "-c"
  - "wal_level=replica"
volumes:
  - postgres_wal:/var/lib/postgresql/wal_archive
```

**Note**: WAL archiving adds complexity and disk usage. Only enable if RPO < 24 hours is required.

---

## 6. Startup & Health

### 6.1 Healthcheck Configuration

**CRITICAL**: Health checks must work with `_FILE` secrets. They CANNOT rely on environment variables like `$POSTGRES_PASSWORD` because the password is not set as an environment variable when using `_FILE` suffix.

**Recommended Approach**: Use `pg_isready` which does not require authentication.

```yaml
services:
  postgres:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s
```

### 6.2 Healthcheck Script (Secrets-Aware)

For enhanced health checks that verify pgvector extension:

```yaml
services:
  postgres:
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s
    volumes:
      - ./profiles/postgresql/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro
```

See `healthcheck-scripts/healthcheck.sh` for the complete implementation.

### 6.3 depends_on Pattern

```yaml
services:
  app:
    depends_on:
      postgres:
        condition: service_healthy
```

### 6.4 Init Scripts (Secrets-Aware)

Init scripts that create users or databases MUST read secrets from files:

```bash
#!/bin/bash
# Read secrets from mounted files, NEVER hardcode
APP_PASSWORD=$(cat /run/secrets/app_db_password)

# Create application user and database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER appuser WITH PASSWORD '$APP_PASSWORD';
    CREATE DATABASE appdb OWNER appuser;
EOSQL
```

See `init-scripts/01-init-databases.sh` for the complete implementation.

**NEVER DO THIS**:

```bash
# WRONG - Hardcoded password
CREATE USER appuser WITH PASSWORD 'CHANGEME_password123';
```

### 6.5 Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `interval` | 10s | Database critical path, frequent checks |
| `timeout` | 5s | pg_isready is fast (<100ms typical) |
| `retries` | 5 | Allow recovery from transient issues |
| `start_period` | 60s | Account for init scripts, extensions |

---

## 7. Storage Options

### 7.1 Local Disk Configuration

For development and simple deployments:

```yaml
services:
  postgres:
    volumes:
      - pmdl_postgres_data:/var/lib/postgresql/data

volumes:
  pmdl_postgres_data:
    driver: local
```

**Directory Permissions** (if using bind mounts):

```bash
mkdir -p ./data/postgres
chown 999:999 ./data/postgres  # UID/GID of postgres user
chmod 700 ./data/postgres
```

### 7.2 Attached Volume Configuration

For cloud/VPS with block storage:

```yaml
volumes:
  pmdl_postgres_data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/block-storage/postgres
      o: bind
```

**Pre-requisites**:
1. Mount block storage to `/mnt/block-storage`
2. Create subdirectory: `mkdir -p /mnt/block-storage/postgres`
3. Set ownership: `chown 999:999 /mnt/block-storage/postgres`

### 7.3 Remote/S3 Considerations

PostgreSQL data volumes should NOT be stored on network filesystems like S3/MinIO for primary data due to:

- POSIX filesystem requirements (fsync, locking)
- Latency sensitivity for transaction commits
- WAL requirements for crash recovery

**S3 is appropriate for**:
- Backups (via rclone)
- Archived WAL segments
- Logical dump storage

### 7.4 Volume Backup Procedure

```bash
# Stop service before volume backup
docker compose stop postgres

# Backup volume
docker run --rm \
    -v pmdl_postgres_data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine tar czf /backup/volume-postgres-$(date +%Y%m%d).tar.gz /data

# Restart service
docker compose start postgres
```

**Note**: Volume backups require service downtime. Prefer logical backups (pg_dump) for zero-downtime backups.

---

## 8. VPS Integration

### 8.1 Disk Provisioning Guidance

**Minimum Disk Requirements**:

| Workload | Data Disk | System Disk | Total |
|----------|-----------|-------------|-------|
| Development | 10 GB | 20 GB | 30 GB |
| Small Prod | 50 GB | 20 GB | 70 GB |
| Medium Prod | 200 GB | 20 GB | 220 GB |

**VPS Provider Notes**:

- **DigitalOcean**: Use block storage volumes for data, attach before deployment
- **Hetzner**: Cloud volumes or local NVMe (faster but tied to instance)
- **Vultr**: Block storage recommended for production

### 8.2 Swap Considerations

**Recommendation**: Enable small swap as safety net, but tune PostgreSQL to avoid using it

**Rationale**: PostgreSQL performance degrades severely when swapping. Proper memory sizing should prevent swap usage. Small swap (1-2GB) protects against OOM kills during unexpected peaks.

**Configuration**:

```bash
# Create small swap as safety net
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Discourage swap usage
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

**Container Configuration**:

```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          memory: 2G
    # Disable swap for database containers
    # mem_swappiness: 0  # Compose v3.8+ / Swarm only
```

### 8.3 Kernel Parameters

Recommended sysctl settings for PostgreSQL:

```bash
# /etc/sysctl.d/99-postgresql.conf

# Increase shared memory limits
kernel.shmmax = 17179869184
kernel.shmall = 4194304

# Virtual memory settings
vm.swappiness = 10
vm.overcommit_memory = 2
vm.overcommit_ratio = 80

# Dirty page settings for write-heavy workloads
vm.dirty_ratio = 40
vm.dirty_background_ratio = 10

# Network settings for high-connection scenarios
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
```

### 8.4 Monitoring Hooks

**Key Metrics to Monitor**:

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| Connection count | 80% of max | 95% of max |
| Cache hit ratio | <95% | <90% |
| Transaction rate | Baseline +50% | Baseline +100% |
| Replication lag | >10s | >60s |
| Disk usage | 70% | 85% |
| Memory usage | 80% | 95% |

**Prometheus Exporter**:

```yaml
services:
  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    environment:
      DATA_SOURCE_URI: "postgres:5432/postgres?sslmode=disable"
      DATA_SOURCE_USER: postgres
      DATA_SOURCE_PASS_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password
    networks:
      - db-internal
      - monitoring
    ports:
      - "127.0.0.1:9187:9187"
```

**pg_stat_statements Integration**:

```sql
-- Enable statistics tracking
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- View slow queries
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

---

## 9. Compose Fragment

### 9.1 Complete Service Definition

Copy this entire block to your `docker-compose.yml`:

```yaml
# ==============================================================
# PostgreSQL 16 with pgvector - Supporting Tech Profile
# ==============================================================
# Profile Version: 1.0
# Documentation: profiles/postgresql/PROFILE-SPEC.md
# ==============================================================

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: pmdl_postgres

    # Secrets configuration
    secrets:
      - postgres_password
      - synapse_db_password
      - librechat_db_password

    # Environment (using _FILE suffix for secrets)
    environment:
      POSTGRES_USER: postgres
      POSTGRES_DB: postgres
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      POSTGRES_INITDB_ARGS: "--encoding=UTF8"

    # Performance tuning via command line
    command:
      - "postgres"
      - "-c"
      - "shared_buffers=512MB"
      - "-c"
      - "effective_cache_size=1536MB"
      - "-c"
      - "work_mem=8MB"
      - "-c"
      - "maintenance_work_mem=128MB"
      - "-c"
      - "max_connections=100"
      - "-c"
      - "random_page_cost=1.1"
      - "-c"
      - "effective_io_concurrency=200"
      - "-c"
      - "max_parallel_maintenance_workers=2"

    # Volumes
    volumes:
      - pmdl_postgres_data:/var/lib/postgresql/data
      - ./profiles/postgresql/init-scripts:/docker-entrypoint-initdb.d:ro
      - ./profiles/postgresql/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro

    # Shared memory for PostgreSQL
    shm_size: 256mb

    # Health check (secrets-compatible)
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s

    # Network isolation
    networks:
      - db-internal

    # Resource limits
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 1G

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
  postgres_password:
    file: ./secrets/postgres_password
  synapse_db_password:
    file: ./secrets/synapse_db_password
  librechat_db_password:
    file: ./secrets/librechat_db_password

# Volumes
volumes:
  pmdl_postgres_data:
    driver: local

# Networks (reference existing or define)
networks:
  db-internal:
    internal: true
    name: pmdl_db-internal
```

### 9.2 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_PASSWORD_FILE` | Yes | - | Path to superuser password file |
| `POSTGRES_USER` | No | postgres | Superuser username |
| `POSTGRES_DB` | No | postgres | Default database name |
| `POSTGRES_INITDB_ARGS` | No | - | Arguments passed to initdb |

### 9.3 Secret Files Required

Generate these before starting:

```bash
# scripts/generate-secrets.sh additions

# PostgreSQL superuser password
openssl rand -hex 24 > ./secrets/postgres_password
chmod 600 ./secrets/postgres_password

# Application database passwords
openssl rand -hex 24 > ./secrets/synapse_db_password
openssl rand -hex 24 > ./secrets/librechat_db_password
chmod 600 ./secrets/synapse_db_password ./secrets/librechat_db_password
```

---

## 10. Troubleshooting

### Common Issues

#### Issue 1: Container Exits Immediately After Start

**Symptoms**: PostgreSQL container starts and immediately exits with code 1

**Cause**: Missing or incorrect `POSTGRES_PASSWORD` / `POSTGRES_PASSWORD_FILE`

**Solution**:
```bash
# Check if secrets exist
ls -la ./secrets/postgres_password

# Check if secret is properly mounted
docker exec postgres cat /run/secrets/postgres_password

# Check logs for specific error
docker logs postgres
```

#### Issue 2: Health Check Fails with `_FILE` Secrets

**Symptoms**: Container shows `unhealthy`, logs show authentication errors

**Cause**: Health check trying to use `$POSTGRES_PASSWORD` which doesn't exist when using `_FILE` suffix

**Solution**: Use `pg_isready` which doesn't require authentication:
```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U postgres"]
```

#### Issue 3: Permission Denied on Data Directory

**Symptoms**: Container fails to start, logs show permission errors on `/var/lib/postgresql/data`

**Cause**: Volume directory not owned by postgres user (UID 999)

**Solution**:
```bash
# For bind mounts
chown 999:999 ./data/postgres

# For named volumes, recreate
docker volume rm pmdl_postgres_data
docker compose up -d postgres
```

#### Issue 4: Out of Shared Memory

**Symptoms**: Queries fail with "could not resize shared memory segment"

**Cause**: Docker `shm_size` not set or too small

**Solution**:
```yaml
services:
  postgres:
    shm_size: 256mb  # Increase if needed
```

#### Issue 5: pgvector Extension Not Available

**Symptoms**: `CREATE EXTENSION vector` fails with "could not open extension control file"

**Cause**: Using official `postgres:16` image instead of `pgvector/pgvector:pg16`

**Solution**: Update image to `pgvector/pgvector:pg16`

#### Issue 6: Init Scripts Not Running

**Symptoms**: Databases/users not created despite init scripts being present

**Cause**: Init scripts only run on empty data volume. Existing data prevents re-execution.

**Solution**:
```bash
# For fresh initialization, remove data volume
docker compose down
docker volume rm pmdl_postgres_data
docker compose up -d postgres

# Or run scripts manually
docker exec -i postgres psql -U postgres < ./init-scripts/01-init-databases.sh
```

### Log Analysis

**View logs**:
```bash
docker logs pmdl_postgres --tail 100 -f
```

**Common log patterns**:

| Pattern | Meaning | Action |
|---------|---------|--------|
| `database system is ready` | Successful startup | None |
| `FATAL: password authentication failed` | Wrong credentials | Check secrets |
| `could not resize shared memory` | shm_size too small | Increase shm_size |
| `too many connections` | max_connections exceeded | Increase limit or add pooling |
| `checkpoints are occurring too frequently` | Heavy write load | Tune checkpoint settings |

---

## 11. References

### Official Documentation

- [PostgreSQL 16 Documentation](https://www.postgresql.org/docs/16/)
- [pgvector GitHub Repository](https://github.com/pgvector/pgvector)
- [pgvector Docker Hub](https://hub.docker.com/r/pgvector/pgvector)
- [Docker PostgreSQL Image](https://hub.docker.com/_/postgres)

### Foundation Decisions Referenced

| Decision | Relevance |
|----------|-----------|
| D3.1 Secret Management | File-based secrets pattern |
| D4.1 Health Checks | Timing parameters, YAML anchors |
| D4.2 Resource Constraints | Memory limits, profile budgets |
| D3.3 Network Isolation | Zone placement (db-internal) |
| D2.4 Backup Recovery | Dump tools, retention policy |
| D9 Storage Strategy | Volume configuration |
| D10 Resource Calculator | Sizing formulas |
| D2.1 Database Selection | PostgreSQL image selection |
| D2.2 Database Memory | Buffer pool sizing |
| D2.3 Database Init | Init script patterns |
| D2.6 PostgreSQL Extensions | pgvector configuration |

### Related Profiles

- **MySQL**: Alternative for Ghost CMS (PostgreSQL not supported)
- **MongoDB**: Complement for LibreChat conversation storage
- **Redis**: Cache layer that often pairs with PostgreSQL

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-12-31 | Initial creation | AI Agent |

---

*Profile Template Version: 1.0*
*Last Updated: 2025-12-31*
*Part of PeerMesh Core*
