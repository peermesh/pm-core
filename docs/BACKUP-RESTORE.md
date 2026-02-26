# Backup and Restore Guide

Create backups and recover data across all database profiles.

## Overview

Each database profile includes production-ready backup and restore scripts with:

- **Automated scheduling** via cron
- **Encryption** with age for off-site storage
- **Verification** with SHA-256 checksums
- **Retention management** to control storage usage

All scripts read credentials from file-based secrets, never environment variables.

## Quick Reference

| Profile | Backup Command | Restore Command |
|---------|---------------|-----------------|
| PostgreSQL | `./profiles/postgresql/backup-scripts/backup.sh` | `./profiles/postgresql/backup-scripts/restore.sh` |
| MySQL | `./profiles/mysql/backup-scripts/backup.sh` | `./profiles/mysql/backup-scripts/restore.sh` |
| MongoDB | `./profiles/mongodb/backup-scripts/backup.sh` | `./profiles/mongodb/backup-scripts/restore.sh` |
| Redis | `./profiles/redis/backup-scripts/backup.sh` | `./profiles/redis/backup-scripts/restore.sh` |
| MinIO | `./profiles/minio/backup-scripts/backup.sh` | `./profiles/minio/backup-scripts/restore.sh` |

## Prerequisites

Before running backup scripts:

1. Ensure containers are running:
   ```bash
   docker compose ps
   ```

2. Verify secrets exist:
   ```bash
   ls -la secrets/
   ```

3. Create backup directory:
   ```bash
   sudo mkdir -p /var/backups/pmdl
   sudo chown $USER:$USER /var/backups/pmdl
   ```

4. (Optional) Install age for encryption:
   ```bash
   # macOS
   brew install age

   # Ubuntu/Debian
   apt install age
   ```

## Manual Backup Procedures

### PostgreSQL Backup

Full backup of all databases:

```bash
./profiles/postgresql/backup-scripts/backup.sh all
```

Backup specific database:

```bash
./profiles/postgresql/backup-scripts/backup.sh database -d synapse
```

Pre-deployment backup (kept separately):

```bash
./profiles/postgresql/backup-scripts/backup.sh predeploy
```

Backup with encryption:

```bash
AGE_RECIPIENT="age1ql3z7hjy54pw3hyww5ayf..." \
  ./profiles/postgresql/backup-scripts/backup.sh all -e
```

### MySQL Backup

Full backup:

```bash
./profiles/mysql/backup-scripts/backup.sh all
```

Single database:

```bash
./profiles/mysql/backup-scripts/backup.sh database -d ghost
```

### MongoDB Backup

Full backup:

```bash
./profiles/mongodb/backup-scripts/backup.sh all
```

Single database:

```bash
./profiles/mongodb/backup-scripts/backup.sh database -d rocketchat
```

### Redis Backup

Trigger RDB snapshot:

```bash
./profiles/redis/backup-scripts/backup.sh
```

Redis backups use BGSAVE for point-in-time snapshots without blocking operations.

### MinIO Backup

Mirror all buckets locally:

```bash
./profiles/minio/backup-scripts/backup.sh local
```

Mirror specific buckets:

```bash
./profiles/minio/backup-scripts/backup.sh local -b uploads,backups
```

Full backup with archive and encryption:

```bash
AGE_RECIPIENT="age1ql3z7hjy54pw3hyww5ayf..." \
  ./profiles/minio/backup-scripts/backup.sh full -e
```

## Backup Verification

Verify backup integrity before storing or transferring:

```bash
# Check gzip format
gzip -t /var/backups/pmdl/postgres/daily/latest

# Verify checksum
sha256sum -c /var/backups/pmdl/postgres/daily/latest.sha256

# For PostgreSQL custom format
./profiles/postgresql/backup-scripts/restore.sh verify \
  -f /var/backups/pmdl/postgres/daily/synapse-2025-12-31.dump
```

## Restore Procedures

### PostgreSQL Restore

List available backups:

```bash
./profiles/postgresql/backup-scripts/restore.sh list
```

Restore full backup (all databases):

```bash
./profiles/postgresql/backup-scripts/restore.sh restore \
  -f /var/backups/pmdl/postgres/daily/postgres-all-2025-12-31.sql.gz
```

Restore single database:

```bash
./profiles/postgresql/backup-scripts/restore.sh restore \
  -f /var/backups/pmdl/postgres/daily/synapse-2025-12-31.dump \
  -d synapse
```

Dry-run (show what would happen):

```bash
./profiles/postgresql/backup-scripts/restore.sh restore \
  -f /var/backups/pmdl/postgres/daily/latest \
  --dry-run
```

Restore encrypted backup:

```bash
AGE_KEY_FILE=~/.config/age/key.txt \
  ./profiles/postgresql/backup-scripts/restore.sh restore \
  -f /var/backups/pmdl/postgres/daily/postgres-all-2025-12-31.sql.gz.age
```

### MySQL Restore

```bash
./profiles/mysql/backup-scripts/restore.sh restore \
  -f /var/backups/pmdl/mysql/daily/mysql-all-2025-12-31.sql.gz
```

### MongoDB Restore

```bash
./profiles/mongodb/backup-scripts/restore.sh restore \
  -f /var/backups/pmdl/mongodb/daily/mongodb-all-2025-12-31.archive.gz
```

### Redis Restore

```bash
./profiles/redis/backup-scripts/restore.sh \
  -f /var/backups/redis/redis-latest.rdb.gz
```

### MinIO Restore

Restore from local mirror:

```bash
./profiles/minio/backup-scripts/restore.sh local
```

Restore specific bucket:

```bash
./profiles/minio/backup-scripts/restore.sh local -b uploads
```

## Automated Backup Configuration

### Cron Setup

Create `/etc/cron.d/pmdl-backup`:

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
PROJECT_ROOT=/opt/pmdl
BACKUP_DIR=/var/backups/pmdl

# PostgreSQL - 2:00 AM daily
0 2 * * * root $PROJECT_ROOT/profiles/postgresql/backup-scripts/backup.sh all >> /var/log/pmdl-backup.log 2>&1

# MySQL - 2:30 AM daily
30 2 * * * root $PROJECT_ROOT/profiles/mysql/backup-scripts/backup.sh all >> /var/log/pmdl-backup.log 2>&1

# MongoDB - 3:00 AM daily
0 3 * * * root $PROJECT_ROOT/profiles/mongodb/backup-scripts/backup.sh all >> /var/log/pmdl-backup.log 2>&1

# Redis - 3:30 AM daily
30 3 * * * root $PROJECT_ROOT/profiles/redis/backup-scripts/backup.sh >> /var/log/pmdl-backup.log 2>&1

# MinIO - 4:00 AM daily
0 4 * * * root $PROJECT_ROOT/profiles/minio/backup-scripts/backup.sh full >> /var/log/pmdl-backup.log 2>&1

# Retention cleanup - 5:00 AM daily
0 5 * * * root find $BACKUP_DIR -name "*.gz" -mtime +7 -delete
```

Set permissions:

```bash
sudo chmod 644 /etc/cron.d/pmdl-backup
```

### Environment Variables

All backup scripts support these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTAINER_NAME` | Profile-specific | Target container name |
| `BACKUP_DIR` | `/var/backups/pmdl/{profile}` | Backup destination |
| `SECRET_DIR` | `./secrets` | Path to secrets directory |
| `AGE_RECIPIENT` | (none) | Age public key for encryption |
| `AGE_KEY_FILE` | `~/.config/age/key.txt` | Age private key for decryption |

### Retention Policy

Default retention (customize in cleanup cron job):

| Tier | Retention | Description |
|------|-----------|-------------|
| Daily | 7 days | Automatic cleanup |
| Pre-deploy | 5 most recent | Kept for rollback |
| Manual | Unlimited | Never auto-deleted |

## Encryption Setup

### Generate Age Key Pair

```bash
# Create key directory
mkdir -p ~/.config/age

# Generate key pair
age-keygen -o ~/.config/age/key.txt

# Extract public key
age-keygen -y ~/.config/age/key.txt
# Output: age1ql3z7hjy54pw3hyww5ayf...
```

### Configure Encrypted Backups

Set the `AGE_RECIPIENT` environment variable in your cron job:

```cron
AGE_RECIPIENT=age1ql3z7hjy54pw3hyww5ayf... \
  $PROJECT_ROOT/profiles/postgresql/backup-scripts/backup.sh all -e
```

### Decrypt Backups

Restore scripts automatically decrypt `.age` files when `AGE_KEY_FILE` is set:

```bash
AGE_KEY_FILE=~/.config/age/key.txt \
  ./profiles/postgresql/backup-scripts/restore.sh restore \
  -f /var/backups/pmdl/postgres/daily/latest.age
```

Manual decryption:

```bash
age -d -i ~/.config/age/key.txt backup.sql.gz.age > backup.sql.gz
```

## Disaster Recovery

### Scenario 1: Single Database Corruption

1. Stop affected application:
   ```bash
   docker compose stop ghost
   ```

2. Restore database:
   ```bash
   ./profiles/mysql/backup-scripts/restore.sh restore \
     -f /var/backups/pmdl/mysql/daily/latest
   ```

3. Restart application:
   ```bash
   docker compose start ghost
   ```

### Scenario 2: Pre-Deployment Rollback

After a failed update:

1. Stop all services:
   ```bash
   docker compose down
   ```

2. Restore from pre-deploy backup:
   ```bash
   ./profiles/postgresql/backup-scripts/restore.sh restore \
     -f /var/backups/pmdl/postgres/pre-deploy/predeploy-2025-12-31.sql.gz
   ```

3. Revert compose files if needed:
   ```bash
   git checkout HEAD~1 -- docker-compose.yml
   ```

4. Restart:
   ```bash
   docker compose up -d
   ```

### Scenario 3: Complete Server Recovery

New server from off-site backups:

1. Install Docker and clone repository:
   ```bash
   git clone https://github.com/your-org/peer-mesh-docker-lab.git
   cd peer-mesh-docker-lab
   ```

2. Download backups from off-site storage:
   ```bash
   # Using rclone (example with Backblaze B2)
   rclone copy b2:pmdl-backups/daily/ /var/backups/pmdl/daily/
   ```

3. Restore configuration:
   ```bash
   tar -xzf /var/backups/pmdl/config/config-latest.tar.gz -C .
   ```

4. Start databases only:
   ```bash
   docker compose -f docker-compose.yml \
     -f .dev/profiles/postgresql/docker-compose.postgresql.yml \
     up -d postgres
   sleep 30
   ```

5. Restore data:
   ```bash
   ./profiles/postgresql/backup-scripts/restore.sh restore \
     -f /var/backups/pmdl/postgres/daily/latest \
     --no-confirm
   ```

6. Start remaining services:
   ```bash
   docker compose up -d
   ```

### Recovery Time Objectives

| Scenario | Estimated RTO |
|----------|---------------|
| Single database restore | 15 minutes |
| Full stack restore (local backup) | 30 minutes |
| Full stack restore (off-site backup) | 1 hour |
| Complete server rebuild | 2 hours |

## Backup Monitoring

### Check Backup Freshness

```bash
# Check last successful backup timestamp
cat /var/backups/pmdl/postgres/.last_successful_backup

# Find backups older than 24 hours
find /var/backups/pmdl -name "latest" -mtime +1 -ls
```

### Simple Monitoring Script

Create `/opt/pmdl/scripts/check-backups.sh`:

```bash
#!/bin/bash

MAX_AGE_HOURS=26
EXIT_CODE=0

for db in postgres mysql mongodb redis minio; do
    TIMESTAMP_FILE="/var/backups/pmdl/${db}/.last_successful_backup"

    if [[ ! -f "$TIMESTAMP_FILE" ]]; then
        echo "CRITICAL: No backup record for $db"
        EXIT_CODE=2
        continue
    fi

    AGE_SECONDS=$(( $(date +%s) - $(stat -c %Y "$TIMESTAMP_FILE") ))
    AGE_HOURS=$(( AGE_SECONDS / 3600 ))

    if [[ $AGE_HOURS -gt $MAX_AGE_HOURS ]]; then
        echo "WARNING: $db backup is ${AGE_HOURS}h old"
        EXIT_CODE=1
    else
        echo "OK: $db backup is ${AGE_HOURS}h old"
    fi
done

exit $EXIT_CODE
```

Add to cron for email alerts:

```cron
0 8 * * * root /opt/pmdl/scripts/check-backups.sh || mail -s "Backup Alert" admin@example.com
```

## Off-Site Backup

### rclone Configuration

Install and configure rclone:

```bash
# Install
curl https://rclone.org/install.sh | sudo bash

# Configure (interactive)
rclone config
```

Example for Backblaze B2:

```ini
[b2]
type = b2
account = YOUR_KEY_ID
key = YOUR_APPLICATION_KEY
```

### Sync Script

Create `/opt/pmdl/scripts/backup-sync.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/var/backups/pmdl"
REMOTE="b2:pmdl-backups"

for db in postgres mysql mongodb redis minio; do
    if [[ -d "$BACKUP_DIR/$db/daily" ]]; then
        rclone sync "$BACKUP_DIR/$db/daily" "$REMOTE/$db/daily" \
            --transfers 4 \
            --checksum
    fi
done

date -Iseconds > "$BACKUP_DIR/.last_offsite_sync"
```

Add to cron after local backups complete:

```cron
0 6 * * * root /opt/pmdl/scripts/backup-sync.sh >> /var/log/pmdl-backup.log 2>&1
```

## Troubleshooting

### Backup Fails: Container Not Found

```
ERROR: Container not found: pmdl_postgres
```

Verify container name matches:

```bash
docker ps --format '{{.Names}}'
# Set correct name
CONTAINER_NAME=myproject_postgres ./backup.sh
```

### Backup Fails: Secret Not Found

```
ERROR: Secret not found: postgres_password
```

Check secrets exist and are readable:

```bash
ls -la secrets/
# Secrets should have 600 permissions
chmod 600 secrets/*
```

### Restore Fails: Checksum Mismatch

```
FAIL: Checksum verification failed!
```

Backup file may be corrupted. Try:

1. Re-download from off-site storage
2. Check disk health: `dmesg | grep -i error`
3. Use an older backup

### Slow Backup Performance

For large databases, consider:

1. Use parallel dump (PostgreSQL):
   ```bash
   pg_dump -j 4 -Fd -f /backup/directory
   ```

2. Compress with faster algorithm:
   ```bash
   docker exec postgres pg_dumpall | lz4 > backup.sql.lz4
   ```

3. Exclude temporary tables in application-specific backups

## Best Practices

1. **Test restores regularly** - Monthly restore to a test environment
2. **Encrypt off-site backups** - Always use age encryption for remote storage
3. **Monitor backup age** - Alert if backups are older than 24 hours
4. **Pre-deploy backups** - Always backup before updates
5. **Separate backup storage** - Use different disk/server for backups
6. **Document custom databases** - List application-specific databases for selective restore

## Further Reading

- [Security Guide](SECURITY.md) - Secret management and permissions
- [Configuration Reference](CONFIGURATION.md) - Environment variables
- [Profiles Guide](PROFILES.md) - Database profile details
- [Troubleshooting Guide](TROUBLESHOOTING.md) - Common issues
