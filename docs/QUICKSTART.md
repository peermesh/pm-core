# Quick Start Guide

Get Peer Mesh Docker Lab running in 5 minutes.

## Prerequisites

Before you begin, ensure you have:

- **Docker Engine** 24.0 or later
- **Docker Compose** 2.20 or later (included with Docker Desktop)
- **2GB RAM** minimum (4GB+ recommended for production)

Verify your installation:

```bash
docker --version
# Docker version 24.0.0 or higher

docker compose version
# Docker Compose version v2.20.0 or higher
```

## Step 1: Clone the Repository

```bash
git clone https://github.com/your-org/peer-mesh-docker-lab.git
cd peer-mesh-docker-lab
```

## Step 2: Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Required: Your domain (use localhost for local development)
DOMAIN=localhost

# Required: Admin email for Let's Encrypt certificates
ACME_EMAIL=admin@example.com

# Optional: Environment (development/staging/production)
ENVIRONMENT=development
```

## Step 3: Generate Secrets

Create secret files for database passwords and API keys:

```bash
# Make the script executable
chmod +x scripts/generate-secrets.sh

# Generate all required secrets
./scripts/generate-secrets.sh
```

This creates files in `secrets/` with randomly generated credentials.

## Step 4: Start Services

Start the core infrastructure:

```bash
docker compose up -d
```

For development with PostgreSQL:

```bash
docker compose -f docker-compose.yml \
               -f profiles/postgresql/docker-compose.postgresql.yml \
               up -d
```

## Step 5: Verify It's Working

Check that all services are running:

```bash
docker compose ps
```

Expected output shows services as "healthy":

```
NAME                STATUS              PORTS
traefik             running (healthy)   80/tcp, 443/tcp
authelia            running (healthy)   9091/tcp
redis-auth          running (healthy)   6379/tcp
```

Access the Traefik dashboard (development only):

```
http://localhost:8080
```

## Next Steps

### Add a Database Profile

```bash
# PostgreSQL
docker compose -f docker-compose.yml \
               -f profiles/postgresql/docker-compose.postgresql.yml \
               up -d

# MySQL
docker compose -f docker-compose.yml \
               -f profiles/mysql/docker-compose.mysql.yml \
               up -d
```

### Deploy an Example Application

```bash
# Ghost blogging platform
docker compose -f docker-compose.yml \
               -f profiles/mysql/docker-compose.mysql.yml \
               -f examples/ghost/docker-compose.ghost.yml \
               up -d
```

### Configure for Production

1. Set `ENVIRONMENT=production` in `.env`
2. Configure a real domain in `DOMAIN=`
3. Ensure ports 80 and 443 are accessible
4. Review [Security Guide](SECURITY.md) for hardening

## Stopping Services

Stop all services:

```bash
docker compose down
```

Stop and remove volumes (WARNING: deletes data):

```bash
docker compose down -v
```

## Troubleshooting

### Containers won't start

Check logs for specific service:

```bash
docker compose logs traefik
docker compose logs authelia
```

### Port already in use

Stop conflicting services or change ports in `.env`:

```bash
# Check what's using port 80
lsof -i :80
```

### Permission denied errors

Ensure secrets directory has correct permissions:

```bash
chmod 700 secrets/
chmod 600 secrets/*
```

See [Troubleshooting Guide](TROUBLESHOOTING.md) for more solutions.

## Getting Help

- Check [Configuration Reference](CONFIGURATION.md) for all options
- Review [Profiles Guide](PROFILES.md) for resource allocation
- Read [Security Guide](SECURITY.md) for hardening checklist
