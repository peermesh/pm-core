# Supporting Tech Profile: [TECHNOLOGY NAME]

**Version**: [IMAGE_VERSION]
**Category**: [Database | Cache | Queue | Search | Storage]
**Status**: Draft | Review | Complete
**Last Updated**: YYYY-MM-DD

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

### What Is [Technology]?

[Brief description of the technology - 2-3 sentences maximum]

### When to Use This Profile

Use this profile when your application needs:

- [ ] [Primary use case 1]
- [ ] [Primary use case 2]
- [ ] [Primary use case 3]

### When NOT to Use This Profile

Do NOT use this profile if:

- [ ] [Anti-pattern or unsuitable use case 1]
- [ ] [Anti-pattern or unsuitable use case 2]

### Comparison with Alternatives

| Feature | [This Tech] | [Alternative 1] | [Alternative 2] |
|---------|-------------|-----------------|-----------------|
| Best for | ... | ... | ... |
| Memory footprint | ... | ... | ... |
| Scaling model | ... | ... | ... |
| Learning curve | ... | ... | ... |

**Recommendation**: [When to choose this over alternatives]

---

## 2. Security Configuration

### 2.1 Non-Root Execution

[Technology] runs as a non-root user inside the container:

```yaml
services:
  [service-name]:
    user: "[uid]:[gid]"  # [username]:[groupname]
```

**Note**: [Any caveats about running as non-root, e.g., file permission requirements]

### 2.2 Secrets via `_FILE` Suffix

All credentials MUST use file-based secrets, never environment variables with raw values.

**Supported Secret Variables**:

| Variable | `_FILE` Equivalent | Purpose |
|----------|-------------------|---------|
| `[VAR_1]` | `[VAR_1]_FILE` | [Purpose] |
| `[VAR_2]` | `[VAR_2]_FILE` | [Purpose] |

**Compose Configuration**:

```yaml
services:
  [service-name]:
    secrets:
      - [secret-name-1]
      - [secret-name-2]
    environment:
      [VAR_1]_FILE: /run/secrets/[secret-name-1]
      [VAR_2]_FILE: /run/secrets/[secret-name-2]

secrets:
  [secret-name-1]:
    file: ./secrets/[filename-1]
  [secret-name-2]:
    file: ./secrets/[filename-2]
```

### 2.3 Network Isolation

This service should be placed in the `[zone]` network zone:

```yaml
services:
  [service-name]:
    networks:
      - db-internal    # For database access from apps
      # NOT exposed to frontend or internet networks
```

**Network Zones** (per D3.3):

| Zone | Access Level | This Service |
|------|--------------|--------------|
| `frontend` | Public-facing | No |
| `backend` | App-to-app | [Yes/No] |
| `db-internal` | Database only | [Yes/No] |
| `monitoring` | Metrics/logs | [Yes/No] |

### 2.4 Authentication Enforcement

**Default Authentication**: [Enabled/Disabled out of the box]

**Required Configuration**:

```yaml
# Enforce authentication
environment:
  [AUTH_REQUIRED_VAR]: "true"  # or equivalent
```

**Connection String Pattern**:

```
[protocol]://[user]:[password]@[host]:[port]/[database]
```

### 2.5 TLS/Encryption

**In-Transit Encryption**:

- [ ] Native TLS support: [Yes/No]
- [ ] Configuration method: [Brief description]

**At-Rest Encryption**:

- [ ] Native encryption: [Yes/No]
- [ ] Recommendation: [Use volume encryption if native not available]

---

## 3. Performance Tuning

### 3.1 Memory Allocation

**Primary Memory Parameter**: `[parameter_name]`

**Formula**:

```
[parameter_name] = [formula based on available RAM]
```

**Example Configurations**:

| System RAM | [Parameter] | Other Settings |
|------------|-------------|----------------|
| 1 GB | [value] | [related settings] |
| 2 GB | [value] | [related settings] |
| 4 GB | [value] | [related settings] |
| 8 GB | [value] | [related settings] |

**Docker Compose Memory Limits**:

```yaml
services:
  [service-name]:
    deploy:
      resources:
        limits:
          memory: [calculated_limit]
        reservations:
          memory: [minimum_required]
```

### 3.2 Connection Limits

**Maximum Connections Formula**:

```
max_connections = [formula]
```

**Factors**:
- Per-connection memory overhead: [size]
- Connection pooling recommendation: [Yes/No, with rationale]
- Timeout settings: [recommended values]

**Configuration**:

```yaml
environment:
  [MAX_CONNECTIONS_VAR]: "[value]"
```

### 3.3 I/O Optimization

**Disk I/O Settings**:

```yaml
# For SSDs
[setting_1]: [value]
[setting_2]: [value]

# For HDDs (if different)
[setting_1]: [value]
[setting_2]: [value]
```

### 3.4 Query/Operation Optimization

[Technology-specific optimizations like query cache, indexes, etc.]

---

## 4. Sizing Calculator

### 4.1 Input Variables

Collect these values before sizing:

| Variable | Description | How to Estimate |
|----------|-------------|-----------------|
| `DATA_SIZE_GB` | Expected data footprint | [Estimation guidance] |
| `PEAK_CONNECTIONS` | Maximum concurrent connections | [Estimation guidance] |
| `QUERIES_PER_SEC` | Expected query rate | [Estimation guidance] |
| `WRITE_PERCENTAGE` | % of writes vs reads | [Estimation guidance] |

### 4.2 Memory Calculation

```bash
#!/bin/bash
# sizing-calculator.sh

DATA_SIZE_GB=${1:-10}
PEAK_CONNECTIONS=${2:-100}
QUERIES_PER_SEC=${3:-50}

# Base memory for [Technology]
BASE_MEMORY_MB=[value]

# Per-connection overhead
CONNECTION_MEMORY_MB=$(echo "$PEAK_CONNECTIONS * [per_connection_mb]" | bc)

# Working set memory (cache/buffer)
# Rule: [Technology-specific rule, e.g., "25% of data size"]
WORKING_SET_MB=$(echo "$DATA_SIZE_GB * 1024 * [percentage]" | bc)

# Total recommended memory
TOTAL_MB=$(echo "$BASE_MEMORY_MB + $CONNECTION_MEMORY_MB + $WORKING_SET_MB" | bc)

echo "=== [Technology] Sizing Results ==="
echo "Data Size: ${DATA_SIZE_GB} GB"
echo "Peak Connections: ${PEAK_CONNECTIONS}"
echo ""
echo "Memory Breakdown:"
echo "  Base:       ${BASE_MEMORY_MB} MB"
echo "  Connections: ${CONNECTION_MEMORY_MB} MB"
echo "  Working Set: ${WORKING_SET_MB} MB"
echo "  ─────────────────────"
echo "  TOTAL:      ${TOTAL_MB} MB"
echo ""
echo "Docker memory limit: ${TOTAL_MB}m"
echo "[Primary memory parameter]: $(echo "$WORKING_SET_MB" | bc)MB"
```

### 4.3 Disk Calculation

```bash
# Disk space calculation

# Data storage
DATA_DISK_GB=$DATA_SIZE_GB

# Index overhead (typically [percentage]% of data)
INDEX_OVERHEAD_GB=$(echo "$DATA_SIZE_GB * [index_factor]" | bc)

# Transaction logs/WAL (typically [value] GB minimum)
LOG_DISK_GB=[value]

# Backup space (at least 1x data for local dumps)
BACKUP_DISK_GB=$DATA_SIZE_GB

# Total
TOTAL_DISK_GB=$(echo "$DATA_DISK_GB + $INDEX_OVERHEAD_GB + $LOG_DISK_GB + $BACKUP_DISK_GB" | bc)

echo "Disk Requirements:"
echo "  Data:    ${DATA_DISK_GB} GB"
echo "  Indexes: ${INDEX_OVERHEAD_GB} GB"
echo "  Logs:    ${LOG_DISK_GB} GB"
echo "  Backups: ${BACKUP_DISK_GB} GB"
echo "  ─────────────────────"
echo "  TOTAL:   ${TOTAL_DISK_GB} GB"
```

### 4.4 Quick Reference Table

| Workload | Data Size | Connections | Memory | Disk |
|----------|-----------|-------------|--------|------|
| Development | <1 GB | <10 | 256 MB | 5 GB |
| Small Production | 1-10 GB | 10-50 | 512 MB | 20 GB |
| Medium Production | 10-50 GB | 50-200 | 2 GB | 100 GB |
| Large Production | 50-200 GB | 200-500 | 8 GB | 400 GB |

---

## 5. Backup Strategy

### 5.1 Backup Method

**Primary Tool**: `[native_dump_tool]`

**Recommended Command**:

```bash
docker exec [container_name] [dump_command] \
    [options] \
    > backup.dump
```

**Options Explained**:

| Option | Purpose | Required |
|--------|---------|----------|
| `[option_1]` | [purpose] | Yes/No |
| `[option_2]` | [purpose] | Yes/No |

### 5.2 Backup Script (Secrets-Aware)

```bash
#!/bin/bash
# backup-scripts/backup.sh
set -euo pipefail

# Configuration
CONTAINER_NAME="${CONTAINER_NAME:-[default_name]}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/[tech]}"
SECRET_FILE="${SECRET_FILE:-./secrets/[secret_name]}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# Read secret from file (NEVER from environment variable)
PASSWORD=$(cat "$SECRET_FILE")

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Execute backup
docker exec "$CONTAINER_NAME" [dump_command] \
    [auth_options] \
    [other_options] \
    | gzip > "$BACKUP_DIR/[tech]-$TIMESTAMP.dump.gz"

# Generate checksum
sha256sum "$BACKUP_DIR/[tech]-$TIMESTAMP.dump.gz" > "$BACKUP_DIR/[tech]-$TIMESTAMP.dump.gz.sha256"

# Verify backup integrity
gzip -t "$BACKUP_DIR/[tech]-$TIMESTAMP.dump.gz"

echo "Backup complete: $BACKUP_DIR/[tech]-$TIMESTAMP.dump.gz"
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
age -r age1... backup.dump.gz > backup.dump.gz.age

# Using rclone crypt
rclone sync ./backups/ encrypted-remote:backups/
```

### 5.5 Restore Procedure

```bash
#!/bin/bash
# backup-scripts/restore.sh
set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-[default_name]}"
SECRET_FILE="${SECRET_FILE:-./secrets/[secret_name]}"

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: $0 <backup_file.dump.gz>"
    exit 1
fi

# Verify backup integrity
gzip -t "$BACKUP_FILE" || { echo "Backup file is corrupt!"; exit 1; }

# Verify checksum if available
if [[ -f "$BACKUP_FILE.sha256" ]]; then
    sha256sum -c "$BACKUP_FILE.sha256" || { echo "Checksum mismatch!"; exit 1; }
fi

# Read secret from file
PASSWORD=$(cat "$SECRET_FILE")

echo "WARNING: This will overwrite existing data!"
read -p "Type 'RESTORE' to confirm: " confirm
[[ "$confirm" == "RESTORE" ]] || { echo "Aborted."; exit 1; }

# Execute restore
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" [restore_command] \
    [auth_options] \
    [other_options]

echo "Restore complete."
```

### 5.6 Restore Testing Procedure

Monthly restore testing (per D2.4):

```bash
#!/bin/bash
# backup-scripts/test-restore.sh

# 1. Create temporary container
docker run -d --name [tech]-restore-test \
    -e [INIT_VARS] \
    [image]:[version]

# 2. Wait for container to be ready
sleep 30

# 3. Restore backup to temp container
./restore.sh latest.dump.gz

# 4. Run verification queries
docker exec [tech]-restore-test [verify_command]

# 5. Cleanup
docker rm -f [tech]-restore-test

echo "Restore test passed."
```

---

## 6. Startup & Health

### 6.1 Healthcheck Configuration

**CRITICAL**: Health checks must work with `_FILE` secrets. They CANNOT rely on environment variables like `$PASSWORD` because those don't exist when using `_FILE` suffix.

**Recommended Approach**: Use a wrapper script that reads the secret from file.

```yaml
services:
  [service-name]:
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

# Read password from secret file (NOT environment variable)
if [[ -f /run/secrets/[secret_name] ]]; then
    PASSWORD=$(cat /run/secrets/[secret_name])
else
    # Fallback for development without secrets
    PASSWORD="${[ENV_VAR]:-}"
fi

# Execute health check
[native_health_command] \
    [auth_with_password] \
    || exit 1

exit 0
```

**Dockerfile Addition** (if custom image needed):

```dockerfile
COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /healthcheck.sh
HEALTHCHECK CMD ["/healthcheck.sh"]
```

### 6.3 depends_on Pattern

```yaml
services:
  app:
    depends_on:
      [service-name]:
        condition: service_healthy
```

### 6.4 Init Scripts (Secrets-Aware)

Init scripts that create users or databases MUST read secrets from files:

```bash
#!/bin/bash
# init-scripts/01-init.sh

# CRITICAL: Read secrets from mounted files, NEVER hardcode
APP_PASSWORD=$(cat /run/secrets/app_db_password)

# Create application user and database
[create_user_command] --password="$APP_PASSWORD"
[create_database_command]
[grant_permissions_command]

echo "Initialization complete."
```

**NEVER DO THIS**:

```bash
# WRONG - Hardcoded password
[create_user_command] --password="CHANGEME_password123"
```

### 6.5 Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `interval` | 10s | [Technology-specific reason] |
| `timeout` | 5s | [Technology-specific reason] |
| `retries` | 5 | [Technology-specific reason] |
| `start_period` | 60s | [Account for init scripts, etc.] |

---

## 7. Storage Options

### 7.1 Local Disk Configuration

For development and simple deployments:

```yaml
services:
  [service-name]:
    volumes:
      - [tech]_data:/var/lib/[tech]/data

volumes:
  [tech]_data:
    driver: local
```

**Directory Permissions**:

```bash
# If using bind mounts
mkdir -p ./data/[tech]
chown [uid]:[gid] ./data/[tech]
chmod 700 ./data/[tech]
```

### 7.2 Attached Volume Configuration

For cloud/VPS with block storage:

```yaml
volumes:
  [tech]_data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/block-storage/[tech]
      o: bind
```

**Pre-requisites**:
1. Mount block storage to `/mnt/block-storage`
2. Create subdirectory: `mkdir -p /mnt/block-storage/[tech]`
3. Set ownership: `chown [uid]:[gid] /mnt/block-storage/[tech]`

### 7.3 Remote/S3 Considerations

[Technology] data volumes should NOT be stored on network filesystems like S3/MinIO for primary data due to:

- [Reason 1: e.g., POSIX requirements]
- [Reason 2: e.g., latency sensitivity]

**S3 is appropriate for**:
- Backups (via rclone)
- Archived data
- Large binary objects (if supported via extension/plugin)

### 7.4 Volume Backup Procedure

```bash
# Stop service before volume backup
docker compose stop [service-name]

# Backup volume
docker run --rm \
    -v [tech]_data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine tar czf /backup/volume-[tech]-$(date +%Y%m%d).tar.gz /data

# Restart service
docker compose start [service-name]
```

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

- **DigitalOcean**: Use block storage volumes, attach before deployment
- **Hetzner**: Cloud volumes or local NVMe
- **Vultr**: Block storage recommended for production

### 8.2 Swap Considerations

**Recommendation**: [Enable/Disable] swap for [Technology]

**Rationale**: [Why swap helps or hurts this technology]

**Configuration**:

```bash
# If swap is beneficial
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Adjust swappiness for [Technology]
echo 'vm.swappiness=[recommended_value]' | sudo tee -a /etc/sysctl.conf
```

### 8.3 Kernel Parameters

Recommended sysctl settings for [Technology]:

```bash
# /etc/sysctl.d/99-[tech].conf

# [Parameter 1 explanation]
[parameter.name] = [value]

# [Parameter 2 explanation]
[parameter.name] = [value]
```

### 8.4 Monitoring Hooks

**Key Metrics to Monitor**:

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| [Metric 1] | [value] | [value] |
| [Metric 2] | [value] | [value] |
| [Metric 3] | [value] | [value] |
| Disk usage | 70% | 85% |
| Memory usage | 80% | 95% |

**Prometheus Exporter** (if available):

```yaml
services:
  [tech]-exporter:
    image: [exporter_image]
    environment:
      [CONNECTION_VAR]: "[connection_string]"
    ports:
      - "127.0.0.1:[port]:[port]"
```

**Health Check Integration**:

```bash
# For external monitoring
curl -f http://localhost:[port]/health || exit 1
```

---

## 9. Compose Fragment

### 9.1 Complete Service Definition

Copy this entire block to your `docker-compose.yml` and replace all `[PLACEHOLDERS]` with actual values:

> **Note**: The placeholders below use `[brackets]` notation. Replace these with actual technology-specific values (e.g., `[VAR_1]_FILE` becomes `POSTGRES_PASSWORD_FILE`).

```yaml
# ==============================================================
# [TECHNOLOGY NAME] - Supporting Tech Profile
# ==============================================================
# Profile Version: [version]
# Documentation: profiles/[tech]/PROFILE-SPEC.md
# ==============================================================

services:
  [service-name]:
    image: [image]:[tag]
    container_name: [container_name]

    # Run as non-root
    user: "[uid]:[gid]"

    # Secrets configuration
    secrets:
      - [secret_name_1]
      - [secret_name_2]

    # Environment (using _FILE suffix)
    environment:
      [VAR_1]_FILE: /run/secrets/[secret_name_1]
      [VAR_2]_FILE: /run/secrets/[secret_name_2]
      # Performance tuning
      [TUNING_VAR_1]: "[value]"
      [TUNING_VAR_2]: "[value]"

    # Volumes
    volumes:
      - [tech]_data:/var/lib/[tech]/data
      - ./profiles/[tech]/init-scripts:/docker-entrypoint-initdb.d:ro
      - ./profiles/[tech]/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro

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

    # Resource limits
    deploy:
      resources:
        limits:
          memory: [limit]
        reservations:
          memory: [reservation]

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
  [secret_name_1]:
    file: ./secrets/[filename_1]
  [secret_name_2]:
    file: ./secrets/[filename_2]

# Volumes
volumes:
  [tech]_data:
    driver: local

# Networks (reference existing or define)
networks:
  db-internal:
    external: true  # Or define inline
```

### 9.2 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `[VAR_1]_FILE` | Yes | - | [Description] |
| `[VAR_2]_FILE` | No | [default] | [Description] |
| `[TUNING_VAR]` | No | [default] | [Description] |

### 9.3 Secret Files Required

Generate these before starting:

```bash
# scripts/generate-secrets.sh additions

generate_db_password "[tech]_password"
generate_db_password "[tech]_app_password"
```

---

## 10. Troubleshooting

### Common Issues

#### Issue 1: [Common Problem]

**Symptoms**: [What user sees]

**Cause**: [Why it happens]

**Solution**:
```bash
[Commands to fix]
```

#### Issue 2: Health Check Fails with `_FILE` Secrets

**Symptoms**: Container shows `unhealthy`, logs show authentication errors

**Cause**: Health check is using `$[PASSWORD_VAR]` which doesn't exist when using `_FILE` suffix

**Solution**: Use the provided healthcheck script that reads from `/run/secrets/`:
```bash
# Verify secret is mounted
docker exec [container] cat /run/secrets/[secret_name]

# Check healthcheck script exists
docker exec [container] ls -la /healthcheck.sh
```

#### Issue 3: Permission Denied on Data Directory

**Symptoms**: Container fails to start, logs show permission errors

**Cause**: Volume directory not owned by container user

**Solution**:
```bash
# For bind mounts
chown [uid]:[gid] ./data/[tech]

# For named volumes, recreate
docker volume rm [tech]_data
docker compose up -d [service-name]
```

### Log Analysis

**View logs**:
```bash
docker logs [container_name] --tail 100 -f
```

**Common log patterns**:

| Pattern | Meaning | Action |
|---------|---------|--------|
| `[pattern_1]` | [meaning] | [action] |
| `[pattern_2]` | [meaning] | [action] |

---

## 11. References

### Official Documentation

- [Official docs link]
- [Docker Hub page]
- [Configuration reference]

### Foundation Decisions Referenced

| Decision | Relevance |
|----------|-----------|
| D3.1 Secret Management | File-based secrets pattern |
| D4.1 Health Checks | Timing parameters, YAML anchors |
| D4.3 Startup Ordering | depends_on pattern |
| D3.3 Network Isolation | Zone placement |
| D2.4 Backup Recovery | Dump tools, retention |
| D4.2 Resource Constraints | Memory limits |

### Related Profiles

- [Related profile 1]: [Why related]
- [Related profile 2]: [Why related]

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| YYYY-MM-DD | Initial creation | [name] |

---

*Profile Template Version: 1.0*
*Last Updated: 2025-12-31*
*Part of PeerMesh Docker Lab*
