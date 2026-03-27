# Troubleshooting Guide

Common issues and solutions when running PeerMesh Core.

## Quick Diagnostics

Before diving into specific issues, run these diagnostic commands:

```bash
# Check container status
docker compose ps

# View recent logs
docker compose logs --tail=50

# Check resource usage
docker stats --no-stream

# Verify compose configuration
docker compose config
```

## Container Won't Start

### Symptoms

- Container status shows "Restarting" or "Exit 1"
- `docker compose up` hangs or fails

### Solutions

**Check logs for the specific container:**

```bash
docker compose logs <service-name>
# Example: docker compose logs postgres
```

**Common causes:**

1. **Missing secrets** - Secret files don't exist
   ```bash
   ls -la secrets/
   # If empty, run:
   ./scripts/generate-secrets.sh
   ```

2. **Permission denied on secrets**
   ```bash
   chmod 600 secrets/*
   chmod 700 secrets/
   ```

3. **Missing environment variables**
   ```bash
   # Check .env exists and has required values
   cat .env | grep -E "DOMAIN|ADMIN_EMAIL"
   ```

4. **Volume permission issues**
   ```bash
   # Check volume ownership
   ls -la ./data/

   # Fix permissions for PostgreSQL (runs as uid 70)
   sudo chown -R 70:70 ./data/postgres/
   ```

## Port Conflicts

### Symptoms

- Error: "bind: address already in use"
- Container starts but immediately exits

### Solutions

**Find what's using the port:**

```bash
# Check port 80
lsof -i :80
# Or
netstat -tlnp | grep :80

# Check port 443
lsof -i :443
```

**Common conflicts:**

| Port | Common Conflicts |
|------|------------------|
| 80 | Apache, nginx, other web servers |
| 443 | Apache, nginx, other web servers |
| 5432 | Local PostgreSQL installation |
| 3306 | Local MySQL installation |
| 6379 | Local Redis installation |

**Resolution options:**

1. Stop the conflicting service:
   ```bash
   sudo systemctl stop nginx
   sudo systemctl stop apache2
   ```

2. Change the port in `.env`:
   ```env
   HTTP_PORT=8080
   HTTPS_PORT=8443
   ```

## Permission Issues

### Symptoms

- "Permission denied" errors in logs
- Container can't write to volumes
- Health checks fail

### Solutions

**For database volumes:**

```bash
# PostgreSQL (uid 70)
sudo chown -R 70:70 ./data/postgres/

# MySQL (uid 999)
sudo chown -R 999:999 ./data/mysql/

# MongoDB (uid 999)
sudo chown -R 999:999 ./data/mongodb/
```

**For secret files:**

```bash
chmod 700 secrets/
chmod 600 secrets/*
```

**For log directories:**

```bash
mkdir -p ./logs
chmod 755 ./logs
```

## Database Connection Failures

### Symptoms

- Application logs show "connection refused"
- Health checks for database fail
- "could not connect to server" errors

### Solutions

**Check database is healthy:**

```bash
docker compose ps postgres
# Should show "healthy"
```

**Verify network connectivity:**

```bash
# Check database is on correct network
docker network inspect db-internal

# Test connection from app container
docker compose exec app ping postgres
```

**Check credentials:**

```bash
# Verify secret file exists and has content
cat secrets/postgres_password

# Check environment uses _FILE suffix
docker compose config | grep -A5 postgres | grep PASSWORD
```

**Wait for initialization:**

```bash
# Database may still be initializing
docker compose logs postgres | tail -20
# Look for "database system is ready to accept connections"
```

## Health Check Failures

### Symptoms

- Container status shows "(unhealthy)"
- Dependent services won't start
- Timeout errors during startup

### Solutions

**Check health check configuration:**

```bash
docker inspect <container-id> | grep -A20 "Health"
```

**Increase timeouts for slow systems:**

```yaml
# docker-compose.override.yml
services:
  postgres:
    healthcheck:
      start_period: 120s  # Give more time to initialize
      interval: 30s
      timeout: 15s
      retries: 5
```

**Run health check manually:**

```bash
docker compose exec postgres pg_isready -U postgres
```

## TLS/Certificate Issues

### Symptoms

- Browser shows "connection not secure"
- Let's Encrypt rate limit errors
- Certificate not found errors

### Solutions

**For development (localhost):**

Use staging certificates:
```env
TRAEFIK_ACME_STAGING=true
```

**Let's Encrypt rate limits:**

1. Use staging for testing
2. Wait 1 hour if rate limited
3. Check domain is publicly accessible

**Certificate not generating:**

```bash
# Check Traefik logs
docker compose logs traefik | grep -i acme

# Verify domain resolves
nslookup your-domain.com

# Ensure ports 80/443 are accessible from internet
```

## Memory Issues

### Symptoms

- Containers killed (OOMKilled)
- System becomes unresponsive
- "Cannot allocate memory" errors

### Solutions

**Check current usage:**

```bash
docker stats --no-stream
```

**Use smaller profile:**

```env
RESOURCE_PROFILE=lite
```

**Increase swap (Linux):**

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

**Reduce service count:**

Start only what you need:
```bash
docker compose up -d traefik postgres
```

## Traefik Routing Issues

### Symptoms

- 404 errors for configured services
- "Bad Gateway" (502) errors
- Service not discoverable

### Solutions

**Check Traefik sees the service:**

```bash
# Access dashboard (development)
curl http://localhost:8080/api/http/routers
```

**Verify labels:**

```bash
docker compose config | grep -A10 "labels" | grep traefik
```

**Check service is on correct network:**

```bash
docker network inspect proxy-external
# Service should be listed
```

**Common label mistakes:**

```yaml
# Wrong - missing enable
labels:
  - "traefik.http.routers.app.rule=Host(`app.example.com`)"

# Correct
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.app.rule=Host(`app.example.com`)"
```

## Cleanup and Reset

### Full Reset

Stop everything and remove all data:

```bash
# Stop containers
docker compose down

# Remove volumes (WARNING: deletes all data)
docker compose down -v

# Remove networks
docker network prune

# Remove unused images
docker image prune
```

### Partial Reset

Reset specific service:

```bash
# Stop and remove one service
docker compose rm -sf postgres

# Remove its volume
docker volume rm peermesh_postgres-data

# Restart
docker compose up -d postgres
```

## Getting More Help

### Collect Debug Information

When asking for help, provide:

```bash
# System info
docker version
docker compose version
uname -a

# Container status
docker compose ps

# Recent logs
docker compose logs --tail=100 > debug-logs.txt

# Configuration (sanitize secrets!)
docker compose config > debug-config.txt
```

### Log Locations

| Service | How to Access |
|---------|---------------|
| All services | `docker compose logs <service>` |
| Traefik | `docker compose logs traefik` |
| Authelia | `docker compose logs authelia` |
| PostgreSQL | `docker compose logs postgres` |

### Useful Commands

```bash
# Enter container shell
docker compose exec postgres bash

# Follow logs in real-time
docker compose logs -f traefik

# Check events
docker events --filter container=traefik

# Inspect container
docker inspect <container-id>
```
