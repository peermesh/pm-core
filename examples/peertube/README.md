# PeerTube Example

PeerTube is a free, open-source, federated video platform that uses ActivityPub for federation and WebTorrent/HLS for P2P video delivery. This example demonstrates how to deploy PeerTube with the foundation's PostgreSQL profile and Traefik routing.

---

## Overview

| Property | Value |
|----------|-------|
| **Application** | PeerTube 6.x |
| **Database** | PostgreSQL 16 (required) |
| **Cache** | Redis 7 (dedicated instance) |
| **Authentication** | PeerTube native auth + optional Authelia for admin |
| **Resource Usage** | 512MB-2GB RAM |
| **Subdomain** | `peertube.${DOMAIN}` |

---

## Profile Requirements

This example requires:

| Profile | Purpose | Required |
|---------|---------|----------|
| PostgreSQL | Database storage | Yes |
| Foundation | Traefik | Yes |
| Authelia | Admin panel protection | Optional |

---

## Quick Start

### 1. Generate Secrets

```bash
# From project root
./scripts/generate-secrets.sh

# Verify PeerTube-specific secrets exist
ls -la secrets/peertube_db_password secrets/peertube_secret
```

### 2. Configure Environment

```bash
cp examples/peertube/.env.example examples/peertube/.env

# Edit with your values
nano examples/peertube/.env
```

### 3. Start PeerTube

```bash
# From project root
docker compose \
  -f docker-compose.yml \
  -f profiles/postgresql/docker-compose.postgresql.yml \
  -f examples/peertube/docker-compose.peertube.yml \
  --profile peertube \
  up -d
```

### 4. Verify Deployment

```bash
# Check health
docker compose ps

# Should show:
# pmdl_peertube         running (healthy)
# pmdl_peertube_redis   running (healthy)
# pmdl_postgres         running (healthy)

# View logs
docker compose logs peertube
```

### 5. Access PeerTube

- **Public Instance**: `https://peertube.yourdomain.com/`
- **Admin Panel**: `https://peertube.yourdomain.com/admin/`

First visit will prompt you to create an admin account.

---

## Architecture

```
Internet
    │
    ▼
┌─────────────┐
│   Traefik   │ (HTTPS termination)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  PeerTube   │ (video platform)
│  (port 9000)│
└──────┬──────┘
       │
    ┌──┴────────┐
    ▼           ▼
┌─────────┐ ┌─────────┐
│PostgreSQL│ │  Redis  │ (db-internal + peertube-internal networks)
└─────────┘ └─────────┘
```

**Optional**: When Authelia is configured, admin panel (`/admin/*`) can be protected with ForwardAuth middleware.

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your domain | `example.com` |
| `PEERTUBE_ADMIN_EMAIL` | Admin email | `admin@example.com` |

Additional configuration can be done through PeerTube's admin panel after first login.

---

## Secrets Required

| Secret File | Purpose |
|-------------|---------|
| `secrets/peertube_db_password` | PeerTube PostgreSQL user password |
| `secrets/peertube_secret` | PeerTube internal secret key |
| `secrets/postgres_password` | PostgreSQL root password (from PostgreSQL profile) |

Generate with:

```bash
# Database password
openssl rand -base64 32 > secrets/peertube_db_password
chmod 600 secrets/peertube_db_password

# PeerTube secret
openssl rand -base64 32 > secrets/peertube_secret
chmod 600 secrets/peertube_secret
```

---

## Traefik Integration

The compose file includes Traefik labels for:

### Public Instance Access

```yaml
labels:
  - "traefik.http.routers.peertube.rule=Host(`peertube.${DOMAIN}`)"
  - "traefik.http.routers.peertube.entrypoints=websecure"
  - "traefik.http.routers.peertube.tls.certresolver=letsencrypt"
```

### Protected Admin Panel (Optional - Requires Authelia)

Uncomment these labels in `docker-compose.peertube.yml` when Authelia is configured:

```yaml
labels:
  - "traefik.http.routers.peertube-admin.rule=Host(`peertube.${DOMAIN}`) && PathPrefix(`/admin`)"
  - "traefik.http.routers.peertube-admin.middlewares=authelia@file"
  - "traefik.http.routers.peertube-admin.priority=100"
```

The `priority=100` ensures the admin router takes precedence over the general router for `/admin/*` paths.

---

## Resource Limits

| Component | Memory Limit | Reservation |
|-----------|--------------|-------------|
| PeerTube | 2G | 512M |
| Redis | 256M | 64M |

PeerTube requires more memory due to video transcoding operations. The 2GB limit provides headroom for concurrent uploads and encoding jobs.

---

## Storage

PeerTube stores content in Docker volumes:

| Volume | Purpose | Backup Priority |
|--------|---------|-----------------|
| `pmdl_peertube_data` | Videos, images, thumbnails | Critical |
| `pmdl_peertube_config` | Instance configuration | High |
| `pmdl_peertube_redis` | Cache data | Low |
| PostgreSQL database | Metadata, users, comments | Critical |

### Content Backup

```bash
# Backup PeerTube data
docker run --rm -v pmdl_peertube_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/peertube-data-$(date +%Y%m%d).tar.gz -C /data .

# Backup PeerTube config
docker run --rm -v pmdl_peertube_config:/data -v $(pwd):/backup \
  alpine tar czf /backup/peertube-config-$(date +%Y%m%d).tar.gz -C /data .
```

### Database Backup

Use the PostgreSQL profile's backup script:

```bash
./profiles/postgresql/backup-scripts/backup.sh
```

---

## Configuration

### Video Transcoding

PeerTube automatically transcodes uploaded videos to multiple resolutions. You can configure transcoding settings in:

Admin Panel > Configuration > Transcoding

### Federation

PeerTube uses ActivityPub to federate with other PeerTube instances and Mastodon. Configure federation settings in:

Admin Panel > Configuration > Federation

### Email (SMTP)

Configure email for notifications and password resets in:

Admin Panel > Configuration > Email

---

## Known Limitations

1. **First Run Performance**: Initial startup takes 2-3 minutes as PeerTube initializes the database schema and creates default configuration.

2. **Video Transcoding**: Transcoding is CPU-intensive. For production use with many concurrent uploads, consider increasing CPU limits or disabling real-time transcoding.

3. **Storage Growth**: Video files consume significant storage. Monitor disk usage and implement retention policies if needed.

4. **P2P Delivery**: WebTorrent P2P works best with public instances. Private/internal deployments may need to disable P2P and use HLS-only delivery.

5. **Federation Requires Public Access**: For federation with other PeerTube instances or Mastodon, your instance must be publicly accessible on the internet.

---

## Troubleshooting

### PeerTube Shows "Service Unavailable"

PostgreSQL or Redis hasn't started yet. Check service health:

```bash
docker compose ps postgres peertube-redis
docker compose logs postgres peertube-redis
```

### Admin Returns 502 Bad Gateway

PeerTube container isn't healthy yet (startup can take 2-3 minutes):

```bash
docker compose logs peertube
docker inspect pmdl_peertube | grep -A5 Health
```

### Videos Not Playing

Check that PeerTube is accessible at the configured domain:

```bash
# In .env
PEERTUBE_WEBSERVER_HOSTNAME=peertube.yourdomain.com  # Must match Traefik host
```

### Transcoding Failures

Check available disk space and PeerTube logs:

```bash
df -h
docker compose logs peertube | grep -i transcode
```

---

## Upgrade Path

PeerTube uses digest pinning for reproducible deployments. For controlled upgrades:

```bash
# 1. Backup database and data
./profiles/postgresql/backup-scripts/backup.sh
docker run --rm -v pmdl_peertube_data:/data -v $(pwd):/backup alpine tar czf /backup/peertube-data.tar.gz -C /data .

# 2. Update image digest in docker-compose.peertube.yml
# Get latest digest from: https://hub.docker.com/r/chocobozzz/peertube

# 3. Pull new image
docker compose pull peertube

# 4. Restart
docker compose up -d peertube

# 5. Verify
docker compose logs peertube
```

---

## References

- PeerTube Docker Hub: https://hub.docker.com/r/chocobozzz/peertube
- PeerTube Documentation: https://docs.joinpeertube.org/
- ActivityPub Federation: https://activitypub.rocks/
- PostgreSQL Profile: `../../profiles/postgresql/`

---

*Example Version: 1.0*
*Created: 2026-02-22*
