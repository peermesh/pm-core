# ADR-0400: Docker Compose Profile System

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

The project needs to support various deployment configurations:

- **Databases**: PostgreSQL, MySQL, MongoDB (not all users need all)
- **Caching**: Redis (optional)
- **Storage**: MinIO S3-compatible (optional)
- **Monitoring**: Prometheus, Grafana (optional)
- **Development**: Adminer, Mailhog (development only)

Users should be able to:

- Enable only the services they need
- Configure activation through environment variables (not file editing)
- Understand what profiles are available
- Add profiles without breaking existing deployments

---

## Decision

**We will use Docker Compose profiles** to organize optional services, activated via `COMPOSE_PROFILES` environment variable in `.env`:

```bash
# Enable PostgreSQL and Redis
COMPOSE_PROFILES=postgresql,redis

# Enable full stack
COMPOSE_PROFILES=postgresql,mysql,mongodb,redis,monitoring
```

Services are categorized into:

- **Foundation** (no profile): Always running - Traefik, socket-proxy
- **Supporting Tech** (profiles): Database and infrastructure - postgresql, mysql, mongodb, redis, minio
- **Feature** (profiles): Optional capabilities - monitoring, backup, dev

---

## Alternatives Considered

### Option A: Docker Compose Include Directive

**Description**: Use `include:` to pull in modular compose files.

**Pros**:
- Clean separation of concerns
- Each module in its own file
- Could share across projects

**Cons**:
- Requires Compose 2.20+ (May 2023)
- Not guaranteed on commodity VPS
- Version compatibility across Docker installations

**Why not chosen**: The project targets commodity VPS where Docker Compose versions vary. Profiles work with Compose 1.28+ (February 2021), providing broader compatibility.

### Option B: COMPOSE_FILE Chaining

**Description**: Multiple compose files, chained via `COMPOSE_FILE=compose.yaml:compose.monitoring.yaml`.

**Pros**:
- Modular files
- Clear separation

**Cons**:
- Order-dependent (later files override earlier)
- Requires environment variable with correct syntax
- Easy to make mistakes

**Why not chosen**: Higher user error rate. Profile names are self-documenting; file paths are not.

### Option C: Override Files

**Description**: Base compose with `compose.override.yaml` for variations.

**Pros**:
- Docker Compose auto-loads override
- Good for dev/prod differences

**Cons**:
- Binary choice (with or without override)
- Cannot select specific features
- Uncommenting sections is code modification

**Why not chosen**: Override pattern works for single variation, not multiple independent optional features.

---

## Consequences

### Positive

- Users configure deployment in `.env`, never editing YAML
- Self-documenting profile names
- Works with Compose 1.28+ (widespread availability)
- Easy to add new profiles without breaking existing configurations
- `docker compose config --profiles` lists available profiles

### Negative

- All services in single file (can become large)
- Profile documentation must be maintained separately
- Some duplication when services share configuration

### Neutral

- YAML anchors mitigate duplication
- Profile listing requires compose command, not visible in file browser

---

## Implementation Notes

### Profile Categories

```yaml
# Foundation (no profile - always on)
services:
  socket-proxy:
    # No profiles key
  traefik:
    # No profiles key

# Supporting Tech (database/infrastructure profiles)
  postgres:
    profiles:
      - postgresql
  mysql:
    profiles:
      - mysql
  mongodb:
    profiles:
      - mongodb
  redis:
    profiles:
      - redis
  minio:
    profiles:
      - minio

# Feature (optional capability profiles)
  prometheus:
    profiles:
      - monitoring
  grafana:
    profiles:
      - monitoring
  backup:
    profiles:
      - backup
```

### .env Configuration

```bash
# .env.example

# PROFILE ACTIVATION
# Comma-separated list of profiles to enable
#
# SUPPORTING TECH:
#   postgresql  - PostgreSQL 16 with pgvector
#   mysql       - MySQL 8.0
#   mongodb     - MongoDB 7.0
#   redis       - Redis 7
#   minio       - S3-compatible storage
#
# FEATURES:
#   monitoring  - Prometheus + Grafana
#   backup      - Automated backup
#   dev         - Development tools
#
COMPOSE_PROFILES=postgresql,redis
```

### Header Documentation

Document profiles in compose.yaml header:

```yaml
# ==============================================================
# PeerMesh Core
# ==============================================================
#
# PROFILES AVAILABLE:
#   postgresql  - PostgreSQL 16 with pgvector
#   mysql       - MySQL 8.0
#   mongodb     - MongoDB 7.0
#   redis       - Redis 7 / Valkey
#   minio       - S3-compatible storage
#   monitoring  - Prometheus, Grafana, Loki
#   backup      - Automated backup container
#   dev         - Adminer, Mailhog, debug tools
#
# ACTIVATION:
#   1. Copy .env.example to .env
#   2. Set COMPOSE_PROFILES=postgresql,redis,backup
#   3. Run: docker compose up -d
#
# ==============================================================
```

### Profile Naming Conventions

- Lowercase with hyphens (`monitoring`, not `Monitoring`)
- Feature-oriented, not component-oriented (`monitoring`, not `prometheus`)
- Singular form (`postgresql`, not `databases`)

### Service with Multiple Profiles

A service can be activated by multiple profiles:

```yaml
adminer:
  profiles:
    - dev
    - monitoring  # Also useful for monitoring database
```

### Dependency Handling

When profiled service depends on another profiled service:

```yaml
grafana:
  profiles:
    - monitoring
  depends_on:
    prometheus:
      condition: service_healthy
```

Both must be in the same active profile for dependency to work.

### Listing Available Profiles

```bash
docker compose config --profiles
# Output: backup, dev, minio, monitoring, mongodb, mysql, postgresql, redis
```

---

## References

### Documentation

- [Docker Compose Profiles](https://docs.docker.com/compose/profiles/) - Official documentation

### Related ADRs

- [ADR-0100: Multi-Database Profiles](./0100-multi-database-profiles.md) - Database profile details
- [ADR-0201: Security Anchors](./0201-security-anchors.md) - YAML patterns for profile services

### Internal Reference

- D5.1-SERVICE-COMPOSITION.md - Original decision document with profile taxonomy

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |
