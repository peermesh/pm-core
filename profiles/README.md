# Supporting Tech Profiles

This directory contains production-ready configurations for common infrastructure services. Each profile is a complete, self-contained specification for deploying a specific technology within the PeerMesh Core foundation.

---

## What Are Profiles?

Profiles are **not applications**. They are the supporting infrastructure that applications need:

| Category | Examples | Purpose |
|----------|----------|---------|
| Databases | PostgreSQL, MySQL, MongoDB | Persistent data storage |
| Caches | Redis, Memcached | Session/query caching |
| Search | Elasticsearch, Meilisearch | Full-text search |
| Message Queues | RabbitMQ, NATS | Async communication |

---

## Profile Structure

Each profile follows the template defined in `_template/PROFILE-SPEC.md`:

```
profiles/
├── _template/                    # Template every profile must follow
│   ├── PROFILE-SPEC.md          # Section structure definition
│   ├── docker-compose.example.yml
│   ├── init-scripts/
│   ├── backup-scripts/
│   └── healthcheck-scripts/
│
├── postgresql/                   # Example database profile
│   ├── PROFILE-SPEC.md          # Complete PostgreSQL specification
│   ├── docker-compose.yml       # Ready-to-use fragment
│   ├── init-scripts/
│   │   └── 01-init.sh
│   ├── backup-scripts/
│   │   ├── backup.sh
│   │   └── restore.sh
│   └── healthcheck-scripts/
│       └── healthcheck.sh
│
├── mysql/
├── mongodb/
├── redis/
├── minio/
├── observability-lite/
│
└── identity/                     # Identity provider (Social)
    ├── PROFILE-SPEC.md          # Identity profile specification
    ├── docker-compose.identity.yml
    ├── .env.example
    └── configs/
        └── file.json            # CSS configuration
```

---

## How to Use Profiles

### 1. Select Profiles for Your Application

Based on your application requirements, identify which supporting technologies you need:

```
My App Needs:
- PostgreSQL for relational data
- Redis for session caching
- (that's it for now)
```

### 2. Copy Profile Compose Fragments

Each profile provides a ready-to-use docker-compose fragment. Include it in your project:

```yaml
# docker-compose.yml
include:
  - path: ./profiles/postgresql/docker-compose.yml
  - path: ./profiles/redis/docker-compose.yml

services:
  my-app:
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    # ... your app config
```

### 3. Generate Secrets

Before starting, run the profile's secret generation:

```bash
./scripts/generate-secrets.sh
```

### 4. Configure Sizing

Use the profile's sizing calculator to determine resource allocation based on your expected load and data footprint.

---

## Profile Categories

### Tier 1: Core Database Profiles (Fully Specified)

These profiles are complete with all sections:

| Profile | Status | Use Case |
|---------|--------|----------|
| PostgreSQL | Available | Relational data, pgvector for embeddings |
| MySQL | Available | WordPress, Ghost, traditional web apps |
| MongoDB | Available | LibreChat, document-oriented data |

### Tier 2: Cache & Storage Profiles

| Profile | Status | Use Case |
|---------|--------|----------|
| Redis | Available | Session storage, caching, pub/sub |
| MinIO | Available | S3-compatible object storage |
| Observability Lite | Available | Netdata + Uptime Kuma low-ops baseline |
| RabbitMQ | Planned | Message queuing |

### Tier 3: Identity & Authentication Profiles

| Profile | Status | Use Case |
|---------|--------|----------|
| Identity | Available | WebID/Solid identity provider (Social) |

### Tier 4: Specialized Profiles (Future)

| Profile | Status | Use Case |
|---------|--------|----------|
| Elasticsearch | Future | Full-text search |
| InfluxDB | Future | Time-series data |

---

## Profile Completeness Checklist

A profile is considered complete when it has:

- [ ] **Overview & Use Cases**: When to use this technology
- [ ] **Security Configuration**: Non-root, secrets via `_FILE`, network isolation
- [ ] **Performance Tuning**: Memory allocation formulas, connection limits
- [ ] **Sizing Calculator**: Input load/data, output memory/disk requirements
- [ ] **Backup Strategy**: Dump scripts, retention, encryption, restore testing
- [ ] **Startup & Health**: Healthchecks that work with file-based secrets
- [ ] **Storage Options**: Local, attached, remote configurations
- [ ] **VPS Integration**: Disk provisioning, swap, monitoring hooks
- [ ] **Compose Fragment**: Copy-paste ready configuration

---

## Creating a New Profile

1. Copy the template:
   ```bash
   cp -r _template/ my-new-tech/
   ```

2. Fill in all sections of `PROFILE-SPEC.md`

3. Implement all scripts:
   - `init-scripts/` - Secrets-aware initialization
   - `backup-scripts/` - Dump and restore procedures
   - `healthcheck-scripts/` - Health checks that work with `_FILE` secrets

4. Make scripts executable:
   ```bash
   chmod +x my-new-tech/init-scripts/*.sh
   chmod +x my-new-tech/backup-scripts/*.sh
   chmod +x my-new-tech/healthcheck-scripts/*.sh
   ```

5. Test with the foundation:
   - Does it start with `docker compose up`?
   - Do health checks pass?
   - Can dependent services wait for it?
   - Does backup/restore work?

6. Submit for review

---

## Design Principles

### 1. Secrets via `_FILE` Suffix (Never Hardcoded)

All profiles MUST use file-based secrets:

```yaml
# CORRECT
environment:
  POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password

# WRONG - Never do this
environment:
  POSTGRES_PASSWORD: changeme
```

### 2. Healthchecks Work Without Environment Variables

Health checks cannot rely on environment variables that don't exist when using `_FILE` secrets:

```yaml
# CORRECT - Uses script that reads from file
healthcheck:
  test: ["CMD", "/healthcheck.sh"]

# WRONG - MYSQL_PASSWORD won't exist with _FILE
healthcheck:
  test: ["CMD-SHELL", "mysqladmin ping -p$$MYSQL_PASSWORD"]
```

### 3. Non-Root Execution

Profiles must run as non-root where supported:

```yaml
services:
  postgres:
    user: "70:70"  # postgres:postgres
```

### 4. Network Isolation Ready

Profiles define which networks they join:

```yaml
services:
  postgres:
    networks:
      - db-internal  # Only accessible to apps, not internet
```

---

## Relationship to Foundation

Profiles are **built on** the foundation decisions:

| Foundation Decision | Profile Implementation |
|---------------------|------------------------|
| [ADR-0003](../docs/decisions/0003-file-based-secrets.md) File-Based Secrets | All secrets via `_FILE`, mounted from `./secrets/` |
| [ADR-0300](../docs/decisions/0300-health-check-strategy.md) Health Check Strategy | YAML anchors, tiered timing |
| [ADR-0300](../docs/decisions/0300-health-check-strategy.md) Health Check Strategy | `depends_on: condition: service_healthy` |
| [ADR-0002](../docs/decisions/0002-four-network-topology.md) Four-Network Topology | Named networks, zone placement |
| [ADR-0300](../docs/decisions/0300-health-check-strategy.md) Health Check Strategy | Native dump tools, rclone sync (backup context) |

---

## References

- Template Specification: `./_template/PROFILE-SPEC.md`
- Foundation Decisions: `../foundation/docs/decisions/`
- Full ADR Index: `../docs/decisions/INDEX.md`
- Decision Provenance: `../docs/decisions/PROVENANCE.md`

---

*Created: 2025-12-31*
*Part of PeerMesh Core*
