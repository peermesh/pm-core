# Backup Module

> Automated backup and restore for Docker volumes and PostgreSQL databases with restic deduplication, age encryption, and S3/MinIO off-site storage support.

## Overview

The Backup Module provides comprehensive automated backup capabilities for peer-mesh-docker-lab deployments. It implements a three-tier backup architecture:

- **Tier 1 (Hot)**: Local backups for quick recovery (7-day retention)
- **Tier 2 (Warm)**: Attached storage for disk failure protection (30-day retention)
- **Tier 3 (Cold)**: Off-site S3/MinIO for disaster recovery (90-day retention)

### Key Features

- Automated PostgreSQL dumps with `pg_dumpall` and `pg_dump`
- Docker volume backup to compressed tar.gz archives
- Restic integration for deduplication and encryption
- S3/MinIO off-site sync support
- Age encryption for sensitive backups
- Configurable retention policies
- Dashboard widget for status monitoring
- Health checks with freshness validation

## Requirements

### Foundation Version
- Minimum: 1.0.0

### System Dependencies
- Docker with Compose plugin
- Docker socket access (for volume operations)

### Optional Dependencies
- PostgreSQL container (for database backups)
- S3-compatible storage (for off-site backups)

## Installation

### Quick Start

```bash
# From the docker-lab root directory
cd modules/backup

# Run installation hook
./hooks/install.sh

# Configure secrets
echo "your-secure-password" > configs/restic_password

# Copy and edit environment file
cp .env.example .env
# Edit .env with your settings

# Start the module
docker compose up -d
```

### Using Module Manager (when available)

```bash
./pmdl module install backup
./pmdl module enable backup
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_LOCAL_PATH` | `/var/backups/pmdl` | Local backup storage directory |
| `POSTGRES_CONTAINER_NAME` | `pmdl_postgres` | PostgreSQL container to backup |
| `VOLUME_PREFIX` | `pmdl_` | Docker volume filter prefix |
| `BACKUP_SCHEDULE_POSTGRES` | `0 2 * * *` | PostgreSQL backup cron schedule |
| `BACKUP_SCHEDULE_VOLUMES` | `0 3 * * *` | Volume backup cron schedule |
| `BACKUP_SCHEDULE_OFFSITE` | `0 4 * * *` | Off-site sync cron schedule |
| `BACKUP_RETENTION_DAILY` | `7` | Days to keep daily backups |
| `BACKUP_RETENTION_WEEKLY` | `4` | Weeks to keep weekly backups |
| `BACKUP_RETENTION_MONTHLY` | `3` | Months to keep monthly backups |

### Secrets Configuration

Secrets are stored as files in the `configs/` directory:

| File | Purpose | Required |
|------|---------|----------|
| `configs/restic_password` | Restic repository encryption password | Yes |
| `configs/s3_access_key` | S3 access key for off-site storage | No |
| `configs/s3_secret_key` | S3 secret key for off-site storage | No |

### S3/MinIO Off-site Storage

To enable off-site backups:

```bash
# Set endpoint and bucket in .env
BACKUP_S3_ENDPOINT=https://s3.example.com
BACKUP_S3_BUCKET=my-backup-bucket

# Configure credentials
echo "your-access-key" > configs/s3_access_key
echo "your-secret-key" > configs/s3_secret_key
```

Supported providers:
- AWS S3
- MinIO (self-hosted)
- Wasabi
- Backblaze B2
- Any S3-compatible storage

### Age Encryption

For additional encryption layer:

```bash
# Generate an age key
age-keygen -o key.txt
# Output: public key: age1...

# Set the public key in .env
BACKUP_AGE_RECIPIENT=age1xxxxxxx...
```

## Usage

### Manual Backup Commands

```bash
# Backup all PostgreSQL databases
docker exec pmdl_backup /usr/local/bin/backup-postgres.sh all

# Backup a specific database
docker exec pmdl_backup /usr/local/bin/backup-postgres.sh database -d mydb

# Backup all Docker volumes
docker exec pmdl_backup /usr/local/bin/backup-volumes.sh backup --all

# Backup a specific volume
docker exec pmdl_backup /usr/local/bin/backup-volumes.sh backup -v pmdl_postgres_data

# Sync to off-site storage
docker exec pmdl_backup /usr/local/bin/sync-offsite.sh

# Apply retention policy
docker exec pmdl_backup /usr/local/bin/backup-postgres.sh retention --days 7
```

### Listing Backups

```bash
# List PostgreSQL backups
docker exec pmdl_backup /usr/local/bin/restore-postgres.sh list

# List volume backups
docker exec pmdl_backup /usr/local/bin/backup-volumes.sh list
```

### Restoring from Backup

```bash
# List available backups
docker exec pmdl_backup /usr/local/bin/restore-postgres.sh list

# Restore full PostgreSQL backup
docker exec -it pmdl_backup /usr/local/bin/restore-postgres.sh restore \
  -f /var/backups/pmdl/postgres/daily/postgres-all-latest.sql.gz

# Restore single database
docker exec -it pmdl_backup /usr/local/bin/restore-postgres.sh restore \
  -f /var/backups/pmdl/postgres/daily/mydb-latest.dump \
  -d mydb

# Restore Docker volume
docker exec -it pmdl_backup /usr/local/bin/backup-volumes.sh restore \
  -v pmdl_postgres_data \
  -f /var/backups/pmdl/volumes/tar/pmdl_postgres_data-latest.tar.gz
```

### Dashboard

If the dashboard is enabled, navigate to `/backup` to:
- View backup status and history
- Monitor storage usage
- Trigger manual backups
- Configure settings

### Health Checks

```bash
# Run health check
./hooks/health.sh

# JSON output for automation
./hooks/health.sh json
```

### Events

This module emits the following events:

| Event | Description |
|-------|-------------|
| `backup.postgres.started` | PostgreSQL backup started |
| `backup.postgres.completed` | PostgreSQL backup completed successfully |
| `backup.postgres.failed` | PostgreSQL backup failed |
| `backup.volumes.started` | Volume backup started |
| `backup.volumes.completed` | Volume backup completed successfully |
| `backup.volumes.failed` | Volume backup failed |
| `backup.offsite.synced` | Off-site sync completed |
| `backup.retention.applied` | Retention policy applied |

## Module Structure

```
modules/backup/
├── module.json           # Module manifest
├── docker-compose.yml    # Service definitions
├── .env.example          # Configuration template
├── README.md             # This file
├── configs/
│   ├── restic_password   # Restic encryption password
│   ├── s3_access_key     # S3 access key
│   └── s3_secret_key     # S3 secret key
├── hooks/
│   ├── install.sh        # Installation script
│   ├── start.sh          # Start script
│   ├── stop.sh           # Stop script
│   ├── health.sh         # Health check script
│   └── uninstall.sh      # Cleanup script
└── dashboard/
    ├── BackupStatusWidget.html   # Dashboard widget
    ├── BackupPage.html           # Full backup page
    └── BackupConfigPanel.html    # Configuration panel
```

## Backup Directory Structure

```
/var/backups/pmdl/
├── postgres/
│   ├── daily/
│   │   ├── postgres-all-2026-01-21_02-00-00.sql.gz
│   │   ├── postgres-all-2026-01-21_02-00-00.sql.gz.sha256
│   │   ├── postgres-all-latest.sql.gz -> ...
│   │   ├── mydb-2026-01-21_02-00-00.dump
│   │   └── mydb-latest.dump -> ...
│   ├── pre-deploy/
│   │   └── predeploy-*.sql.gz
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
├── restic/               # If using restic
│   ├── config
│   ├── data/
│   ├── keys/
│   └── snapshots/
└── .last_offsite_sync
```

## Disaster Recovery Procedures

### Scenario 1: Single Database Corruption

```bash
# 1. Stop affected application
docker compose stop matrix-synapse

# 2. Find latest backup
docker exec pmdl_backup /usr/local/bin/restore-postgres.sh list

# 3. Restore database
docker exec -it pmdl_backup /usr/local/bin/restore-postgres.sh restore \
  -f /var/backups/pmdl/postgres/daily/synapse-latest.dump \
  -d synapse

# 4. Restart application
docker compose start matrix-synapse
```

### Scenario 2: Complete Server Recovery

```bash
# On new server:

# 1. Clone repository
git clone https://github.com/your-org/peer-mesh-docker-lab.git /opt/pmdl
cd /opt/pmdl

# 2. Configure backup module with off-site credentials
cp modules/backup/.env.example modules/backup/.env
# Configure S3 settings in .env
# Copy credentials to configs/

# 3. Download backups from off-site
docker exec pmdl_backup /usr/local/bin/restore-postgres.sh download \
  -s postgres/postgres-all-latest.sql.gz

# 4. Restore configuration and secrets
cp /backup/configs/.env .
cp -r /backup/configs/secrets ./

# 5. Start database first
docker compose up -d postgres
sleep 30

# 6. Restore data
docker exec -it pmdl_backup /usr/local/bin/restore-postgres.sh restore \
  -f /var/backups/pmdl/postgres/downloads/postgres-all-latest.sql.gz \
  --no-confirm

# 7. Start all services
docker compose up -d
```

## Troubleshooting

### Backup Service Not Starting

```bash
# Check container logs
docker logs pmdl_backup

# Verify secrets are configured
cat modules/backup/configs/restic_password

# Check Docker socket access
docker ps
```

### Backups Are Stale

```bash
# Check cron is running
docker exec pmdl_backup ps aux | grep cron

# Run manual backup
docker exec pmdl_backup /usr/local/bin/backup-postgres.sh all

# Check logs
docker exec pmdl_backup cat /var/log/backup.log
```

### Off-site Sync Failing

```bash
# Test S3 connectivity
docker exec pmdl_backup env | grep S3

# Run sync manually with verbose output
docker exec pmdl_backup /usr/local/bin/sync-offsite.sh

# Check credentials
docker exec pmdl_backup cat /run/secrets/s3_access_key
```

### Restore Fails with Checksum Error

The backup file may be corrupted. Try:

1. Use an older backup from the list
2. Download fresh copy from off-site storage
3. Check disk health: `dmesg | grep -i error`

## Best Practices

1. **Test restores regularly** - Monthly restore to a test environment
2. **Encrypt off-site backups** - Always use restic or age encryption
3. **Monitor backup age** - Alert if backups are older than 48 hours
4. **Pre-deploy backups** - Always backup before updates
5. **Store credentials securely** - Use a password manager for backup credentials
6. **Document custom databases** - List application-specific databases for selective restore

## Related Documentation

- [ADR-0102: Backup Architecture](../../docs/decisions/0102-backup-architecture.md)
- [Backup Scripts README](../../scripts/backup/README.md)
- [Module Schema](../../foundation/schemas/module.schema.json)
- [Lifecycle Schema](../../foundation/schemas/lifecycle.schema.json)

## License

MIT License - see LICENSE file for details.
