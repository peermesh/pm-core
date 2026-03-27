# ADR-0102: Backup Architecture

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-21 |
| **Status** | accepted |
| **Superseded By** | - |
| **Supersedes** | - |
| **Authors** | AI-assisted |
| **Reviewers** | - |

---

## Context

The peermesh-docker-lab project manages stateful services including databases (PostgreSQL, MySQL, MongoDB) and object storage (MinIO). While individual profile backup scripts exist, the current approach has significant gaps:

1. **Docker volumes are not backed up** - Only database dumps exist, not raw volume data
2. **No automated backup orchestration** - Backups require manual cron setup
3. **No off-site backup solution** - Local backups only, vulnerable to server loss
4. **No unified backup interface** - Each profile has separate scripts with different interfaces

Key constraints from VISION.md:
- **Local-first/offline capable**: Must work without constant internet connectivity
- **Zero daily maintenance**: Automated, unattended operation
- **Commodity VPS budget**: $20-50/month infrastructure cost

Related findings:
- FIND-002: Backup excludes volumes
- FIND-005: No volume backup automation

---

## Decision

**We will implement a three-tier backup architecture using restic as the backup engine, with local, attached storage, and optional S3/MinIO destinations.**

### Tier 1: Hot Backups (Local)

- **Location**: `/var/backups/pmdl/` on the same server
- **Retention**: 7 days rolling
- **Purpose**: Quick recovery from application errors, accidental deletions
- **RPO**: 24 hours (daily backups)
- **RTO**: 15 minutes

### Tier 2: Warm Backups (Attached Storage)

- **Location**: Attached block storage volume (if available)
- **Retention**: 30 days rolling
- **Purpose**: Recovery from disk failures
- **RPO**: 24 hours
- **RTO**: 30 minutes

### Tier 3: Cold Backups (Off-Site)

- **Location**: S3-compatible storage (MinIO, Backblaze B2, Wasabi)
- **Retention**: 90 days (configurable)
- **Purpose**: Disaster recovery, server loss
- **RPO**: 24 hours
- **RTO**: 1-4 hours (depending on data size)

### Backup Types

#### 1. Database Logical Backups (pg_dump/mysqldump/mongodump)

- Application-consistent snapshots
- Point-in-time recovery capable
- Portable across versions
- Used for: Database restore, migration

#### 2. Docker Volume Backups

- Raw volume data via `docker run` with volume mount
- Faster than logical dumps for large datasets
- Used for: Disaster recovery, server migration

#### 3. Configuration Backups

- docker-compose files, .env, configs/
- Secrets backed up separately with encryption
- Used for: Server rebuild, audit trail

### Backup Engine: Restic

Restic was chosen over alternatives for:

1. **Deduplication**: Only stores changed blocks, reducing storage costs
2. **Encryption**: AES-256 by default, required for off-site backups
3. **S3 compatibility**: Native support for MinIO, B2, S3, Wasabi
4. **Snapshot management**: Built-in retention policies
5. **Verification**: Integrity checks on every backup
6. **Single binary**: No dependencies, easy deployment

### Automation Approach

A single backup container (`pmdl_backup`) runs as a Docker service with:

- Cron-based scheduling (configurable)
- Access to Docker socket (read-only) for volume discovery
- Pre/post hooks for database quiescence
- Failure notifications (optional webhook/email)

---

## Alternatives Considered

### Option A: Cron Scripts Only (Current Approach)

**Description**: Shell scripts executed via system cron, individual per-profile

**Pros**:
- Simple to understand
- No additional dependencies
- Already partially implemented

**Cons**:
- No deduplication
- No built-in encryption
- Requires manual S3 tooling (rclone)
- No unified retention management
- Volumes not backed up

**Why not chosen**: Doesn't address volume backups or off-site automation

### Option B: Velero (Kubernetes Backup)

**Description**: Popular Kubernetes backup solution

**Pros**:
- Industry standard for K8s
- Excellent plugin ecosystem
- CSI snapshot support

**Cons**:
- Designed for Kubernetes, not Docker Compose
- Significant complexity for single-server deployment
- Overhead doesn't justify benefits

**Why not chosen**: Over-engineered for Docker Compose use case

### Option C: Duplicity

**Description**: GPG-encrypted incremental backups

**Pros**:
- Mature, well-tested
- GPG encryption
- Incremental backups

**Cons**:
- Slower than restic for large datasets
- Python dependency
- Complex restore process

**Why not chosen**: Restic offers better performance and simpler UX

### Option D: BorgBackup

**Description**: Deduplicating backup program

**Pros**:
- Excellent compression and deduplication
- Mature and reliable
- Strong encryption

**Cons**:
- Requires server-side borg installation for remote backups
- No native S3 support (requires rclone mount)
- More complex setup

**Why not chosen**: Native S3 support in restic is critical for off-site backups

---

## Consequences

### Positive

- **Automated disaster recovery**: All data backed up without manual intervention
- **Reduced storage costs**: Deduplication significantly reduces off-site storage
- **Encryption by default**: Safe for S3/cloud storage
- **Unified interface**: Single set of scripts for all backup operations
- **Offline capable**: Local and attached storage tiers work without internet
- **Zero maintenance**: Automated retention, verification, and cleanup

### Negative

- **Additional container**: One more service to manage
- **restic dependency**: Adds external tooling (mitigated: single static binary)
- **Initial learning curve**: Operators need to learn restic commands
- **Repository initialization**: One-time setup required for each destination

### Neutral

- Existing profile backup scripts remain functional (can be used for manual backups)
- Storage costs for off-site backups (expected: $1-5/month for typical deployments)

---

## Implementation Notes

### Directory Structure

```
scripts/backup/
  backup-volumes.sh      # Docker volume backup
  backup-postgres.sh     # PostgreSQL dump wrapper
  restore-postgres.sh    # PostgreSQL restore wrapper
  README.md              # Usage documentation

profiles/backup/
  docker-compose.backup.yml  # Backup container definition
  configs/
    backup.env.example       # Configuration template
    crontab                  # Backup schedule
  PROFILE-SPEC.md            # Profile documentation
```

### Restic Repository Structure

```
/var/backups/pmdl/restic/     # Local repository
  config                       # Restic config
  data/                        # Deduplicated data blocks
  keys/                        # Encryption keys
  snapshots/                   # Snapshot metadata

s3://bucket/pmdl-backups/     # Off-site repository (same structure)
```

### Backup Schedule (Default)

| Time | Operation |
|------|-----------|
| 02:00 | PostgreSQL pg_dump |
| 02:15 | MySQL mysqldump |
| 02:30 | MongoDB mongodump |
| 03:00 | Docker volumes (all profiles) |
| 04:00 | Sync to off-site (if configured) |
| 05:00 | Retention cleanup |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_LOCAL_PATH` | `/var/backups/pmdl` | Local backup destination |
| `BACKUP_RESTIC_PASSWORD_FILE` | `/run/secrets/restic_password` | Restic repository password |
| `BACKUP_S3_ENDPOINT` | (none) | S3-compatible endpoint URL |
| `BACKUP_S3_BUCKET` | (none) | Bucket name for off-site backups |
| `BACKUP_S3_ACCESS_KEY_FILE` | (none) | S3 access key secret path |
| `BACKUP_S3_SECRET_KEY_FILE` | (none) | S3 secret key secret path |
| `BACKUP_RETENTION_DAILY` | `7` | Days to keep daily backups |
| `BACKUP_RETENTION_WEEKLY` | `4` | Weeks to keep weekly backups |
| `BACKUP_RETENTION_MONTHLY` | `3` | Months to keep monthly backups |

### Recovery Procedures

#### Scenario 1: Single Database Corruption

```bash
# List PostgreSQL snapshots
./scripts/backup/restore-postgres.sh list

# Restore latest
./scripts/backup/restore-postgres.sh restore -f latest
```

#### Scenario 2: Server Rebuild

```bash
# On new server, initialize from off-site backup
export RESTIC_REPOSITORY="s3:endpoint/bucket/pmdl-backups"
export RESTIC_PASSWORD_FILE="/path/to/password"

# List available snapshots
restic snapshots

# Restore volumes
restic restore latest --target /var/lib/docker/volumes/

# Restore configs
restic restore latest:/configs --target /opt/pmdl/
```

---

## References

### Documentation

- [Restic Documentation](https://restic.readthedocs.io/) - Official restic documentation
- [Restic S3 Backend](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#amazon-s3) - S3 configuration guide

### Research

- [Backup Solution Comparison](https://www.borgbackup.org/references.html) - Borg's comparison with alternatives
- [3-2-1 Backup Rule](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/) - Industry standard backup strategy

### Related ADRs

- [ADR-0003: File-Based Secrets Management](./0003-file-based-secrets.md) - Secret handling for backup credentials
- [ADR-0100: Multi-Database Profiles](./0100-multi-database-profiles.md) - Database profiles being backed up
- [ADR-0202: SOPS and Age Secrets Encryption](./0202-sops-age-secrets-encryption.md) - Encryption for backup secrets

### External Discussions

- [FIND-002: Backup excludes volumes](../../../../.dev/ai/findings/FIND-002-backup-excludes-volumes.md) - Original finding
- [FIND-005: No volume backup automation](../../../../.dev/ai/findings/FIND-005-no-volume-backup-automation.md) - Related finding

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-21 | Initial draft | AI Agent |
| 2026-01-21 | Status changed to accepted | AI Agent |
