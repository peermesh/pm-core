# Security Guide

Security architecture, hardening checklist, and best practices.

## Security Posture Overview

PeerMesh Docker Lab implements defense-in-depth with multiple security layers:

1. **Network Isolation** - Three-tier network segmentation
2. **Secret Management** - File-based secrets, never environment variables
3. **Non-Root Containers** - Minimal privileges for all services
4. **Docker Socket Protection** - Proxy isolates Docker API access
5. **Automatic HTTPS** - TLS termination at reverse proxy

## OpenBao Fallback Policy

For environments without TPM/vTPM support, OpenBao unseal handling must follow a fail-closed fallback policy. This project-level strategy is documented in:

- `docs/security/OPENBAO-NO-TPM-FALLBACK-STRATEGY.md`

## Network Isolation

> **Network Documentation Map**: This section provides a simplified overview. For the authoritative technical specification, see [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

### Three-Tier Network Architecture

```
Internet
    │
    ▼
┌─────────────────────────────────────┐
│  proxy-external (Public Zone)       │
│  - Traefik                          │
│  - Authelia                         │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  app-internal (Application Zone)    │
│  - Application containers           │
│  - Can reach databases              │
│  - Cannot reach internet directly   │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  db-internal (Database Zone)        │
│  - PostgreSQL, MySQL, MongoDB       │
│  - Redis, MinIO                     │
│  - No internet access               │
│  - No direct external access        │
└─────────────────────────────────────┘
```

### Network Rules

| Source | Destination | Allowed |
|--------|-------------|---------|
| Internet | proxy-external | Yes (80, 443) |
| Internet | app-internal | No |
| Internet | db-internal | No |
| proxy-external | app-internal | Yes |
| app-internal | db-internal | Yes |
| db-internal | Internet | No |

### Implementation

Networks are defined in docker-compose.yml:

```yaml
networks:
  proxy-external:
    name: proxy-external
  app-internal:
    name: app-internal
    internal: true
  db-internal:
    name: db-internal
    internal: true
```

The `internal: true` flag prevents containers from accessing the internet.

## Secret Management

### File-Based Secrets

All secrets are stored as files, never as environment variables:

```yaml
# Correct - File-based secret
environment:
  POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
secrets:
  - postgres_password

secrets:
  postgres_password:
    file: ./secrets/postgres_password

# Wrong - Exposed in environment
environment:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

### Why File-Based Secrets?

1. **Not in process listings** - `ps aux` won't show passwords
2. **Not in Docker inspect** - `docker inspect` won't expose them
3. **Not in logs** - Environment variable dumps won't include secrets
4. **Controlled permissions** - File permissions restrict access

### Secret File Permissions

```bash
# Set restrictive permissions
chmod 700 secrets/
chmod 600 secrets/*

# Verify
ls -la secrets/
# -rw-------  1 user user  44 Dec 31 12:00 postgres_password
```

### Secret Generation

Generate cryptographically secure secrets:

```bash
# Run the generation script
./scripts/generate-secrets.sh

# Or generate manually
openssl rand -base64 32 > secrets/my_secret
chmod 600 secrets/my_secret
```

## Non-Root Containers

All services run as non-root users where supported:

| Service | User:Group | UID:GID |
|---------|------------|---------|
| PostgreSQL | postgres:postgres | 70:70 |
| MySQL | mysql:mysql | 999:999 |
| MongoDB | mongodb:mongodb | 999:999 |
| Redis | redis:redis | 999:999 |
| Traefik | traefik:traefik | 65532:65532 |

### Implementation

```yaml
services:
  postgres:
    user: "70:70"

  traefik:
    user: "65532:65532"
    read_only: true
    security_opt:
      - no-new-privileges:true
```

## Docker Socket Protection

Docker socket access is dangerous - it's equivalent to root access on the host. Traefik needs socket access for service discovery, so we use a proxy.

### Docker Socket Proxy

```yaml
services:
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    environment:
      CONTAINERS: 1      # Read container info
      SERVICES: 0        # No Swarm services
      NETWORKS: 0        # No network management
      VOLUMES: 0         # No volume management
      IMAGES: 0          # No image management
      EXEC: 0            # No exec into containers
      POST: 0            # No write operations
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - docker-socket

  traefik:
    environment:
      DOCKER_HOST: tcp://docker-socket-proxy:2375
    networks:
      - docker-socket
      - proxy-external
```

### Why Socket Proxy?

- Traefik can discover containers (CONTAINERS=1)
- Traefik cannot create/delete containers (POST=0)
- Traefik cannot exec into containers (EXEC=0)
- Socket only accessible on internal network

## TLS Configuration

### Automatic HTTPS

Traefik handles TLS termination with Let's Encrypt:

```yaml
services:
  traefik:
    command:
      - "--certificatesresolvers.letsencrypt.acme.email=${ADMIN_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
```

### TLS Best Practices

Default configuration enforces:

- TLS 1.2 minimum (TLS 1.3 preferred)
- Strong cipher suites only
- HSTS headers
- HTTP to HTTPS redirect

### Self-Signed Certificates (Development)

For local development without valid domain:

```env
TRAEFIK_ACME_STAGING=true
```

## Dashboard API Authentication

### Authentication-First Design

The Docker Lab Dashboard protects **all endpoints** behind authentication, including typically-public endpoints like `/api/health`. This is an intentional secure-by-default design decision.

**Rationale:**

- **No information disclosure**: Even health status can reveal system information to attackers
- **Consistent security model**: No exceptions to authentication policy in default configuration
- **Defense-in-depth**: Additional layer beyond network-level access controls

**Trade-offs:**

- External monitoring tools (Uptime Kuma, Prometheus exporters, etc.) cannot check `/api/health` without credentials
- Users must explicitly opt-in to public health endpoints if needed

**Customizing for Monitoring:**

If your deployment requires a public health endpoint for external monitoring:

1. Edit the auth middleware in `services/dashboard/handlers/auth.go`
2. Add an exception for `/api/health`:
   ```go
   // Example: exempt health endpoint from authentication
   if r.URL.Path == "/api/health" {
       next.ServeHTTP(w, r)
       return
   }
   ```
3. Document your modification in deployment notes
4. Consider network-level access controls (IP allowlisting) as an alternative

**Security vs. Convenience:**

This design favors security over convenience. The health endpoint authentication is not a bug - it's a deliberate architectural choice. Users who need different behavior must explicitly modify the code, ensuring conscious security decisions.

## CI/CD Security Controls

Deployment security model:

1. Production deployment is pull-based webhook execution from the VPS.
2. Push-based GitHub Actions deployment (`deploy.yml`) remains disabled by default.
3. Deploy workflow edits are guarded by pre-commit and require explicit override:

```bash
ALLOW_DEPLOY_WORKFLOW_EDIT=true git commit -m "..."
```

Guarded files:

1. `.github/workflows/deploy.yml`
2. `.github/workflows/deploy.yml.DISABLED`

## Hardening Checklist

### Before Deployment

- [ ] All secrets generated with `./scripts/generate-secrets.sh`
- [ ] Secret files have 600 permissions
- [ ] Secrets directory has 700 permissions
- [ ] No hardcoded passwords in compose files
- [ ] `.env` file not committed to git

### Network

- [ ] Database containers on `db-internal` network
- [ ] Internal networks marked `internal: true`
- [ ] Only ports 80/443 exposed to internet
- [ ] Docker socket proxy configured

### Containers

- [ ] All containers have resource limits
- [ ] Containers run as non-root where possible
- [ ] `no-new-privileges` security option set
- [ ] Read-only root filesystem where possible

### Access Control

- [ ] Authelia configured for admin panels
- [ ] Strong 2FA enabled
- [ ] Default credentials changed
- [ ] Traefik dashboard disabled in production

### Monitoring

- [ ] Log aggregation configured
- [ ] Failed login alerts set up
- [ ] Resource usage monitoring enabled
- [ ] Backup verification scheduled

## Security Updates

### Container Image Updates

Check for updates regularly:

```bash
# Pull latest images
docker compose pull --ignore-buildable

# Recreate containers with new images
docker compose up -d
```

### Vulnerability Scanning

Scan images for vulnerabilities:

```bash
# Using Docker Scout (Docker Desktop)
docker scout cves traefik:v2.11

# Using Trivy
trivy image traefik:v2.11
```

## Incident Response

### Suspected Compromise

1. **Isolate** - Stop affected containers
   ```bash
   docker compose stop
   ```

2. **Preserve** - Keep logs and data for analysis
   ```bash
   docker compose logs > incident-logs.txt
   ```

3. **Rotate** - Generate new secrets
   ```bash
   ./scripts/generate-secrets.sh --force
   ```

4. **Rebuild** - Pull fresh images
   ```bash
   docker compose pull --ignore-buildable
   docker compose up -d --force-recreate
   ```

### Log Locations

| Service | Log Access |
|---------|------------|
| All services | `docker compose logs <service>` |
| Traefik access | Traefik container: `/var/log/traefik/` |
| Authelia | `docker compose logs authelia` |

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:

1. Do not open a public GitHub issue
2. Email security concerns to the maintainers
3. Allow time for a fix before public disclosure

## References

- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
