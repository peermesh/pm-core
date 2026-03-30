# Module Architecture

The PeerMesh Core is built on a layered architecture where each tier serves a distinct role. At its heart is a formal module system that allows infrastructure extensions to plug into a shared foundation. This document explains what modules are, how they relate to the foundation and other tiers, and how the naming conventions work across the broader PeerMesh ecosystem.

If you are new to the project, start here. The first two sections give you the map. The later sections give you the terrain.

---

## Overview: Four Tiers, One Platform

The Core organizes everything into four tiers. Each tier builds on the one below it, and none of them can be understood in isolation. Think of it as a stack where the bottom layer is the ground you stand on, and each layer above adds capability.

```
+---------------------------------------------------------------+
|                     TIER 4: MODULES                           |
|  Infrastructure extensions with lifecycle management          |
|  (backup, pki, federation-adapter)                            |
+---------------------------------------------------------------+
                              |
+---------------------------------------------------------------+
|                     TIER 3: EXAMPLES                          |
|  Application deployments that consume the platform            |
|  (Ghost, LibreChat, Matrix, WordPress)                        |
+---------------------------------------------------------------+
                              |
+---------------------------------------------------------------+
|                     TIER 2: PROFILES                          |
|  Supporting infrastructure services                           |
|  (PostgreSQL, MySQL, Redis, MinIO, NATS)                      |
+---------------------------------------------------------------+
                              |
+---------------------------------------------------------------+
|                     TIER 1: FOUNDATION                        |
|  The platform itself -- what everything plugs into            |
|  (Traefik, socket-proxy, networks, secrets, schemas)          |
+---------------------------------------------------------------+
```

The foundation is not a module. It is what modules plug into. Profiles are not modules either -- they are infrastructure services that modules and examples can depend on. Examples are application deployments that demonstrate how to compose profiles with the foundation. Modules are the formal extension system, with manifests, lifecycle hooks, dependency resolution, and dashboard integration.

This distinction matters. If you blur the lines between these tiers, you will make architectural decisions that create coupling where there should be separation.

---

## The Naming Resolution: Parent "Services" vs Core "Modules"

The PeerMesh ecosystem previously used the word "module" at two completely different levels. As of 2026-02-26, this collision has been resolved by [ADR-0500](decisions/0500-module-architecture.md) (ACCEPTED).

### Parent-Level "Services" (Knowledge Graph Lab)

At the parent project level, top-level components are now called **"services"** -- full-stack application services of the Knowledge Graph Lab platform. These are things like backend API services built with FastAPI, frontend UIs built with React, AI inference services, and publishing pipelines. Each one has its own Dockerfile, API endpoints, database schema, and business logic. The directory `.dev/modules/` on disk still exists (a filesystem path rename is a separate decision), but documentation refers to these as services.

### Core "Modules" (This System)

Inside the Core (`modules/`), the term "module" refers to **infrastructure extensions** -- operational capabilities that plug into the Core foundation. Things like backup systems, PKI certificate authorities, and federation protocol adapters. Each one has a `module.json` manifest, lifecycle hooks, dashboard registration, dependency declarations, and is managed through the CLI with `launch_pm-core.sh module enable/disable`.

These are not application logic. They extend the platform itself. They are governed by JSON schemas at `foundation/schemas/module.schema.json`, and they follow a formal plugin architecture with well-defined contracts.

### Why This Distinction Matters

These two concepts share nothing but the former name. A parent-project "service" is an application with business logic, database migrations, and API contracts. A Core "module" is an infrastructure extension with lifecycle hooks, dashboard widgets, and compose patterns. The Core module system earned the name "module" through its formal, implemented architecture -- manifests, schemas, CLI integration, dependency resolution, lifecycle management.

Historical documents dated before 2026-02-26 still use "module" for parent-level components. This is expected. See the parent project's nomenclature change notice at `.dev/ai/NOMENCLATURE-CHANGE-MODULES-TO-SERVICES.md` for full context.

---

## Tier 1: The Foundation -- What Modules Plug Into

The foundation is the platform. It is not a participant in the module system; it is the system that modules participate in. Understanding this distinction is the single most important architectural insight in the Core.

### What the Foundation Contains

The foundation lives at `foundation/` in the repository root and provides:

**Core Services** -- The runtime infrastructure that must be running before anything else can work:

| Service | Role | Location |
|---------|------|----------|
| Traefik | Reverse proxy, TLS termination, automatic HTTPS, routing | `foundation/services/traefik/` |
| Docker Socket Proxy | Filtered, read-only Docker API access for Traefik | `foundation/services/socket-proxy/` |
| Dashboard | Web UI for module management, container status, system health | `foundation/services/dashboard/` |

**Network Topology** -- The four-network security model ([ADR-0002](decisions/0002-four-network-topology.md)):

| Network | Purpose | Who Connects |
|---------|---------|--------------|
| `proxy-external` | Traefik to public-facing services | Traefik, web-facing modules and examples |
| `proxy-internal` | Internal routing between services | Services that need to talk to each other |
| `db-internal` | Database access, never exposed externally | Profiles (databases), services that need data |
| `management` | Docker socket proxy, admin tools | Socket proxy, dashboard, admin scripts |

**Contract Layer** -- The schemas, interfaces, and libraries that define what a module IS:

- `foundation/schemas/` -- JSON schemas for module manifests, lifecycle hooks, dashboard registration, event bus, configuration, connections, security contracts
- `foundation/interfaces/` -- TypeScript and Python interface definitions for dashboard integration, event bus, connection resolution, encryption, identity
- `foundation/lib/` -- Shell utilities for dependency resolution (with topological sort and cycle detection), dashboard registration, environment generation, connection resolution, migration, version checking
- `foundation/templates/` -- Starter templates for new modules
- `foundation/docs/` -- Detailed guides for manifest authoring, lifecycle hooks, dashboard registration, configuration schemas, compose patterns

### Why the Foundation Is Not a Module

The foundation does not have a `module.json`. It does not go through lifecycle hooks. It does not register with a dashboard -- it IS the dashboard. It does not declare dependencies -- it IS what dependencies resolve against.

This is analogous to the relationship between an operating system kernel and an application. The kernel provides system calls, filesystems, process management, and networking. Applications use those facilities. You would not describe the Linux kernel as "an application that runs on Linux." Similarly, you should not describe the Core foundation as "a module that runs on the Core."

The `foundation/` directory contains the contract layer: the schemas and interfaces that define the module API surface. Modules implement those contracts. The foundation enforces them.

---

## Tier 2: Profiles -- Infrastructure Services

Profiles are supporting infrastructure that applications and modules may need but that are not part of the platform itself. They are databases, caches, message brokers, object stores, and identity providers.

### How Profiles Differ from Modules

Profiles do not have `module.json` manifests. They are not managed by the module CLI. They do not register with the dashboard. They do not have lifecycle hooks in the module system sense. They are activated through Docker Compose file stacking (`-f` flags) and are selected per-deployment based on what the applications need.

| Aspect | Module | Profile |
|--------|--------|---------|
| Has `module.json` | Yes | No |
| Managed by CLI | Yes (`module enable/disable`) | No (compose `-f` stacking) |
| Dashboard integration | Yes (routes, widgets, config panels) | No |
| Lifecycle hooks | Yes (install, start, stop, health, uninstall) | No (init scripts only) |
| Dependency resolution | Yes (transitive, with topological sort) | No |
| Purpose | Extend the platform | Provide infrastructure services |

### Available Profiles

| Profile | Type | Purpose |
|---------|------|---------|
| PostgreSQL | Database | Relational data with pgvector support |
| MySQL | Database | Traditional web application database |
| MongoDB | Database | Document storage |
| Redis | Cache | Sessions, caching, pub/sub |
| MinIO | Storage | S3-compatible object storage |
| NATS | Queue | Message broker |
| Identity | Auth | WebID/Solid identity provider |
| Observability Lite | Monitoring | Netdata + Uptime Kuma |
| Observability Full | Monitoring | Prometheus + Grafana + Loki |

Each profile follows a standard structure with a compose file, init scripts, backup scripts, and healthcheck scripts. See the [Profiles Guide](PROFILES.md) for complete documentation.

### The Connection Abstraction

The foundation defines a connection abstraction system that allows modules to declare what they need (a "database" or a "cache") without specifying which profile provides it. At deployment time, the connection resolver maps abstract requirements to concrete profiles. This is how the same module can work with PostgreSQL in production and SQLite in testing -- the module declares a "database" connection, and the deployment configuration determines which profile satisfies it.

The connection abstraction is defined in `foundation/schemas/` and `foundation/interfaces/`, and resolution is handled by `foundation/lib/connection-resolve.sh`. Note that while the schema and interface layers are solid, the runtime resolution is not yet fully exercised in production.

---

## Tier 3: Examples -- Application Deployments

Examples are demonstrations of how to compose the foundation and profiles into real, working applications. They exist to show patterns, not to extend the platform.

### How Examples Differ from Modules

Examples do not have `module.json` manifests, lifecycle hooks, or dashboard integration. They are standalone Docker Compose configurations that reference foundation networks and profile services. They use Compose profiles (`--profile` flag) for activation rather than the module CLI.

An example answers the question: "How do I deploy Ghost (or Matrix, or WordPress) on top of the Core foundation?" A module answers the question: "How do I add backup capability (or PKI, or federation) to the Core platform?"

### Available Examples

| Example | Dependencies | Purpose |
|---------|-------------|---------|
| Ghost | MySQL profile | Publishing platform |
| LibreChat | MongoDB + PostgreSQL profiles | AI assistant interface |
| Matrix | PostgreSQL profile | Federated communication |
| WordPress | MySQL profile | Content management |
| PeerTube | PostgreSQL profile | Video platform |
| Listmonk | PostgreSQL profile | Newsletter management |
| Solid | PostgreSQL profile | Solid Pod server |
| Python API | Foundation only | HTTPBin API baseline |
| Landing | Foundation only | Static landing page |
| RSS2BSky | Foundation only | RSS-to-Bluesky bridge |

Each example follows patterns documented in the [example application template](../examples/_template/) and is governed by [ADR-0401](decisions/0401-example-application-pattern.md).

---

## Tier 4: Modules -- The Formal Extension System

This is the tier that this document is really about. Modules are the formal mechanism for extending the Core platform with new operational capabilities. They are the only tier with a manifest spec, lifecycle management, dependency resolution, dashboard integration, and CLI orchestration.

### What Makes Something a Module

A module is a self-contained directory under `modules/` that contains:

1. **A manifest** (`module.json`) -- The declaration of what the module is, what it needs, what it provides, and how it integrates with the foundation. This is the module's identity document. It is validated against `foundation/schemas/module.schema.json`.

2. **A compose file** (`docker-compose.yml`) -- The Docker Compose service definitions that actually run the module's containers. These extend foundation base patterns for consistent resource limits, security posture, and network topology.

3. **Lifecycle hooks** (`hooks/`) -- Shell scripts that execute at specific points in the module's lifetime: install, start, stop, uninstall, health check, upgrade, and validate. These are the operational automation layer.

4. **Documentation** (`README.md`) -- User-facing documentation explaining what the module does, how to install and configure it, and how to troubleshoot it.

Optional components include dashboard UI elements (`dashboard/`), configuration files (`configs/`), environment templates (`.env.example`), and test scripts (`tests/`).

### The Module Manifest in Detail

The `module.json` manifest is the most important file in any module. It is both a machine-readable specification and a human-readable summary of the module's architectural contract with the foundation.

**Required fields:**

```json
{
  "$schema": "../../foundation/schemas/module.schema.json",
  "id": "my-module",
  "version": "1.0.0",
  "name": "My Module",
  "description": "What this module does and why it exists",
  "author": { "name": "Author Name" },
  "license": "MIT",
  "tags": ["category", "capability"],
  "foundation": {
    "minVersion": "1.0.0"
  }
}
```

The `id` field is kebab-case and must be unique across all modules. The `version` field follows semantic versioning. The `foundation.minVersion` field declares the minimum foundation version this module is compatible with -- it is the backward-compatibility contract.

**Dependency declarations:**

```json
{
  "requires": {
    "connections": [
      { "type": "database", "provider": "postgresql" }
    ],
    "modules": [
      { "id": "pki", "minVersion": "1.0.0" }
    ],
    "securityServices": ["encryption"]
  },
  "provides": {
    "connections": [],
    "events": [
      "my-module.action.completed",
      "my-module.health.checked"
    ],
    "securityServices": []
  }
}
```

The `requires` section declares what this module needs from the outside world. The `provides` section declares what this module makes available to others. The dependency resolver (`foundation/lib/dependency-resolve.sh`) performs transitive resolution with topological sort and cycle detection to determine the correct enable order.

**Dashboard integration:**

```json
{
  "dashboard": {
    "displayName": "My Module",
    "icon": "icon-name",
    "routes": [
      {
        "path": "/my-module",
        "nav": { "label": "My Module", "order": 200 }
      }
    ],
    "statusWidget": {
      "component": "./dashboard/MyStatusWidget.html",
      "size": "small",
      "order": 200
    },
    "configPanel": {
      "component": "./dashboard/MyConfigPanel.html"
    }
  }
}
```

Dashboard registration is how modules appear in the web UI. Routes add navigation entries, status widgets appear on the dashboard home page, and config panels provide a settings interface. Registration is handled by `foundation/lib/dashboard-register.sh`.

**Lifecycle hooks:**

```json
{
  "lifecycle": {
    "install": "./hooks/install.sh",
    "start": "./hooks/start.sh",
    "stop": "./hooks/stop.sh",
    "uninstall": "./hooks/uninstall.sh",
    "health": {
      "script": "./hooks/health.sh",
      "timeout": 15
    },
    "upgrade": "./hooks/upgrade.sh",
    "validate": "./hooks/validate.sh"
  }
}
```

Each hook script is called at the corresponding point in the module's lifecycle. The `install` hook runs once when the module is first added. The `health` hook runs periodically or on demand and should output JSON conforming to the foundation health schema. The `validate` hook runs before install to verify prerequisites.

**Configuration schema:**

```json
{
  "config": {
    "version": "1.0",
    "properties": {
      "settingName": {
        "type": "string",
        "description": "Human-readable explanation of this setting",
        "default": "default-value",
        "env": "MY_MODULE_SETTING_NAME"
      },
      "apiKey": {
        "type": "string",
        "description": "API key for external service",
        "secret": true,
        "env": "MY_MODULE_API_KEY"
      }
    },
    "required": ["apiKey"]
  }
}
```

The configuration schema maps settings to environment variables and declares which are secrets. Secret values use file-based injection (`_FILE` suffix pattern) per [ADR-0003](decisions/0003-file-based-secrets.md) and are never stored in environment variables directly.

### Existing Modules

| Module | Version | Status | Complexity | Purpose |
|--------|---------|--------|------------|---------|
| backup | 1.0.0 | Complete | High | Restic-based backup with PostgreSQL dump, age encryption, S3 off-site |
| pki | 1.0.0 | Complete | Medium-High | Certificate management with CFSSL internal CA |
| mastodon | 1.0.0 | Complete | High | Mastodon social media server |
| federation-adapter | 0.1.0 | Skeleton | Low | Adapter boundary for federation workloads |
| test-module | 0.1.0 | Complete | Minimal | Foundation validation and CI testing |

The backup and pki modules are the best references for well-formed module implementation. The test-module is useful as a minimal example but uses `scripts/` instead of `hooks/` for its lifecycle scripts (the convention in production modules is `hooks/`).

### CLI Integration

The `launch_pm-core.sh` script provides module management commands:

| Command | Purpose |
|---------|---------|
| `module list` | Show installed modules and their status |
| `module enable <name>` | Enable a module (with dependency resolution) |
| `module enable <name> --dry-run` | Preview what enabling would do |
| `module disable <name>` | Disable a module (docker compose down) |
| `module status <name>` | Show container status for a module |

See the [CLI Reference](cli.md) for complete command documentation.

### Network Integration

Modules connect to foundation networks based on their needs:

- **`proxy-external`** -- Required if the module exposes web endpoints via Traefik
- **`db-internal`** -- Required if the module needs database access
- **`module-internal`** -- For inter-module communication (bridge, internal)
- **`module-external`** -- For module external access (bridge)

The network a module joins determines its blast radius in a security incident. Modules should connect to the minimum set of networks required for their function.

### Resource Profiles

Modules extend from base service definitions in `foundation/docker-compose.base.yml`:

| Base Service | Memory | CPU | Use Case |
|-------------|--------|-----|----------|
| `_service-lite` | 256MB | 0.5 | Lightweight services, sidecars |
| `_service-standard` | 512MB | 1.0 | Most modules |
| `_service-heavy` | 1GB | 2.0 | Resource-intensive services |
| `_security-hardened` | - | - | Adds cap_drop, no-new-privileges, read-only root |

Modules extend these using YAML anchors in their compose files, ensuring consistent resource governance across the platform.

---

## Implementation Status

The module system is a living architecture. Some parts are fully implemented and battle-tested; others are defined but not yet wired into the runtime. This section provides an honest assessment so you know what you can rely on today and what is still in progress.

### Implemented and Working

| Feature | Evidence | Confidence |
|---------|----------|------------|
| `module.json` manifest spec | Five modules have valid manifests; JSON schema exists and validates | High |
| Dashboard registration | Dashboard UI exists; modules declare routes and widgets | High |
| Dependency resolution | `foundation/lib/dependency-resolve.sh` with topological sort and cycle detection | High |
| `module enable/disable` (basic) | Works for compose up/down operations | High |
| Compose base patterns | All modules extend from foundation base services | High |
| Network topology | Four-network model is enforced in all compose files | High |
| Secrets management | File-based secrets pattern is consistent across all modules | High |

### Defined but Not Fully Wired

| Feature | Current State | Gap |
|---------|--------------|-----|
| Lifecycle hook orchestration | Hook scripts exist in modules, but `module enable` only runs `docker compose up -d` -- it does not invoke install, validate, or health hooks | CLI must be updated to call hooks in sequence |
| Connection abstraction | Schemas and interfaces exist; unclear if runtime resolution is exercised in production | Needs integration testing |
| Event bus | Interfaces defined at `foundation/interfaces/`; no implementation installed | Requires an event bus provider module (redis, nats, or memory) |
| Module validation | No `module validate` CLI command exists | Would check schema compliance, file existence, compose validity |
| Module scaffolding | No `module create` CLI command exists | Would copy template and rename placeholders |
| Foundation migration system | CLI and scripts exist; unclear if tested in production | Needs validation |

### Not Yet Implemented

| Feature | Description |
|---------|-------------|
| Module registry/catalog | A central listing of available modules with descriptions and versions |
| Module packaging | A standard way to distribute modules as archives |
| Module upgrade orchestration | Automated version migration using the `upgrade` lifecycle hook |
| Integration test suite | End-to-end testing of the create-enable-health-disable cycle |

### Overall Assessment

The module system is approximately **60% implemented**. The manifest specification, JSON schemas, compose patterns, and basic CLI operations are solid. The biggest gap is lifecycle hook orchestration -- the hooks exist as scripts inside each module, but the CLI does not call them during `module enable` or `module disable`. This means the module system functions as a compose management layer today, with the lifecycle automation defined but not yet connected.

This is a deliberate staging choice, not a design flaw. The manifest and schema layers were built first to establish the contract, and the orchestration layer will follow. The architecture is sound; the wiring is incomplete.

---

## Creating a New Module

This section provides a high-level walkthrough. For the detailed checklist, see the [Module Rubric](MODULE-RUBRIC.md). For manifest field documentation, see `foundation/docs/MODULE-MANIFEST.md`.

### Step 1: Start from the Template

Copy the foundation module template to a new directory under `modules/`:

```bash
cp -r foundation/templates/module-template modules/my-module
cd modules/my-module
```

Alternatively, study the backup or pki modules as comprehensive references, or wait for the hello-module example (tracked in WO-104) which will provide a complete, annotated, clone-and-customize starting point.

### Step 2: Write the Manifest

Edit `module.json` to declare your module's identity, dependencies, and integration points. At minimum, you need the `id`, `version`, `name`, and `foundation.minVersion` fields. Add dependency declarations, dashboard integration, and configuration schema as your module requires them.

### Step 3: Write the Compose File

Define your Docker Compose services, extending from foundation base patterns. Connect to the appropriate networks. Pin your image versions (no `:latest` tags -- see [Supply Chain Security](SUPPLY-CHAIN-SECURITY.md)). Apply security hardening (cap_drop, no-new-privileges, non-root user).

### Step 4: Implement Lifecycle Hooks

Create shell scripts under `hooks/` for at least `install.sh` and `health.sh`. All scripts should use `set -euo pipefail`, be idempotent (safe to run multiple times), and provide clear log output.

### Step 5: Test

Enable your module with `launch_pm-core.sh module enable my-module` and verify that services start, health checks pass, and Traefik routing works (if applicable). Run the health hook manually to confirm it produces valid output.

### Step 6: Document

Write a comprehensive `README.md` covering installation, configuration, usage, troubleshooting, and architecture. See the [Module Rubric](MODULE-RUBRIC.md) for the complete documentation checklist.

---

## The PeerMesh Module Template

The project is developing a "hello-module" example (tracked in WO-104) that will serve as the definitive clone-and-customize starting point for new modules. This will be a Type 2 module -- a Core infrastructure extension -- not a parent-project application service.

The hello-module will be a minimal, working Nginx web server that demonstrates every module system feature end-to-end: manifest with all sections annotated, compose file with foundation base patterns, lifecycle hooks that actually do something, dashboard widget, health check with JSON output, smoke test, and comprehensive documentation with `# CUSTOMIZE:` markers throughout.

Until the hello-module is available, use the existing foundation template at `foundation/templates/module-template/` as a starting point and refer to the backup module at `modules/backup/` as the most complete reference implementation.

---

## Related Documentation

### Architecture and Design

- [ARCHITECTURE.md](ARCHITECTURE.md) -- System architecture overview with four-tier diagram
- [ADR-0500: Module Architecture](decisions/0500-module-architecture.md) -- The pending decision record on layer definitions and naming
- [ADR-0400: Profile System](decisions/0400-profile-system.md) -- How profiles are structured
- [ADR-0401: Example Application Pattern](decisions/0401-example-application-pattern.md) -- How examples are structured

### Module Development

- [MODULE-RUBRIC.md](MODULE-RUBRIC.md) -- Quality and compatibility checklist for modules
- [CLI Reference](cli.md) -- `launch_pm-core.sh` module management commands
- [Foundation README](../foundation/README.md) -- Foundation layer documentation
- `foundation/docs/MODULE-MANIFEST.md` -- Detailed manifest field documentation
- `foundation/docs/LIFECYCLE-HOOKS.md` -- Lifecycle hook specifications
- `foundation/docs/DASHBOARD-REGISTRATION.md` -- Dashboard integration guide
- `foundation/docs/COMPOSE-PATTERNS.md` -- Docker Compose best practices

### Security

- [SECURITY.md](SECURITY.md) -- Security guidelines
- [ADR-0003: File-Based Secrets](decisions/0003-file-based-secrets.md) -- Secrets management pattern
- [ADR-0200: Non-Root Containers](decisions/0200-non-root-containers.md) -- Container security baseline
- [SUPPLY-CHAIN-SECURITY.md](SUPPLY-CHAIN-SECURITY.md) -- Image provenance and version pinning

### Operational Guides

- [DEPLOYMENT.md](DEPLOYMENT.md) -- Deployment procedures
- [GOTCHAS.md](GOTCHAS.md) -- Known issues and workarounds (especially #12: socket-proxy read_only)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) -- Common problems and solutions

---

*Document version: 1.0.0*
*Last updated: 2026-02-26*
