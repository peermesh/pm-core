# Project Glossary & Nomenclature Reference

**Version**: 1.0.0
**Last Updated**: 2026-01-23
**Maintainer**: All contributors

This document defines the authoritative terms, naming conventions, and namespaces used throughout the PeerMesh Docker Lab project. **All code, configuration, and documentation MUST use these terms consistently.**

---

## Quick Reference: Naming Prefixes

| Prefix | Scope | Example |
|--------|-------|---------|
| `DOCKERLAB_` | Docker Lab Dashboard (main UI) | `DOCKERLAB_USERNAME` |
| `TRAEFIK_` | Traefik reverse proxy | `TRAEFIK_DASHBOARD_PORT` |
| `POSTGRES_` | PostgreSQL database | `POSTGRES_PASSWORD` |
| `REDIS_` | Redis cache/queue | `REDIS_PASSWORD` |
| `MINIO_` | MinIO object storage | `MINIO_ROOT_PASSWORD` |
| `MASTODON_` | Mastodon module | `MASTODON_DB_PASSWORD` |
| `PKI_` | PKI/step-ca module | `PKI_CA_PASSWORD` |
| `BACKUP_` | Backup module | `BACKUP_RETENTION_DAYS` |

---

## Core Components

### Docker Lab Dashboard

**Canonical Name**: Docker Lab Dashboard
**Service Name**: `dashboard`
**Config Prefix**: `DOCKERLAB_`
**URL**: `https://${DOMAIN}/` (root)

The main web UI for monitoring and managing Docker infrastructure. Built with Go + HTMX.

| Variable | Purpose | Example |
|----------|---------|---------|
| `DOCKERLAB_USERNAME` | Admin username | `admin` |
| `DOCKERLAB_PASSWORD` | Admin password | (generated) |
| `DOCKERLAB_DEMO_MODE` | Enable guest access | `true` / `false` |
| `DOCKERLAB_SESSION_SECRET` | Session signing key | (generated) |
| `DOCKERLAB_INSTANCE_NAME` | Multi-instance display name | `Production` |
| `DOCKERLAB_INSTANCE_ID` | Unique instance identifier | `prod-001` |
| `DOCKERLAB_INSTANCE_URL` | Instance URL for federation | `https://dockerlab.example.com` |
| `DOCKERLAB_INSTANCE_SECRET` | Inter-instance auth token | (generated) |

**NOT to be confused with**: Traefik Dashboard (see below)

---

### Traefik Dashboard

**Canonical Name**: Traefik Dashboard
**Service Name**: `traefik` (internal API)
**Config Prefix**: `TRAEFIK_DASHBOARD_`
**URL**: `https://traefik.${DOMAIN}/` or `localhost:8080`

Traefik's built-in administration interface for monitoring routes, services, and middleware.

| Variable | Purpose | Example |
|----------|---------|---------|
| `TRAEFIK_DASHBOARD_PORT` | Local port binding | `8080` |
| `TRAEFIK_DASHBOARD_AUTH` | htpasswd credentials | `admin:$apr1$...` |
| `TRAEFIK_DASHBOARD_ENABLED` | Enable/disable | `true` / `false` |

**Production Note**: Should be disabled or localhost-only in production.

---

### Traefik (Reverse Proxy)

**Canonical Name**: Traefik
**Service Name**: `traefik`
**Config Prefix**: `TRAEFIK_`

The reverse proxy handling HTTPS termination, routing, and load balancing.

| Variable | Purpose |
|----------|---------|
| `TRAEFIK_LOG_LEVEL` | Logging verbosity |
| `TRAEFIK_ACME_EMAIL` | Let's Encrypt contact (actual env var: `ADMIN_EMAIL`) |
| `TRAEFIK_ENTRYPOINTS_*` | Entry point config |

---

### Socket Proxy

**Canonical Name**: Socket Proxy
**Service Name**: `socket-proxy`
**Config Prefix**: `SOCKET_PROXY_`

Security proxy for Docker socket access.

---

## Database Services

### PostgreSQL

**Canonical Name**: PostgreSQL
**Service Name**: `postgres`
**Config Prefix**: `POSTGRES_`
**Profile**: `postgresql`

| Variable | Purpose |
|----------|---------|
| `POSTGRES_USER` | Database user |
| `POSTGRES_PASSWORD` | Database password |
| `POSTGRES_DB` | Default database |
| `POSTGRES_SHARED_BUFFERS` | Memory allocation |

---

### Redis

**Canonical Name**: Redis
**Service Name**: `redis`
**Config Prefix**: `REDIS_`
**Profile**: `redis`

| Variable | Purpose |
|----------|---------|
| `REDIS_PASSWORD` | Authentication |
| `REDIS_MAXMEMORY` | Memory limit |

---

## Modules

Modules follow the pattern: `modules/{name}/`

### Backup Module

**Canonical Name**: Backup Module
**Directory**: `modules/backup/`
**Config Prefix**: `BACKUP_`
**Profile**: `backup`

| Variable | Purpose |
|----------|---------|
| `BACKUP_SCHEDULE` | Cron schedule |
| `BACKUP_RETENTION_DAYS` | Retention period |
| `BACKUP_S3_BUCKET` | Off-site destination |

---

### PKI Module

**Canonical Name**: PKI Module (step-ca)
**Directory**: `modules/pki/`
**Config Prefix**: `PKI_`
**Profile**: `pki`

| Variable | Purpose |
|----------|---------|
| `PKI_CA_NAME` | CA common name |
| `PKI_CA_PASSWORD` | CA key password |
| `PKI_PROVISIONER_PASSWORD` | Provisioner password |

---

### Mastodon Module

**Canonical Name**: Mastodon Module
**Directory**: `modules/mastodon/`
**Config Prefix**: `MASTODON_`
**Profile**: `mastodon`

| Variable | Purpose |
|----------|---------|
| `MASTODON_DOMAIN` | Instance domain |
| `MASTODON_DB_PASSWORD` | Database password |
| `MASTODON_SECRET_KEY_BASE` | Rails secret |

---

## Naming Conventions

### Environment Variables

```
{NAMESPACE}_{COMPONENT}_{SETTING}

Examples:
  DOCKERLAB_SESSION_SECRET     # Docker Lab Dashboard session secret
  TRAEFIK_DASHBOARD_PORT       # Traefik Dashboard port
  POSTGRES_SHARED_BUFFERS      # PostgreSQL memory setting
  MASTODON_DB_PASSWORD         # Mastodon's database password
```

**Rules:**
1. ALL CAPS with underscores
2. Namespace prefix REQUIRED (no generic names)
3. Use established prefixes from this glossary
4. New modules: use module directory name as prefix

### Naming Pattern Summary

| Element | Pattern | Example |
|---------|---------|---------|
| Container | `pmdl_{service}` | `pmdl_dashboard` |
| Volume | `pmdl_{service}_data` | `pmdl_postgres_data` |
| Network | `pmdl_{purpose}` | `pmdl_db-internal` |
| Image | `pmdl/{service}:tag` | `pmdl/dashboard:0.1.0` |
| Env Var | `{MODULE}_SETTING` | `POSTGRES_MEMORY_LIMIT` |
| Event | `{module}.{entity}.{action}` | `backup.postgres.completed` |
| Profile | `lowercase-singular` | `postgresql`, `monitoring` |
| Module ID | `lowercase-hyphen` | `backup`, `test-module` |
| Secret | `{service}_password` | `postgres_password` |

### Service Names (docker-compose)

```
{component}[-{qualifier}]

Examples:
  dashboard          # Main Docker Lab Dashboard
  traefik            # Reverse proxy
  postgres           # Database
  redis              # Cache
  socket-proxy       # Docker socket proxy
  backup-scheduler   # Backup cron service
```

**Rules:**
1. Lowercase with hyphens
2. Short, descriptive names
3. Qualifiers for variants (e.g., `postgres-replica`)

### File/Directory Names

```
{COMPONENT}.md           # Documentation
{component}/             # Directories
{component}.yml          # Config files
{COMPONENT}-*.md         # Related docs

Examples:
  GLOSSARY.md
  DASHBOARD.md
  modules/backup/
  docker-compose.yml
```

---

## Disambiguation Table

| Term | Refers To | NOT |
|------|-----------|-----|
| "Dashboard" (capitalized) | Docker Lab Dashboard | Traefik Dashboard |
| "Traefik Dashboard" | Traefik's admin UI | Docker Lab Dashboard |
| `dashboard` service | Docker Lab Dashboard | Any other dashboard |
| `DASHBOARD_*` vars | **DEPRECATED** - use `DOCKERLAB_*` | - |
| "the dashboard" | Context-dependent - be specific | - |

---

## Adding New Terms

See [GLOSSARY-GUIDE.md](./GLOSSARY-GUIDE.md) for:
- When to add new terms
- How to choose namespaces
- Review process
- Agent triggers for updates

---

## Changelog

### 1.0.0 - 2026-01-23

- Initial glossary created
- Defined core component naming (Dashboard disambiguation)
- Established namespace prefixes
- Documented naming conventions
