# Backup Scripts

Unified backup and restore scripts for peer-mesh-docker-lab.

## Overview

This directory contains scripts for backing up and restoring:

- **Docker volumes** - Raw volume data for disaster recovery
- **PostgreSQL databases** - Logical dumps with pg_dump/pg_dumpall
- **Configuration files** - docker-compose, .env, secrets

All scripts support:
- Local file storage
- Restic integration for deduplication and encryption
- S3/MinIO upload for off-site backups
- Age encryption for sensitive data

## Quick Start

### Backup All PostgreSQL Databases

```bash
./scripts/backup/backup-postgres.sh all
```

### Backup All Docker Volumes

```bash
./scripts/backup/backup-volumes.sh backup --all
```

### List Available Backups

```bash
./scripts/backup/restore-postgres.sh list
./scripts/backup/backup-volumes.sh list
```

### Restore from Backup

```bash
# Restore PostgreSQL (will prompt for confirmation)
./scripts/backup/restore-postgres.sh restore -f /var/backups/pmdl/postgres/daily/latest

# Restore specific database
./scripts/backup/restore-postgres.sh restore -f /var/backups/pmdl/postgres/daily/synapse-latest.dump -d synapse

# Restore Docker volume
./scripts/backup/backup-volumes.sh restore -v pmdl_postgres_data -f /var/backups/pmdl/volumes/tar/pmdl_postgres_data-latest.tar.gz
```

## Scripts

### backup-postgres.sh

PostgreSQL backup script with full and per-database backup support.

```bash
Usage: backup-postgres.sh [command] [options]

Commands:
    all         Backup all databases (pg_dumpall) [default]
    database    Backup single database (requires -d flag)
    predeploy   Quick backup before deployment
    list        List available databases
    retention   Apply retention policy

Options:
    -d, --database NAME    Database name for single backup
    -e, --encrypt          Encrypt backup with age
    -r, --restic           Also backup to restic repository
    -s, --s3               Also upload to S3/MinIO
    --days DAYS            Retention days (default: 7)
```

**Examples:**

```bash
# Full backup
./scripts/backup/backup-postgres.sh all

# Backup specific database
./scripts/backup/backup-postgres.sh database -d synapse

# Full backup with encryption and S3 upload
./scripts/backup/backup-postgres.sh all -e -s

# Pre-deployment backup
./scripts/backup/backup-postgres.sh predeploy

# Apply retention (keep 7 days)
./scripts/backup/backup-postgres.sh retention --days 7
```

### restore-postgres.sh

PostgreSQL restore script with verification and multiple source support.

```bash
Usage: restore-postgres.sh [command] [options]

Commands:
    restore     Restore from backup file [default]
    list        List available backups
    verify      Verify backup integrity without restoring
    download    Download backup from S3

Options:
    -f, --file PATH        Backup file to restore (local path)
    -d, --database NAME    Target database (for custom format only)
    -s, --s3-path PATH     S3 path to download
    -r, --restic SNAPSHOT  Restore from restic snapshot
    --dry-run              Show what would be done
    --no-confirm           Skip confirmation prompt
```

**Examples:**

```bash
# List all backups
./scripts/backup/restore-postgres.sh list

# Verify backup integrity
./scripts/backup/restore-postgres.sh verify -f /var/backups/pmdl/postgres/daily/latest

# Restore full backup
./scripts/backup/restore-postgres.sh restore -f /var/backups/pmdl/postgres/daily/postgres-all-latest.sql.gz

# Restore single database
./scripts/backup/restore-postgres.sh restore -f /var/backups/pmdl/postgres/daily/synapse-latest.dump -d synapse

# Restore encrypted backup
AGE_KEY_FILE=~/.config/age/key.txt \
./scripts/backup/restore-postgres.sh restore -f /var/backups/pmdl/postgres/daily/postgres-all-latest.sql.gz.age

# Download from S3 and restore
./scripts/backup/restore-postgres.sh restore -s postgres/postgres-all-2026-01-21.sql.gz

# Restore from restic
./scripts/backup/restore-postgres.sh restore -r latest
```

### backup-volumes.sh

Docker volume backup script with tar and restic support.

```bash
Usage: backup-volumes.sh [command] [options]

Commands:
    backup      Backup volumes (default)
    restore     Restore a volume from backup
    list        List available backups
    retention   Apply retention policy

Options:
    -v, --volume NAME      Specific volume to backup/restore
    -p, --prefix PREFIX    Volume prefix filter (default: pmdl_)
    -f, --file PATH        Backup file for restore
    -r, --restic           Use restic for backup
    -d, --days DAYS        Retention days (default: 7)
    --all                  Backup all matching volumes
```

**Examples:**

```bash
# Backup all pmdl_ volumes
./scripts/backup/backup-volumes.sh backup --all

# Backup specific volume
./scripts/backup/backup-volumes.sh backup -v pmdl_postgres_data

# Backup with restic for deduplication
./scripts/backup/backup-volumes.sh backup --all --restic

# Restore volume
./scripts/backup/backup-volumes.sh restore \
    -v pmdl_postgres_data \
    -f /var/backups/pmdl/volumes/tar/pmdl_postgres_data-2026-01-21.tar.gz

# List backups
./scripts/backup/backup-volumes.sh list
```

## Configuration

### Environment Variables

All scripts support configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_DIR` | `/var/backups/pmdl` | Base backup directory |
| `CONTAINER_NAME` | `pmdl_postgres` | PostgreSQL container name |
| `SECRET_DIR` | `./secrets` | Directory containing secrets |
| `VOLUME_PREFIX` | `pmdl_` | Volume filter prefix |

### Encryption (Age)

| Variable | Default | Description |
|----------|---------|-------------|
| `AGE_RECIPIENT` | (none) | Age public key for encryption |
| `AGE_KEY_FILE` | `~/.config/age/key.txt` | Age private key for decryption |

### Restic Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `RESTIC_REPOSITORY` | (none) | Restic repository URL |
| `RESTIC_PASSWORD_FILE` | (none) | Path to restic password file |

### S3/MinIO Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_ENDPOINT` | (none) | S3-compatible endpoint URL |
| `S3_BUCKET` | (none) | Bucket name |
| `S3_ACCESS_KEY_FILE` | (none) | Path to access key file |
| `S3_SECRET_KEY_FILE` | (none) | Path to secret key file |

## Automation with Cron

### Example Crontab

Create `/etc/cron.d/pmdl-backup`:

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
PROJECT_ROOT=/opt/pmdl
BACKUP_DIR=/var/backups/pmdl

# PostgreSQL - 2:00 AM daily
0 2 * * * root $PROJECT_ROOT/scripts/backup/backup-postgres.sh all >> /var/log/pmdl-backup.log 2>&1

# Docker volumes - 3:00 AM daily
0 3 * * * root $PROJECT_ROOT/scripts/backup/backup-volumes.sh backup --all >> /var/log/pmdl-backup.log 2>&1

# Retention cleanup - 5:00 AM daily
0 5 * * * root $PROJECT_ROOT/scripts/backup/backup-postgres.sh retention --days 7 >> /var/log/pmdl-backup.log 2>&1
0 5 * * * root $PROJECT_ROOT/scripts/backup/backup-volumes.sh retention --days 7 >> /var/log/pmdl-backup.log 2>&1
```

### Backup Profile (Recommended)

For fully automated backups, use the backup Docker profile instead of cron:

```bash
# Enable backup profile
COMPOSE_PROFILES=postgresql,backup docker compose up -d
```

See `profiles/backup/PROFILE-SPEC.md` for details.

## Backup Directory Structure

```
/var/backups/pmdl/
├── postgres/
│   ├── daily/
│   │   ├── postgres-all-2026-01-21_02-00-00.sql.gz
│   │   ├── postgres-all-2026-01-21_02-00-00.sql.gz.sha256
│   │   ├── postgres-all-latest.sql.gz -> postgres-all-2026-01-21_02-00-00.sql.gz
│   │   ├── synapse-2026-01-21_02-00-00.dump
│   │   └── synapse-latest.dump -> synapse-2026-01-21_02-00-00.dump
│   ├── pre-deploy/
│   │   └── predeploy-2026-01-21_01-30-00.sql.gz
│   ├── logs/
│   │   └── backup-2026-01-21.log
│   └── .last_successful_backup
├── volumes/
│   ├── tar/
│   │   ├── pmdl_postgres_data-2026-01-21_03-00-00.tar.gz
│   │   ├── pmdl_postgres_data-2026-01-21_03-00-00.tar.gz.sha256
│   │   └── pmdl_postgres_data-latest.tar.gz -> ...
│   └── logs/
│       └── backup-2026-01-21.log
└── restic/                    # If using restic
    ├── config
    ├── data/
    ├── keys/
    └── snapshots/
```

## Disaster Recovery Procedures

### Scenario 1: Single Database Corruption

```bash
# 1. Stop affected application
docker compose stop matrix-synapse

# 2. Find latest backup
./scripts/backup/restore-postgres.sh list

# 3. Restore database
./scripts/backup/restore-postgres.sh restore \
    -f /var/backups/pmdl/postgres/daily/synapse-latest.dump \
    -d synapse

# 4. Restart application
docker compose start matrix-synapse
```

### Scenario 2: Pre-Deployment Rollback

```bash
# 1. Stop all services
docker compose down

# 2. Restore from pre-deploy backup
./scripts/backup/restore-postgres.sh restore \
    -f /var/backups/pmdl/postgres/pre-deploy/predeploy-2026-01-21_01-30-00.sql.gz \
    --no-confirm

# 3. Revert compose files
git checkout HEAD~1 -- docker-compose.yml

# 4. Restart
docker compose up -d
```

### Scenario 3: Complete Server Recovery

```bash
# On new server:

# 1. Clone repository
git clone https://github.com/your-org/peer-mesh-docker-lab.git /opt/pmdl
cd /opt/pmdl

# 2. Download backups from off-site storage
# Option A: S3
./scripts/backup/restore-postgres.sh download -s postgres/postgres-all-latest.sql.gz

# Option B: Restic
RESTIC_REPOSITORY="s3:endpoint/bucket" \
RESTIC_PASSWORD_FILE="/path/to/password" \
./scripts/backup/restore-postgres.sh restore -r latest

# 3. Restore configuration
cp /backup/configs/.env .
cp -r /backup/configs/secrets ./

# 4. Start databases
docker compose up -d postgres
sleep 30

# 5. Restore data
./scripts/backup/restore-postgres.sh restore \
    -f /var/backups/pmdl/postgres/downloads/postgres-all-latest.sql.gz \
    --no-confirm

# 6. Start remaining services
docker compose up -d
```

## Best Practices

1. **Test restores regularly** - Monthly restore to a test environment
2. **Encrypt off-site backups** - Always use age encryption for remote storage
3. **Monitor backup age** - Alert if backups are older than 24 hours
4. **Pre-deploy backups** - Always backup before updates
5. **Separate backup storage** - Use different disk/server for backups
6. **Document custom databases** - List application-specific databases for selective restore

## Troubleshooting

### Backup Fails: Container Not Found

```bash
# Verify container name
docker ps --format '{{.Names}}'

# Set correct name
CONTAINER_NAME=myproject_postgres ./scripts/backup/backup-postgres.sh all
```

### Backup Fails: Permission Denied

```bash
# Ensure backup directory exists and is writable
sudo mkdir -p /var/backups/pmdl
sudo chown $USER:$USER /var/backups/pmdl
```

### Restore Fails: Checksum Mismatch

The backup file may be corrupted. Try:

1. Re-download from off-site storage
2. Check disk health: `dmesg | grep -i error`
3. Use an older backup

### Restic: Repository Not Found

```bash
# Initialize repository first
RESTIC_REPOSITORY="/var/backups/pmdl/restic" \
RESTIC_PASSWORD_FILE="./secrets/restic_password" \
restic init
```

## Related Documentation

- [ADR-0102: Backup Architecture](../../docs/decisions/0102-backup-architecture.md)
- [BACKUP-RESTORE.md](../../docs/BACKUP-RESTORE.md)
- [profiles/backup/PROFILE-SPEC.md](../../profiles/backup/PROFILE-SPEC.md)
