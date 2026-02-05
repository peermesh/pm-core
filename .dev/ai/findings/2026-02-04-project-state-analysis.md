# Project State Analysis - Docker Lab

**Date:** 2026-02-04
**Purpose:** Consolidate understanding of current project state, work streams, and alignment with research

---

## Executive Summary

Docker Lab has a **mature foundation system** with 4 existing modules, but there is a **gap between the current implementation and the microservices architecture** described in recent research. Two work streams are identified:

1. **Strip Down** - Simplify Docker Lab to a basic foundation for extension
2. **Example Module** - Create a reference module demonstrating best practices

**Recommendation:** Example module work should come first to establish the pattern before stripping down.

---

## Current State Inventory

### Foundation System (v1.0.0)

| Component | Status | Notes |
|-----------|--------|-------|
| Module manifest schema | COMPLETE | `foundation/schemas/module.schema.json` |
| Lifecycle hooks | COMPLETE | install/start/stop/uninstall/health |
| Version compatibility | COMPLETE | SemVer checking with range support |
| Docker Compose patterns | COMPLETE | Extends with resource limits |
| Event bus interface | STUB | No-op implementation only |
| Dashboard registration | PARTIAL | Bug: false positive detection |
| Connection abstraction | COMPLETE | Provider matching |
| Migration system | COMPLETE | Up/down/status commands |
| Foundation CLI | PARTIAL | Install/uninstall are placeholders |

### Existing Modules (4 total)

| Module | Complexity | Status | Notes |
|--------|------------|--------|-------|
| `test-module` | Minimal | Testing artifact | Created during foundation validation |
| `backup` | Full | Production-ready | Restic, S3, age encryption, dashboard widgets |
| `pki` | Full | Production-ready | step-ca, auto-renewal, dashboard widgets |
| `mastodon` | Full | Production-ready | Federated social, OpenSearch, multi-service |

**Observation:** The existing modules are complex, production-grade implementations. There is no **simple example module** that demonstrates the minimum viable pattern.

### Uncommitted Work

| Category | Files | Status |
|----------|-------|--------|
| Glossary docs | 2 new files | Ready to commit |
| Dashboard handlers | 2 modified | Ready to commit |
| Config updates | 3 modified | Ready to commit |
| AGENTS.md | 1 new file | Created this session |

---

## Gap Analysis: Foundation vs Microservices Research

### Microservices Research Document
**Source:** `~/Downloads/INBOX-markdown/PeerMesh microservices and hot-pluggable modules.md`

This 800+ line document defines a more advanced architecture that the current foundation does not fully implement:

| Feature | Research Spec | Current Foundation | Gap |
|---------|---------------|-------------------|-----|
| **Event Bus** | NATS + JetStream | No-op stub | MAJOR |
| **Control Plane** | Module registry, lifecycle manager | None | MAJOR |
| **Required Endpoints** | `/healthz`, `/readyz`, `/meta` | Not enforced | MEDIUM |
| **Module Contract** | Manifest in image label + `/meta` | File-based only | MEDIUM |
| **modules.d/ Reconciliation** | File watch, auto-enable/disable | None | MAJOR |
| **Gateway Integration** | Dynamic Traefik label routing | Manual compose | MINOR |
| **Service Identity** | mTLS or signed JWT | None | FUTURE |
| **UI Registry** | Module Federation / Import Maps | Component paths only | FUTURE |

### Key Alignment Points

The research document **aligns with** the current foundation on:
- Module manifest structure (similar schema)
- Lifecycle states (Installed → Enabled → Disabled → Uninstalled)
- Docker-first deployment model
- Traefik as gateway
- Out-of-process modules (containers)

### Critical Gaps to Address

1. **No Event Bus Implementation**
   - Current: `foundation/lib/eventbus-noop.sh` is a stub
   - Research: NATS + JetStream recommended
   - Impact: Modules cannot communicate asynchronously

2. **No Control Plane**
   - Current: Manual CLI commands
   - Research: Automatic reconciliation from `modules.d/`
   - Impact: Cannot hot-plug modules without restart

3. **Module Contract Not Enforced**
   - Current: Modules have lifecycle hooks but no HTTP endpoints required
   - Research: All modules must expose `/healthz`, `/readyz`, `/meta`
   - Impact: No uniform health checking or discovery

---

## Two Work Streams Identified

### Stream 1: Strip Docker Lab to Basic Foundation

**Goal:** Remove complex implementations, keep only the foundation layer

**What to keep:**
- Foundation schemas, scripts, templates
- Docker Compose base patterns
- Traefik configuration (simplified)
- Core secrets management

**What to remove/simplify:**
- Complex example applications (examples/)
- Multiple database profiles (keep one)
- Dashboard service (make optional)
- Existing modules (move to separate repo or archive)

**Concerns:**
- Risk of losing working examples
- Need clear "what comes back later" list

### Stream 2: Create Example Module

**Goal:** Build a minimal reference module that demonstrates the complete pattern

**Requirements per research doc:**
- Container that starts from scratch with config/secrets only
- Implements `/healthz`, `/readyz`, `/meta` endpoints
- Declares routes and event topics in manifest
- Owns its data model (migrations if needed)
- Safe under retry (idempotent)
- Emits structured logs with trace context

**Candidate: Simple Counter Service**
- Single HTTP endpoint (increment counter)
- Publishes event on each increment
- Consumes event to maintain running total
- Scheduled job (hourly reset or report)
- Uses inbox pattern for idempotency
- Minimal dependencies

---

## Recommended Approach

### Phase 1: Example Module First (recommended)

1. **Design the "reference module"** that satisfies the microservices research contract
2. **Build it as a working example** that demonstrates:
   - Required HTTP endpoints
   - Event publishing/consuming
   - Scheduled jobs
   - Idempotency patterns
3. **Document the pattern** - This becomes the module authoring guide

### Phase 2: Foundation Alignment

1. **Implement NATS + JetStream** event bus (or at least abstraction)
2. **Add control plane basics** - `modules.d/` watching, reconciliation
3. **Enforce module contract** - Health check verification in dashboard registration

### Phase 3: Strip Down

1. **Archive existing complex modules** to separate repos
2. **Simplify profiles** to essential minimum
3. **Update documentation** for new minimal state
4. **Keep reference module** as the canonical example

---

## Open Questions

1. **Event bus urgency:** Is NATS + JetStream required for the example module, or can we stub it initially?
2. **Control plane scope:** Full reconciliation or just improved CLI?
3. **Existing modules fate:** Archive, separate repo, or deprecate?
4. **Dashboard coupling:** How much should the example module depend on dashboard?

---

## References

### Project Artifacts
- Recovery Snapshot: `.dev/ai/recovery/SNAPSHOT-2026-02-04.md`
- Git Analysis: `.dev/ai/recovery/git-analysis.md`
- Module Foundation Test: `.dev/ai/reviews/TEST-Module-Foundation-2026-01-22-02-21-52Z.md`
- Identity Proposal: `.dev/ai/proposals/PROP-2026-01-15-identity-provider-support.md`

### External Research
- **CRITICAL:** `~/Downloads/INBOX-markdown/PeerMesh microservices and hot-pluggable modules.md`
- Event Bus Research: `~/.agents/.dev/ai/master-control/research/decision-event-bus/`
- Module Architecture: `~/.agents/docs/MODULAR-ARCHITECTURE-GOVERNANCE.md`

### Foundation Docs
- Foundation README: `foundation/README.md`
- Lifecycle Hooks: `foundation/docs/LIFECYCLE-HOOKS.md`
- Compose Patterns: `foundation/docs/COMPOSE-PATTERNS.md`

---

*Analysis generated: 2026-02-04*
