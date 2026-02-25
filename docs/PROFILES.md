# Profiles Guide

Understand and customize resource profiles and supporting tech profiles.

## What Are Profiles?

Peer Mesh Docker Lab uses two types of profiles:

1. **Resource Profiles** - Control memory and CPU allocation (`lite`, `core`, `full`)
2. **Supporting Tech Profiles** - Add database and infrastructure services (`postgresql`, `mysql`, `redis`, etc.)

## Resource Profiles

Resource profiles set container memory limits and CPU allocations based on your deployment environment.

### lite

Minimal resources for CI/CD pipelines and testing.

| Service | Memory Limit | Memory Reserved | CPU Limit |
|---------|-------------|-----------------|-----------|
| Traefik | 128MB | 64MB | 0.25 |
| Authelia | 128MB | 64MB | 0.25 |
| Redis | 64MB | 32MB | 0.1 |
| PostgreSQL | 256MB | 128MB | 0.5 |
| MySQL | 256MB | 128MB | 0.5 |

**Total**: ~512MB RAM, 0.5 CPU

**Use when**:
- Running in CI/CD pipelines
- Local development on resource-constrained machines
- Quick testing and validation

### core

Balanced resources for development and staging environments.

| Service | Memory Limit | Memory Reserved | CPU Limit |
|---------|-------------|-----------------|-----------|
| Traefik | 256MB | 128MB | 0.5 |
| Authelia | 256MB | 128MB | 0.5 |
| Redis | 128MB | 64MB | 0.25 |
| PostgreSQL | 512MB | 256MB | 1.0 |
| MySQL | 512MB | 256MB | 1.0 |

**Total**: ~2GB RAM, 2 CPU

**Use when**:
- Development servers
- Staging environments
- Small production deployments

### full

Full resources for production with monitoring.

| Service | Memory Limit | Memory Reserved | CPU Limit |
|---------|-------------|-----------------|-----------|
| Traefik | 512MB | 256MB | 1.0 |
| Authelia | 512MB | 256MB | 1.0 |
| Redis | 256MB | 128MB | 0.5 |
| PostgreSQL | 2GB | 1GB | 2.0 |
| MySQL | 2GB | 1GB | 2.0 |
| Prometheus | 1GB | 512MB | 1.0 |
| Grafana | 512MB | 256MB | 0.5 |

**Total**: ~8GB RAM, 4 CPU

**Use when**:
- Production deployments
- Need monitoring and metrics
- High-availability requirements

### Activating a Resource Profile

Set in `.env`:

```env
RESOURCE_PROFILE=core
```

Or via command line:

```bash
docker compose --profile core up -d
```

## Supporting Tech Profiles

Add infrastructure services to your deployment.

### Available Profiles

| Profile | Service | Purpose | Default Port |
|---------|---------|---------|--------------|
| `postgresql` | PostgreSQL 16 | Relational database, pgvector | 5432 |
| `mysql` | MySQL 8.0 | Traditional web database | 3306 |
| `mongodb` | MongoDB 7.0 | Document database | 27017 |
| `redis` | Redis 7 | Caching, sessions | 6379 |
| `minio` | MinIO | S3-compatible storage | 9000/9001 |

### Future Profiles

| Profile | Service | Purpose | Status |
|---------|---------|---------|--------|
| `monitoring` | Prometheus + Grafana | Metrics and dashboards | Planned |
| `backup` | Restic + rclone | Automated backups | Planned |
| `dev` | Dev tools | Hot reload, debugging | Planned |

### Using a Tech Profile

Include the profile's compose file:

```bash
# Single profile
docker compose -f docker-compose.yml \
               -f .dev/profiles/postgresql/docker-compose.postgresql.yml \
               up -d

# Multiple profiles
docker compose -f docker-compose.yml \
               -f .dev/profiles/postgresql/docker-compose.postgresql.yml \
               -f .dev/profiles/redis/docker-compose.redis.yml \
               up -d
```

### Profile Configuration

Each profile has its own configuration in `profiles/<name>/`:

```
profiles/postgresql/
  ├── PROFILE-SPEC.md           # Complete specification
  ├── docker-compose.postgresql.yml
  ├── init-scripts/             # Database initialization
  ├── backup-scripts/           # Backup procedures
  └── healthcheck-scripts/      # Health checks
```

## Customizing Profiles

### Override Resource Limits

Create a `docker-compose.override.yml`:

```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '4'
        reservations:
          memory: 2G
```

### Extend a Tech Profile

Create a custom compose file that extends the base:

```yaml
# docker-compose.custom-postgres.yml
include:
  - path: profiles/postgresql/docker-compose.postgresql.yml

services:
  postgres:
    environment:
      POSTGRES_MAX_CONNECTIONS: 200
    volumes:
      - ./my-init-scripts:/docker-entrypoint-initdb.d:ro
```

### Create a New Profile

1. Copy the template:
   ```bash
   cp -r profiles/_template profiles/my-service
   ```

2. Edit `PROFILE-SPEC.md` with your service configuration

3. Create `docker-compose.my-service.yml`:
   ```yaml
   services:
     my-service:
       image: my-image:1.0.0
       networks:
         - db-internal
       healthcheck:
         test: ["CMD", "healthcheck.sh"]
         interval: 30s
         timeout: 10s
         retries: 3
       deploy:
         resources:
           limits:
             memory: ${MY_SERVICE_MEMORY_LIMIT:-256M}
   ```

4. Add initialization and health check scripts

5. Test with the foundation:
   ```bash
   docker compose -f docker-compose.yml \
                  -f .dev/profiles/my-service/docker-compose.my-service.yml \
                  config
   ```

## Profile Best Practices

### 1. Use Secrets via Files

Never hardcode passwords:

```yaml
# Correct
environment:
  POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password

# Wrong
environment:
  POSTGRES_PASSWORD: changeme
```

### 2. Always Set Resource Limits

Prevent runaway containers:

```yaml
deploy:
  resources:
    limits:
      memory: 512M
    reservations:
      memory: 256M
```

### 3. Use Health Checks

Enable proper startup ordering:

```yaml
healthcheck:
  test: ["CMD", "/healthcheck.sh"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

### 4. Connect to Correct Networks

- `proxy-external` - Services accessed via Traefik
- `db-internal` - Database access (not exposed to internet)
- `monitoring` - Metrics collection

## Troubleshooting

### Profile Not Found

Ensure the profile directory exists:

```bash
ls profiles/
```

### Resource Limits Too Low

Increase limits in override file or use a larger profile:

```bash
# Check current usage
docker stats
```

### Database Won't Start

Check initialization scripts ran correctly:

```bash
docker compose logs postgres
```

See [Troubleshooting Guide](TROUBLESHOOTING.md) for more solutions.
