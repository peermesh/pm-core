# System Architecture

Core follows a **four-tier modular architecture** designed for composability, security, and maintainability.

## Provisioning and Runtime Boundary

Core architecture intentionally separates infrastructure provisioning from runtime operations:

1. Infrastructure layer (OpenTofu):
   - manages VPS/network/firewall/DNS resources via provider APIs
   - runs `plan/apply` workflows with explicit evidence
2. Runtime layer (Core foundation + modules):
   - runs container services on provisioned hosts
   - handles deployment, promotion gates, backups, and runtime validation

Provider terminology:

1. VPS provider:
   The infrastructure vendor (for example, Hetzner Cloud).
2. OpenTofu provider plugin:
   The API adapter used by OpenTofu to control that vendor.

Canonical model reference:

- [OpenTofu Deployment Model](OPENTOFU-DEPLOYMENT-MODEL.md)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 4: SERVICES                              │
│  Custom services (dashboard, webhooks) with full integration    │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 3: EXAMPLES                              │
│  Application demonstrations (Ghost, LibreChat, Matrix)          │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 2: PROFILES                              │
│  Supporting tech (PostgreSQL, MySQL, MongoDB, Redis, MinIO)     │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 1: FOUNDATION                            │
│  Core infrastructure (Traefik, socket-proxy, networks, secrets) │
└─────────────────────────────────────────────────────────────────┘
```

## Tier 1: Foundation

The Foundation layer provides core infrastructure that all other tiers depend on.

### Components

| Component | Purpose | ADR |
|-----------|---------|-----|
| Traefik | Reverse proxy, TLS termination, routing | [ADR-0001](decisions/0001-traefik-reverse-proxy.md) |
| Docker Socket Proxy | Filtered Docker API access | [ADR-0004](decisions/0004-docker-socket-proxy.md) |
| Networks | Four-network security topology | [ADR-0002](decisions/0002-four-network-topology.md) |
| Secrets | File-based secret management | [ADR-0003](decisions/0003-file-based-secrets.md) |

### Foundation Module System

The `foundation/` directory contains the contract layer that defines what modules are and how they integrate:

- **Schemas** - JSON schemas for modules, events, connections
- **Interfaces** - TypeScript/Python interface definitions
- **Lib** - Shell scripts for version checking, migrations, dependency resolution
- **Templates** - Module creation templates
- **Docs** - Component documentation

The foundation is NOT a module -- it is the platform that modules plug into. For the full architectural explanation of this distinction and the module system design, see [MODULE-ARCHITECTURE.md](MODULE-ARCHITECTURE.md).

See [foundation/README.md](../foundation/README.md) for complete documentation.

### Key Principles

- **Zero Runtime Dependencies** - Core works without external services
- **Interfaces Over Implementations** - Defines contracts, add-ons implement
- **BYOK (Bring Your Own Keys)** - Users provide credentials
- **Swappable Connections** - Same module works with different backends

## Tier 2: Profiles

Profiles are **supporting infrastructure** that applications need but are not applications themselves.

### Available Profiles

| Profile | Type | Purpose | Location |
|---------|------|---------|----------|
| PostgreSQL | Database | Relational data, pgvector | `profiles/postgresql/` |
| MySQL | Database | Traditional web apps | `profiles/mysql/` |
| MongoDB | Database | Document storage | `profiles/mongodb/` |
| Redis | Cache | Sessions, caching | `profiles/redis/` |
| MinIO | Storage | S3-compatible storage | `profiles/minio/` |
| Identity | Auth | WebID/Solid identity | `profiles/identity/` |

### Profile Structure

Each profile follows a standard structure:

```
profiles/<name>/
├── PROFILE-SPEC.md             # Complete specification
├── docker-compose.<name>.yml   # Compose configuration
├── init-scripts/               # Initialization scripts
├── backup-scripts/             # Backup and restore
└── healthcheck-scripts/        # Health checks
```

### Profile Principles

- **Secrets via `_FILE`** - Never hardcoded credentials
- **Healthchecks** - Work without environment variables
- **Non-Root Execution** - Security by default
- **Network Isolation** - Connect only to required networks

See [profiles/README.md](../profiles/README.md) for details.

## Tier 3: Examples

Examples are **demonstrations**, not core infrastructure. They show how to compose the Foundation and Profiles to build real applications.

### Available Examples

| Example | Description | Profiles Used |
|---------|-------------|---------------|
| Ghost | Publishing platform | MySQL |
| LibreChat | AI assistant interface | MongoDB, PostgreSQL |
| Matrix | Federated communication | PostgreSQL |

### Example Principles

- **Reference Profiles** - Never duplicate profile configuration
- **Self-Contained** - Each example has complete documentation
- **Follow Foundation Patterns** - Use consistent security and resource patterns

See [examples/README.md](../examples/README.md) for details.

## Tier 4: Services

Custom services that integrate with the foundation for specific functionality.

### Available Services

| Service | Purpose | Location |
|---------|---------|----------|
| Dashboard | Module registry, container management | `services/dashboard/` |

### Optional Boundary Modules

| Module | Purpose | Location |
|--------|---------|----------|
| Federation Adapter | Optional federation/syndication boundary scaffold | `modules/federation-adapter/` |

Adapter modules are opt-in and must never be required for baseline compose startup.
See [FEDERATION-ADAPTER-BOUNDARY.md](FEDERATION-ADAPTER-BOUNDARY.md).

### Service Integration

Services and modules integrate with the foundation through:

- **Module Manifest** - `module.json` describing the module's identity, dependencies, and integration points
- **Docker Compose** - Standard compose patterns extending foundation base services
- **Event Bus** - Communication with other modules (interface defined, implementation pending)
- **Dashboard Registration** - UI integration via manifest declarations

For comprehensive documentation of the module system -- including the manifest specification, lifecycle hooks, dependency resolution, CLI commands, and implementation status -- see [MODULE-ARCHITECTURE.md](MODULE-ARCHITECTURE.md).

## Network Architecture

The four-network topology provides security through isolation:

```
┌─────────────────────────────────────────────────────────────────┐
│                        INTERNET                                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    proxy-external                                │
│  Traefik ←→ Public-facing services                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    proxy-internal                                │
│  Internal routing between services                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      db-internal                                 │
│  Database access (never exposed externally)                      │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      management                                  │
│  Docker socket proxy, admin tools                                │
└─────────────────────────────────────────────────────────────────┘
```

See [ADR-0002](decisions/0002-four-network-topology.md) for full details.

## Resource Profiles

Three resource profiles control memory and CPU allocation:

| Profile | RAM | CPU | Use Case |
|---------|-----|-----|----------|
| `lite` | 512MB | 0.5 | CI/CD, testing |
| `core` | 2GB | 2 | Development, staging |
| `full` | 8GB | 4 | Production |

## Decision Record Index

All architectural decisions are documented as ADRs:

- [ADR Index](decisions/INDEX.md) - Complete listing
- [ADR Provenance](decisions/PROVENANCE.md) - Research lineage

## Related Documentation

- [Module Architecture](MODULE-ARCHITECTURE.md) - Deep-dive into the module system, four-tier model, and naming conventions
- [Module Rubric](MODULE-RUBRIC.md) - Quality checklist for module development
- [Foundation Reference](../foundation/README.md)
- [Profiles Guide](PROFILES.md)
- [Security Guide](SECURITY.md)
- [Deployment Guide](DEPLOYMENT.md)

---

*Architecture version: 1.1.0*
*Last updated: 2026-02-21*
