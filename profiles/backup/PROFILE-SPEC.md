# Feature Profile: Backup Automation

**Version**: 1.0
**Category**: Feature
**Status**: Complete
**Last Updated**: 2026-01-21

---

## Table of Contents

1. [Overview & Use Cases](#1-overview--use-cases)
2. [Quick Start](#2-quick-start)
3. [Configuration](#3-configuration)
4. [Backup Types](#4-backup-types)
5. [Scheduling](#5-scheduling)
6. [Off-Site Storage](#6-off-site-storage)
7. [Restore Procedures](#7-restore-procedures)
8. [Monitoring](#8-monitoring)
9. [Troubleshooting](#9-troubleshooting)
10. [References](#10-references)

---

## 1. Overview & Use Cases

### What Is This Profile?

The backup profile provides automated, scheduled backups of databases and Docker volumes using restic for deduplication, encryption, and off-site storage support.

### Key Features

- **Automated scheduling** - Cron-based, zero daily maintenance
- **Deduplication** - Restic reduces storage costs by 60-90%
- **Encryption** - AES-256 encryption for off-site backups
- **Multiple destinations** - Local, attached storage, S3/MinIO
- **Database-aware** - Pre-backup hooks for data consistency
- **Verification** - Automatic integrity checks

### When to Use This Profile

Enable this profile when you need:

- [x] Automated daily backups without manual intervention
- [x] Off-site backup to S3/MinIO/Backblaze
- [x] Disaster recovery capability
- [x] Volume-level backups (not just database dumps)
- [x] Deduplication to reduce storage costs

### When NOT to Use This Profile

Do NOT use this profile if:

- [ ] You prefer managing backups via system cron (use scripts directly)
- [ ] You have existing backup infrastructure (Velero, Veeam, etc.)
- [ ] You need real-time replication (consider streaming replication)

---

## 2. Quick Start

### 2.1 Generate Secrets

```bash
# Generate restic password
openssl rand -hex 32 > ./secrets/restic_password
chmod 600 ./secrets/restic_password

# For S3/MinIO (optional)
echo "your-access-key" > ./secrets/s3_access_key
echo "your-secret-key" > ./secrets/s3_secret_key
chmod 600 ./secrets/s3_*
```

### 2.2 Configure Environment

Add to your `.env`:

```bash
# Backup profile
BACKUP_LOCAL_PATH=/var/backups/pmdl

# Optional: S3 off-site backup
BACKUP_S3_ENDPOINT=https://s3.example.com
BACKUP_S3_BUCKET=my-backups
```

### 2.3 Enable Profile

```bash
# Add backup to your profiles
COMPOSE_PROFILES=postgresql,backup docker compose up -d

# Verify backup container is running
docker compose ps backup
```

### 2.4 Test Manual Backup

```bash
# Run manual PostgreSQL backup
docker exec pmdl_backup /usr/local/bin/backup-postgres.sh all

# Check backup was created
ls -la /var/backups/pmdl/postgres/daily/
```

---

## 3. Configuration

### 3.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_LOCAL_PATH` | `/var/backups/pmdl` | Local backup destination |
| `VOLUME_PREFIX` | `pmdl_` | Volume filter prefix |
| `POSTGRES_CONTAINER_NAME` | `pmdl_postgres` | PostgreSQL container name |
| `BACKUP_RETENTION_DAILY` | `7` | Days to keep daily backups |
| `BACKUP_RETENTION_WEEKLY` | `4` | Weeks to keep weekly backups |
| `BACKUP_RETENTION_MONTHLY` | `3` | Months to keep monthly backups |
| `BACKUP_RESTIC_REPOSITORY` | (none) | Restic repository URL |
| `BACKUP_S3_ENDPOINT` | (none) | S3-compatible endpoint |
| `BACKUP_S3_BUCKET` | (none) | S3 bucket name |
| `BACKUP_AGE_RECIPIENT` | (none) | Age public key for encryption |

### 3.2 Required Secrets

| Secret File | Purpose |
|-------------|---------|
| `secrets/restic_password` | Restic repository encryption password |
| `secrets/s3_access_key` | S3 access key (if using S3) |
| `secrets/s3_secret_key` | S3 secret key (if using S3) |
| `secrets/age_key` | Age private key (for restore) |

### 3.3 Directory Structure

```
/var/backups/pmdl/
├── postgres/
│   ├── daily/           # Daily database dumps
│   ├── pre-deploy/      # Pre-deployment snapshots
│   └── logs/            # Backup logs
├── volumes/
│   ├── tar/             # Volume tar archives
│   └── logs/            # Volume backup logs
├── restic/              # Local restic repository
└── .last_successful_backup
```

---

## 4. Backup Types

### 4.1 PostgreSQL Logical Backups

- **Tool**: pg_dump / pg_dumpall
- **Format**: gzip-compressed SQL or custom format
- **Schedule**: 2:00 AM daily
- **Use case**: Point-in-time recovery, database migration

**Files produced**:
- `postgres-all-{timestamp}.sql.gz` - Full dump of all databases
- `{database}-{timestamp}.dump` - Single database (custom format)

### 4.2 Docker Volume Backups

- **Tool**: tar via Alpine container
- **Format**: gzip-compressed tar archive
- **Schedule**: 3:00 AM daily
- **Use case**: Complete data recovery, server migration

**Files produced**:
- `{volume_name}-{timestamp}.tar.gz` - Volume archive
- `{volume_name}-{timestamp}.tar.gz.sha256` - Checksum

### 4.3 Restic Snapshots

- **Tool**: restic
- **Format**: Deduplicated, encrypted blocks
- **Schedule**: 4:00 AM daily (sync)
- **Use case**: Efficient off-site storage, point-in-time recovery

**Repository structure**:
- `config` - Repository configuration
- `data/` - Deduplicated data blocks
- `keys/` - Encryption keys
- `snapshots/` - Snapshot metadata

---

## 5. Scheduling

### 5.1 Default Schedule

| Time | Operation |
|------|-----------|
| 02:00 | PostgreSQL pg_dumpall |
| 03:00 | Docker volume backup (all pmdl_ volumes) |
| 04:00 | Off-site sync (S3/restic) |
| 05:00 | Retention cleanup |

### 5.2 Customizing Schedule

The schedule is defined in the backup container's entrypoint. To customize:

1. Create a custom crontab file:

```cron
# /opt/pmdl/profiles/backup/configs/custom-crontab
# PostgreSQL backup - 1:00 AM daily
0 1 * * * /usr/local/bin/backup-postgres.sh all >> /var/log/backup.log 2>&1

# Volume backup - 1:30 AM daily
30 1 * * * /usr/local/bin/backup-volumes.sh backup --all >> /var/log/backup.log 2>&1
```

2. Mount custom crontab:

```yaml
volumes:
  - ./profiles/backup/configs/custom-crontab:/etc/crontabs/root:ro
```

### 5.3 Manual Execution

```bash
# Trigger immediate PostgreSQL backup
docker exec pmdl_backup /usr/local/bin/backup-postgres.sh all

# Trigger immediate volume backup
docker exec pmdl_backup /usr/local/bin/backup-volumes.sh backup --all

# Trigger immediate off-site sync
docker exec pmdl_backup /usr/local/bin/sync-offsite.sh
```

---

## 6. Off-Site Storage

### 6.1 S3/MinIO Configuration

```bash
# .env
BACKUP_S3_ENDPOINT=https://s3.example.com
BACKUP_S3_BUCKET=pmdl-backups

# secrets/s3_access_key
your-access-key-id

# secrets/s3_secret_key
your-secret-access-key
```

### 6.2 Restic Repository Configuration

For dedicated restic backend (more efficient):

```bash
# Local repository
BACKUP_RESTIC_REPOSITORY=/var/backups/pmdl/restic

# S3 repository
BACKUP_RESTIC_REPOSITORY=s3:https://s3.example.com/bucket/path

# SFTP repository
BACKUP_RESTIC_REPOSITORY=sftp:user@host:/backups/pmdl

# REST server
BACKUP_RESTIC_REPOSITORY=rest:https://user:pass@backup.example.com:8000/
```

### 6.3 Backblaze B2 Example

```bash
# .env
BACKUP_S3_ENDPOINT=https://s3.us-west-000.backblazeb2.com
BACKUP_S3_BUCKET=your-bucket-name

# Or use restic directly
BACKUP_RESTIC_REPOSITORY=b2:your-bucket-name:/pmdl-backups
```

### 6.4 MinIO (Self-Hosted) Example

```bash
# .env
BACKUP_S3_ENDPOINT=https://minio.internal:9000
BACKUP_S3_BUCKET=backups
```

---

## 7. Restore Procedures

### 7.1 PostgreSQL Restore

```bash
# List available backups
docker exec pmdl_backup /usr/local/bin/restore-postgres.sh list

# Restore latest
docker exec pmdl_backup /usr/local/bin/restore-postgres.sh restore \
    -f /var/backups/pmdl/postgres/daily/postgres-all-latest.sql.gz

# Restore specific database
docker exec pmdl_backup /usr/local/bin/restore-postgres.sh restore \
    -f /var/backups/pmdl/postgres/daily/synapse-latest.dump \
    -d synapse

# Restore from S3
docker exec pmdl_backup /usr/local/bin/restore-postgres.sh restore \
    -s postgres/postgres-all-2026-01-21.sql.gz
```

### 7.2 Volume Restore

```bash
# Stop containers using the volume
docker compose stop postgres

# Restore volume
docker exec pmdl_backup /usr/local/bin/backup-volumes.sh restore \
    -v pmdl_postgres_data \
    -f /var/backups/pmdl/volumes/tar/pmdl_postgres_data-latest.tar.gz

# Start containers
docker compose start postgres
```

### 7.3 Restic Restore

```bash
# List snapshots
docker exec pmdl_backup restic snapshots

# Restore specific snapshot
docker exec pmdl_backup restic restore abc123 --target /restore

# Restore latest
docker exec pmdl_backup restic restore latest --target /restore --tag postgres
```

### 7.4 Disaster Recovery (New Server)

```bash
# 1. Clone repository
git clone https://github.com/your-org/peer-mesh-docker-lab.git /opt/pmdl
cd /opt/pmdl

# 2. Restore secrets (from secure storage)
cp /secure-backup/secrets/* ./secrets/

# 3. Configure S3 credentials
export S3_ENDPOINT="https://s3.example.com"
export S3_BUCKET="pmdl-backups"
export RESTIC_REPOSITORY="s3:${S3_ENDPOINT}/${S3_BUCKET}/restic"
export RESTIC_PASSWORD_FILE="./secrets/restic_password"

# 4. Download latest backup
./scripts/backup/restore-postgres.sh download -s postgres/postgres-all-latest.sql.gz

# 5. Start database container
docker compose up -d postgres
sleep 30

# 6. Restore data
./scripts/backup/restore-postgres.sh restore \
    -f /var/backups/pmdl/postgres/downloads/postgres-all-latest.sql.gz \
    --no-confirm

# 7. Start remaining services
docker compose up -d
```

---

## 8. Monitoring

### 8.1 Health Check

The backup container includes a health check that verifies:
- Backup files exist
- Last backup is less than 48 hours old

```bash
docker inspect pmdl_backup --format='{{.State.Health.Status}}'
```

### 8.2 Backup Freshness Check

```bash
# Check last successful backup timestamp
cat /var/backups/pmdl/.last_successful_backup

# Check last off-site sync
cat /var/backups/pmdl/.last_offsite_sync
```

### 8.3 Monitoring Script

Create `/opt/pmdl/scripts/check-backups.sh`:

```bash
#!/bin/bash

MAX_AGE_HOURS=26
EXIT_CODE=0

for type in postgres volumes; do
    TIMESTAMP_FILE="/var/backups/pmdl/${type}/.last_successful_backup"

    if [[ ! -f "$TIMESTAMP_FILE" ]]; then
        echo "CRITICAL: No backup record for $type"
        EXIT_CODE=2
        continue
    fi

    AGE_SECONDS=$(( $(date +%s) - $(date -r "$TIMESTAMP_FILE" +%s) ))
    AGE_HOURS=$(( AGE_SECONDS / 3600 ))

    if [[ $AGE_HOURS -gt $MAX_AGE_HOURS ]]; then
        echo "WARNING: $type backup is ${AGE_HOURS}h old"
        EXIT_CODE=1
    else
        echo "OK: $type backup is ${AGE_HOURS}h old"
    fi
done

exit $EXIT_CODE
```

### 8.4 Alerting

Add to cron for email alerts:

```cron
0 8 * * * /opt/pmdl/scripts/check-backups.sh || mail -s "Backup Alert" admin@example.com
```

---

## 9. Troubleshooting

### 9.1 Backup Container Won't Start

**Symptoms**: Container exits immediately

**Cause**: Missing secrets or configuration

**Solution**:
```bash
# Check secrets exist
ls -la ./secrets/restic_password

# Check logs
docker logs pmdl_backup
```

### 9.2 Restic Repository Not Found

**Symptoms**: "repository does not exist" error

**Solution**:
```bash
# Initialize repository manually
docker exec pmdl_backup restic init
```

### 9.3 S3 Upload Fails

**Symptoms**: "access denied" or timeout errors

**Solution**:
```bash
# Verify credentials
docker exec pmdl_backup cat /run/secrets/s3_access_key

# Test S3 connectivity
docker exec pmdl_backup aws --endpoint-url $S3_ENDPOINT s3 ls
```

### 9.4 Backup Too Large

**Symptoms**: Disk full, backup takes too long

**Solution**:
```bash
# Use restic for deduplication
BACKUP_RESTIC_REPOSITORY=/var/backups/pmdl/restic

# Reduce retention
BACKUP_RETENTION_DAILY=3
```

### 9.5 PostgreSQL Connection Refused

**Symptoms**: "could not connect to server" error

**Cause**: Backup container not on db-internal network

**Solution**:
```yaml
# Ensure backup is on correct network
networks:
  - db-internal
```

---

## 10. References

### Documentation

- [ADR-0102: Backup Architecture](../../docs/decisions/0102-backup-architecture.md)
- [Backup Scripts README](../../scripts/backup/README.md)
- [BACKUP-RESTORE.md](../../docs/BACKUP-RESTORE.md)
- [Restic Documentation](https://restic.readthedocs.io/)

### Related Profiles

- **postgresql**: Primary database profile
- **minio**: S3-compatible storage (can be backup destination)

### Foundation Decisions Referenced

| Decision | Relevance |
|----------|-----------|
| D2.4 Backup Recovery | Backup strategy and retention |
| D3.1 Secret Management | Secret file handling |
| D3.3 Network Isolation | Backup container network access |

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-21 | Initial creation | AI Agent |

---

*Profile Template Version: 1.0*
*Last Updated: 2026-01-21*
*Part of Peer Mesh Docker Lab*
