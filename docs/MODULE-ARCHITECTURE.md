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

Inside the Core (`modules/`), the term "module" refers to **infrastructure extensions** -- operational capabilities that plug into the Core foundation. Things like backup systems, PKI certificate authorities, and federation protocol adapters. Each one has a `module.json` manifest, lifecycle hooks, dashboard registration, dependency declarations, and is managed through the CLI (`./launch_core.sh module …` from the Core repo root). The `launch_pm-core.sh` entry point forwards to `launch_core.sh`.

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

The connection abstraction is defined in `foundation/schemas/` and `foundation/interfaces/`, and resolution is handled by `foundation/lib/connection-resolve.sh`. `module enable` invokes the resolver for each module in the resolved dependency order before install/start hooks; deployment-specific gaps may still appear if required profiles are not enabled.

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

At runtime, `launch_core.sh` invokes hooks by filename under `hooks/` when they exist and are executable: on **`module enable`** (in dependency order, after connection resolution), **`install.sh`** then **`start.sh`** (or, if there is no start hook, **`docker compose up -d`** for that module’s `docker-compose.yml`). On **`module disable`**, it runs **`stop.sh`** (or **`docker compose down`**) then optional **`uninstall.sh`**, in reverse dependency order. **`module health`** runs **`hooks/health.sh`** when present. The optional manifest field **`lifecycle.validate`** (and **`hooks/validate.sh`**) is **not** executed automatically during enable; use **`module validate`** for schema and contract checks. The **`upgrade`** hook is not orchestrated by the CLI today; use **`module update`** to pull images and recreate containers.

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

`launch_core.sh` (and the `launch_pm-core.sh` wrapper) provide module management commands:

| Command | Purpose |
|---------|---------|
| `module list` | List modules and available compose profiles |
| `module enable <name>` | Resolve dependencies and connections, then run install/start hooks (or compose up) per module in order |
| `module enable <name> --dry-run` | Show dependency resolution only |
| `module disable <name>` | Run stop/uninstall hooks (or compose down) in reverse dependency order |
| `module status <name>` | Show `docker compose ps` for the module |
| `module health [name]` | Run `hooks/health.sh` for one module or all running modules |
| `module validate [name]` | Validate `module.json` (and optional `--contract` / `--contract-json` reports) |
| `module create <name>` | Scaffold a new module from `foundation/templates/module-template` |
| `module update <name>` | Pull images and recreate containers for a running module |

**Verification:** From the Core repository root, `./launch_core.sh help` includes the current module subcommand list; inspect `cmd_module` in `launch_core.sh` for the exact enable/disable sequence.

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
| `module.json` manifest spec | Multiple modules with manifests; JSON schema validates on enable | High |
| Dashboard registration | Dashboard UI exists; modules declare routes and widgets | High |
| Dependency resolution | `foundation/lib/dependency-resolve.sh` with topological sort and cycle detection; used by enable/disable | High |
| `module enable` / `module disable` | Connection resolution, then install/start (or compose up); teardown via stop/uninstall (or compose down) in reverse order | High |
| Lifecycle hooks (install, start, stop, uninstall, health) | Invoked from `launch_core.sh` when `hooks/*.sh` are executable | High |
| `module validate`, `module create`, `module update` | Implemented in `launch_core.sh` | High |
| Compose base patterns | Modules extend foundation base services | High |
| Network topology | Four-network model is enforced in compose files | High |
| Secrets management | File-based secrets pattern is consistent across modules | High |

### Defined but Not Fully Wired

| Feature | Current State | Gap |
|---------|--------------|-----|
| Manifest `lifecycle.validate` / `lifecycle.upgrade` | Not run automatically during enable/disable | Use `module validate` and `module update` (or custom automation) instead |
| Connection abstraction | Resolver runs on `module enable` (`foundation/lib/connection-resolve.sh`) | Broader production exercise and tests still useful |
| Event bus | Interfaces at `foundation/interfaces/`; no default provider wired | Requires an event bus provider module (e.g. Redis, NATS) |
| Foundation migration system | CLI and scripts exist; production coverage varies | Needs validation in your environment |

### Not Yet Implemented

| Feature | Description |
|---------|-------------|
| Module registry/catalog | Central listing of available modules with descriptions and versions |
| Module packaging | Standard distribution as archives |
| Automatic `upgrade` hook orchestration | Manifest `upgrade` script not chained by CLI (distinct from `module update`) |
| Integration test suite | End-to-end coverage of full create-enable-health-disable cycles |

### Overall Assessment

The module system is **largely implemented** for day-to-day operations: manifests, schemas, dependency and connection resolution on enable, compose patterns, and **core lifecycle hook wiring** in `launch_core.sh` are in place. Remaining work is mostly optional features (event bus provider, packaging, catalog) and deeper validation of connection resolution and migrations in real deployments—not “hooks exist but the CLI ignores them.”

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

Enable your module with `./launch_core.sh module enable my-module` and verify that services start, hooks run as expected, and Traefik routing works (if applicable). Run `./launch_core.sh module health my-module` (or the hook directly) to confirm health output.

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
- [CLI Reference](cli.md) -- `launch_core.sh` module management commands
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

*Document version: 1.1.0*
*Last updated: 2026-03-30*
