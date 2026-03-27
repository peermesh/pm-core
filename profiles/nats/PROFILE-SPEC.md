# Supporting Tech Profile: NATS + JetStream

**Version**: NATS 2.x (Alpine)
**Image**: `nats:2-alpine`
**Category**: Queue / Event Bus
**Status**: Complete
**Last Updated**: 2026-02-22

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

### What Is NATS?

NATS is a high-performance messaging system for cloud-native applications, IoT messaging, and microservices architectures. JetStream adds persistence, replay, and stream processing capabilities to NATS's core pub/sub messaging. This profile provides a single-node NATS server with JetStream enabled as an event bus substrate for module coordination.

### When to Use This Profile

Use this profile when your application needs:

- [x] Asynchronous event distribution between modules
- [x] Reliable message delivery with persistence (JetStream streams)
- [x] Pub/sub messaging patterns
- [x] Request/reply communication patterns
- [x] Low-latency message passing (<1ms within same host)
- [x] Event sourcing or audit log streams

### When NOT to Use This Profile

Do NOT use this profile if:

- [ ] You need distributed messaging across multiple VPS instances (NATS clustering is out of scope)
- [ ] Your workload requires complex routing logic (use a dedicated message broker like RabbitMQ)
- [ ] You need guaranteed ordered delivery at scale (JetStream ordering is best-effort on single node)
- [ ] You require Kafka-style partition management

### Comparison with Alternatives

| Feature | NATS + JetStream | Redis Pub/Sub | RabbitMQ |
|---------|------------------|---------------|----------|
| Best for | Event bus, microservices | Cache + simple pub/sub | Complex routing |
| Memory footprint | Low (15-30 MB idle) | Low | Medium-High |
| Scaling model | Single node (this profile) | Single node | Clustered |
| Learning curve | Easy | Easy | Moderate |
| Persistence | JetStream streams | No (ephemeral) | Yes |
| Ordering | Per-stream | No | Per-queue |

**Recommendation**: Use NATS when you need a lightweight event bus for module coordination. Use Redis if you already have it for caching and only need ephemeral pub/sub. Use RabbitMQ for complex enterprise messaging patterns.

---

## 2. Security Configuration

### 2.1 Non-Root Execution

NATS runs as a non-root user (nats, UID 999) inside the container:

```yaml
services:
  nats:
    user: "999:999"  # nats:nats
```

**Note**: The official NATS image runs as the nats user by default. Data directories are owned by UID 999.

### 2.2 Secrets via `_FILE` Suffix

NATS authentication uses token-based auth with file-mounted secrets.

**Supported Secret Variables**:

| Variable | `_FILE` Equivalent | Purpose |
|----------|-------------------|---------|
| N/A | Token file mount | Authentication token read from file |

**Compose Configuration**:

```yaml
services:
  nats:
    secrets:
      - nats_auth_token
    volumes:
      - ./profiles/nats/nats-server.conf:/etc/nats/nats-server.conf:ro
    command:
      - "--config"
      - "/etc/nats/nats-server.conf"

secrets:
  nats_auth_token:
    file: ./secrets/nats_auth_token
```

**Configuration File Pattern** (nats-server.conf):

```
authorization {
  token: $NATS_AUTH_TOKEN
}
```

**Note**: The token is injected via environment variable pointing to the secret file.

### 2.3 Network Isolation

NATS should be placed in the `app-internal` network zone (backend communication):

```yaml
services:
  nats:
    networks:
      - app-internal
    # NOT exposed to frontend or internet networks
```

**Network Zones** (per ADR-0002):

| Zone | Access Level | NATS |
|------|--------------|------|
| `frontend` | Public-facing | No |
| `backend` (app-internal) | App-to-app | Yes |
| `db-internal` | Database only | No |
| `monitoring` | Metrics/logs | Optional (for exporters) |

### 2.4 Authentication Enforcement

**Default Authentication**: Disabled (must be explicitly enabled)

**Required Configuration**:

```yaml
# Mount auth token as secret
secrets:
  - nats_auth_token
environment:
  NATS_AUTH_TOKEN_FILE: /run/secrets/nats_auth_token
```

**Connection String Pattern**:

```
nats://[token]@nats:4222
```

**Client Connection Example**:

```javascript
// Node.js
const { connect } = require('nats');
const token = await readFile('/run/secrets/nats_auth_token', 'utf8');
const nc = await connect({ servers: 'nats://nats:4222', token });
```

### 2.5 TLS/Encryption

**In-Transit Encryption**:

- [x] Native TLS support: Yes
- Configuration method: Mount certificates and configure in nats-server.conf

```yaml
tls {
  cert_file: "/certs/server.crt"
  key_file:  "/certs/server.key"
  ca_file:   "/certs/ca.crt"
  verify:    true
}
```

**Note**: TLS is optional for single-VPS deployments where all communication is localhost. Enable for multi-host setups.

**At-Rest Encryption**:

- [ ] Native encryption: No (JetStream streams are stored unencrypted)
- Recommendation: Use volume-level encryption (LUKS) if stream data is sensitive

---

## 3. Performance Tuning

### 3.1 Memory Allocation

**Primary Memory Parameter**: JetStream `max_memory_store`

**Formula**:

```
max_memory_store = (available_memory - 100MB base overhead) * 0.7
```

**Example Configurations**:

| Container RAM | max_memory_store | max_file_store | Max Streams |
|---------------|------------------|----------------|-------------|
| 256 MB | 100 MB | 1 GB | 10 |
| 512 MB | 280 MB | 2 GB | 25 |
| 1 GB | 640 MB | 5 GB | 50 |
| 2 GB | 1300 MB | 10 GB | 100 |

**Docker Compose Memory Limits**:

```yaml
services:
  nats:
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 128M
```

### 3.2 Connection Limits

**Maximum Connections Formula**:

```
max_connections = unlimited (default)
# For resource-constrained VPS: max_connections = 1000
```

**Factors**:
- Per-connection memory overhead: ~10 KB
- Connection pooling recommendation: Not needed for intra-VPS communication
- Timeout settings: `write_deadline = 10s` (default)

**Configuration**:

```yaml
# nats-server.conf
max_connections: 1000
write_deadline: "10s"
ping_interval: "2m"
ping_max: 3
```

### 3.3 I/O Optimization

**Disk I/O Settings**:

JetStream uses file-based storage for stream persistence.

```yaml
# For SSDs (recommended)
jetstream {
  store_dir: "/data/jetstream"
  max_memory_store: 280MB
  max_file_store: 2GB
}
```

**Note**: JetStream performs sequential writes. SSD recommended but not required.

### 3.4 Stream/Operation Optimization

**Stream Limits** (per-stream defaults):

```
max_msgs: 1000000          # Maximum messages per stream
max_bytes: 1GB             # Maximum stream size
max_age: 168h              # 7 days retention
max_msg_size: 1MB          # Maximum individual message size
discard: old               # Discard oldest when limits reached
```

**Resource Optimization**:

- Use memory-based streams for ephemeral data (fast, no disk)
- Use file-based streams for durable data (persistent, slower)
- Set appropriate retention policies to prevent unbounded growth

---

## 4. Sizing Calculator

### 4.1 Input Variables

Collect these values before sizing:

| Variable | Description | How to Estimate |
|----------|-------------|-----------------|
| `MSG_RATE` | Messages per second | Expected event frequency across all modules |
| `AVG_MSG_SIZE` | Average message size (bytes) | Typical event payload size (500-5000 bytes) |
| `RETENTION_HOURS` | Message retention (hours) | How long to keep events (24-168 hours) |
| `STREAM_COUNT` | Number of JetStream streams | One per event type/module |

### 4.2 Memory Calculation

```bash
#!/bin/bash
# NATS + JetStream sizing calculator

MSG_RATE=${1:-100}           # msgs/sec
AVG_MSG_SIZE=${2:-1024}      # bytes
RETENTION_HOURS=${3:-168}    # 7 days
STREAM_COUNT=${4:-10}

# Base NATS overhead
BASE_MEMORY_MB=30

# JetStream memory overhead (metadata, indexes)
# Formula: stream_count * 5MB + (msg_rate * avg_msg_size * 60 seconds / 1MB)
JETSTREAM_METADATA_MB=$(echo "$STREAM_COUNT * 5" | bc)

# Working memory for in-flight messages (1 minute buffer)
WORKING_MEMORY_MB=$(echo "$MSG_RATE * $AVG_MSG_SIZE * 60 / 1024 / 1024" | bc)

# Total recommended memory
TOTAL_MB=$(echo "$BASE_MEMORY_MB + $JETSTREAM_METADATA_MB + $WORKING_MEMORY_MB" | bc)

# Container limit (add 30% headroom)
CONTAINER_LIMIT_MB=$(echo "$TOTAL_MB * 1.3" | bc | cut -d. -f1)

echo "=== NATS + JetStream Sizing Results ==="
echo "Message Rate: ${MSG_RATE} msgs/sec"
echo "Avg Message Size: ${AVG_MSG_SIZE} bytes"
echo "Retention: ${RETENTION_HOURS} hours"
echo "Stream Count: ${STREAM_COUNT}"
echo ""
echo "Memory Breakdown:"
echo "  Base NATS:     ${BASE_MEMORY_MB} MB"
echo "  JetStream metadata: ${JETSTREAM_METADATA_MB} MB"
echo "  Working memory: ${WORKING_MEMORY_MB} MB"
echo "  ─────────────────────"
echo "  TOTAL:         ${TOTAL_MB} MB"
echo ""
echo "Recommended container limit: ${CONTAINER_LIMIT_MB} MB"
echo "max_memory_store: $(echo "$TOTAL_MB * 0.7" | bc | cut -d. -f1)MB"
```

### 4.3 Disk Calculation

```bash
# Disk space calculation for JetStream file store

# Total messages over retention period
TOTAL_MESSAGES=$(echo "$MSG_RATE * $RETENTION_HOURS * 3600" | bc)

# Raw data size
DATA_SIZE_GB=$(echo "$TOTAL_MESSAGES * $AVG_MSG_SIZE / 1024 / 1024 / 1024" | bc)

# Overhead (metadata, indexes) - 20% of data
OVERHEAD_GB=$(echo "$DATA_SIZE_GB * 0.2" | bc)

# Total disk for JetStream
JETSTREAM_DISK_GB=$(echo "$DATA_SIZE_GB + $OVERHEAD_GB" | bc)

# Add buffer (2x for safety)
TOTAL_DISK_GB=$(echo "$JETSTREAM_DISK_GB * 2" | bc)

echo "Disk Requirements:"
echo "  JetStream data: ${DATA_SIZE_GB} GB"
echo "  Metadata overhead: ${OVERHEAD_GB} GB"
echo "  Safety buffer (2x): ${JETSTREAM_DISK_GB} GB"
echo "  ─────────────────────"
echo "  TOTAL:   ${TOTAL_DISK_GB} GB"
```

### 4.4 Quick Reference Table

| Workload | Msg Rate | Avg Size | Retention | Memory | Disk |
|----------|----------|----------|-----------|--------|------|
| Development | 10/sec | 1 KB | 24h | 128 MB | 2 GB |
| Small Production | 100/sec | 1 KB | 168h | 256 MB | 10 GB |
| Medium Production | 500/sec | 2 KB | 168h | 512 MB | 50 GB |
| Large Production | 2000/sec | 2 KB | 168h | 1 GB | 200 GB |

---

## 5. Backup Strategy

### 5.1 Backup Method

**Primary Tool**: JetStream stream snapshot export

**Recommended Command**:

```bash
# Backup all streams
docker exec nats nats stream backup --all /data/backup/streams

# Backup specific stream
docker exec nats nats stream backup <stream-name> /data/backup/streams/<stream-name>
```

**Options Explained**:

| Option | Purpose | Required |
|--------|---------|----------|
| `--all` | Backup all streams | For full backup |
| Stream name | Backup specific stream | For incremental |

**Alternative**: Volume-level backup (simpler, requires downtime)

```bash
docker compose stop nats
tar czf nats-jetstream-$(date +%Y%m%d).tar.gz /var/lib/docker/volumes/pmdl_nats_data/_data
docker compose start nats
```

### 5.2 Backup Script (Secrets-Aware)

```bash
#!/bin/bash
# backup-scripts/backup-nats.sh
set -euo pipefail

# Configuration
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_nats}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/nats}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup all JetStream streams
echo "Backing up NATS JetStream streams..."
docker exec "$CONTAINER_NAME" sh -c \
    "nats stream backup --all /data/backup/streams-$TIMESTAMP" || {
    echo "WARNING: Stream backup failed, falling back to volume copy"
    # Fallback: Copy entire data directory
    docker cp "$CONTAINER_NAME:/data/jetstream" "$BACKUP_DIR/jetstream-$TIMESTAMP"
}

# Copy backup out of container
docker cp "$CONTAINER_NAME:/data/backup/streams-$TIMESTAMP" "$BACKUP_DIR/" || {
    echo "Using volume copy as backup"
}

# Compress backup
tar czf "$BACKUP_DIR/nats-jetstream-$TIMESTAMP.tar.gz" \
    -C "$BACKUP_DIR" "streams-$TIMESTAMP" 2>/dev/null || \
    tar czf "$BACKUP_DIR/nats-jetstream-$TIMESTAMP.tar.gz" \
    -C "$BACKUP_DIR" "jetstream-$TIMESTAMP"

# Generate checksum
sha256sum "$BACKUP_DIR/nats-jetstream-$TIMESTAMP.tar.gz" \
    > "$BACKUP_DIR/nats-jetstream-$TIMESTAMP.tar.gz.sha256"

# Cleanup intermediate files
rm -rf "$BACKUP_DIR/streams-$TIMESTAMP" "$BACKUP_DIR/jetstream-$TIMESTAMP"

echo "Backup complete: $BACKUP_DIR/nats-jetstream-$TIMESTAMP.tar.gz"
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
age -r age1publickey... nats-jetstream-backup.tar.gz > nats-jetstream-backup.tar.gz.age

# Using rclone crypt
rclone sync ./backups/ encrypted-remote:nats-backups/
```

### 5.5 Restore Procedure

```bash
#!/bin/bash
# backup-scripts/restore-nats.sh
set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-pmdl_nats}"

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: $0 <backup_file.tar.gz>"
    exit 1
fi

# Verify backup integrity
sha256sum -c "$BACKUP_FILE.sha256" || { echo "Checksum mismatch!"; exit 1; }

echo "WARNING: This will overwrite existing JetStream data!"
read -p "Type 'RESTORE' to confirm: " confirm
[[ "$confirm" == "RESTORE" ]] || { echo "Aborted."; exit 1; }

# Stop NATS
docker compose stop nats

# Extract backup
TEMP_DIR=$(mktemp -d)
tar xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Copy backup into container volume
docker cp "$TEMP_DIR"/* "$CONTAINER_NAME:/data/jetstream/"

# Cleanup
rm -rf "$TEMP_DIR"

# Start NATS
docker compose start nats

echo "Restore complete. Verify streams with: docker exec nats nats stream ls"
```

### 5.6 Restore Testing Procedure

Monthly restore testing (per D2.4):

```bash
#!/bin/bash
# backup-scripts/test-restore.sh

# 1. Create temporary container
docker run -d --name nats-restore-test \
    -e NATS_ENABLE_JETSTREAM=true \
    nats:2-alpine -js

# 2. Wait for container to be ready
sleep 10

# 3. Restore backup to temp container
tar xzf latest-backup.tar.gz -C /tmp/
docker cp /tmp/streams-* nats-restore-test:/data/jetstream/

# 4. Restart to load streams
docker restart nats-restore-test
sleep 5

# 5. Run verification
docker exec nats-restore-test nats stream ls

# 6. Cleanup
docker rm -f nats-restore-test
rm -rf /tmp/streams-*

echo "Restore test passed."
```

---

## 6. Startup & Health

### 6.1 Healthcheck Configuration

**CRITICAL**: NATS healthcheck is simple - check if the server is listening on port 4222.

```yaml
services:
  nats:
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

### 6.2 Healthcheck Script (Secrets-Aware)

```bash
#!/bin/bash
# healthcheck-scripts/healthcheck-nats.sh

# Check if NATS is accepting connections
nc -z localhost 4222 || exit 1

# Optional: Check JetStream is enabled (requires nats CLI)
if command -v nats &> /dev/null; then
    nats account info > /dev/null 2>&1 || exit 1
fi

exit 0
```

**Alternative** (using wget - available in alpine image):

```yaml
healthcheck:
  test: ["CMD", "wget", "--spider", "-q", "http://localhost:8222/healthz"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s
```

**Note**: NATS exposes a monitoring endpoint on port 8222 with `/healthz` endpoint.

### 6.3 depends_on Pattern

```yaml
services:
  app:
    depends_on:
      nats:
        condition: service_healthy
```

### 6.4 Init Scripts (Secrets-Aware)

NATS does not support traditional init scripts. Stream creation is done via:

1. Application code (recommended - declarative stream creation on first publish)
2. Manual setup after deployment
3. Init container that runs nats CLI commands

**Init Container Pattern**:

```yaml
services:
  nats-init:
    image: natsio/nats-box:latest
    depends_on:
      nats:
        condition: service_healthy
    volumes:
      - ./profiles/nats/init-scripts/init-streams.sh:/init-streams.sh:ro
    command: ["/init-streams.sh"]
    networks:
      - app-internal
```

**Example init-streams.sh**:

```bash
#!/bin/sh
# Read auth token
TOKEN=$(cat /run/secrets/nats_auth_token)

# Create streams
nats stream add EVENTS \
    --subjects "events.*" \
    --retention limits \
    --max-msgs=-1 \
    --max-bytes=1GB \
    --max-age=168h \
    --storage file \
    --replicas 1 \
    --server nats://nats:4222 \
    --creds <(echo "$TOKEN")
```

### 6.5 Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `interval` | 10s | NATS starts fast, frequent checks acceptable |
| `timeout` | 5s | Health endpoint responds in <100ms |
| `retries` | 5 | Allow recovery from transient network issues |
| `start_period` | 30s | JetStream initialization can take 10-20s |

---

## 7. Storage Options

### 7.1 Local Disk Configuration

For development and simple deployments:

```yaml
services:
  nats:
    volumes:
      - pmdl_nats_data:/data

volumes:
  pmdl_nats_data:
    driver: local
```

**Directory Permissions**:

```bash
# If using bind mounts
mkdir -p ./data/nats
chown 999:999 ./data/nats  # UID/GID of nats user
chmod 700 ./data/nats
```

### 7.2 Attached Volume Configuration

For cloud/VPS with block storage:

```yaml
volumes:
  pmdl_nats_data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/block-storage/nats
      o: bind
```

**Pre-requisites**:
1. Mount block storage to `/mnt/block-storage`
2. Create subdirectory: `mkdir -p /mnt/block-storage/nats`
3. Set ownership: `chown 999:999 /mnt/block-storage/nats`

### 7.3 Remote/S3 Considerations

NATS JetStream data should NOT be stored on network filesystems like S3/MinIO for primary storage due to:

- POSIX filesystem requirements (file locking, atomic writes)
- Latency sensitivity for message persistence
- Sequential I/O patterns optimized for local disk

**S3 is appropriate for**:
- Backups (via rclone)
- Archived streams (export to object storage)
- Long-term event log storage

### 7.4 Volume Backup Procedure

```bash
# Stop service before volume backup
docker compose stop nats

# Backup volume
docker run --rm \
    -v pmdl_nats_data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine tar czf /backup/volume-nats-$(date +%Y%m%d).tar.gz /data

# Restart service
docker compose start nats
```

**Note**: Volume backups require service downtime. Prefer JetStream stream snapshots for zero-downtime backups.

---

## 8. VPS Integration

### 8.1 Disk Provisioning Guidance

**Minimum Disk Requirements**:

| Workload | Data Disk | System Disk | Total |
|----------|-----------|-------------|-------|
| Development | 2 GB | 20 GB | 22 GB |
| Small Prod | 10 GB | 20 GB | 30 GB |
| Medium Prod | 50 GB | 20 GB | 70 GB |

**VPS Provider Notes**:

- **DigitalOcean**: Use block storage volumes for data retention >1 week
- **Hetzner**: Local NVMe sufficient for most workloads
- **Vultr**: Block storage recommended for production

### 8.2 Swap Considerations

**Recommendation**: Enable small swap as safety net

**Rationale**: NATS is memory-efficient and should not swap under normal operation. Small swap (1-2GB) protects against OOM kills during unexpected spikes.

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

### 8.3 Kernel Parameters

Recommended sysctl settings for NATS:

```bash
# /etc/sysctl.d/99-nats.conf

# Increase file descriptor limits
fs.file-max = 100000

# Network settings for high-connection scenarios
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096

# Reduce TIME_WAIT state duration
net.ipv4.tcp_fin_timeout = 30
```

### 8.4 Monitoring Hooks

**Key Metrics to Monitor**:

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| Connection count | 500 | 900 |
| Memory usage | 80% | 95% |
| JetStream storage | 70% | 85% |
| Message rate | Baseline +100% | Baseline +200% |
| Slow consumers | >5 | >20 |

**Prometheus Exporter**:

NATS exposes metrics on the monitoring port (8222):

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'nats'
    static_configs:
      - targets: ['nats:8222']
    metrics_path: '/metrics'
```

**Health Check Integration**:

```bash
# For external monitoring
curl -f http://localhost:8222/healthz || exit 1
```

---

## 9. Compose Fragment

### 9.1 Complete Service Definition

Copy this entire block to your `docker-compose.yml`:

```yaml
# ==============================================================
# NATS + JetStream - Supporting Tech Profile
# ==============================================================
# Profile Version: 1.0
# Documentation: profiles/nats/PROFILE-SPEC.md
# ==============================================================

services:
  nats:
    image: nats:2-alpine
    container_name: pmdl_nats

    # Run as non-root
    user: "999:999"  # nats:nats

    # Command: Enable JetStream with configuration
    command:
      - "--jetstream"
      - "--store_dir=/data/jetstream"
      - "--max_memory_store=280MB"
      - "--max_file_store=2GB"
      - "--http_port=8222"
      - "--auth_token_file=/run/secrets/nats_auth_token"

    # Secrets configuration
    secrets:
      - nats_auth_token

    # Environment
    environment:
      NATS_SERVER_NAME: pmdl-nats

    # Volumes
    volumes:
      - pmdl_nats_data:/data
      - ./profiles/nats/healthcheck-scripts/healthcheck-nats.sh:/healthcheck.sh:ro

    # Health check
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8222/healthz"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

    # Network isolation
    networks:
      - app-internal

    # Resource limits (small profile)
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 128M

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
  nats_auth_token:
    file: ./secrets/nats_auth_token

# Volumes
volumes:
  pmdl_nats_data:
    driver: local

# Networks (reference existing)
networks:
  app-internal:
    external: true
```

### 9.2 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NATS_SERVER_NAME` | No | Generated | Server name for clustering (informational) |

### 9.3 Command-Line Flags Reference

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--jetstream` | Yes | Disabled | Enable JetStream |
| `--store_dir` | Yes | - | JetStream storage directory |
| `--max_memory_store` | No | 75% RAM | Maximum memory for streams |
| `--max_file_store` | No | 10GB | Maximum disk for streams |
| `--http_port` | No | 8222 | Monitoring/metrics port |
| `--auth_token_file` | No | - | Authentication token file path |

### 9.4 Secret Files Required

Generate these before starting:

```bash
# scripts/generate-secrets.sh additions

# NATS authentication token (32-byte random)
openssl rand -hex 32 > ./secrets/nats_auth_token
chmod 600 ./secrets/nats_auth_token
```

---

## 10. Troubleshooting

### Common Issues

#### Issue 1: JetStream Not Enabled

**Symptoms**: Clients cannot create streams, error "JetStream not enabled"

**Cause**: Missing `--jetstream` flag in command

**Solution**:
```yaml
command:
  - "--jetstream"
  - "--store_dir=/data/jetstream"
```

#### Issue 2: Permission Denied on Data Directory

**Symptoms**: Container fails to start, logs show permission errors on `/data`

**Cause**: Volume directory not owned by nats user (UID 999)

**Solution**:
```bash
# For bind mounts
chown 999:999 ./data/nats

# For named volumes, recreate
docker volume rm pmdl_nats_data
docker compose up -d nats
```

#### Issue 3: Out of Memory (JetStream)

**Symptoms**: Messages fail to publish, error "insufficient resources"

**Cause**: JetStream memory limit reached

**Solution**: Increase `max_memory_store` or use file-based streams
```yaml
command:
  - "--max_memory_store=512MB"
```

#### Issue 4: Authentication Failures

**Symptoms**: Clients cannot connect, error "authorization violation"

**Cause**: Token mismatch or secret file not mounted

**Solution**:
```bash
# Verify secret is mounted
docker exec pmdl_nats cat /run/secrets/nats_auth_token

# Verify client is using correct token
docker exec pmdl_nats nats server ls --user=token --password=$(cat ./secrets/nats_auth_token)
```

#### Issue 5: Health Check Fails

**Symptoms**: Container shows `unhealthy` despite NATS running

**Cause**: Monitoring port (8222) not accessible

**Solution**: Verify monitoring is enabled
```yaml
command:
  - "--http_port=8222"
```

#### Issue 6: Stream Storage Full

**Symptoms**: Messages rejected with "maximum bytes exceeded"

**Cause**: Stream reached `max_file_store` limit

**Solution**: Increase limit or adjust retention policy
```bash
# Increase global limit
docker compose down
# Edit docker-compose.yml: --max_file_store=5GB
docker compose up -d

# Or adjust stream retention
docker exec pmdl_nats nats stream edit EVENTS --max-age=24h
```

### Log Analysis

**View logs**:
```bash
docker logs pmdl_nats --tail 100 -f
```

**Common log patterns**:

| Pattern | Meaning | Action |
|---------|---------|--------|
| `[INF] Starting nats-server` | Successful startup | None |
| `[INF] JetStream enabled` | JetStream active | None |
| `[ERR] Authorization violation` | Auth failure | Check token |
| `[WRN] Slow consumer` | Client not keeping up | Scale consumer or increase buffer |
| `[ERR] Maximum file store exceeded` | Storage full | Increase limit or reduce retention |

---

## 11. References

### Official Documentation

- [NATS Documentation](https://docs.nats.io/)
- [JetStream Documentation](https://docs.nats.io/nats-concepts/jetstream)
- [NATS Docker Hub](https://hub.docker.com/_/nats)
- [NATS Configuration Reference](https://docs.nats.io/running-a-nats-service/configuration)

### Foundation Decisions Referenced

| Decision | Relevance |
|----------|-----------|
| D3.1 Secret Management | File-based secrets pattern |
| D4.1 Health Checks | Timing parameters, monitoring endpoint |
| D4.2 Resource Constraints | Memory limits, profile budgets |
| ADR-0002 Network Isolation | Zone placement (app-internal) |
| D2.4 Backup Recovery | Stream snapshot tools, retention policy |
| D9 Storage Strategy | Volume configuration |

### Related Profiles

- **Redis**: Alternative for pub/sub (ephemeral, no persistence)
- **PostgreSQL**: Complement for event sourcing (NATS for transport, PostgreSQL for storage)
- **MongoDB**: Complement for event log archival

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-22 | Initial creation | AI Agent |

---

*Profile Template Version: 1.0*
*Last Updated: 2026-02-22*
*Part of PeerMesh Docker Lab*
