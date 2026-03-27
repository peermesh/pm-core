# Supporting Tech Profile: MinIO

**Version**: MinIO latest (RELEASE.2024-xx-xx)
**Image**: `minio/minio:latest`
**Category**: Storage
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

### What Is MinIO?

MinIO is a high-performance, S3-compatible object storage server designed for cloud-native workloads. It provides a local, self-hosted alternative to AWS S3 with full API compatibility, enabling true local-first development without cloud dependencies.

### When to Use This Profile

Use this profile when your application needs:

- [x] S3-compatible object storage for backups
- [x] User file uploads and media storage
- [x] Static asset hosting
- [x] Backup destination for database dumps
- [x] Local development equivalent to AWS S3
- [x] Air-gapped or offline object storage

### When NOT to Use This Profile

Do NOT use this profile if:

- [ ] You only need simple file storage (use Docker volumes directly)
- [ ] You need block storage for databases (use attached volumes)
- [ ] Your storage needs are under 1GB (complexity not justified)
- [ ] You need guaranteed POSIX filesystem semantics (MinIO is object storage)

### Comparison with Alternatives

| Feature | MinIO | AWS S3 | Ceph RGW | SeaweedFS |
|---------|-------|--------|----------|-----------|
| Best for | Local/edge S3 | Cloud-native | Distributed | Simple blob |
| Memory footprint | Low (200-500MB) | N/A (managed) | High (2GB+) | Medium |
| S3 compatibility | Full | Native | Full | Partial |
| Learning curve | Easy | Easy | Hard | Medium |
| Self-hosted | Yes | No | Yes | Yes |
| Single-node | Excellent | N/A | Overkill | Good |

**Recommendation**: Use MinIO as your S3-compatible local storage for backups, file uploads, and development parity with AWS S3. It requires minimal resources and provides full S3 API compatibility.

---

## 2. Security Configuration

### 2.1 Non-Root Execution

MinIO runs as a non-root user by default:

```yaml
services:
  minio:
    user: "1000:1000"  # minio user
```

**Note**: When using bind mounts or attached volumes, ensure the target directory is owned by UID 1000 or matches the user specified.

### 2.2 Secrets via `_FILE` Suffix

All credentials MUST use file-based secrets, never environment variables with raw values.

**Supported Secret Variables**:

| Variable | `_FILE` Equivalent | Purpose |
|----------|-------------------|---------|
| `MINIO_ROOT_USER` | `MINIO_ROOT_USER_FILE` | Admin username |
| `MINIO_ROOT_PASSWORD` | `MINIO_ROOT_PASSWORD_FILE` | Admin password |

**Compose Configuration**:

```yaml
services:
  minio:
    secrets:
      - minio_root_user
      - minio_root_password
    environment:
      MINIO_ROOT_USER_FILE: /run/secrets/minio_root_user
      MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_root_password

secrets:
  minio_root_user:
    file: ./secrets/minio_root_user
  minio_root_password:
    file: ./secrets/minio_root_password
```

### 2.3 Network Isolation

MinIO has dual network requirements:

1. **API Access (Port 9000)**: For applications to store/retrieve objects
2. **Console Access (Port 9001)**: For web-based management UI

```yaml
services:
  minio:
    networks:
      - app-internal    # For application access to S3 API
      - backend         # Optional: if Traefik/Caddy routes to console
```

**Network Zones** (per D3.3):

| Zone | Access Level | MinIO |
|------|--------------|-------|
| `frontend` | Public-facing | No (unless console exposed via reverse proxy) |
| `backend` | App-to-app | Yes (API access) |
| `app-internal` | Internal services | Yes (primary) |
| `db-internal` | Database only | No |
| `monitoring` | Metrics/logs | Optional |

### 2.4 Authentication Enforcement

**Default Authentication**: Enabled (root credentials required)

**Required Configuration**:

MinIO always requires authentication. The root credentials are mandatory for initial setup and administrative access.

**Access Key Management**:

For production, create dedicated access keys instead of using root credentials:

```bash
# Create access key via mc (MinIO Client)
mc admin user add local appuser app-secret-key

# Create bucket-specific policy
mc admin policy attach local readwrite --user appuser
```

**Connection String Pattern**:

Applications connect using S3 SDK with:
- Endpoint: `http://minio:9000`
- Access Key: From secret
- Secret Key: From secret
- Region: `us-east-1` (default, can be any)

### 2.5 TLS/Encryption

**In-Transit Encryption**:

- [x] Native TLS support: Yes
- Configuration method: Mount certificates to `/root/.minio/certs/`

```yaml
volumes:
  - ./certs/public.crt:/root/.minio/certs/public.crt:ro
  - ./certs/private.key:/root/.minio/certs/private.key:ro
```

**At-Rest Encryption**:

- [x] Native encryption: Yes (Server-Side Encryption)
- Configuration: Enable SSE-S3 for automatic encryption

```bash
# Enable auto-encryption on bucket
mc encrypt set sse-s3 local/mybucket
```

**Recommendation**: Use reverse proxy (Caddy/Traefik) for TLS termination in production. Enable SSE for sensitive data at rest.

---

## 3. Performance Tuning

### 3.1 Memory Allocation

**Primary Memory Characteristics**:

MinIO is memory-efficient and uses a Go-based memory model. Memory usage scales with:
- Number of concurrent connections
- Object sizes being transferred
- Number of buckets and objects (metadata)

**Memory Guidelines**:

| Workload | Objects | Concurrent Ops | Memory |
|----------|---------|----------------|--------|
| Development | <10K | <10 | 128 MB |
| Small Production | 10K-100K | 10-50 | 256 MB |
| Medium Production | 100K-1M | 50-100 | 512 MB |
| Large Production | 1M+ | 100+ | 1 GB+ |

**Docker Compose Memory Limits**:

```yaml
services:
  minio:
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### 3.2 Connection Limits

MinIO handles connections efficiently. Default limits are typically sufficient:

- Maximum concurrent connections: ~10,000 per server
- Per-connection memory: Minimal (~1-2 KB)
- Connection pooling: Handled by S3 clients

**Configuration** (via environment):

```yaml
environment:
  # Tune if needed (defaults are usually fine)
  MINIO_API_REQUESTS_MAX: 10000
  MINIO_API_REQUESTS_DEADLINE: 10s
```

### 3.3 I/O Optimization

**Disk I/O Settings**:

MinIO is I/O intensive. Use SSDs for best performance.

```yaml
# For SSDs (recommended)
# No special configuration needed - MinIO auto-detects

# For HDDs (if unavoidable)
environment:
  # Enable bitrot healing in background
  MINIO_SCANNER_SPEED: "slow"
```

**Multipart Upload Tuning**:

For large file uploads (>100MB), multipart upload improves throughput:

```yaml
environment:
  # Minimum size for multipart uploads (default: 128MiB)
  MINIO_API_MULTIPART_SIZE: 67108864  # 64MB parts
```

### 3.4 Operation Optimization

**Lifecycle Policies**:

Configure automatic cleanup of old objects:

```bash
# Set lifecycle policy to delete old backups
mc ilm rule add --expire-days 30 local/backups
```

**Bucket Quotas**:

Prevent runaway storage usage:

```bash
# Set 50GB quota on bucket
mc quota set local/uploads --size 50GB
```

---

## 4. Sizing Calculator

### 4.1 Input Variables

Collect these values before sizing:

| Variable | Description | How to Estimate |
|----------|-------------|-----------------|
| `STORAGE_GB` | Expected total storage | Sum of all object sizes |
| `OBJECT_COUNT` | Number of objects | Count or estimate objects |
| `PEAK_REQUESTS` | Requests per second | Application metrics |
| `AVG_OBJECT_SIZE_MB` | Average object size | Storage / Object count |

### 4.2 Memory Calculation

```bash
#!/bin/bash
# MinIO sizing calculator

OBJECT_COUNT=${1:-100000}
PEAK_REQUESTS=${2:-50}

# Base memory for MinIO
BASE_MEMORY_MB=100

# Metadata cache (~1KB per 1000 objects)
METADATA_MB=$(echo "$OBJECT_COUNT / 1000" | bc)

# Connection handling (~1KB per concurrent request)
CONNECTION_MB=$PEAK_REQUESTS

# Buffer for operations
BUFFER_MB=50

# Total MinIO memory
TOTAL_MB=$((BASE_MEMORY_MB + METADATA_MB + CONNECTION_MB + BUFFER_MB))

echo "=== MinIO Sizing Results ==="
echo "Object Count: ${OBJECT_COUNT}"
echo "Peak Requests/sec: ${PEAK_REQUESTS}"
echo ""
echo "Memory Breakdown:"
echo "  Base:       ${BASE_MEMORY_MB} MB"
echo "  Metadata:   ${METADATA_MB} MB"
echo "  Connections: ${CONNECTION_MB} MB"
echo "  Buffer:     ${BUFFER_MB} MB"
echo "  -----------------------"
echo "  TOTAL:      ${TOTAL_MB} MB"
echo ""
echo "Docker memory limit: $((TOTAL_MB + TOTAL_MB / 5))m (with 20% headroom)"
```

### 4.3 Disk Calculation

```bash
# Disk space calculation

STORAGE_GB=$1
BACKUP_RETENTION_DAYS=7
AVG_DAILY_BACKUP_GB=$2

# Raw data storage
DATA_DISK_GB=$STORAGE_GB

# Temporary upload space (10% of data)
TEMP_DISK_GB=$(echo "$STORAGE_GB * 0.1" | bc)

# Metadata overhead (1% of data)
METADATA_DISK_GB=$(echo "$STORAGE_GB * 0.01" | bc)

# Total
TOTAL_DISK_GB=$(echo "$DATA_DISK_GB + $TEMP_DISK_GB + $METADATA_DISK_GB" | bc)

echo "Disk Requirements:"
echo "  Data:      ${DATA_DISK_GB} GB"
echo "  Temp:      ${TEMP_DISK_GB} GB"
echo "  Metadata:  ${METADATA_DISK_GB} GB"
echo "  -----------------------"
echo "  TOTAL:     ${TOTAL_DISK_GB} GB"
```

### 4.4 Quick Reference Table

| Workload | Storage | Objects | Memory | Disk Overhead |
|----------|---------|---------|--------|---------------|
| Development | <10 GB | <10K | 128 MB | +1 GB |
| Small Production | 10-50 GB | 10K-100K | 256 MB | +5 GB |
| Medium Production | 50-200 GB | 100K-500K | 512 MB | +20 GB |
| Large Production | 200+ GB | 500K+ | 1 GB | +30 GB |

---

## 5. Backup Strategy

### 5.1 Backup Method

**Primary Tool**: `mc mirror` (MinIO Client)

MinIO is often the **backup destination**, not the backup source. However, MinIO data itself should be backed up.

**Recommended Command**:

```bash
# Mirror MinIO data to external location
mc mirror local/ s3remote/ --overwrite --remove

# Or to local filesystem
mc mirror local/ /backup/minio/ --overwrite
```

### 5.2 Backup Script (Secrets-Aware)

See `backup-scripts/backup.sh` for the complete implementation.

**Key Features**:
- Reads credentials from `/run/secrets/`
- Uses `mc mirror` for efficient syncing
- Supports multiple destinations
- Generates manifest of backed-up objects

### 5.3 Retention Policy

Follow the standard retention (per D2.4):

| Tier | Retention | Count |
|------|-----------|-------|
| Daily | 7 days | 7 |
| Weekly | 4 weeks | 4 |
| Monthly | 3 months | 3 |

**Lifecycle Policies** (applied within MinIO):

```bash
# Auto-delete old backups within MinIO
mc ilm rule add --expire-days 30 local/temp-backups

# Transition old data to different storage class
mc ilm rule add --transition-days 90 --storage-class GLACIER local/archives
```

### 5.4 Encryption Requirements

Backups leaving the host MUST be encrypted:

```bash
# Using rclone with encryption
rclone sync minio:backups encrypted-remote:backups \
    --s3-endpoint=http://localhost:9000

# Or encrypt before upload
mc pipe local/backup.tar.gz | age -r age1... > backup.tar.gz.age
```

### 5.5 Restore Procedure

See `backup-scripts/restore.sh` for the complete implementation.

**Quick Restore**:

```bash
# Restore from external S3
mc mirror s3remote/ local/ --overwrite

# Restore from local backup
mc mirror /backup/minio/ local/ --overwrite

# Restore specific bucket
mc mirror s3remote/mybucket local/mybucket --overwrite
```

### 5.6 Cross-Site Replication (Advanced)

For disaster recovery, configure site replication:

```bash
# Add replication target
mc admin replicate add local remote

# Status check
mc admin replicate info local
```

---

## 6. Startup & Health

### 6.1 Healthcheck Configuration

**CRITICAL**: Health checks must work with `_FILE` secrets.

MinIO provides a dedicated health endpoint that doesn't require authentication.

```yaml
services:
  minio:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

### 6.2 Healthcheck Script (Secrets-Aware)

For enhanced health checks including bucket verification:

```yaml
services:
  minio:
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    volumes:
      - ./profiles/minio/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro
```

See `healthcheck-scripts/healthcheck.sh` for the complete implementation.

**Alternative using mc**:

```bash
# If mc is available in container
mc ready local || exit 1
```

### 6.3 depends_on Pattern

```yaml
services:
  app:
    depends_on:
      minio:
        condition: service_healthy
```

### 6.4 Init Scripts (Secrets-Aware)

Init scripts for creating default buckets:

See `init-scripts/01-init-buckets.sh` for the complete implementation.

**Quick Bucket Creation** (via docker exec after startup):

```bash
# Create buckets using mc
docker exec minio mc mb local/backups --ignore-existing
docker exec minio mc mb local/uploads --ignore-existing
```

### 6.5 Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `interval` | 30s | MinIO is stable, less frequent checks acceptable |
| `timeout` | 10s | Health endpoint responds quickly |
| `retries` | 3 | Allow brief network issues |
| `start_period` | 30s | Account for initial startup and bucket creation |

---

## 7. Storage Options

### 7.1 Local Disk Configuration

For development and simple deployments:

```yaml
services:
  minio:
    volumes:
      - pmdl_minio_data:/data

volumes:
  pmdl_minio_data:
    driver: local
```

**Directory Permissions**:

```bash
# If using bind mounts
mkdir -p ./data/minio
chown 1000:1000 ./data/minio
chmod 750 ./data/minio
```

### 7.2 Attached Volume Configuration

For cloud/VPS with block storage:

```yaml
volumes:
  pmdl_minio_data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/block-storage/minio
      o: bind
```

**Pre-requisites**:
1. Mount block storage to `/mnt/block-storage`
2. Create subdirectory: `mkdir -p /mnt/block-storage/minio`
3. Set ownership: `chown 1000:1000 /mnt/block-storage/minio`

### 7.3 Erasure Coding (Advanced)

For high availability with multiple disks:

```yaml
services:
  minio:
    command: server /data{1...4} --console-address ":9001"
    volumes:
      - /mnt/disk1/minio:/data1
      - /mnt/disk2/minio:/data2
      - /mnt/disk3/minio:/data3
      - /mnt/disk4/minio:/data4
```

**Note**: Erasure coding requires at least 4 disks and provides data redundancy. This is optional for commodity VPS deployments.

### 7.4 Volume Backup Procedure

```bash
# Stop service before volume backup (if possible)
docker compose stop minio

# Backup volume
docker run --rm \
    -v pmdl_minio_data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine tar czf /backup/volume-minio-$(date +%Y%m%d).tar.gz /data

# Restart service
docker compose start minio
```

**Preferred**: Use `mc mirror` for online backups without downtime.

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

- **DigitalOcean**: Use Spaces for remote S3 destination, Block Storage for local
- **Hetzner**: Storage Boxes for backup destination, Cloud Volumes for local
- **Vultr**: Object Storage for backup destination, Block Storage for local

### 8.2 Swap Considerations

**Recommendation**: Disable swap for MinIO containers

**Rationale**: MinIO performance degrades significantly with swapping. Size memory appropriately instead.

**Configuration**:

```yaml
services:
  minio:
    deploy:
      resources:
        limits:
          memory: 512M
    # Disable swap (Compose v3.8+ / Swarm only)
    # mem_swappiness: 0
```

### 8.3 Kernel Parameters

Recommended sysctl settings for MinIO:

```bash
# /etc/sysctl.d/99-minio.conf

# Increase file descriptor limits
fs.file-max = 100000

# Network tuning for high-throughput
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# Memory-mapped files (for large objects)
vm.max_map_count = 262144
```

### 8.4 Monitoring Hooks

**Key Metrics to Monitor**:

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| Disk usage | 70% | 85% |
| Request latency (p99) | >500ms | >2s |
| Error rate | >1% | >5% |
| Active connections | 80% of limit | 95% of limit |

**Prometheus Exporter**:

MinIO has built-in Prometheus metrics:

```yaml
services:
  minio:
    environment:
      MINIO_PROMETHEUS_AUTH_TYPE: public
    ports:
      - "127.0.0.1:9000:9000"  # Includes /minio/v2/metrics
```

**Prometheus Scrape Config**:

```yaml
scrape_configs:
  - job_name: minio
    metrics_path: /minio/v2/metrics/cluster
    static_configs:
      - targets: ['minio:9000']
```

**Health Check Integration**:

```bash
# For external monitoring
curl -f http://localhost:9000/minio/health/live || exit 1
curl -f http://localhost:9000/minio/health/ready || exit 1
```

---

## 9. Compose Fragment

### 9.1 Complete Service Definition

Copy this entire block to your `docker-compose.yml`:

```yaml
# ==============================================================
# MinIO S3-Compatible Object Storage - Supporting Tech Profile
# ==============================================================
# Profile Version: 1.0
# Documentation: profiles/minio/PROFILE-SPEC.md
# ==============================================================

services:
  minio:
    image: minio/minio:latest
    container_name: pmdl_minio

    # ---------------------------------------------------------
    # Server Command
    # ---------------------------------------------------------
    # Single server mode with console enabled
    command: server /data --console-address ":9001"

    # ---------------------------------------------------------
    # Secrets Configuration
    # ---------------------------------------------------------
    secrets:
      - minio_root_user
      - minio_root_password

    # ---------------------------------------------------------
    # Environment
    # ---------------------------------------------------------
    environment:
      # Root credentials from secrets (NEVER plain text)
      MINIO_ROOT_USER_FILE: /run/secrets/minio_root_user
      MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_root_password
      # Prometheus metrics (optional)
      MINIO_PROMETHEUS_AUTH_TYPE: public
      # Browser console (optional - disable in hardened prod)
      MINIO_BROWSER: "on"

    # ---------------------------------------------------------
    # Volumes
    # ---------------------------------------------------------
    volumes:
      # Data volume (persistent)
      - pmdl_minio_data:/data
      # Healthcheck script
      - ./profiles/minio/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro

    # ---------------------------------------------------------
    # Health Check
    # ---------------------------------------------------------
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

    # ---------------------------------------------------------
    # Network Configuration
    # ---------------------------------------------------------
    networks:
      - app-internal
      - backend  # For Traefik/Caddy routing to console

    # ---------------------------------------------------------
    # Port Exposure (Development Only)
    # ---------------------------------------------------------
    # In production, expose via reverse proxy instead
    ports:
      - "127.0.0.1:9000:9000"   # S3 API
      - "127.0.0.1:9001:9001"   # Console (remove in production)

    # ---------------------------------------------------------
    # Resource Constraints
    # ---------------------------------------------------------
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M

    # ---------------------------------------------------------
    # Restart Policy
    # ---------------------------------------------------------
    restart: unless-stopped

    # ---------------------------------------------------------
    # Logging
    # ---------------------------------------------------------
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

# ==============================================================
# Secrets
# ==============================================================

secrets:
  minio_root_user:
    file: ./secrets/minio_root_user
  minio_root_password:
    file: ./secrets/minio_root_password

# ==============================================================
# Volumes
# ==============================================================

volumes:
  pmdl_minio_data:
    driver: local
    # For attached block storage, use:
    # driver_opts:
    #   type: none
    #   device: /mnt/block-storage/minio
    #   o: bind

# ==============================================================
# Networks
# ==============================================================

networks:
  app-internal:
    name: pmdl_app-internal
  backend:
    name: pmdl_backend
```

### 9.2 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MINIO_ROOT_USER_FILE` | Yes | - | Path to admin username file |
| `MINIO_ROOT_PASSWORD_FILE` | Yes | - | Path to admin password file |
| `MINIO_BROWSER` | No | on | Enable/disable web console |
| `MINIO_PROMETHEUS_AUTH_TYPE` | No | jwt | Metrics auth (public/jwt) |

### 9.3 Secret Files Required

Generate these before starting:

```bash
# scripts/generate-secrets.sh additions

# MinIO root user (admin username)
echo "minio-admin" > ./secrets/minio_root_user
chmod 600 ./secrets/minio_root_user

# MinIO root password (32+ character recommended)
openssl rand -hex 24 > ./secrets/minio_root_password
chmod 600 ./secrets/minio_root_password
```

---

## 10. Troubleshooting

### Common Issues

#### Issue 1: Container Fails to Start with Permission Errors

**Symptoms**: MinIO fails with "unable to initialize backend" or "permission denied"

**Cause**: Data volume not owned by MinIO user (UID 1000)

**Solution**:
```bash
# For bind mounts
chown -R 1000:1000 ./data/minio

# For named volumes, recreate
docker volume rm pmdl_minio_data
docker compose up -d minio
```

#### Issue 2: Cannot Connect to S3 API

**Symptoms**: Applications fail with "connection refused" or "access denied"

**Cause**: Wrong endpoint, credentials, or network isolation

**Solution**:
```bash
# Verify MinIO is healthy
docker exec pmdl_minio curl -f http://localhost:9000/minio/health/live

# Test with mc
docker exec pmdl_minio mc alias set local http://localhost:9000 $(cat secrets/minio_root_user) $(cat secrets/minio_root_password)
docker exec pmdl_minio mc ls local/
```

#### Issue 3: Health Check Fails

**Symptoms**: Container shows `unhealthy`

**Cause**: MinIO still initializing or curl not available in container

**Solution**:
```bash
# Check logs
docker logs pmdl_minio --tail 50

# Test health endpoint manually
docker exec pmdl_minio curl -v http://localhost:9000/minio/health/live
```

#### Issue 4: Console Not Accessible

**Symptoms**: Cannot access MinIO console on port 9001

**Cause**: `MINIO_BROWSER` disabled or port not exposed

**Solution**:
```yaml
environment:
  MINIO_BROWSER: "on"
ports:
  - "9001:9001"
```

#### Issue 5: Slow Upload/Download Performance

**Symptoms**: Large file transfers are slow

**Cause**: Network configuration or disk I/O bottleneck

**Solution**:
```bash
# Check disk I/O
docker stats pmdl_minio

# Use multipart uploads for large files (configure in S3 client)
# Enable read-ahead for sequential reads
echo "madvise" > /sys/kernel/mm/transparent_hugepage/enabled
```

### Log Analysis

**View logs**:
```bash
docker logs pmdl_minio --tail 100 -f
```

**Common log patterns**:

| Pattern | Meaning | Action |
|---------|---------|--------|
| `API: STARTUP` | Successful startup | None |
| `Unable to initialize backend` | Storage issue | Check permissions/mount |
| `Access Denied` | Auth failure | Verify credentials |
| `Healing required` | Data inconsistency | Run `mc admin heal` |
| `Disk space low` | Running out of storage | Add space or cleanup |

---

## 11. References

### Official Documentation

- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
- [MinIO Docker Hub](https://hub.docker.com/r/minio/minio)
- [MinIO Client (mc) Reference](https://min.io/docs/minio/linux/reference/minio-mc.html)
- [MinIO SDKs](https://min.io/docs/minio/linux/developers/minio-drivers.html)

### Foundation Decisions Referenced

| Decision | Relevance |
|----------|-----------|
| D3.1 Secret Management | File-based secrets pattern |
| D3.3 Network Isolation | Zone placement (app-internal) |
| D4.1 Health Checks | Timing parameters |
| D4.3 Startup Ordering | depends_on pattern |
| D2.4 Backup Recovery | Backup destination |
| D9 Storage Strategy | Volume configuration, tiered storage |

### Related Profiles

- **PostgreSQL**: Backup dumps can be stored in MinIO
- **MongoDB**: Backup archives can be stored in MinIO
- **Redis**: RDB snapshots can be stored in MinIO

### Integration Patterns

**As Backup Destination**:

```bash
# PostgreSQL backup to MinIO
pg_dump ... | gzip | mc pipe local/db-backups/postgres-$(date +%Y%m%d).sql.gz
```

**Application File Storage**:

```javascript
// Node.js with AWS SDK
const s3 = new S3Client({
  endpoint: "http://minio:9000",
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY
  },
  forcePathStyle: true
});
```

**Traefik Routing** (Console Access via HTTPS):

```yaml
services:
  minio:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.minio-console.rule=Host(`minio.example.com`)"
      - "traefik.http.services.minio-console.loadbalancer.server.port=9001"
```

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-12-31 | Initial creation | AI Agent |

---

*Profile Template Version: 1.0*
*Last Updated: 2025-12-31*
*Part of PeerMesh Docker Lab*
