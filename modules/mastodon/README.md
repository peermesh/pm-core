# Mastodon Module

A self-hosted federated social networking platform with ActivityPub support, running on PeerMesh Docker Lab.

## Overview

This module deploys a complete Mastodon instance with:

- **Mastodon Web** - Puma application server (UI + REST API)
- **Mastodon Streaming** - Node.js WebSocket server for real-time updates
- **Mastodon Sidekiq** - Background job processor (federation, email, media)
- **OpenSearch** - Full-text search engine for posts, accounts, hashtags

## Prerequisites

Before installing this module, ensure:

1. **Foundation services running**:
   ```bash
   docker compose up -d traefik socket-proxy
   ```

2. **PostgreSQL profile enabled**:
   ```bash
   COMPOSE_PROFILES=postgresql docker compose up -d postgres
   ```

3. **Redis profile enabled**:
   ```bash
   COMPOSE_PROFILES=redis docker compose up -d redis
   ```

4. **Domain configured** with DNS pointing to your server

5. **SSL certificates** will be auto-provisioned by Traefik via Let's Encrypt

## Quick Start

### 1. Install the Module

```bash
cd modules/mastodon
./hooks/install.sh
```

This will:
- Generate secret keys (SECRET_KEY_BASE, OTP_SECRET)
- Create the Mastodon database user and database
- Create configuration templates

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit with your settings
nano .env
```

Required settings:
```bash
MASTODON_LOCAL_DOMAIN=mastodon.example.com
MASTODON_ADMIN_EMAIL=admin@example.com
MASTODON_SECRET_KEY_BASE=<from configs/mastodon_secrets.env>
MASTODON_OTP_SECRET=<from configs/mastodon_secrets.env>
MASTODON_DB_PASSWORD=<from secrets/mastodon_db_password>
```

### 3. Start the Services

```bash
./hooks/start.sh
```

Or manually:
```bash
docker compose up -d
```

### 4. Run Database Migrations

First-time setup only:
```bash
docker compose run --rm mastodon-web bundle exec rails db:migrate
```

### 5. Create Admin User

```bash
docker compose run --rm mastodon-web \
  tootctl accounts create admin \
  --email=admin@example.com \
  --confirmed \
  --role=Owner
```

### 6. Generate VAPID Keys (Web Push)

```bash
docker compose run --rm mastodon-web \
  bundle exec rake mastodon:webpush:generate_vapid_key
```

Add the output to your `.env` file:
```bash
MASTODON_VAPID_PRIVATE_KEY=...
MASTODON_VAPID_PUBLIC_KEY=...
```

Then restart the services:
```bash
docker compose down
docker compose up -d
```

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              Traefik                     │
                    │         (Reverse Proxy + TLS)            │
                    └──────────┬─────────────┬─────────────────┘
                               │             │
              ┌────────────────▼───┐    ┌────▼────────────────┐
              │   mastodon-web     │    │ mastodon-streaming  │
              │   (Puma :3000)     │    │   (Node.js :4000)   │
              │   UI + REST API    │    │     WebSocket       │
              └────────┬───────────┘    └──────────┬──────────┘
                       │                           │
              ┌────────▼───────────────────────────▼──────────┐
              │              mastodon-sidekiq                  │
              │           (Background Jobs)                    │
              │  Federation • Email • Media • Scheduled Tasks  │
              └────────────────────┬───────────────────────────┘
                                   │
     ┌─────────────┬───────────────┼───────────────┬──────────────┐
     │             │               │               │              │
┌────▼────┐  ┌─────▼────┐   ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
│PostgreSQL│  │  Redis   │   │ OpenSearch │  │ S3/MinIO  │  │   SMTP    │
│  (DB)    │  │ (Cache)  │   │  (Search)  │  │ (Media)   │  │  (Email)  │
└──────────┘  └──────────┘   └───────────┘  └───────────┘  └───────────┘
  External      External        Module        Optional       Optional
```

## Configuration

### Instance Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `MASTODON_LOCAL_DOMAIN` | Instance domain (REQUIRED) | - |
| `MASTODON_SINGLE_USER_MODE` | Personal instance mode | `false` |
| `MASTODON_REGISTRATIONS_MODE` | `open`, `approval_required`, `none` | `approval_required` |
| `MASTODON_MAX_TOOT_CHARS` | Maximum post length | `500` |

### Performance Tuning

| Variable | Description | Default |
|----------|-------------|---------|
| `MASTODON_WEB_CONCURRENCY` | Puma workers | `2` |
| `MASTODON_MAX_THREADS` | Threads per worker | `5` |
| `MASTODON_STREAMING_CLUSTER_NUM` | Streaming workers | `1` |
| `MASTODON_SIDEKIQ_CONCURRENCY` | Sidekiq threads | `25` |

### Federation

| Variable | Description | Default |
|----------|-------------|---------|
| `MASTODON_AUTHORIZED_FETCH` | Require signed requests | `true` |
| `MASTODON_LIMITED_FEDERATION_MODE` | Allowlist federation | `false` |

## Admin Commands

All commands run in the `mastodon-web` container:

```bash
# Enter the container shell
docker compose exec mastodon-web bash

# Or run commands directly
docker compose exec mastodon-web tootctl <command>
```

### User Management

```bash
# Create user
tootctl accounts create USERNAME --email=EMAIL --confirmed

# Make user admin
tootctl accounts modify USERNAME --role=Owner

# List users
tootctl accounts list

# Suspend user
tootctl accounts modify USERNAME --suspend

# Unsuspend user
tootctl accounts modify USERNAME --unsuspend
```

### Search

```bash
# Deploy search index (required after updates)
tootctl search deploy

# Clear search index
tootctl search reset
```

### Media

```bash
# Remove orphaned media files
tootctl media remove-orphans

# Remove remote media older than 7 days
tootctl media remove --days=7

# Check media storage usage
tootctl media usage
```

### Federation

```bash
# Refresh a remote account
tootctl accounts refresh USERNAME@DOMAIN

# Clear delivery failures
tootctl domains purge DOMAIN

# List known domains
tootctl domains list
```

### Maintenance

```bash
# Clear caches
tootctl cache clear

# Database maintenance
tootctl maintenance fix-duplicates
```

## Monitoring

### Health Check

```bash
./hooks/health.sh        # Text output
./hooks/health.sh json   # JSON output
```

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f mastodon-web
docker compose logs -f mastodon-sidekiq
docker compose logs -f mastodon-streaming
docker compose logs -f opensearch
```

### Sidekiq Dashboard

Access via the web UI: `https://your-domain/sidekiq` (admin only)

## Backup & Restore

### Database Backup

```bash
# Using pg_dump
docker exec pmdl_postgres pg_dump -U mastodon mastodon > mastodon_backup.sql

# Using the backup module
./modules/backup/hooks/start.sh
docker exec pmdl_backup /usr/local/bin/backup-postgres.sh mastodon
```

### Media Backup

Media is stored in the `pmdl_mastodon_system` volume:

```bash
# Backup media
docker run --rm \
  -v pmdl_mastodon_system:/data:ro \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/mastodon_media_$(date +%Y%m%d).tar.gz /data
```

### Restore

```bash
# Restore database
cat mastodon_backup.sql | docker exec -i pmdl_postgres psql -U mastodon mastodon

# Restore media
docker run --rm \
  -v pmdl_mastodon_system:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/mastodon_media_YYYYMMDD.tar.gz -C /
```

## Upgrading

1. **Check release notes** at [Mastodon releases](https://github.com/mastodon/mastodon/releases)

2. **Backup first**:
   ```bash
   docker exec pmdl_postgres pg_dump -U mastodon mastodon > pre_upgrade_backup.sql
   ```

3. **Pull new images**:
   ```bash
   docker compose pull
   ```

4. **Run migrations**:
   ```bash
   docker compose run --rm mastodon-web bundle exec rails db:migrate
   ```

5. **Restart services**:
   ```bash
   docker compose down
   docker compose up -d
   ```

6. **Verify health**:
   ```bash
   ./hooks/health.sh
   ```

## Troubleshooting

### Services won't start

Check dependencies:
```bash
docker ps | grep -E "postgres|redis"
docker network ls | grep pmdl
```

### Database connection errors

Verify credentials:
```bash
docker exec pmdl_mastodon_web bundle exec rails runner "puts ActiveRecord::Base.connection.active?"
```

### Search not working

Reindex OpenSearch:
```bash
docker compose exec mastodon-web tootctl search deploy
```

Check OpenSearch health:
```bash
docker compose exec opensearch curl -s localhost:9200/_cluster/health
```

### Sidekiq jobs stuck

Check queue status:
```bash
docker compose exec mastodon-web bundle exec rails runner \
  "puts Sidekiq::Stats.new.queues"
```

Clear stuck jobs:
```bash
docker compose exec mastodon-web bundle exec rails runner \
  "Sidekiq::RetrySet.new.clear"
```

### Memory issues

OpenSearch needs sufficient memory. Check:
```bash
docker stats pmdl_mastodon_opensearch
```

Reduce heap size in `docker-compose.yml` if needed:
```yaml
environment:
  - OPENSEARCH_JAVA_OPTS=-Xms256m -Xmx256m
```

## Security Considerations

1. **Never expose ports directly** - all traffic goes through Traefik
2. **Use strong secrets** - auto-generated by `install.sh`
3. **Enable authorized fetch** - prevents scraping by unauthenticated users
4. **Configure SMTP securely** - use TLS for email
5. **Regular backups** - use the backup module
6. **Keep updated** - subscribe to [Mastodon security advisories](https://github.com/mastodon/mastodon/security/advisories)

## Resources

- [Mastodon Documentation](https://docs.joinmastodon.org/)
- [Admin Guide](https://docs.joinmastodon.org/admin/setup/)
- [tootctl Reference](https://docs.joinmastodon.org/admin/tootctl/)
- [GitHub Repository](https://github.com/mastodon/mastodon)
- [Fediverse](https://fediverse.party/)

## License

MIT License - see [LICENSE](../../LICENSE)
