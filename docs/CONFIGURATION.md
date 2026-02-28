# Configuration Reference

Complete reference for environment variables and configuration options.

## Environment File

All configuration is managed through the `.env` file at the project root. Copy from the template:

```bash
cp .env.example .env
```

## Required Variables

These must be set before starting services:

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Base domain for all services | `example.com` |
| `ADMIN_EMAIL` | Email for Let's Encrypt certificates | `admin@example.com` |

## Core Settings

### General

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `development` | Environment: `development`, `staging`, `production` |
| `COMPOSE_PROJECT_NAME` | `peermesh` | Docker Compose project prefix |
| `TZ` | `UTC` | Timezone for all containers |

### Traefik (Reverse Proxy)

| Variable | Default | Description |
|----------|---------|-------------|
| `TRAEFIK_LOG_LEVEL` | `ERROR` | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |

> **Note**: Traefik dashboard and ACME staging are configured via command-line arguments in `docker-compose.yml`, not environment variables. See the Traefik service definition for details.

### Authelia (Authentication) -- Example Application

> **Note**: Authelia is an **example application**, not a core foundation service. The variables below apply only if you deploy the Authelia example. They are not present in the base `.env.example` or `docker-compose.yml`.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTHELIA_JWT_SECRET_FILE` | `/run/secrets/authelia_jwt` | Path to JWT secret file |
| `AUTHELIA_SESSION_SECRET_FILE` | `/run/secrets/authelia_session` | Path to session secret file |
| `AUTHELIA_DEFAULT_2FA_METHOD` | `totp` | Default 2FA: `totp`, `webauthn` |

## Database Profiles

### PostgreSQL

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_VERSION` | `16` | PostgreSQL version |
| `POSTGRES_USER` | `postgres` | Superuser username |
| `POSTGRES_PASSWORD_FILE` | `/run/secrets/postgres_password` | Password file path |
| `POSTGRES_MAX_CONNECTIONS` | `100` | Maximum connections |
| `POSTGRES_SHARED_BUFFERS` | `256MB` | Shared memory buffers |

### MySQL

| Variable | Default | Description |
|----------|---------|-------------|
| `MYSQL_VERSION` | `8.0` | MySQL version |
| `MYSQL_ROOT_PASSWORD_FILE` | `/run/secrets/mysql_root_password` | Root password file |
| `MYSQL_INNODB_BUFFER_POOL_SIZE` | `256M` | InnoDB buffer pool |

### MongoDB

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_VERSION` | `7.0` | MongoDB version |
| `MONGO_INITDB_ROOT_USERNAME` | `admin` | Admin username |
| `MONGO_INITDB_ROOT_PASSWORD_FILE` | `/run/secrets/mongo_password` | Password file path |

### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_VERSION` | `7` | Redis version |
| `REDIS_PASSWORD_FILE` | `/run/secrets/redis_password` | Password file path |
| `REDIS_MAXMEMORY` | `128mb` | Maximum memory |
| `REDIS_MAXMEMORY_POLICY` | `allkeys-lru` | Eviction policy |

### MinIO (Object Storage)

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ROOT_USER` | `minio` | Admin username |
| `MINIO_ROOT_PASSWORD_FILE` | `/run/secrets/minio_password` | Password file path |
| `MINIO_BROWSER` | `on` | Enable web console |

## Resource Profiles

Select a profile matching your deployment:

| Variable | Default | Description |
|----------|---------|-------------|
| `RESOURCE_PROFILE` | `core` | Profile: `lite`, `core`, `full` |

See [Profiles Guide](PROFILES.md) for detailed resource allocations.

## Network Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_PORT` | `80` | HTTP port (redirect to HTTPS) |
| `HTTPS_PORT` | `443` | HTTPS port |
| `TRAEFIK_DASHBOARD_PORT` | `8080` | Dashboard port (development only) |

## Backup Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_ENABLED` | `true` | Enable automated backups |
| `BACKUP_RETENTION_DAYS` | `7` | Days to keep local backups |
| `BACKUP_SCHEDULE` | `0 2 * * *` | Cron schedule (2 AM daily) |
| `BACKUP_ENCRYPTION_KEY_FILE` | `/run/secrets/backup_key` | Encryption key file |

## Secret Files

Secrets are stored as files in the `secrets/` directory, not as environment variables. This prevents accidental exposure in logs or process listings.

### Required Secrets

Generate with `./scripts/generate-secrets.sh`:

| File | Purpose |
|------|---------|
| `secrets/authelia_jwt` | Authelia JWT signing key |
| `secrets/authelia_session` | Authelia session encryption |
| `secrets/postgres_password` | PostgreSQL superuser password |
| `secrets/mysql_root_password` | MySQL root password |
| `secrets/redis_password` | Redis authentication |
| `secrets/backup_key` | Backup encryption key |

### Manual Secret Generation

If you need to regenerate a specific secret:

```bash
# Generate a 32-byte random secret
openssl rand -base64 32 > secrets/my_secret

# Set restrictive permissions
chmod 600 secrets/my_secret
```

## Per-Service Configuration

Individual services can be configured through their compose files in `profiles/` and `examples/` directories. Each includes a `.env.example` documenting service-specific variables.

## Development vs Production

### Development Settings

```env
ENVIRONMENT=development
TRAEFIK_LOG_LEVEL=DEBUG
# Note: Traefik dashboard and ACME staging are configured in docker-compose.yml,
# not via environment variables. Adjust command-line arguments there.
```

### Production Settings

```env
ENVIRONMENT=production
TRAEFIK_LOG_LEVEL=ERROR
# Note: Ensure Traefik ACME staging is disabled in docker-compose.yml for production.
```

## Validation

Verify your configuration:

```bash
# Check compose file syntax
docker compose config

# Validate environment variables are set
docker compose config | grep -E "DOMAIN|ADMIN_EMAIL"

# Check secret files exist
ls -la secrets/
```
