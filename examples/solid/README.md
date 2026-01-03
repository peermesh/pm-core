# Solid Community Server Example

Solid Community Server (CSS) is an open-source implementation of the Solid specification, providing decentralized data storage with user-controlled pods. This example demonstrates how to deploy CSS with Traefik routing.

---

## Overview

| Property | Value |
|----------|-------|
| **Application** | Solid Community Server 7.x |
| **Database** | File-based (no external DB required) |
| **Authentication** | WebID, built-in registration |
| **Resource Usage** | 256-512MB RAM |
| **Subdomain** | `solid.${DOMAIN}` |

---

## Profile Requirements

This example requires:

| Profile | Purpose | Required |
|---------|---------|----------|
| Foundation | Traefik | Yes |

---

## Quick Start

### 1. Configure Environment

```bash
cp examples/solid/.env.example examples/solid/.env

# Edit with your values
nano examples/solid/.env
```

### 2. Start Solid

```bash
# From project root
docker compose \
  -f docker-compose.yml \
  -f examples/solid/docker-compose.solid.yml \
  --profile solid \
  up -d
```

### 3. Verify Deployment

```bash
# Check health
docker compose ps

# Should show:
# pmdl_solid     running (healthy)

# View logs
docker compose logs solid
```

### 4. Access Solid

- **Server**: `https://solid.yourdomain.com/`
- **Register**: `https://solid.yourdomain.com/.account/login/password/register/`

First visit allows you to create a new account and pod.

---

## Architecture

```
Internet
    |
    v
+-------------+
|   Traefik   | (HTTPS termination)
+------+------+
       |
       v
+-------------+
|    Solid    | (Community Server)
|  (port 3000)|
+------+------+
       |
       v
+-------------+
|  File Store | (local volume)
+-------------+
```

---

## What is Solid?

Solid (Social Linked Data) is a specification that lets people store their data in decentralized data stores called Pods. Key concepts:

- **Pods**: Personal data stores that you control
- **WebID**: Your decentralized identity (like an email address for the web)
- **Linked Data**: Data is stored in standard RDF formats
- **Access Control**: You decide who can access your data

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your domain | `example.com` |

The base URL is automatically set to `https://solid.${DOMAIN}/`.

---

## Storage

Solid stores data in Docker volumes:

| Volume | Purpose | Backup Priority |
|--------|---------|-----------------|
| `pmdl_solid_data` | User pods, profiles, resources | Critical |

### Data Backup

```bash
# Backup Solid data
docker run --rm -v pmdl_solid_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/solid-data-$(date +%Y%m%d).tar.gz -C /data .
```

---

## Resource Limits

| Profile | Memory Limit | Reservation |
|---------|--------------|-------------|
| Default | 512M | 256M |

CSS is lightweight and efficient for file-based storage.

---

## Troubleshooting

### Server Returns 502 Bad Gateway

Solid container is not healthy yet:

```bash
docker compose logs solid
docker inspect pmdl_solid | grep -A5 Health
```

### Cannot Access .well-known

Verify Traefik routing:

```bash
curl -v https://solid.yourdomain.com/.well-known/solid
```

### Registration Not Working

Check CSS logs for errors:

```bash
docker compose logs solid | grep -i error
```

---

## Advanced Configuration

### Custom Configuration

Mount a custom config file for advanced setups:

```yaml
volumes:
  - ./config/my-config.json:/community-solid-server/config/my-config.json:ro
command:
  - -c
  - /community-solid-server/config/my-config.json
  - -f
  - /data
```

### External OIDC Provider

For integration with external identity providers, see the CSS documentation on OIDC configuration.

---

## References

- Solid Community Server: https://github.com/CommunitySolidServer/CommunitySolidServer
- CSS Docker Hub: https://hub.docker.com/r/solidproject/community-server
- Solid Specification: https://solidproject.org/TR/protocol
- CSS Documentation: https://communitysolidserver.github.io/CommunitySolidServer/

---

*Example Version: 1.0*
*Created: 2026-01-01*
