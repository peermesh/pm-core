# Supporting Tech Profile: MySQL

**Version**: 8.0
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

### What Is MySQL?

MySQL is a widely-deployed open-source relational database management system. In this project, MySQL 8.0 is used exclusively for applications that require it, most notably Ghost CMS which dropped PostgreSQL support in version 1.0 and officially supports only MySQL 8 for production deployments.

### When to Use This Profile

Use this profile when your application needs:

- [x] Ghost CMS or other applications requiring MySQL specifically
- [x] WordPress, Drupal, or other PHP-based CMS platforms
- [x] Legacy applications with MySQL schema dependencies
- [x] Applications using MySQL-specific features (FULLTEXT indexes, stored procedures)

### When NOT to Use This Profile

Do NOT use this profile if:

- [x] Your application supports PostgreSQL - prefer PostgreSQL for its richer feature set
- [x] You need pgvector for vector embeddings - use PostgreSQL profile instead
- [x] Your application is new development with no database preference - choose PostgreSQL

### Comparison with Alternatives

| Feature | MySQL 8.0 | PostgreSQL 16 | MariaDB 11 |
|---------|-----------|---------------|------------|
| Best for | Ghost CMS, WordPress | Matrix Synapse, pgvector apps | MySQL alternative |
| Memory footprint | Medium-High | Medium | Medium |
| Scaling model | Read replicas | Read replicas + pgvector | Read replicas |
| Learning curve | Low | Medium | Low |
| JSON support | Good | Excellent | Good |

**Recommendation**: Use MySQL only when the target application explicitly requires it. For new projects with database flexibility, prefer PostgreSQL.

---

## 2. Security Configuration

### 2.1 Non-Root Execution

MySQL 8.0 official images run as the `mysql` user (UID 999, GID 999) by default. No additional configuration required:

```yaml
services:
  mysql:
    image: mysql:8.0
    # Runs as mysql user (999:999) by default
```

**Note**: If using bind mounts, ensure the host directory is owned by UID 999 or is world-writable (not recommended for production).

### 2.2 Secrets via `_FILE` Suffix

All credentials MUST use file-based secrets, never environment variables with raw values.

**Supported Secret Variables**:

| Variable | `_FILE` Equivalent | Purpose |
|----------|-------------------|---------|
| `MYSQL_ROOT_PASSWORD` | `MYSQL_ROOT_PASSWORD_FILE` | Root user password |
| `MYSQL_PASSWORD` | `MYSQL_PASSWORD_FILE` | Application user password |
| `MYSQL_USER` | N/A (not sensitive) | Application username |
| `MYSQL_DATABASE` | N/A (not sensitive) | Default database name |

**Compose Configuration**:

```yaml
services:
  mysql:
    secrets:
      - mysql_root_password
      - mysql_app_password
    environment:
      MYSQL_ROOT_PASSWORD_FILE: /run/secrets/mysql_root_password
      MYSQL_DATABASE: app_database
      MYSQL_USER: app_user
      MYSQL_PASSWORD_FILE: /run/secrets/mysql_app_password

secrets:
  mysql_root_password:
    file: ./secrets/mysql_root_password
  mysql_app_password:
    file: ./secrets/mysql_app_password
```

### 2.3 Network Isolation

MySQL should be placed in the `db-internal` network zone only:

```yaml
services:
  mysql:
    networks:
      - db-internal
      # NOT exposed to frontend or internet networks
```

**Network Zones** (per D3.3):

| Zone | Access Level | MySQL |
|------|--------------|-------|
| `frontend` | Public-facing | No |
| `backend` | App-to-app | No |
| `db-internal` | Database only | Yes |
| `monitoring` | Metrics/logs | Optional |

### 2.4 Authentication Enforcement

**Default Authentication**: Enabled - MySQL 8.0 uses `caching_sha2_password` by default.

**Required Configuration**:

```yaml
command:
  # Skip symbolic-links to prevent symlink attacks
  - "--skip-symbolic-links"
  # Restrict file operations to secure directory
  - "--secure-file-priv=/var/lib/mysql-files"
```

**Connection String Pattern**:

```
mysql://[user]:[password]@[host]:3306/[database]
```

### 2.5 TLS/Encryption

**In-Transit Encryption**:

- [x] Native TLS support: Yes (MySQL 8.0 generates self-signed certs by default)
- [x] Configuration method: `--require-secure-transport` for enforcement

**At-Rest Encryption**:

- [ ] Native encryption: Available (InnoDB tablespace encryption) but complex to configure
- [x] Recommendation: Use volume encryption for simpler deployment

---

## 3. Performance Tuning

### 3.1 Memory Allocation

**Primary Memory Parameter**: `innodb_buffer_pool_size`

**Formula** (per D10 Resource Calculator):

```
innodb_buffer_pool_size = MIN(data_size_mb * 0.70, container_limit * 0.70)
```

The InnoDB buffer pool should be 65-70% of the container memory limit, with remaining memory reserved for:
- Per-connection overhead (~10MB per connection)
- Query buffers and temporary tables
- OS operations within container

**Example Configurations**:

| Container RAM | innodb_buffer_pool_size | max_connections | performance_schema |
|---------------|-------------------------|-----------------|-------------------|
| 512 MB | 384 MB (75%) | 30 | OFF |
| 1 GB | 700 MB (70%) | 40 | OFF |
| 1.5 GB | 1024 MB (68%) | 50 | OFF |
| 2 GB | 1400 MB (70%) | 75 | Optional |
| 4 GB | 2800 MB (70%) | 100 | ON |

**Docker Compose Memory Limits**:

```yaml
services:
  mysql:
    deploy:
      resources:
        limits:
          memory: 1536M
        reservations:
          memory: 768M
```

### 3.2 Connection Limits

**Maximum Connections Formula**:

```
max_connections = concurrent_users * 2 + 20
```

**Factors**:
- Per-connection memory overhead: ~10 MB (thread stack, buffers, session state)
- Connection pooling recommendation: Yes, Ghost uses internal connection pooling
- Timeout settings: `wait_timeout=28800` (8 hours default)

**Configuration**:

```yaml
command:
  - "--max-connections=50"
```

### 3.3 I/O Optimization

**InnoDB Flush Settings**:

```yaml
command:
  # For SSDs (recommended for most VPS)
  - "--innodb-flush-log-at-trx-commit=2"  # Flush to OS buffer on commit, fsync once/second
  - "--innodb-flush-method=O_DIRECT"       # Bypass OS cache for data files (SSD)

  # Disable binary logging for single-node
  - "--skip-log-bin"
```

**innodb_flush_log_at_trx_commit values**:
- `1`: Full ACID (fsync every commit) - safest, slowest
- `2`: Flush to OS buffer per commit, fsync once per second - balanced
- `0`: Flush once per second only - fastest, up to 1 second data loss risk

**Recommendation**: Value `2` for blog/CMS workloads where 1-second potential data loss on OS crash is acceptable.

### 3.4 Query/Operation Optimization

**Disable Performance Schema** (saves ~400MB):

```yaml
command:
  - "--performance-schema=OFF"
```

**Why disable**:
- Ghost CMS does not require MySQL performance instrumentation
- Monitoring handled externally (Prometheus/Grafana if enabled)
- Significant memory savings on constrained VPS
- Re-enable temporarily with `--performance-schema=ON` for debugging

**Slow Query Log** (for debugging):

```yaml
command:
  - "--slow-query-log=ON"
  - "--slow-query-log-file=/var/lib/mysql/slow.log"
  - "--long-query-time=2"  # Log queries taking > 2 seconds
```

---

## 4. Sizing Calculator

### 4.1 Input Variables

Collect these values before sizing:

| Variable | Description | How to Estimate |
|----------|-------------|-----------------|
| `DATA_SIZE_GB` | Expected database size | Ghost: ~100MB per 1000 posts |
| `PEAK_CONNECTIONS` | Maximum concurrent connections | Ghost: concurrent_users * 2 |
| `WRITE_PERCENTAGE` | % of writes vs reads | Ghost: ~20% writes, 80% reads |

### 4.2 Memory Calculation

```bash
#!/bin/bash
# sizing-calculator-mysql.sh

DATA_SIZE_GB=${1:-2}
PEAK_CONNECTIONS=${2:-30}

# InnoDB buffer pool: 70% of data or 70% of max container
# For container sizing, use data-based calculation
BUFFER_POOL_MB=$(echo "$DATA_SIZE_GB * 1024 * 0.70" | bc)

# Cap at reasonable maximums
if (( $(echo "$BUFFER_POOL_MB > 4096" | bc -l) )); then
    BUFFER_POOL_MB=4096
fi

# Per-connection overhead
CONNECTION_OVERHEAD_MB=$(echo "$PEAK_CONNECTIONS * 10" | bc)

# Base MySQL overhead (without performance_schema)
BASE_OVERHEAD_MB=150

# Total recommended container memory
TOTAL_MB=$(echo "$BUFFER_POOL_MB + $CONNECTION_OVERHEAD_MB + $BASE_OVERHEAD_MB" | bc)

# Add 20% headroom for container limit
CONTAINER_LIMIT_MB=$(echo "$TOTAL_MB * 1.2" | bc | cut -d'.' -f1)

echo "=== MySQL Sizing Results ==="
echo "Data Size: ${DATA_SIZE_GB} GB"
echo "Peak Connections: ${PEAK_CONNECTIONS}"
echo ""
echo "Memory Breakdown:"
echo "  InnoDB Buffer Pool: ${BUFFER_POOL_MB} MB"
echo "  Connection Overhead: ${CONNECTION_OVERHEAD_MB} MB"
echo "  Base Overhead:       ${BASE_OVERHEAD_MB} MB"
echo "  ─────────────────────"
echo "  Minimum Required:    ${TOTAL_MB} MB"
echo ""
echo "Docker Container Limit: ${CONTAINER_LIMIT_MB}m"
echo "innodb_buffer_pool_size: ${BUFFER_POOL_MB}M"
```

### 4.3 Disk Calculation

```bash
# Disk space calculation for MySQL

DATA_DISK_GB=$DATA_SIZE_GB

# InnoDB log files (typically 2 x 50MB by default)
LOG_DISK_GB=0.5

# Temporary tables headroom
TEMP_DISK_GB=1

# Backup space (at least 1x data for local dumps)
BACKUP_DISK_GB=$DATA_SIZE_GB

# Total
TOTAL_DISK_GB=$(echo "$DATA_DISK_GB + $LOG_DISK_GB + $TEMP_DISK_GB + $BACKUP_DISK_GB" | bc)

echo "Disk Requirements:"
echo "  Data:     ${DATA_DISK_GB} GB"
echo "  Logs:     ${LOG_DISK_GB} GB"
echo "  Temp:     ${TEMP_DISK_GB} GB"
echo "  Backups:  ${BACKUP_DISK_GB} GB"
echo "  ─────────────────────"
echo "  TOTAL:    ${TOTAL_DISK_GB} GB"
```

### 4.4 Quick Reference Table

| Workload | Data Size | Connections | Memory | Disk |
|----------|-----------|-------------|--------|------|
| Development | <500 MB | <10 | 512 MB | 5 GB |
| Small Blog (Ghost) | 500MB-2 GB | 10-30 | 768 MB | 10 GB |
| Medium Production | 2-10 GB | 30-50 | 1.5 GB | 30 GB |
| Large Production | 10-50 GB | 50-100 | 4 GB | 100 GB |

---

## 5. Backup Strategy

### 5.1 Backup Method

**Primary Tool**: `mysqldump`

**Recommended Command**:

```bash
docker exec mysql mysqldump \
    -u root \
    -p"$(cat /run/secrets/mysql_root_password)" \
    --all-databases \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    | gzip > backup.sql.gz
```

**Options Explained**:

| Option | Purpose | Required |
|--------|---------|----------|
| `--single-transaction` | Consistent snapshot without locking (InnoDB) | Yes |
| `--routines` | Include stored procedures | Yes |
| `--triggers` | Include triggers | Yes |
| `--events` | Include scheduled events | Yes |
| `--all-databases` | Backup all databases including system | Yes |

### 5.2 Backup Script (Secrets-Aware)

See `backup-scripts/backup.sh` in this profile directory.

```bash
#!/bin/bash
# backup-scripts/backup.sh
set -euo pipefail

# Configuration
CONTAINER_NAME="${CONTAINER_NAME:-mysql}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mysql}"
SECRET_FILE="${SECRET_FILE:-./secrets/mysql_root_password}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# Read secret from file (NEVER from environment variable)
if [[ ! -f "$SECRET_FILE" ]]; then
    echo "ERROR: Secret file not found: $SECRET_FILE"
    exit 1
fi
PASSWORD=$(cat "$SECRET_FILE")

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Execute backup with --single-transaction for consistent snapshot
echo "Starting MySQL backup..."
docker exec "$CONTAINER_NAME" mysqldump \
    -u root \
    -p"$PASSWORD" \
    --all-databases \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    2>/dev/null \
    | gzip > "$BACKUP_DIR/mysql-$TIMESTAMP.sql.gz"

# Generate checksum
sha256sum "$BACKUP_DIR/mysql-$TIMESTAMP.sql.gz" > "$BACKUP_DIR/mysql-$TIMESTAMP.sql.gz.sha256"

# Verify backup integrity
gzip -t "$BACKUP_DIR/mysql-$TIMESTAMP.sql.gz" || {
    echo "ERROR: Backup file is corrupt!"
    exit 1
}

# Update latest symlink
ln -sf "mysql-$TIMESTAMP.sql.gz" "$BACKUP_DIR/latest.sql.gz"

echo "Backup complete: $BACKUP_DIR/mysql-$TIMESTAMP.sql.gz"
echo "Size: $(du -h "$BACKUP_DIR/mysql-$TIMESTAMP.sql.gz" | cut -f1)"
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
# Using age encryption (per D3.1)
age -r age1publickey... mysql-backup.sql.gz > mysql-backup.sql.gz.age

# Using rclone crypt for automatic encryption during sync
rclone sync ./backups/ encrypted-remote:mysql-backups/
```

### 5.5 Restore Procedure

See `backup-scripts/restore.sh` in this profile directory.

```bash
#!/bin/bash
# backup-scripts/restore.sh
set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-mysql}"
SECRET_FILE="${SECRET_FILE:-./secrets/mysql_root_password}"

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: $0 <backup_file.sql.gz>"
    echo "Available backups:"
    ls -lt /var/backups/mysql/*.sql.gz 2>/dev/null | head -10 || echo "No backups found"
    exit 1
fi

# Verify backup integrity
echo "Verifying backup integrity..."
gzip -t "$BACKUP_FILE" || { echo "Backup file is corrupt!"; exit 1; }

# Verify checksum if available
if [[ -f "$BACKUP_FILE.sha256" ]]; then
    sha256sum -c "$BACKUP_FILE.sha256" || { echo "Checksum mismatch!"; exit 1; }
fi

# Read secret from file
PASSWORD=$(cat "$SECRET_FILE")

echo ""
echo "WARNING: This will overwrite existing databases!"
echo "Backup file: $BACKUP_FILE"
read -p "Type 'RESTORE' to confirm: " confirm
[[ "$confirm" == "RESTORE" ]] || { echo "Aborted."; exit 1; }

# Execute restore
echo "Restoring from backup..."
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" mysql \
    -u root \
    -p"$PASSWORD"

echo "Restore complete."
echo "Verify with: docker exec $CONTAINER_NAME mysql -u root -p -e 'SHOW DATABASES;'"
```

### 5.6 Restore Testing Procedure

Monthly restore testing (per D2.4):

```bash
#!/bin/bash
# backup-scripts/test-restore.sh

# 1. Create temporary container for testing
docker run -d --name mysql-restore-test \
    -e MYSQL_ROOT_PASSWORD=test_restore_password \
    mysql:8.0

# 2. Wait for container to be ready
echo "Waiting for MySQL to start..."
sleep 30

# 3. Restore backup to temp container
LATEST_BACKUP=$(ls -t /var/backups/mysql/*.sql.gz | head -1)
gunzip -c "$LATEST_BACKUP" | docker exec -i mysql-restore-test mysql -u root -ptest_restore_password

# 4. Run verification queries
docker exec mysql-restore-test mysql -u root -ptest_restore_password -e "SHOW DATABASES;"
docker exec mysql-restore-test mysql -u root -ptest_restore_password -e "SELECT COUNT(*) FROM ghost.posts;" 2>/dev/null || echo "Ghost tables verified"

# 5. Cleanup
docker rm -f mysql-restore-test

echo "Restore test passed."
```

---

## 6. Startup & Health

### 6.1 Healthcheck Configuration

**CRITICAL**: Health checks must work with `_FILE` secrets. They CANNOT rely on environment variables like `$MYSQL_PASSWORD` because those don't exist when using `_FILE` suffix.

**Recommended Approach**: Use socket-based ping (no password required) or a wrapper script.

```yaml
services:
  mysql:
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s
    volumes:
      - ./profiles/mysql/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro
```

### 6.2 Healthcheck Script (Secrets-Aware)

See `healthcheck-scripts/healthcheck.sh` in this profile directory.

**Option A: Socket-based ping (Recommended - no password needed)**

```bash
#!/bin/bash
# healthcheck-scripts/healthcheck.sh
# Socket-based healthcheck - works without password

# Use mysqladmin ping via socket (no auth required for localhost socket)
mysqladmin ping -h localhost --silent || exit 1

exit 0
```

**Option B: Query-based check with secrets file**

```bash
#!/bin/bash
# healthcheck-scripts/healthcheck.sh
# Query-based healthcheck reading password from secrets

# Read password from secret file (NOT environment variable)
if [[ -f /run/secrets/mysql_root_password ]]; then
    PASSWORD=$(cat /run/secrets/mysql_root_password)
    mysql -h localhost -u root -p"$PASSWORD" -e "SELECT 1" --silent || exit 1
else
    # Fallback to socket-based check
    mysqladmin ping -h localhost --silent || exit 1
fi

exit 0
```

**Why not use `${MYSQL_PASSWORD}` in healthcheck**:
- When using `MYSQL_PASSWORD_FILE`, the `MYSQL_PASSWORD` environment variable is NOT set
- Health checks using `$MYSQL_PASSWORD` will fail with authentication errors
- Socket-based `mysqladmin ping` or reading from secrets file are the only reliable options

### 6.3 depends_on Pattern

```yaml
services:
  ghost:
    depends_on:
      mysql:
        condition: service_healthy
```

### 6.4 Init Scripts (Secrets-Aware)

Init scripts that create users or databases MUST read secrets from files:

See `init-scripts/01-init-databases.sh` in this profile directory.

```bash
#!/bin/bash
# init-scripts/01-init-databases.sh
# Runs on first container start with empty data volume

set -e

# Note: For Ghost, the database and user are created automatically via
# MYSQL_DATABASE, MYSQL_USER, and MYSQL_PASSWORD_FILE environment variables
# This script is for additional databases/users if needed

# Read passwords from mounted secrets
if [[ -f /run/secrets/app_db_password ]]; then
    APP_PASSWORD=$(cat /run/secrets/app_db_password)
else
    echo "WARNING: /run/secrets/app_db_password not found, skipping additional user creation"
    exit 0
fi

# Example: Create additional application database and user
mysql -u root -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
    -- Create additional database if needed
    CREATE DATABASE IF NOT EXISTS app_extra;

    -- Create additional user with secrets-based password
    CREATE USER IF NOT EXISTS 'app_extra'@'%' IDENTIFIED BY '${APP_PASSWORD}';
    GRANT ALL PRIVILEGES ON app_extra.* TO 'app_extra'@'%';

    FLUSH PRIVILEGES;
EOSQL

echo "MySQL initialization complete."
```

**NEVER DO THIS**:

```bash
# WRONG - Hardcoded password
mysql -u root -p"password123" -e "CREATE USER..."
```

### 6.5 Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `interval` | 10s | Critical database service, frequent checks |
| `timeout` | 5s | MySQL ping should be sub-second |
| `retries` | 5 | Allow for transient issues |
| `start_period` | 60s | InnoDB initialization, data recovery on crash |

**Note**: MySQL can report healthy (mysqladmin ping) during its temporary in-memory startup phase. The 60s start_period ensures InnoDB is fully initialized before dependent services start.

---

## 7. Storage Options

### 7.1 Local Disk Configuration

For development and simple deployments:

```yaml
services:
  mysql:
    volumes:
      - pmdl_mysql_data:/var/lib/mysql

volumes:
  pmdl_mysql_data:
    driver: local
```

**Directory Permissions** (if using bind mounts):

```bash
# MySQL runs as UID 999 (mysql user)
mkdir -p ./data/mysql
chown 999:999 ./data/mysql
chmod 700 ./data/mysql
```

### 7.2 Attached Volume Configuration

For cloud/VPS with block storage:

```yaml
volumes:
  pmdl_mysql_data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/block-storage/mysql
      o: bind
```

**Pre-requisites**:
1. Mount block storage to `/mnt/block-storage`
2. Create subdirectory: `mkdir -p /mnt/block-storage/mysql`
3. Set ownership: `chown 999:999 /mnt/block-storage/mysql`

### 7.3 Remote/S3 Considerations

MySQL data volumes should NOT be stored on network filesystems like S3/MinIO for primary data due to:

- MySQL requires POSIX-compliant filesystem with proper locking
- Latency-sensitive operations (InnoDB doublewrite, redo logs)
- Data corruption risk with eventual consistency storage

**S3 is appropriate for**:
- Backups (via mysqldump + rclone)
- Large binary data (BLOB offloading to application layer)

### 7.4 Volume Backup Procedure

For cold backups when mysqldump is insufficient:

```bash
# Stop service before volume backup
docker compose stop mysql

# Backup volume
docker run --rm \
    -v pmdl_mysql_data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine tar czf /backup/volume-mysql-$(date +%Y%m%d).tar.gz /data

# Restart service
docker compose start mysql
```

**Note**: Prefer `mysqldump --single-transaction` for hot backups when possible.

---

## 8. VPS Integration

### 8.1 Disk Provisioning Guidance

**Minimum Disk Requirements**:

| Workload | Data Disk | System Disk | Total |
|----------|-----------|-------------|-------|
| Development | 10 GB | 20 GB | 30 GB |
| Small Blog | 20 GB | 20 GB | 40 GB |
| Medium Prod | 50 GB | 20 GB | 70 GB |

**VPS Provider Notes**:

- **DigitalOcean**: Use block storage volumes for data, NVMe for fast I/O
- **Hetzner**: Cloud volumes or local NVMe - excellent price/performance
- **Vultr**: Block storage recommended for database persistence

### 8.2 Swap Considerations

**Recommendation**: Enable small swap (1-2GB) but configure MySQL to avoid it

**Rationale**: MySQL performance degrades significantly when swapping. InnoDB buffer pool should fit entirely in RAM.

**Configuration**:

```bash
# Enable small swap for emergency only
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Discourage swap usage
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

**Container Setting**:

```yaml
services:
  mysql:
    # Disable swap for database container
    deploy:
      resources:
        limits:
          memory: 1536M
    # Note: mem_swappiness not directly supported in Compose
    # Use Docker daemon configuration or cgroup settings
```

### 8.3 Kernel Parameters

Recommended sysctl settings for MySQL:

```bash
# /etc/sysctl.d/99-mysql.conf

# Increase file descriptor limit for many connections
fs.file-max = 65535

# Increase TCP connection queue
net.core.somaxconn = 1024

# Faster TCP connection reuse
net.ipv4.tcp_tw_reuse = 1

# Increase max memory map areas (for InnoDB)
vm.max_map_count = 262144
```

### 8.4 Monitoring Hooks

**Key Metrics to Monitor**:

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| `Threads_connected` | 80% of max_connections | 95% of max_connections |
| `Innodb_buffer_pool_reads` | Increasing trend | Sustained high values |
| `Slow_queries` | >10/hour | >100/hour |
| Disk usage | 70% | 85% |
| Memory usage | 80% | 95% |

**Prometheus Exporter** (optional):

```yaml
services:
  mysql-exporter:
    image: prom/mysqld-exporter:latest
    environment:
      DATA_SOURCE_NAME: "exporter:exporter_password@(mysql:3306)/"
    ports:
      - "127.0.0.1:9104:9104"
    networks:
      - db-internal
      - monitoring
    depends_on:
      mysql:
        condition: service_healthy
```

**Note**: Create exporter user in MySQL:
```sql
CREATE USER 'exporter'@'%' IDENTIFIED BY 'exporter_password';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';
```

---

## 9. Compose Fragment

### 9.1 Complete Service Definition

Copy this entire block to your `docker-compose.yml`:

```yaml
# ==============================================================
# MySQL 8.0 - Supporting Tech Profile
# ==============================================================
# Profile Version: 1.0
# Documentation: profiles/mysql/PROFILE-SPEC.md
# Primary Consumer: Ghost CMS
# ==============================================================

services:
  mysql:
    image: mysql:8.0
    container_name: pmdl_mysql

    # Secrets configuration (NEVER use plaintext passwords)
    secrets:
      - mysql_root_password
      - mysql_app_password

    # Environment (using _FILE suffix for secrets)
    environment:
      MYSQL_ROOT_PASSWORD_FILE: /run/secrets/mysql_root_password
      MYSQL_DATABASE: ghost
      MYSQL_USER: ghost
      MYSQL_PASSWORD_FILE: /run/secrets/mysql_app_password
      # Timezone (optional)
      TZ: UTC

    # Performance tuning via command line
    # Memory target: 1.5GB container, 1GB buffer pool
    command:
      - "--innodb-buffer-pool-size=1073741824"  # 1GB
      - "--performance-schema=OFF"               # Save ~400MB
      - "--max-connections=50"
      - "--innodb-flush-log-at-trx-commit=2"     # Balanced durability
      - "--skip-log-bin"                         # Single node, no replication
      - "--skip-symbolic-links"                  # Security
      - "--character-set-server=utf8mb4"
      - "--collation-server=utf8mb4_unicode_ci"

    # Volumes
    volumes:
      - pmdl_mysql_data:/var/lib/mysql
      - ./profiles/mysql/init-scripts:/docker-entrypoint-initdb.d:ro
      - ./profiles/mysql/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro

    # Health check (uses script for _FILE compatibility)
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s

    # Network isolation
    networks:
      - db-internal

    # Resource limits (Full profile)
    deploy:
      resources:
        limits:
          memory: 1536M
        reservations:
          memory: 768M

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
  mysql_root_password:
    file: ./secrets/mysql_root_password
  mysql_app_password:
    file: ./secrets/mysql_app_password

# Volumes
volumes:
  pmdl_mysql_data:
    driver: local

# Networks (reference existing or define)
networks:
  db-internal:
    internal: true
```

### 9.2 Core Profile Variant (512MB container)

For memory-constrained environments:

```yaml
services:
  mysql:
    # Same as above, but with reduced resources
    command:
      - "--innodb-buffer-pool-size=402653184"  # 384MB
      - "--performance-schema=OFF"
      - "--max-connections=30"
      - "--innodb-flush-log-at-trx-commit=2"
      - "--skip-log-bin"
      - "--skip-symbolic-links"
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### 9.3 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MYSQL_ROOT_PASSWORD_FILE` | Yes | - | Path to root password secret |
| `MYSQL_DATABASE` | No | - | Database to create on first run |
| `MYSQL_USER` | No | - | Application user to create |
| `MYSQL_PASSWORD_FILE` | When MYSQL_USER set | - | Application user password |
| `TZ` | No | UTC | Container timezone |

### 9.4 Secret Files Required

Generate these before starting:

```bash
# scripts/generate-secrets.sh additions

# MySQL root password (48 hex chars = 24 bytes of entropy)
openssl rand -hex 24 > ./secrets/mysql_root_password
chmod 600 ./secrets/mysql_root_password

# MySQL application password (Ghost)
openssl rand -hex 24 > ./secrets/mysql_app_password
chmod 600 ./secrets/mysql_app_password
```

---

## 10. Troubleshooting

### Common Issues

#### Issue 1: Container Immediately Exits

**Symptoms**: Container starts and exits within seconds, logs show InnoDB errors

**Cause**: Corrupted InnoDB files or insufficient memory for recovery

**Solution**:
```bash
# Check logs for specific error
docker logs pmdl_mysql --tail 100

# If InnoDB corruption, may need to start with recovery mode
# WARNING: This can lose data - only use as last resort
docker run --rm -it \
    -v pmdl_mysql_data:/var/lib/mysql \
    mysql:8.0 \
    --innodb-force-recovery=1
```

#### Issue 2: Health Check Fails with `_FILE` Secrets

**Symptoms**: Container shows `unhealthy`, logs show authentication errors

**Cause**: Health check is using `${MYSQL_PASSWORD}` which doesn't exist when using `_FILE` suffix

**Solution**: Use the provided healthcheck script that uses socket-based ping:
```bash
# Verify healthcheck script is mounted
docker exec pmdl_mysql ls -la /healthcheck.sh

# Test healthcheck manually
docker exec pmdl_mysql /healthcheck.sh
echo $?  # Should be 0

# If script not found, check volume mount
docker inspect pmdl_mysql | grep -A5 "Mounts"
```

#### Issue 3: Permission Denied on Data Directory

**Symptoms**: Container fails to start, logs show permission errors on `/var/lib/mysql`

**Cause**: Volume directory not owned by mysql user (UID 999)

**Solution**:
```bash
# For bind mounts
sudo chown 999:999 ./data/mysql

# For named volumes, recreate
docker volume rm pmdl_mysql_data
docker compose up -d mysql
```

#### Issue 4: Ghost Cannot Connect After Password Change

**Symptoms**: Ghost shows database connection errors after rotating MySQL password

**Cause**: Password in secrets file changed but Ghost config not updated

**Solution**:
```bash
# Ensure Ghost's database config references the correct secret
# Update ghost_db_password secret file
# Restart both services
docker compose restart mysql ghost
```

#### Issue 5: Slow Queries After Migration

**Symptoms**: Previously fast queries now take seconds

**Cause**: InnoDB buffer pool too small for migrated data, or statistics outdated

**Solution**:
```bash
# Check buffer pool usage
docker exec pmdl_mysql mysql -u root -p -e "SHOW STATUS LIKE 'Innodb_buffer_pool%';"

# If reads > pages in pool, increase buffer_pool_size
# Also analyze tables after large data changes
docker exec pmdl_mysql mysql -u root -p -e "ANALYZE TABLE ghost.posts;"
```

### Log Analysis

**View logs**:
```bash
docker logs pmdl_mysql --tail 100 -f
```

**Common log patterns**:

| Pattern | Meaning | Action |
|---------|---------|--------|
| `[ERROR] InnoDB: Cannot allocate memory` | Buffer pool too large | Reduce innodb_buffer_pool_size |
| `[Warning] Aborted connection` | Client disconnected abnormally | Check application connection handling |
| `[ERROR] Access denied for user` | Authentication failure | Verify password in secrets file |
| `[Warning] IP address could not be resolved` | DNS lookup delay | Add `skip-name-resolve` to command |
| `[Note] Ready for connections` | MySQL fully started | Normal startup message |

---

## 11. References

### Official Documentation

- [MySQL 8.0 Docker Documentation](https://hub.docker.com/_/mysql)
- [MySQL 8.0 Reference Manual](https://dev.mysql.com/doc/refman/8.0/en/)
- [InnoDB Configuration](https://dev.mysql.com/doc/refman/8.0/en/innodb-parameters.html)

### Foundation Decisions Referenced

| Decision | Relevance |
|----------|-----------|
| D3.1 Secret Management | File-based secrets pattern, `_FILE` suffix |
| D4.1 Health Checks | Timing parameters, socket-based ping |
| D4.3 Startup Ordering | depends_on pattern |
| D3.3 Network Isolation | db-internal zone placement |
| D2.4 Backup Recovery | mysqldump tools, retention policy |
| D4.2 Resource Constraints | Memory limits, profile budgets |
| D2.1 Database Selection | MySQL for Ghost CMS |
| D2.2 Database Memory | InnoDB buffer pool sizing |
| D9 Storage Strategy | Volume naming, backup destinations |
| D10 Resource Calculator | Memory calculation formulas |

### Related Profiles

- **PostgreSQL Profile**: Primary database for Matrix Synapse, LibreChat
- **MongoDB Profile**: Document storage for LibreChat conversations

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-12-31 | Initial creation | AI Agent |

---

*Profile Template Version: 1.0*
*Last Updated: 2025-12-31*
*Part of Peer Mesh Docker Lab*
