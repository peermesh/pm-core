# Quick Start Guide

This document is the canonical public install path for PeerMeshCore's `docker-lab` repository, exposed at https://github.com/peermesh/docker-lab. Follow these steps when you need a public-facing quick start or want the referenced commands to match the public boundary.

Get Peer Mesh Docker Lab running in 5 minutes.

Note:

1. This quick start is the fastest runtime-first path.
2. If you want API-driven VPS provisioning first (recommended for production reproducibility), start with [OpenTofu Deployment Model](OPENTOFU-DEPLOYMENT-MODEL.md) and then return here for runtime deployment.

---

## Production Quick Start (10 Steps)

> **For production deployments**, use the [fork + upstream remote pattern](DEPLOYMENT-REPO-PATTERN.md) instead of cloning Docker Lab directly. Forking gives you your own repo for project-specific configuration while preserving the ability to merge upstream improvements. The steps below still apply -- you just run them inside your forked repo instead of a direct clone.

A condensed path for operators who want the shortest route to a running instance:

1. **Clone the repo**
   ```bash
   git clone https://github.com/peermesh/docker-lab.git && cd docker-lab
   ```
2. **Copy `.env.example` to `.env`**, set `DOMAIN` and `ADMIN_EMAIL`
   ```bash
   cp .env.example .env
   # Edit .env: set DOMAIN=yourdomain.com and ADMIN_EMAIL=you@example.com
   ```
3. **Generate secrets**
   ```bash
   ./scripts/generate-secrets.sh
   ```
4. **Build the dashboard image** (required -- not in any registry)
   ```bash
   docker compose build dashboard
   ```
5. **Start services**
   ```bash
   ./launch_peermesh.sh up
   ```
6. **Verify all services are healthy**
   ```bash
   docker compose ps
   # All services should show "healthy"
   ```
7. **Access your dashboard** at `https://your-domain`
8. **Enable modules**
   ```bash
   ./launch_peermesh.sh module enable hello-core
   ```
9. **Add database profiles** as needed (see [Profiles Guide](PROFILES.md))
10. **Review** the [Security Guide](SECURITY.md) and [Deployment Guide](DEPLOYMENT.md) for hardening

For a detailed walkthrough with explanations, continue with the step-by-step guide below.

---

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
git clone https://github.com/peermesh/docker-lab.git
cd docker-lab
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
ADMIN_EMAIL=admin@example.com

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

## Step 4: Build the Dashboard

The dashboard image must be built locally (it is not published to any registry):

```bash
docker compose build dashboard
```

## Step 5: Start Services

Start the PeerMeshCore runtime foundation:

```bash
./launch_peermesh.sh up
```

For development with PostgreSQL:

```bash
./launch_peermesh.sh up --profile=postgresql
```

<details>
<summary>Advanced / Manual: raw Docker Compose commands</summary>

```bash
# Foundation only
docker compose up -d

# With PostgreSQL profile
docker compose -f docker-compose.yml \
               -f profiles/postgresql/docker-compose.postgresql.yml \
               up -d
```

</details>

## Step 6: Verify It's Working

Check that all services are running:

```bash
docker compose ps
```

Expected output shows services as "healthy":

```
NAME                STATUS              PORTS
traefik             running (healthy)   80/tcp, 443/tcp
```

Access the Traefik dashboard (development only):

```
http://localhost:8080
```

## Next Steps

### Add a Database Profile

```bash
# PostgreSQL
./launch_peermesh.sh up --profile=postgresql

# MySQL
./launch_peermesh.sh up --profile=mysql
```

### Deploy an Example Application

```bash
# Ghost blogging platform
./launch_peermesh.sh up --profile=mysql --example=ghost
```

### Enable a Module

```bash
./launch_peermesh.sh module enable hello-core
```

<details>
<summary>Advanced / Manual: raw Docker Compose commands</summary>

```bash
# PostgreSQL
docker compose -f docker-compose.yml \
               -f profiles/postgresql/docker-compose.postgresql.yml \
               up -d

# MySQL
docker compose -f docker-compose.yml \
               -f profiles/mysql/docker-compose.mysql.yml \
               up -d

# Ghost example
docker compose -f docker-compose.yml \
               -f profiles/mysql/docker-compose.mysql.yml \
               -f examples/ghost/docker-compose.ghost.yml \
               up -d
```

</details>

### Configure for Production

1. Set `ENVIRONMENT=production` in `.env`
2. Configure a real domain in `DOMAIN=`
3. Ensure ports 80 and 443 are accessible
4. Review [Security Guide](SECURITY.md) for hardening

## Stopping Services

Stop all services:

```bash
./launch_peermesh.sh down
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
