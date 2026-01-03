# Ghost CMS Example

Ghost is a modern, open-source publishing platform for creating professional blogs and publications. This example demonstrates how to deploy Ghost with the foundation's MySQL profile and Traefik routing. Authelia protection for the admin panel is optional and can be enabled when Authelia is configured.

---

## Overview

| Property | Value |
|----------|-------|
| **Application** | Ghost CMS 5.x |
| **Database** | MySQL 8.0 (required - Ghost does not support PostgreSQL) |
| **Authentication** | Magic links for subscribers, optional Authelia for admin |
| **Resource Usage** | 256-512MB RAM |
| **Subdomain** | `ghost.${DOMAIN}` |

---

## Profile Requirements

This example requires:

| Profile | Purpose | Required |
|---------|---------|----------|
| MySQL | Database storage | Yes |
| Foundation | Traefik | Yes |
| Authelia | Admin panel protection | Optional |

---

## Quick Start

### 1. Generate Secrets

```bash
# From project root
./scripts/generate-secrets.sh

# Verify Ghost-specific secrets exist
ls -la secrets/ghost_db_password
```

### 2. Configure Environment

```bash
cp examples/ghost/.env.example examples/ghost/.env

# Edit with your values
nano examples/ghost/.env
```

### 3. Start Ghost

```bash
# From project root
docker compose \
  -f docker-compose.yml \
  -f profiles/mysql/docker-compose.mysql.yml \
  -f examples/ghost/docker-compose.ghost.yml \
  --profile ghost \
  up -d
```

### 4. Verify Deployment

```bash
# Check health
docker compose ps

# Should show:
# pmdl_ghost     running (healthy)
# pmdl_mysql     running (healthy)

# View logs
docker compose logs ghost
```

### 5. Access Ghost

- **Blog**: `https://ghost.yourdomain.com/`
- **Admin**: `https://ghost.yourdomain.com/ghost/`

First visit to `/ghost/` will prompt you to create an admin account.

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
│    Ghost    │ (blog + admin)
│  (port 2368)│
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    MySQL    │ (db-internal network)
└─────────────┘
```

**Optional**: When Authelia is configured, admin panel (`/ghost/*`) can be protected with ForwardAuth middleware.

---

## Authentication Strategy

Ghost has a unique authentication model:

### Subscribers (Blog Readers)

- Use Ghost's built-in **magic link** authentication
- Email-based, passwordless login
- No SSO required - Ghost handles this natively

### Staff/Admin (Default)

- Ghost admin panel at `/ghost/`
- Uses Ghost's built-in authentication
- First visit prompts admin account creation

### Staff/Admin (With Authelia)

When Authelia is configured, you can enable additional protection:

1. Uncomment the `ghost-admin` router labels in `docker-compose.ghost.yml`
2. Admin access requires Authelia login first
3. Ghost's internal auth becomes a secondary layer

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your domain | `example.com` |
| `GHOST_URL` | Full URL to Ghost | `https://ghost.example.com` |
| `GHOST_MAIL_TRANSPORT` | Mail transport type | `SMTP` |
| `GHOST_MAIL_HOST` | SMTP server | `smtp.sendgrid.net` |
| `GHOST_MAIL_PORT` | SMTP port | `587` |
| `GHOST_MAIL_USER` | SMTP username | `apikey` |
| `GHOST_MAIL_PASSWORD` | SMTP password | (use secret file) |
| `GHOST_MAIL_FROM` | From address | `noreply@example.com` |

---

## Secrets Required

| Secret File | Purpose |
|-------------|---------|
| `secrets/ghost_db_password` | Ghost MySQL user password |
| `secrets/mysql_root_password` | MySQL root password (from MySQL profile) |
| `secrets/ghost_mail_password` | SMTP password (optional, for email) |

Generate with:

```bash
# Database password
openssl rand -base64 32 > secrets/ghost_db_password
chmod 600 secrets/ghost_db_password

# Mail password (if using SMTP)
echo "your-smtp-api-key" > secrets/ghost_mail_password
chmod 600 secrets/ghost_mail_password
```

---

## Traefik Integration

The compose file includes Traefik labels for:

### Public Blog Access

```yaml
labels:
  - "traefik.http.routers.ghost.rule=Host(`ghost.${DOMAIN}`)"
  - "traefik.http.routers.ghost.entrypoints=websecure"
  - "traefik.http.routers.ghost.tls.certresolver=letsencrypt"
```

### Protected Admin Panel (Optional - Requires Authelia)

Uncomment these labels in `docker-compose.ghost.yml` when Authelia is configured:

```yaml
labels:
  - "traefik.http.routers.ghost-admin.rule=Host(`ghost.${DOMAIN}`) && PathPrefix(`/ghost`)"
  - "traefik.http.routers.ghost-admin.middlewares=authelia@file"
  - "traefik.http.routers.ghost-admin.priority=100"
```

The `priority=100` ensures the admin router takes precedence over the general router for `/ghost/*` paths.

---

## Resource Limits

| Profile | Memory Limit | Reservation |
|---------|--------------|-------------|
| Core | 256M | 128M |
| Full | 512M | 256M |

Ghost is memory-efficient. The default 512M limit provides headroom for image processing and peak traffic.

---

## Storage

Ghost stores content in Docker volumes:

| Volume | Purpose | Backup Priority |
|--------|---------|-----------------|
| `pmdl_ghost_content` | Themes, images, files | High |
| MySQL database | Posts, settings, users | Critical |

### Content Backup

```bash
# Backup Ghost content
docker run --rm -v pmdl_ghost_content:/data -v $(pwd):/backup \
  alpine tar czf /backup/ghost-content-$(date +%Y%m%d).tar.gz -C /data .
```

### Database Backup

Use the MySQL profile's backup script:

```bash
./profiles/mysql/backup-scripts/backup.sh
```

---

## Customization

### Custom Theme

Mount your theme directory:

```yaml
volumes:
  - ./themes/my-theme:/var/lib/ghost/content/themes/my-theme:ro
```

Then activate in Ghost admin: Settings > Design > Change theme.

### Custom Routes

Mount a `routes.yaml`:

```yaml
volumes:
  - ./config/routes.yaml:/var/lib/ghost/content/settings/routes.yaml:ro
```

---

## Troubleshooting

### Ghost Shows "Site is loading"

MySQL hasn't started yet. Check MySQL health:

```bash
docker compose ps mysql
docker compose logs mysql
```

### Admin Returns 502 Bad Gateway

Ghost container isn't healthy yet:

```bash
docker compose logs ghost
docker inspect pmdl_ghost | grep -A5 Health
```

### Images Not Loading

Check that Ghost URL matches your actual domain:

```bash
# In .env
GHOST_URL=https://ghost.yourdomain.com  # Must match Traefik host
```

### Email Not Working

Verify SMTP configuration:

```bash
docker compose exec ghost ghost config get mail
```

---

## Upgrade Path

Ghost auto-updates with each container restart if using `latest` tag. For controlled upgrades:

```yaml
# Pin to specific version
image: ghost:5.89.0-alpine

# Or use major version tag
image: ghost:5-alpine
```

Upgrade procedure:

```bash
# 1. Backup database and content
./profiles/mysql/backup-scripts/backup.sh
docker run --rm -v pmdl_ghost_content:/data -v $(pwd):/backup alpine tar czf /backup/ghost-content.tar.gz -C /data .

# 2. Pull new image
docker compose pull ghost

# 3. Restart
docker compose up -d ghost

# 4. Verify
docker compose logs ghost
```

---

## References

- Ghost Docker Hub: https://hub.docker.com/_/ghost
- Ghost Documentation: https://ghost.org/docs/
- D2.1 Database Selection: Ghost requires MySQL (PostgreSQL not supported)
- D3.4 Authentication: Forward auth pattern for admin protection
- MySQL Profile: `../../profiles/mysql/`

---

*Example Version: 1.0*
*Created: 2025-12-31*
