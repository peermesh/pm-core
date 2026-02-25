# Security Architecture

Comprehensive security architecture documentation for Peer Mesh Docker Lab.

**Version**: 1.1.0
**Last Updated**: 2026-02-21
**Status**: Production-Ready

---

## Executive Summary

Peer Mesh Docker Lab implements defense-in-depth security with:

- **Network Isolation**: Four-tier network topology
- **Secrets Management**: File-based secrets, never environment variables
- **Container Hardening**: Non-root, dropped capabilities, resource limits
- **API Protection**: Docker socket proxy with read-only filtering
- **TLS Everywhere**: Automatic HTTPS via Let's Encrypt
- **Webhook Deployment**: Pull-based deployment without SSH keys in CI
- **Supply-Chain Gates**: Image policy + SBOM + vulnerability threshold validation
- **Encrypted Secrets Workflow**: SOPS+age support for encrypted-at-rest secret bundles
- **Provisioning Boundary**: OpenTofu handles infra provisioning, Docker Lab handles runtime operations

---

## Table of Contents

1. [Security Principles](#security-principles)
2. [Network Architecture](#network-architecture)
3. [Secrets Management](#secrets-management)
4. [Authentication & Authorization](#authentication--authorization)
5. [TLS Configuration](#tls-configuration)
6. [Container Security](#container-security)
7. [Docker Socket Protection](#docker-socket-protection)
8. [Provisioning Security Boundary](#provisioning-security-boundary)
9. [Supply-Chain Security Controls](#supply-chain-security-controls)
10. [Deployment Security](#deployment-security)
11. [Monitoring & Logging](#monitoring--logging)
12. [Incident Response](#incident-response)
13. [Compliance Mapping](#compliance-mapping)

---

## Security Principles

### Defense in Depth

Multiple security layers ensure that compromise of one layer does not compromise the entire system:

```
Layer 1: Network Perimeter
├── Firewall (ports 80, 443, 8448 only)
├── TLS termination
└── Rate limiting

Layer 2: Application Proxy
├── Traefik reverse proxy
├── Request filtering
└── Security headers

Layer 3: Container Isolation
├── Namespace isolation
├── Network segmentation
└── Resource limits

Layer 4: Service Security
├── Non-root execution
├── Capability dropping
└── Read-only filesystems

Layer 5: Data Security
├── File-based secrets
├── Encrypted at rest (optional SOPS)
└── Minimal data exposure
```

### Principle of Least Privilege

Every component has only the permissions it needs:

| Component | Permissions | Justification |
|-----------|-------------|---------------|
| Traefik | Read containers, networks | Service discovery |
| Dashboard | Read containers only | Status display |
| Databases | Write to data volume | Store application data |
| Apps | Connect to specific DB | Application function |

### Zero Trust Network

Internal networks are treated as potentially hostile:

- No implicit trust between containers
- Explicit network membership required
- Internal networks block internet access
- Service-to-service authentication where supported

---

## Network Architecture

### Network Topology

```
                    ┌─────────────────────────────────┐
                    │           INTERNET               │
                    │      (Untrusted Zone)            │
                    └──────────────┬──────────────────┘
                                   │
                         Ports 80, 443, 8448
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        proxy-external                                │
│                     (DMZ / Public Zone)                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                       │
│  │ Traefik  │    │Dashboard │    │  MinIO   │  (Public-facing)      │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘                       │
└───────┼───────────────┼───────────────┼─────────────────────────────┘
        │               │               │
        ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        app-internal                                  │
│                   (Application Zone)                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                       │
│  │  Redis   │    │  Apps    │    │ Services │  (Internal only)      │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘                       │
│       │               │               │                              │
│       │  internal: true - NO internet access                         │
└───────┼───────────────┼───────────────┼─────────────────────────────┘
        │               │               │
        ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        db-internal                                   │
│                     (Database Zone)                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                       │
│  │PostgreSQL│    │  MySQL   │    │ MongoDB  │  (Data stores)        │
│  └──────────┘    └──────────┘    └──────────┘                       │
│                                                                      │
│       internal: true - NO internet access, NO public ports           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        socket-proxy                                  │
│                    (Management Zone)                                 │
│  ┌─────────────────────┐    ┌──────────┐                            │
│  │ Docker Socket Proxy │◄───│ Traefik  │  (API filtered access)     │
│  └─────────────────────┘    └──────────┘                            │
│                                                                      │
│       internal: true - Isolated, read-only Docker API                │
└─────────────────────────────────────────────────────────────────────┘
```

### Network Access Matrix

| Source | proxy-external | app-internal | db-internal | socket-proxy |
|--------|----------------|--------------|-------------|--------------|
| Internet | Ports 80,443,8448 | No | No | No |
| proxy-external | Yes | Yes | No | Via Traefik only |
| app-internal | Yes | Yes | Yes | No |
| db-internal | No | No | Yes | No |
| socket-proxy | No | No | No | Yes |

### Network Security Controls

```yaml
networks:
  # Public-facing network
  proxy-external:
    name: pmdl_proxy-external
    # NOT internal - can reach internet

  # Application network - no internet
  app-internal:
    name: pmdl_app-internal
    internal: true  # Blocks internet access

  # Database network - no internet, no public access
  db-internal:
    name: pmdl_db-internal
    internal: true  # Blocks internet access

  # Socket proxy - highly isolated
  socket-proxy:
    name: pmdl_socket-proxy
    internal: true  # Blocks internet access
```

---

## Secrets Management

**Canonical Source**: For complete secrets management procedures, team onboarding, rotation workflows, and recovery procedures, see [SECRETS-MANAGEMENT.md](SECRETS-MANAGEMENT.md).

This section provides architecture overview. Operational procedures are maintained in the canonical source.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Host Filesystem                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              secrets/ (chmod 700)                        │    │
│  │  ┌────────────────────┐  ┌────────────────────┐         │    │
│  │  │ postgres_password  │  │ mysql_root_password │ (600)  │    │
│  │  └─────────┬──────────┘  └──────────┬─────────┘         │    │
│  │            │                        │                    │    │
│  └────────────┼────────────────────────┼────────────────────┘    │
└───────────────┼────────────────────────┼────────────────────────┘
                │                        │
        Docker Compose secrets directive
                │                        │
                ▼                        ▼
┌───────────────────────────────────────────────────────────────────┐
│                    Container Runtime                               │
│  ┌────────────────────┐       ┌────────────────────┐              │
│  │     PostgreSQL     │       │       MySQL        │              │
│  │                    │       │                    │              │
│  │ /run/secrets/      │       │ /run/secrets/      │              │
│  │   postgres_password│       │   mysql_root_pw    │              │
│  │                    │       │                    │              │
│  │ POSTGRES_PASSWORD_ │       │ MYSQL_ROOT_        │              │
│  │ FILE=/run/secrets/ │       │ PASSWORD_FILE=...  │              │
│  │   postgres_password│       │                    │              │
│  └────────────────────┘       └────────────────────┘              │
└───────────────────────────────────────────────────────────────────┘
```

### Secret Types

| Secret | Type | Purpose | Generation |
|--------|------|---------|------------|
| postgres_password | Database | PostgreSQL root | 32 bytes hex |
| mysql_root_password | Database | MySQL root | 32 bytes hex |
| mongodb_root_password | Database | MongoDB root | 32 bytes hex |
| minio_root_user | Service | MinIO username | 16 chars alphanumeric |
| minio_root_password | Service | MinIO password | 32 bytes hex |
| dashboard_password | Application | Dashboard access | 24 bytes base64 |
| webhook_secret | Deployment | GitHub webhook | 32 bytes hex |

### Secret Properties

1. **Never in environment variables** - Always `_FILE` suffix
2. **File permissions** - 600 (owner read/write only)
3. **Directory permissions** - 700 (owner only)
4. **Mounted read-only** - Containers cannot modify
5. **Not in Docker inspect** - Secret values not exposed
6. **Not in process listings** - `ps` cannot show secrets

### Implementation

```yaml
# docker-compose.yml
secrets:
  postgres_password:
    file: ./secrets/postgres_password

services:
  postgres:
    secrets:
      - postgres_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
```

### Generation

```bash
# Generate all secrets
./scripts/generate-secrets.sh

# Validate secrets exist
./scripts/generate-secrets.sh --validate
```

### Related ADRs

- [ADR-0003: File-Based Secrets](decisions/0003-file-based-secrets.md)
- [ADR-0202: SOPS+Age Encryption](decisions/0202-sops-age-secrets-encryption.md)

---

## Authentication & Authorization

### Dashboard Authentication

The dashboard implements:

1. **HTTP Basic Auth** - Via Traefik middleware for initial protection
2. **Application Auth** - Go-based session management
3. **Rate Limiting** - 10 requests/minute average, 20 burst

```yaml
labels:
  # Basic auth at proxy level
  - "traefik.http.middlewares.dashboard-auth.basicauth.users=${DASHBOARD_AUTH}"

  # Rate limiting
  - "traefik.http.middlewares.dashboard-ratelimit.ratelimit.average=10"
  - "traefik.http.middlewares.dashboard-ratelimit.ratelimit.burst=20"
```

### Traefik Dashboard

When enabled (development only):

```yaml
labels:
  - "traefik.http.middlewares.dashboard-auth.basicauth.users=${TRAEFIK_DASHBOARD_AUTH}"
```

**Production Recommendation**: Disable Traefik dashboard or restrict to localhost only.

### Database Authentication

All databases authenticate via secrets:

| Database | Auth Method | Secret Source |
|----------|-------------|---------------|
| PostgreSQL | Password | `/run/secrets/postgres_password` |
| MySQL | Password | `/run/secrets/mysql_root_password` |
| MongoDB | SCRAM-SHA-256 | `/run/secrets/mongodb_root_password` |
| Redis | None (internal) | Network isolation only |

### MinIO Authentication

```yaml
environment:
  MINIO_ROOT_USER_FILE: /run/secrets/minio_root_user
  MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_root_password
```

---

## TLS Configuration

### Certificate Management

```
┌─────────────────────────────────────────────────────────────────┐
│                        Let's Encrypt                             │
│                     (Certificate Authority)                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    HTTP-01 Challenge
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Traefik                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Certificate Store                           │    │
│  │         /acme/acme.json (chmod 600)                     │    │
│  │                                                          │    │
│  │  - Auto-renewal before expiry                           │    │
│  │  - Wildcard support via DNS challenge (optional)        │    │
│  │  - Multiple certificates per domain                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  TLS Termination for all *.domain.com                           │
└─────────────────────────────────────────────────────────────────┘
```

### TLS Settings

```yaml
command:
  # Certificate resolver
  - "--certificatesresolvers.letsencrypt.acme.email=${ADMIN_EMAIL}"
  - "--certificatesresolvers.letsencrypt.acme.storage=/acme/acme.json"
  - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"

  # HTTP to HTTPS redirect
  - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
  - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
```

### Security Headers

Applied to all services via middleware:

```yaml
labels:
  # Strict Transport Security
  - "traefik.http.middlewares.security.headers.stsSeconds=31536000"
  - "traefik.http.middlewares.security.headers.stsIncludeSubdomains=true"
  - "traefik.http.middlewares.security.headers.stsPreload=true"

  # XSS Protection
  - "traefik.http.middlewares.security.headers.browserxssfilter=true"

  # Content Type Sniffing
  - "traefik.http.middlewares.security.headers.contenttypenosniff=true"

  # Clickjacking Protection
  - "traefik.http.middlewares.security.headers.frameDeny=true"

  # Additional Headers
  - "traefik.http.middlewares.security.headers.customResponseHeaders.X-Robots-Tag=noindex,nofollow"
  - "traefik.http.middlewares.security.headers.customResponseHeaders.X-Permitted-Cross-Domain-Policies=none"
```

### TLS Versions

Traefik 2.11 defaults:
- Minimum: TLS 1.2
- Preferred: TLS 1.3
- Weak ciphers disabled

---

## Container Security

### Security Anchors

Standard security configuration applied to all services:

```yaml
x-secured-service: &secured-service
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  restart: unless-stopped
```

### Container Hardening Matrix

| Service | Non-Root | no-new-privs | cap_drop ALL | read_only | Memory Limit |
|---------|----------|--------------|--------------|-----------|--------------|
| socket-proxy | No* | - | - | No | 32MB |
| traefik | Yes | Yes | Yes | Optional | 256MB |
| dashboard | Yes | Yes | Yes | No | 64MB |
| postgres | Partial** | No | No | No | 1GB |
| mysql | Partial** | No | No | No | 1GB |
| mongodb | Partial** | No | No | No | 1GB |
| redis | Yes | Yes | Yes | No | 256MB |
| minio | No | No | No | No | 512MB |

*Socket-proxy requires root for Docker socket access
**Databases start as root but drop privileges after init

### Resource Limits

All services have defined resource limits:

```yaml
deploy:
  resources:
    limits:
      memory: 256M     # Hard limit
    reservations:
      memory: 64M      # Guaranteed minimum
```

### Logging Configuration

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"    # Rotate at 10MB
    max-file: "3"      # Keep 3 files
```

---

## Docker Socket Protection

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Docker Daemon                                │
│                 /var/run/docker.sock                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    Read-only mount (:ro)
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│               tecnativa/docker-socket-proxy                      │
│                                                                  │
│  Allowed Endpoints:              Blocked Endpoints:              │
│  ├── CONTAINERS=1 (read)         ├── POST=0 (all writes)        │
│  ├── NETWORKS=1 (read)           ├── EXEC=0                     │
│  ├── INFO=1                      ├── IMAGES=0                   │
│  └── VERSION=1                   ├── VOLUMES=0                  │
│                                  ├── BUILD=0                    │
│                                  ├── COMMIT=0                   │
│                                  └── ...all others=0            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                 tcp://socket-proxy:2375
                    (internal network)
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Traefik                                  │
│                                                                  │
│  DOCKER_HOST=tcp://socket-proxy:2375                            │
│                                                                  │
│  Can: List containers, read labels, watch events                │
│  Cannot: Create, delete, exec, or modify anything               │
└─────────────────────────────────────────────────────────────────┘
```

### Proxy Configuration

```yaml
socket-proxy:
  image: tecnativa/docker-socket-proxy:0.2
  user: "0:0"  # Required for socket access
  environment:
    # Allowed (read-only service discovery)
    CONTAINERS: 1
    NETWORKS: 1
    INFO: 1
    VERSION: 1

    # Blocked (all modifications)
    POST: 0        # No write operations
    SERVICES: 0
    TASKS: 0
    SWARM: 0
    VOLUMES: 0
    BUILD: 0
    COMMIT: 0
    CONFIGS: 0
    DISTRIBUTION: 0
    EXEC: 0        # No exec into containers
    GRPC: 0
    IMAGES: 0
    NODES: 0
    PLUGINS: 0
    SECRETS: 0
    SESSION: 0
    SYSTEM: 0
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  networks:
    - socket-proxy  # Internal network only
```

### Security Benefits

1. **Attack Surface Reduction** - Limited API endpoints
2. **Read-Only Operations** - Cannot modify Docker state
3. **Network Isolation** - Proxy on internal network
4. **No Direct Socket Mount** - Traefik never touches socket

### Related ADR

- [ADR-0004: Docker Socket Proxy](decisions/0004-docker-socket-proxy.md)

---

## Provisioning Security Boundary

Infrastructure provisioning and runtime operations are intentionally separated:

1. OpenTofu controls infrastructure resources (VPS/network/firewall/DNS) through provider APIs.
2. Docker Lab runtime controls container lifecycle (Compose/webhook deploy, promotion, backups, validation).

Security implications:

1. Infrastructure credentials (for example, `HCLOUD_TOKEN`, DNS API token) are used only in scoped plan/apply sessions.
2. Runtime secrets remain in Docker Lab secrets flow and are not moved into OpenTofu state.
3. No runtime container/module lifecycle ownership is delegated to OpenTofu in this cycle.

References:

- [OPENTOFU-DEPLOYMENT-MODEL.md](OPENTOFU-DEPLOYMENT-MODEL.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)

---

## Supply-Chain Security Controls

Deployment preflight enforces supply-chain controls before promotion:

1. Image policy validation (tag/digest policy contract).
2. SBOM generation (CycloneDX artifacts).
3. Vulnerability threshold gating with authenticated scanning path.

Command entrypoint:

```bash
./scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL
```

Primary policy references:

- [SUPPLY-CHAIN-SECURITY.md](SUPPLY-CHAIN-SECURITY.md)
- [ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md](ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md)
- [IMAGE-DIGEST-BASELINE.md](IMAGE-DIGEST-BASELINE.md)
- [DEPLOYMENT-PROMOTION-RUNBOOK.md](DEPLOYMENT-PROMOTION-RUNBOOK.md)

---

## Deployment Security

### Pull-Based Deployment (Webhook)

```
┌─────────────────────────────────────────────────────────────────┐
│                         GitHub                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Repository                                              │    │
│  │  ├── Code                                                │    │
│  │  ├── Webhook Secret (stored)                             │    │
│  │  └── Deploy Key (read-only, stored)                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────────┘
                             │
              HTTPS POST with HMAC-SHA256 signature
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                          VPS                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Webhook Listener                                        │    │
│  │  ├── Validates HMAC signature                           │    │
│  │  ├── Triggers deploy script                             │    │
│  │  └── Logs all deployments                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                             │                                    │
│                             ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Deploy Script                                           │    │
│  │  ├── git fetch (using local deploy key)                 │    │
│  │  ├── git checkout                                        │    │
│  │  ├── docker compose pull                                 │    │
│  │  └── docker compose up -d                                │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Security Advantages Over Push-Based

| Aspect | Push-Based (SSH) | Pull-Based (Webhook) |
|--------|------------------|---------------------|
| Credential Location | GitHub Secrets + VPS | VPS only |
| GitHub Compromise Impact | Full server access | Can only trigger deploys |
| Attack Surface | SSH port open | HTTPS endpoint |
| Credential Rotation | Complex | Simple |

### Webhook Security

1. **HMAC Validation** - Every request verified
2. **HTTPS Only** - TLS-encrypted transport
3. **Read-Only Key** - Deploy key cannot push
4. **Isolated Container** - Webhook runs containerized

---

## Monitoring & Logging

### Log Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    All Containers                                │
│  logging:                                                        │
│    driver: json-file                                            │
│    options:                                                      │
│      max-size: "10m"                                            │
│      max-file: "3"                                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│               docker compose logs                                │
│                                                                  │
│  Access: docker compose logs [service]                          │
│  Tail: docker compose logs -f --tail 100 [service]              │
└─────────────────────────────────────────────────────────────────┘
```

### Traefik Access Logs

```yaml
command:
  - "--accesslog=true"
  - "--accesslog.format=json"
```

### Security Monitoring Recommendations

1. **Log Aggregation** - Send to central logging (Loki, ELK)
2. **Failed Auth Alerts** - Monitor 401/403 responses
3. **Rate Limit Hits** - Alert on excessive rate limiting
4. **Container Restarts** - Monitor for crash loops

---

## Incident Response

### Immediate Actions

```bash
# 1. Isolate - Stop affected containers
docker compose stop [service]

# 2. Preserve - Capture logs and state
docker compose logs > incident-$(date +%Y%m%d-%H%M%S).log
docker inspect [container] > container-state.json

# 3. Investigate - Check for compromise indicators
docker compose logs --tail 1000 | grep -i "error\|fail\|denied"
```

### Credential Rotation

```bash
# Rotate all secrets
./scripts/generate-secrets.sh --force

# Rotate webhook secret
just webhook-rotate-secret

# Rotate deploy key
just webhook-rotate-key
```

### Recovery

```bash
# Pull fresh images
docker compose pull --ignore-buildable

# Recreate all containers
docker compose up -d --force-recreate
```

---

## Compliance Mapping

### CIS Docker Benchmark Coverage

| CIS Control | Status | Implementation |
|-------------|--------|----------------|
| 2.1 Network traffic between containers | Pass | Internal networks |
| 4.1 Create user for container | Partial | Most services non-root |
| 4.5 Content trust | Info | Not enabled |
| 5.2 SELinux/AppArmor | N/A | Host dependent |
| 5.4 Privileged containers | Pass | None privileged |
| 5.9 Host network namespace | Pass | Only traefik for ports |
| 5.10 Memory limits | Pass | All services limited |
| 5.12 Root filesystem read-only | Partial | Where supported |
| 5.22 docker exec commands | Pass | Blocked via proxy |
| 5.25 Restart policy | Pass | unless-stopped |
| 5.31 Docker socket in containers | Mitigated | Via proxy only |

### OWASP Container Security

| Control | Status | Implementation |
|---------|--------|----------------|
| C1: Image Provenance | Pass | Official images only |
| C2: Image Scanning | Manual | Trivy/Docker Scout |
| C3: Secrets Management | Pass | File-based secrets |
| C4: Network Segmentation | Pass | Four-tier topology |
| C5: Secure Configuration | Pass | Security anchors |
| C6: Runtime Security | Pass | no-new-privileges |
| C7: Logging | Pass | JSON with rotation |

---

## Related Documentation

- [SECURITY.md](SECURITY.md) - Security guide and hardening checklist
- [ADR-0002: Four-Network Topology](decisions/0002-four-network-topology.md)
- [ADR-0003: File-Based Secrets](decisions/0003-file-based-secrets.md)
- [ADR-0004: Docker Socket Proxy](decisions/0004-docker-socket-proxy.md)
- [ADR-0200: Non-Root Containers](decisions/0200-non-root-containers.md)
- [ADR-0201: Security Anchors](decisions/0201-security-anchors.md)
- [WEBHOOK-DEPLOYMENT.md](WEBHOOK-DEPLOYMENT.md) - Pull-based deployment
- [SUPPLY-CHAIN-SECURITY.md](SUPPLY-CHAIN-SECURITY.md) - Image policy, SBOM, vulnerability thresholds
- [ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md](ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md) - Immutable version and digest requirements
- [IMAGE-DIGEST-BASELINE.md](IMAGE-DIGEST-BASELINE.md) - Current external image lock set
- [OPENTOFU-DEPLOYMENT-MODEL.md](OPENTOFU-DEPLOYMENT-MODEL.md) - Infra provisioning boundary model
- [AUDIT-PREP.md](AUDIT-PREP.md) - Audit preparation package

---

*Document version: 1.1.0*
*CIS Docker Benchmark version: 1.6.0*
*OWASP Container Security version: 2023*
