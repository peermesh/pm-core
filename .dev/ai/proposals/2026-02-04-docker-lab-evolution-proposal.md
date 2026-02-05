# Docker Lab Evolution Proposal

**Date:** 2026-02-04
**Author:** AI Analysis Agent
**Status:** DRAFT - Pending External Review
**Version:** 1.0.0

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Current State Analysis](#current-state-analysis)
4. [Target Architecture](#target-architecture)
5. [Solution Proposal](#solution-proposal)
6. [Process](#process)
7. [Plan](#plan)
8. [Strategy](#strategy)
9. [Roadmap](#roadmap)
10. [Risk Assessment](#risk-assessment)
11. [Success Criteria](#success-criteria)
12. [Appendices](#appendices)

---

## 1. Executive Summary

### What is Docker Lab?

Docker Lab is a **production-ready Docker Compose boilerplate** for self-hosted applications on commodity VPS instances. It provides:

- Traefik reverse proxy with automatic TLS
- Four-network security topology
- File-based secrets management
- Database profiles (PostgreSQL, MySQL, MongoDB, Redis)
- Module foundation system for extensibility
- Dashboard service for container management

**Current Version:** 0.1.0 (Released 2025-12-31)
**Project Health:** STABLE - 5 MASTER-PLAN phases complete

### The Problem

Docker Lab has grown organically to include complex modules (backup, PKI, Mastodon) but lacks:
1. A **simple reference module** demonstrating the minimum viable pattern
2. Alignment with the **microservices architecture specification** (800+ line research doc)
3. A clear **stripped-down foundation** that new users can extend

### The Proposal

1. **Create an Example Module First** - Build a minimal "reference module" that satisfies the microservices contract before stripping anything down
2. **Align Foundation with Research** - Implement missing components (event bus, control plane basics)
3. **Strip Down After** - Remove complex modules once the pattern is established

### Why This Order?

Creating the example module first:
- Establishes the canonical pattern before simplification
- Validates our understanding of the target architecture
- Provides a working reference for the community
- Reduces risk of stripping too much or too little

---

## 2. Problem Statement

### 2.1 Primary Problem: No Simple Reference Module

Docker Lab contains four modules:

| Module | Lines of Config | Complexity | Services |
|--------|-----------------|------------|----------|
| test-module | ~70 | Minimal | 0 (shell scripts only) |
| backup | 190+ | Production-grade | Restic, S3, age encryption |
| pki | 170+ | Production-grade | step-ca, auto-renewal |
| mastodon | 270+ | Production-grade | Multi-service, OpenSearch |

**Issue:** New users wanting to create a module must either:
- Copy from `test-module` (too minimal, missing HTTP endpoints)
- Copy from production modules (too complex, overwhelming)

There is no **Goldilocks module** - one that's simple enough to understand but complete enough to demonstrate all patterns.

### 2.2 Secondary Problem: Architecture Gap

A comprehensive microservices research document (see Appendix A) defines architecture patterns that Docker Lab's foundation does not implement:

| Feature | Research Specification | Docker Lab Status | Gap |
|---------|----------------------|-------------------|-----|
| Event Bus | NATS + JetStream recommended | No-op stub only | MAJOR |
| Control Plane | Module registry, lifecycle manager | None | MAJOR |
| Required Endpoints | `/healthz`, `/readyz`, `/meta` | Not enforced | MEDIUM |
| `modules.d/` Reconciliation | File watch, auto-enable/disable | None | MAJOR |
| Module Contract | Manifest in image label + `/meta` | File-based only | MEDIUM |

### 2.3 Tertiary Problem: Complexity Creep

The project accumulated production-grade modules during development that obscure the foundation's simplicity:
- New users see complex examples first
- Hard to understand what's "foundation" vs "add-on"
- Maintenance burden grows with each complex module

### 2.4 Problem Summary

**In one sentence:** Docker Lab needs a simple, canonical example module that demonstrates the complete pattern before the codebase can be stripped down for extensibility.

---

## 3. Current State Analysis

### 3.1 Project Structure

```
docker-lab/
├── docker-compose.yml           # Main orchestration
├── launch_peermesh.sh           # CLI entry point
├── foundation/                  # Module system core
│   ├── VERSION                  # 1.0.0
│   ├── schemas/                 # JSON schemas (7 files)
│   ├── interfaces/              # TypeScript/Python interfaces
│   ├── lib/                     # Shell utilities
│   ├── templates/               # Module template
│   ├── docs/                    # Component documentation
│   └── bin/                     # CLI commands
├── profiles/                    # Database/infrastructure profiles
│   ├── postgresql/
│   ├── mysql/
│   ├── mongodb/
│   ├── redis/
│   ├── minio/
│   └── identity/
├── modules/                     # Installable modules
│   ├── test-module/             # Testing artifact
│   ├── backup/                  # Production backup system
│   ├── pki/                     # Internal PKI
│   └── mastodon/                # Federated social network
├── services/                    # Core services
│   └── dashboard/               # Go-based management UI
├── examples/                    # Example applications
│   ├── ghost/
│   ├── librechat/
│   └── matrix/
├── configs/                     # Configuration templates
├── scripts/                     # Operational scripts
├── secrets/                     # Secret files (gitignored)
└── docs/                        # Documentation
    ├── ARCHITECTURE.md
    ├── SECURITY-ARCHITECTURE.md
    └── decisions/               # 13 accepted ADRs
```

### 3.2 Architecture Overview

Docker Lab follows a **four-tier modular architecture**:

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

### 3.3 Network Architecture

Four-network topology provides security through isolation:

```
INTERNET
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

### 3.4 Foundation Module System

The foundation provides:

| Component | Status | Description |
|-----------|--------|-------------|
| Module Manifest Schema | COMPLETE | JSON schema for `module.json` |
| Lifecycle Hooks | COMPLETE | install/start/stop/uninstall/health |
| Version Compatibility | COMPLETE | SemVer checking with range support |
| Docker Compose Patterns | COMPLETE | Extends with resource limits |
| Event Bus Interface | STUB | `eventbus-noop.sh` - no implementation |
| Dashboard Registration | PARTIAL | Bug: false positive detection |
| Connection Abstraction | COMPLETE | Provider matching |
| Migration System | COMPLETE | Up/down/status commands |
| Foundation CLI | PARTIAL | Install/uninstall are placeholders |

### 3.5 Existing Module Analysis

#### test-module (Testing Artifact)
- **Purpose:** Created during foundation validation testing
- **Completeness:** Minimal - shell scripts only, no Docker container
- **HTTP Endpoints:** None
- **Event Publishing:** None (declared but not implemented)
- **Usability:** Too minimal to serve as example

#### backup (Production Module)
- **Purpose:** Automated backup with restic, age encryption, S3
- **Completeness:** Full - scheduled jobs, dashboard widgets, multiple operations
- **Complexity:** 24 config properties, 8 event types
- **Usability:** Too complex for learning

#### pki (Production Module)
- **Purpose:** Internal PKI with step-ca for automated TLS
- **Completeness:** Full - certificate lifecycle, dashboard integration
- **Complexity:** 14 config properties, 7 event types
- **Usability:** Too specialized for general example

#### mastodon (Production Module)
- **Purpose:** Federated social network with ActivityPub
- **Completeness:** Full - multi-service, OpenSearch, Rails app
- **Complexity:** 26 config properties, requires postgres + redis
- **Usability:** Too complex, too specific

### 3.6 Security Posture

| Category | Count | Status |
|----------|-------|--------|
| Critical Findings | 0 | - |
| High Findings | 2 | Mitigated |
| Medium Findings | 3 | Mitigated |
| Low Findings | 2 | 1 Open (Content Trust) |
| Info Findings | 2 | Mitigated |

Key mitigations in place:
- Docker socket proxy with read-only filtering
- File-based secrets (never environment variables)
- Four-tier network isolation
- Non-root container execution
- Pull-based webhook deployment

### 3.7 Decision Record Summary

13 accepted Architecture Decision Records (ADRs):

**Foundation (0000-0099):**
- ADR-0001: Traefik as Reverse Proxy
- ADR-0002: Four-Network Topology
- ADR-0003: File-Based Secrets Management
- ADR-0004: Docker Socket Proxy

**Databases (0100-0199):**
- ADR-0100: Multi-Database Profiles
- ADR-0101: PostgreSQL with pgvector Extension
- ADR-0102: Backup Architecture

**Security (0200-0299):**
- ADR-0200: Non-Root Container Execution
- ADR-0201: Security Anchors Pattern
- ADR-0202: SOPS and Age Secrets Encryption

**Operations (0300-0399):**
- ADR-0300: Health Check Strategy
- ADR-0301: Deployment Scripts

**Structure (0400-0499):**
- ADR-0400: Docker Compose Profile System
- ADR-0401: Example Application Pattern

### 3.8 Uncommitted Work

Currently pending commit:
- `docs/GLOSSARY.md` - New terminology reference
- `docs/GLOSSARY-GUIDE.md` - Guide for adding terms
- `docs/DASHBOARD.md` - Documentation expansion
- `services/dashboard/handlers/auth.go` - Auth improvements
- `services/dashboard/handlers/instances.go` - Instance improvements
- `.env.example` - Config updates
- `docker-compose.yml` - Service configuration
- `AGENTS.md` - Project AI configuration

---

## 4. Target Architecture

### 4.1 Microservices Research Specification

The target architecture is defined by an 800+ line research document titled "PeerMesh microservices and hot-pluggable modules". Key elements:

#### 4.1.1 Core Components

1. **Gateway** - Traefik with dynamic routing (already implemented)
2. **Control Plane** - Module registry, lifecycle manager (NOT implemented)
3. **Identity** - Service-to-service authentication (partial)
4. **Event Bus** - NATS + JetStream (NOT implemented, only stub)
5. **Observability** - Logs, metrics, traces (partial)

#### 4.1.2 Module Contract

Every module MUST expose:
- `GET /healthz` - Liveness check
- `GET /readyz` - Readiness check (dependencies connected, migrations applied)
- `GET /meta` - Module manifest summary

#### 4.1.3 Module Manifest Schema

```json
{
  "id": "module-id",
  "name": "Module Name",
  "version": "1.0.0",
  "platform_api_version": "1",
  "publisher": "publisher-name",
  "capabilities": {
    "http_routes": [
      {"path_prefix": "/module", "port": 8080, "strip_prefix": true}
    ],
    "events_publish": ["module.entity.action"],
    "events_subscribe": [
      {"topic": "other.entity.action", "consumer_group": "module"}
    ],
    "jobs": [
      {"name": "cleanup", "schedule": "0 */6 * * *", "concurrency": 1}
    ]
  },
  "data": {
    "db_mode": "owned",
    "migration": {"cmd": ["/app/migrate"]}
  },
  "resources": {
    "cpu": "500m",
    "memory": "512Mi"
  }
}
```

#### 4.1.4 Event Bus Requirements

- Topic naming: `peermesh.<domain>.<entity>.<verb>`
- Event envelope with id, type, time, source, subject, trace, data
- At-least-once delivery with idempotency keys
- Inbox/outbox patterns for correctness

#### 4.1.5 modules.d/ Reconciliation

```yaml
# modules.d/counter.yaml
id: counter
image: ghcr.io/peermesh/module-counter:1.0.0
enabled: true
routes:
  - path_prefix: /counter
    port: 8080
events:
  publish:
    - counter.incremented
config:
  INITIAL_VALUE: 0
```

Rules:
- File added → install/enable
- File changed → rolling update
- File removed → disable

### 4.2 Gap Between Current and Target

| Area | Current State | Target State | Work Required |
|------|---------------|--------------|---------------|
| Event Bus | No-op stub | NATS + JetStream | MAJOR - new implementation |
| Control Plane | None | Registry + lifecycle | MAJOR - new service |
| Module Endpoints | Shell scripts only | HTTP /healthz, /readyz, /meta | MEDIUM - container required |
| modules.d/ | None | File-based reconciliation | MAJOR - new feature |
| Module Contract | module.json only | Manifest + image label + /meta | MEDIUM - spec alignment |

---

## 5. Solution Proposal

### 5.1 Two Work Streams

#### Stream A: Example Module (PRIMARY)
Create a minimal "reference module" that demonstrates the complete pattern.

#### Stream B: Foundation Simplification (SECONDARY)
Strip Docker Lab to essential foundation after pattern is established.

### 5.2 Why Example Module First?

1. **Validates Understanding** - Building the example proves we understand the target architecture
2. **Establishes Pattern** - Creates the canonical reference before removing things
3. **Reduces Risk** - We know what to keep because we've built what's needed
4. **Serves Community** - Reference module becomes the primary learning resource

### 5.3 Example Module Specification

**Name:** `counter-example`

**Purpose:** A minimal HTTP service that demonstrates all module contract requirements.

#### 5.3.1 Functionality

| Feature | Implementation |
|---------|---------------|
| HTTP Endpoint | `POST /counter/increment` - increments value |
| HTTP Endpoint | `GET /counter/value` - returns current value |
| Required Endpoint | `GET /healthz` - liveness check |
| Required Endpoint | `GET /readyz` - readiness check |
| Required Endpoint | `GET /meta` - module manifest |
| Event Publishing | `counter.value.incremented` on each increment |
| Event Consuming | `counter.reset.requested` to reset value |
| Scheduled Job | Hourly stats report |
| Idempotency | Request ID tracking in inbox table |
| Data Ownership | SQLite database (owned) |

#### 5.3.2 Why a Counter?

- **Simple to Understand:** Everyone knows what a counter does
- **All Patterns Included:** Events, jobs, idempotency, health checks
- **Minimal Dependencies:** Single binary, embedded database
- **Quick to Build:** Can be implemented in any language
- **Easy to Test:** Deterministic behavior

#### 5.3.3 Technical Choices

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Language | Go | Match dashboard service, single binary |
| Database | SQLite | Zero dependencies, file-based |
| Event Bus | Interface with stub | Prepare for NATS without requiring it |
| Container Size | ~10MB | Demonstrates minimal footprint |

### 5.4 Foundation Alignment (Deferred)

After the example module is complete, implement:

1. **Event Bus Abstraction** - Interface that works with NATS, Redis, or memory
2. **Control Plane MVP** - modules.d/ watching with basic reconciliation
3. **Contract Enforcement** - Dashboard registration verifies endpoints

### 5.5 Simplification (Deferred)

After foundation is aligned:

1. **Archive Production Modules** - Move backup, pki, mastodon to separate repos
2. **Simplify Profiles** - Keep postgresql, redis; archive others
3. **Update Documentation** - Focus on foundation + example module

---

## 6. Process

### 6.1 Development Process

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   1. Design     │───▶│   2. Build      │───▶│   3. Document   │
│   Example       │    │   Example       │    │   Example       │
│   Module Spec   │    │   Module        │    │   Module        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   4. Validate   │───▶│   5. Align      │───▶│   6. Strip      │
│   Against       │    │   Foundation    │    │   Down          │
│   Research Spec │    │   Components    │    │   Codebase      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 6.2 Decision Points

| Decision | When | Options | Criteria |
|----------|------|---------|----------|
| Event bus implementation | After example module | NATS, Redis Streams, Memory | Operational simplicity, research alignment |
| Control plane scope | After example module | Full/MVP/CLI-only | Complexity vs value |
| Module archive location | After simplification | Separate repos/monorepo/deprecate | Maintenance burden |

### 6.3 Validation Checkpoints

1. **Example Module Review** - Does it satisfy all research spec requirements?
2. **Foundation Alignment Review** - Do new components integrate correctly?
3. **Simplification Review** - Is the stripped codebase still functional?

---

## 7. Plan

### 7.1 Phase 1: Example Module (PRIMARY FOCUS)

#### Step 1.1: Design Module Specification
- Define complete API contract
- Define event schemas
- Define database schema
- Define configuration schema
- Write module.json manifest

**Deliverables:**
- `modules/counter-example/SPEC.md`
- `modules/counter-example/module.json`

#### Step 1.2: Implement HTTP Service
- Scaffold Go HTTP server
- Implement `/counter/increment` endpoint
- Implement `/counter/value` endpoint
- Implement `/healthz`, `/readyz`, `/meta` endpoints
- Add SQLite persistence

**Deliverables:**
- `modules/counter-example/main.go`
- `modules/counter-example/Dockerfile`
- `modules/counter-example/docker-compose.yml`

#### Step 1.3: Implement Event Integration
- Define event bus interface
- Implement stub/memory event bus
- Publish `counter.value.incremented` events
- Subscribe to `counter.reset.requested` events

**Deliverables:**
- `modules/counter-example/events/`
- Event bus interface in foundation

#### Step 1.4: Implement Scheduled Job
- Add hourly stats job
- Demonstrate idempotency with request ID tracking
- Implement inbox pattern

**Deliverables:**
- Job scheduler integration
- Inbox table implementation

#### Step 1.5: Implement Lifecycle Hooks
- `install.sh` - Create database, initialize state
- `start.sh` - Start container
- `stop.sh` - Graceful shutdown
- `health.sh` - Return JSON health status
- `uninstall.sh` - Cleanup

**Deliverables:**
- `modules/counter-example/hooks/`

#### Step 1.6: Add Dashboard Integration
- Status widget
- Config panel
- Navigation entry

**Deliverables:**
- `modules/counter-example/dashboard/`

#### Step 1.7: Document and Test
- Write comprehensive README
- Write module authoring guide based on experience
- Create integration tests

**Deliverables:**
- `modules/counter-example/README.md`
- `docs/MODULE-AUTHORING-GUIDE.md`
- Test scripts

### 7.2 Phase 2: Foundation Alignment (DEFERRED)

#### Step 2.1: Event Bus Implementation
- Abstract event bus interface
- Implement NATS adapter
- Implement memory adapter (development)
- Update foundation documentation

#### Step 2.2: Control Plane MVP
- Implement modules.d/ file watching
- Implement basic reconciliation (add/remove)
- Update CLI commands

#### Step 2.3: Contract Enforcement
- Update dashboard registration to verify endpoints
- Add module validation to CLI

### 7.3 Phase 3: Simplification (DEFERRED)

#### Step 3.1: Archive Complex Modules
- Move backup module to separate repository
- Move pki module to separate repository
- Move mastodon module to separate repository
- Update references and documentation

#### Step 3.2: Simplify Profiles
- Keep postgresql profile (most common)
- Keep redis profile (caching/sessions)
- Archive mysql, mongodb, minio profiles

#### Step 3.3: Update Documentation
- Revise README for minimal foundation
- Update architecture docs
- Create migration guide for existing users

---

## 8. Strategy

### 8.1 Build the Pattern, Then Simplify

**Principle:** Never subtract before you've added the replacement.

The existing modules are complex because no simple reference existed. By creating the canonical example first, we:
1. Know exactly what the minimum viable module looks like
2. Can confidently remove what's unnecessary
3. Have a working reference for comparison

### 8.2 Defer Infrastructure Changes

**Principle:** Don't change the platform while building on it.

Event bus and control plane changes are deferred until the example module proves the pattern works with stubs. This:
1. Reduces scope of initial work
2. Validates assumptions before investing in infrastructure
3. Keeps the example module portable

### 8.3 Document as We Build

**Principle:** The example IS the documentation.

Instead of writing documentation separately, the example module becomes the primary learning resource. Every pattern decision is captured in working code.

### 8.4 Preserve Optionality

**Principle:** Make changes reversible.

- Modules are archived, not deleted
- Profiles are disabled, not removed
- Foundation additions are backward-compatible

---

## 9. Roadmap

### 9.1 Timeline Overview

```
Week 1-2: Example Module Design & Core Implementation
Week 3:   Event Integration & Scheduled Jobs
Week 4:   Dashboard Integration & Documentation
Week 5:   Foundation Alignment (Event Bus)
Week 6:   Foundation Alignment (Control Plane MVP)
Week 7-8: Simplification & Final Documentation
```

### 9.2 Milestones

| Milestone | Definition | Target |
|-----------|------------|--------|
| M1: Example Module MVP | HTTP endpoints working | Week 2 |
| M2: Example Module Complete | All features, documented | Week 4 |
| M3: Foundation Aligned | Event bus + control plane MVP | Week 6 |
| M4: Simplified Codebase | Archive complete, docs updated | Week 8 |

### 9.3 Dependencies

```
Example Module Spec
       │
       ▼
Example Module Implementation ─────────────────┐
       │                                        │
       ▼                                        ▼
Event Bus Interface ◀─────────────── Module Authoring Guide
       │
       ▼
Control Plane MVP
       │
       ▼
Simplification
       │
       ▼
Updated Documentation
```

### 9.4 Resource Requirements

| Phase | Primary Skills | Effort |
|-------|---------------|--------|
| Example Module | Go, Docker, HTTP APIs | Medium |
| Foundation Alignment | Go, NATS, File I/O | Medium |
| Simplification | Git, Documentation | Low |

---

## 10. Risk Assessment

### 10.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Event bus complexity | Medium | Medium | Defer to Phase 2, use stubs first |
| Control plane scope creep | High | High | Define MVP explicitly, defer advanced features |
| Example module too complex | Medium | Medium | Timebox features, prioritize core patterns |
| Breaking existing users | Low | High | Archive, don't delete; provide migration guide |

### 10.2 Process Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Scope expansion | High | Medium | Strict phase gates, defer non-essential work |
| Documentation debt | Medium | Medium | Document as we build, not after |
| Loss of existing work | Low | High | Git history preserved, archives accessible |

### 10.3 Alignment Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Research spec changes | Low | Medium | Treat spec as guidance, not requirement |
| Conflicting patterns | Medium | Medium | Resolve conflicts in example module phase |
| Over-engineering | Medium | Medium | "Simple counter" constraint enforces simplicity |

---

## 11. Success Criteria

### 11.1 Example Module Success

The example module is successful when:

- [ ] Exposes `/healthz`, `/readyz`, `/meta` endpoints
- [ ] Handles HTTP requests (increment, get value)
- [ ] Publishes events to event bus interface
- [ ] Consumes events from event bus interface
- [ ] Runs scheduled job successfully
- [ ] Demonstrates idempotency pattern
- [ ] Integrates with dashboard (widget, panel, nav)
- [ ] Passes all lifecycle hooks
- [ ] Can be created from template in <30 minutes
- [ ] Is documented with inline comments and README

### 11.2 Foundation Alignment Success

Foundation alignment is successful when:

- [ ] Event bus abstraction supports NATS and memory backends
- [ ] modules.d/ file changes trigger reconciliation
- [ ] Dashboard registration verifies module endpoints
- [ ] CLI can install/uninstall modules with new contract

### 11.3 Simplification Success

Simplification is successful when:

- [ ] Codebase is 50% smaller by file count
- [ ] README focuses on foundation + example module
- [ ] New user can run example module within 5 minutes
- [ ] Archived modules remain accessible and documented
- [ ] All tests still pass

---

## 12. Appendices

### Appendix A: Microservices Research Specification Summary

**Source:** "PeerMesh microservices and hot-pluggable modules" (800+ lines)

**Core Constraint:** "Add modules without restarting the server"

**Target Architecture Components:**
1. Gateway - TLS termination, routing, auth enforcement
2. Control Plane - Module registry, lifecycle manager
3. Identity - OIDC integration, service-to-service identity
4. Event Bus - Pub/sub and work-queue patterns
5. Observability - Logs, metrics, traces

**Module Lifecycle States:**
- Installed → Enabled → Disabled → Uninstalled

**Enable Flow:**
1. Fetch artifact (OCI image)
2. Verify publisher signature
3. Validate compatibility
4. Provision runtime (start container)
5. Run migrations
6. Register routes/events/UI
7. Health-gate (liveness + readiness)
8. Expose traffic

**Required Module Endpoints:**
- `GET /healthz` - liveness
- `GET /readyz` - readiness
- `GET /meta` - manifest summary

**Event Bus Recommendation:** NATS + JetStream for:
- Local-first and remote deployments
- Operational simplicity
- Work queue + pub/sub in one system

**Event Naming Convention:** `peermesh.<domain>.<entity>.<verb>`

**Correctness Patterns:**
- Idempotency keys (job_id uniqueness)
- Inbox pattern (deduplicate incoming events)
- Outbox pattern (reliable event publishing)
- DB-backed claiming (`SELECT ... FOR UPDATE SKIP LOCKED`)

### Appendix B: Current Module Manifest Schema

```json
{
  "$schema": "foundation/schemas/module.schema.json",
  "id": "module-id",
  "version": "1.0.0",
  "name": "Module Name",
  "description": "Description",
  "author": {"name": "Author", "email": "email@example.com"},
  "license": "MIT",
  "tags": ["tag1", "tag2"],
  "foundation": {
    "minVersion": "1.0.0",
    "maxVersion": "2.0.0"
  },
  "requires": {
    "connections": [
      {"type": "database", "providers": ["postgres"], "required": true}
    ],
    "modules": ["other-module"]
  },
  "provides": {
    "connections": [],
    "events": ["module.entity.action"]
  },
  "dashboard": {
    "displayName": "Module Name",
    "icon": "puzzle",
    "routes": [
      {"path": "/module", "nav": {"label": "Module", "order": 100}}
    ],
    "statusWidget": {"component": "./dashboard/Widget.html"},
    "configPanel": {"component": "./dashboard/Config.html"}
  },
  "lifecycle": {
    "install": "./hooks/install.sh",
    "start": "./hooks/start.sh",
    "stop": "./hooks/stop.sh",
    "uninstall": "./hooks/uninstall.sh",
    "health": "./hooks/health.sh"
  },
  "config": {
    "version": "1.0",
    "properties": {
      "setting": {
        "type": "string",
        "description": "Description",
        "default": "value",
        "env": "MODULE_SETTING"
      }
    },
    "required": []
  }
}
```

### Appendix C: Current Lifecycle Hooks

| Hook | When Called | Exit Codes |
|------|-------------|------------|
| install | Module first added | 0=success, 1=failure, 2=missing deps, 3=config error |
| start | Module activated | 0=success, 1=failure, 2=deps unavailable |
| stop | Module deactivated | 0=success, 1=failure, 2=timeout |
| uninstall | Module removed | 0=success, 1=failure, 2=cancelled |
| health | Periodic/on-demand | 0=healthy, 1=unhealthy, 2=degraded |
| upgrade | Version changes | 0=success, 1=failure |
| validate | Before install | 0=pass, 1=fail |

### Appendix D: Security Posture Summary

| Finding ID | Severity | Status | Description |
|------------|----------|--------|-------------|
| SEC-001 | High | Mitigated | Docker socket exposure → socket proxy |
| SEC-002 | Medium | Mitigated | Root user in DB → privilege drop + isolation |
| SEC-003 | High | Mitigated | Env var secrets → file-based secrets |
| SEC-004 | Medium | Mitigated | SSH keys in CI/CD → pull-based webhook |
| SEC-005 | Medium | Mitigated | Traefik dashboard → localhost binding |
| SEC-006 | Low | Mitigated | No centralized logging → log rotation |
| SEC-007 | Info | Mitigated | Read-only filesystem → partial implementation |
| SEC-008 | Info | Mitigated | No image scanning → manual process documented |
| SEC-009 | Low | **Open** | Content Trust not enabled |

### Appendix E: Existing ADRs

| ADR | Title | Status |
|-----|-------|--------|
| 0001 | Traefik as Reverse Proxy | Accepted |
| 0002 | Four-Network Topology | Accepted |
| 0003 | File-Based Secrets Management | Accepted |
| 0004 | Docker Socket Proxy | Accepted |
| 0100 | Multi-Database Profiles | Accepted |
| 0101 | PostgreSQL with pgvector Extension | Accepted |
| 0102 | Backup Architecture | Accepted |
| 0200 | Non-Root Container Execution | Accepted |
| 0201 | Security Anchors Pattern | Accepted |
| 0202 | SOPS and Age Secrets Encryption | Accepted |
| 0300 | Health Check Strategy | Accepted |
| 0301 | Deployment Scripts | Accepted |
| 0400 | Docker Compose Profile System | Accepted |
| 0401 | Example Application Pattern | Accepted |

---

## Review Instructions

**For External Reviewers:**

This document is intended to be self-contained. You should be able to evaluate the proposal without access to the actual codebase.

**Questions to Consider:**

1. Does the problem statement accurately capture the core issues?
2. Is the solution (example module first) the right approach?
3. Are there risks not identified?
4. Is the roadmap realistic?
5. Are the success criteria measurable and appropriate?

**Feedback Format:**

Please provide feedback in the following structure:
- **Agreement/Disagreement** with major sections
- **Concerns** about specific decisions
- **Suggestions** for improvements
- **Questions** that need clarification

---

*Document generated: 2026-02-04*
*Status: DRAFT - Pending External Review*
