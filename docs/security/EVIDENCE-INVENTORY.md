# Security Evidence Inventory

**Version**: 1.0.0
**Date**: 2026-02-22
**Status**: Audit Preparation Package
**Purpose**: Index of all security-related artifacts for professional security audit

---

## Overview

This document provides a comprehensive index of all security evidence artifacts in the Docker Lab codebase. It is organized by security control category and maps to the CIS Docker Benchmark, OWASP Container Security, and threat model mitigations.

**Base Path**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/`

All file paths in this document are absolute paths from the sub-repo root.

---

## Table of Contents

1. [Configuration Files](#configuration-files)
2. [Security Scripts](#security-scripts)
3. [Documentation](#documentation)
4. [Architecture Decision Records (ADRs)](#architecture-decision-records-adrs)
5. [Test Suites](#test-suites)
6. [Security Framework Artifacts (WO-079-1A)](#security-framework-artifacts-wo-079-1a)
7. [Deployment Evidence](#deployment-evidence)
8. [Hardening Overlays](#hardening-overlays)
9. [Security Reports](#security-reports)

---

## Configuration Files

### Primary Compose Files

| File | Security Controls | Description |
|------|------------------|-------------|
| `docker-compose.yml` | Network segmentation, secrets, resource limits, security anchors | Main service definitions with four-tier network topology |
| `docker-compose.hardening.yml` | Capability restrictions, read-only filesystems, security overlays | Hardening overlay with cap_drop/cap_add, read_only where supported |
| `foundation/docker-compose.base.yml` | Security anchors (x-secured-service), logging defaults, restart policies | Reusable YAML anchors for consistent security configuration |

**Absolute Paths**:
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.yml`
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.hardening.yml`
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/foundation/docker-compose.base.yml`

**CIS Controls**: 2.1 (network isolation), 5.3 (capabilities), 5.11 (memory limits), 5.25 (restart policy), 5.26 (no-new-privileges), 5.29 (custom networks)

---

### Traefik Configuration

| File | Security Controls | Description |
|------|------------------|-------------|
| `configs/traefik/traefik.yml` | TLS settings, entrypoints, certificate resolvers | Traefik static configuration (if using file-based config) |

**Compose Labels** (in `docker-compose.yml` traefik service):
- TLS certificate resolver (Let's Encrypt)
- HTTP to HTTPS redirect
- Security headers (HSTS, XSS protection, frame deny, content-type nosniff)
- Rate limiting middleware
- Access logging

**Absolute Path**:
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.yml` (traefik service labels)

**CIS Controls**: 5.13 (bind incoming traffic), TLS enforcement

---

### Network Definitions

| Network | Configuration | Security Property |
|---------|--------------|------------------|
| `socket-proxy` | `internal: true` | Isolated, no internet egress, Docker API access only |
| `db-internal` | `internal: true` | Isolated, no internet egress, no public ports |
| `app-internal` | `internal: true` | Isolated, no internet egress |
| `proxy-external` | No `internal` flag | Internet-facing (required for Traefik) |

**Absolute Path**: Network definitions in `docker-compose.yml` (networks section)

**CIS Controls**: 2.1 (restrict network traffic between containers)

---

## Security Scripts

### Supply-Chain Security Scripts

| Script | Function | Output |
|--------|---------|---------|
| `scripts/security/validate-image-policy.sh` | Validates image tags/digests against policy contract | TSV report, exit code 0/1 |
| `scripts/security/generate-sbom.sh` | Generates CycloneDX SBOM for all images | SBOM JSON files, index TSV |
| `scripts/security/validate-supply-chain.sh` | Full supply-chain gate (policy + SBOM + vulnerability scan) | Supply-chain summary, aggregated reports |
| `scripts/security/audit-ownership.sh` | Audits file ownership and permissions for security-sensitive files | Ownership violations report |

**Absolute Paths**:
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/security/validate-image-policy.sh`
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/security/generate-sbom.sh`
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/security/validate-supply-chain.sh`
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/security/audit-ownership.sh`

**CIS Controls**: 4.2 (use trusted base images), 4.5 (content trust), 4.11 (install verified packages)

---

### CIS Docker Benchmark Script

| Script | Function | Output |
|--------|---------|---------|
| `scripts/security/run-docker-bench.sh` | Runs docker-bench-security (CIS Docker Benchmark scanner) | Timestamped log in `.dev/ai/security/` |

**Absolute Path**:
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/security/run-docker-bench.sh`

**Documentation**:
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/security/DOCKER-BENCH-GUIDE.md`
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/security/README.md`

**CIS Controls**: Full CIS Docker Benchmark v1.6.0

---

### Secrets Management Scripts

| Script | Function | Output |
|--------|---------|---------|
| `scripts/generate-secrets.sh` | Generates secure random secrets, sets file permissions (600/700) | Secrets files in `secrets/` directory |

**Absolute Path**:
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/generate-secrets.sh`

**CIS Controls**: 4.10 (do not store secrets in Dockerfiles), secrets management best practices

---

### Deployment and Validation Scripts

| Script | Function | Security Gates |
|--------|---------|---------------|
| `scripts/deploy.sh` | Orchestrates deployment with security gates | Supply-chain validation, fail-closed on gate failure, evidence bundle generation |
| `scripts/init-volumes.sh` | Initializes volumes with correct ownership/permissions | Prevents permission-denied issues for non-root containers |

**Absolute Paths**:
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/deploy.sh`
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/scripts/init-volumes.sh`

**Related ADR**: ADR-0301 (deployment scripts)

---

## Documentation

### Core Security Documents

| Document | Content | Audit Relevance |
|----------|---------|----------------|
| `docs/SECURITY-ARCHITECTURE.md` | Comprehensive security architecture (35 KB, 789 lines) | Defense-in-depth layers, network topology, secrets flow, compliance mapping |
| `docs/SECURITY.md` | Security guide and hardening best practices | Operator guidelines |
| `docs/SECURITY-CHECKLIST.md` | CIS + OWASP controls checklist | Pre-deployment validation |
| `docs/AUDIT-PREP.md` | Existing audit preparation package (24 KB) | Architecture overview, config index, known issues |
| `docs/SECRETS-MANAGEMENT.md` | Secrets lifecycle, rotation, team onboarding | Operational security procedures |
| `docs/SUPPLY-CHAIN-SECURITY.md` | Supply-chain security baseline | Image policy, SBOM, vulnerability thresholds |
| `docs/GOTCHAS.md` | Documented deployment gotchas and security trade-offs | Explains intentional exceptions (read_only, cap_drop on databases) |

**Absolute Paths** (prefix: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/`):
- `SECURITY-ARCHITECTURE.md`
- `SECURITY.md`
- `SECURITY-CHECKLIST.md`
- `AUDIT-PREP.md`
- `SECRETS-MANAGEMENT.md`
- `SUPPLY-CHAIN-SECURITY.md`
- `GOTCHAS.md`

---

### Threat Model and Audit Documents (This Package)

| Document | Content | Audit Relevance |
|----------|---------|----------------|
| `docs/security/THREAT-MODEL.md` | STRIDE threat analysis, attack surfaces, trust boundaries, mitigations | Primary threat model for audit |
| `docs/security/EVIDENCE-INVENTORY.md` | This document - index of all security artifacts | Navigation aid for auditors |
| `docs/security/AUDIT-READINESS-CHECKLIST.md` | CIS Docker Benchmark mapping to implementation | Gap analysis, compliance status |
| `docs/security/OSS-AUDIT-RESULTS.md` | Results from open-source security audit tools | Pre-audit findings |

**Absolute Paths** (prefix: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/security/`):
- `THREAT-MODEL.md`
- `EVIDENCE-INVENTORY.md`
- `AUDIT-READINESS-CHECKLIST.md`
- `OSS-AUDIT-RESULTS.md`

---

### Deployment and Operations Guides

| Document | Security Content | Audit Relevance |
|----------|-----------------|----------------|
| `docs/DEPLOYMENT.md` | VPS setup, firewall configuration, secret provisioning | Production deployment security |
| `docs/WEBHOOK-DEPLOYMENT.md` | Pull-based deployment security model | CI/CD security, credential management |
| `docs/DEPLOYMENT-CHECKLIST.md` | Pre-deployment validation steps | Security gate enforcement |
| `docs/DEPLOYMENT-PROMOTION-RUNBOOK.md` | Promotion workflow with security gates | Evidence-based promotion process |
| `docs/BACKUP-RESTORE.md` | Backup encryption, restore procedures | Data protection, disaster recovery |

**Absolute Paths** (prefix: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/`):
- `DEPLOYMENT.md`
- `WEBHOOK-DEPLOYMENT.md`
- `DEPLOYMENT-CHECKLIST.md`
- `DEPLOYMENT-PROMOTION-RUNBOOK.md`
- `BACKUP-RESTORE.md`

---

## Architecture Decision Records (ADRs)

### Security-Focused ADRs

| ADR | Title | Security Decision |
|-----|-------|------------------|
| ADR-0001 | Traefik Reverse Proxy | TLS termination, centralized routing, security headers |
| ADR-0002 | Four-Network Topology | Network isolation, internal networks, egress blocking |
| ADR-0003 | File-Based Secrets | Secrets never in environment variables, file permissions 600/700 |
| ADR-0004 | Docker Socket Proxy | Read-only Docker API access, filtered endpoints, write operations blocked |
| ADR-0200 | Non-Root Containers | Privilege reduction, non-root execution where supported |
| ADR-0201 | Security Anchors | Standardized security configuration (no-new-privileges, cap_drop) |
| ADR-0202 | SOPS+Age Secrets Encryption | Encrypted secrets at rest, team-based decryption |

**Absolute Paths** (prefix: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/`):
- `0001-traefik-reverse-proxy.md`
- `0002-four-network-topology.md`
- `0003-file-based-secrets.md`
- `0004-docker-socket-proxy.md`
- `0200-non-root-containers.md`
- `0201-security-anchors.md`
- `0202-sops-age-secrets-encryption.md`

---

### Operational ADRs with Security Implications

| ADR | Title | Security Relevance |
|-----|-------|-------------------|
| ADR-0102 | Backup Architecture | Backup encryption, restore validation |
| ADR-0301 | Deployment Scripts | Fail-closed gates, evidence bundles |
| ADR-0300 | Health Check Strategy | Service liveness, restart policies |

**Absolute Paths** (prefix: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/`):
- `0102-backup-architecture.md`
- `0301-deployment-scripts.md`
- `0300-health-check-strategy.md`

---

## Test Suites

### Test Infrastructure (WO-063)

| Test Category | Location | Security Coverage |
|--------------|----------|------------------|
| Unit Tests | `tests/unit/` | Script validation, framework integrity |
| Integration Tests | `tests/integration/` | Module lifecycle, security hooks |
| Smoke Tests | `tests/smoke/` | Deployed application health checks |
| End-to-End Tests | `tests/e2e/` | Backup/restore workflows |

**Test Runner**: `tests/run-tests.sh`

**Test Framework**: bats-core (submodules in `tests/lib/`)

**Absolute Paths**:
- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/tests/`
- Documentation: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/testing-guide.md`

**Justfile Integration**: `just test`, `just test-unit`, `just test-integration`, etc.

---

### Security-Specific Tests

| Test | File | Validates |
|------|------|-----------|
| Scripts help validation | `tests/unit/test-scripts-help.bats` | All scripts have --help, no syntax errors |
| Module lifecycle | `tests/integration/test-module-lifecycle.bats` | Lifecycle hooks execute correctly |
| Backup/restore | `tests/e2e/test-backup-restore.bats` | Data integrity, encryption (if enabled) |

**Total Test Count**: 60+ tests (as of WO-063 completion)

---

## Security Framework Artifacts (WO-079-1A)

### Foundation Interfaces

| Interface | Language | Purpose |
|-----------|---------|---------|
| `foundation/interfaces/identity.py` | Python | Identity credential lifecycle (issue, verify, revoke, rotate) |
| `foundation/interfaces/identity.ts` | TypeScript | Same as above (TS version) |
| `foundation/interfaces/encryption.py` | Python | Key management, storage encryption |
| `foundation/interfaces/encryption.ts` | TypeScript | Same as above (TS version) |
| `foundation/interfaces/contract.py` | Python | Capability-based security (evaluate, enforce) |
| `foundation/interfaces/contract.ts` | TypeScript | Same as above (TS version) |

**Absolute Paths** (prefix: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/foundation/interfaces/`):
- `identity.py`, `identity.ts`
- `encryption.py`, `encryption.ts`
- `contract.py`, `contract.ts`

**Status**: Phase 1A complete (interfaces defined, no implementations yet)

---

### Foundation Schemas

| Schema | Purpose | Validation |
|--------|---------|-----------|
| `foundation/schemas/security.schema.json` | Module manifest `security` section | JSON Schema validation |
| `foundation/schemas/contract-manifest.schema.json` | Capability contracts | Contract structure validation |
| `foundation/schemas/security-event.schema.json` | Security event bus messages | Event format validation |
| `foundation/schemas/lifecycle.schema.json` | Security lifecycle hooks (provision, deprovision, rotate, lock) | Hook schema validation |
| `foundation/schemas/module.schema.json` | Module manifest (includes security section) | Full manifest validation |

**Absolute Paths** (prefix: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/foundation/schemas/`):
- `security.schema.json`
- `contract-manifest.schema.json`
- `security-event.schema.json`
- `lifecycle.schema.json`
- `module.schema.json`

---

### Foundation Documentation

| Document | Content |
|----------|---------|
| `foundation/docs/SECURITY-FRAMEWORK.md` | Security framework overview, phasing, interfaces |
| `foundation/docs/IDENTITY-INTERFACE.md` | Identity provider interface specification |
| `foundation/docs/ENCRYPTION-INTERFACE.md` | Encryption provider interface specification |
| `foundation/docs/CONTRACT-SYSTEM.md` | Capability-based security model |
| `foundation/docs/SECURITY-LIFECYCLE-HOOKS.md` | Security hook invocation model |

**Absolute Paths** (prefix: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/foundation/docs/`):
- `SECURITY-FRAMEWORK.md`
- `IDENTITY-INTERFACE.md`
- `ENCRYPTION-INTERFACE.md`
- `CONTRACT-SYSTEM.md`
- `SECURITY-LIFECYCLE-HOOKS.md`

---

## Deployment Evidence

### Evidence Bundle Structure

Deployment evidence bundles are created by `scripts/deploy.sh` and stored in timestamped directories:

**Location (default)**: `/tmp/pmdl-deploy-evidence/`

**Contents**:
- `deploy.log` - Full deployment log
- `preflight-supply-chain.log` - Supply-chain gate output
- `supply-chain/supply-chain-summary.env` - Gate results summary
- `supply-chain/image-policy.tsv` - Image policy validation report
- `supply-chain/sbom/SBOM-INDEX.tsv` - SBOM artifact index
- `supply-chain/vulnerability-gate.tsv` - Vulnerability scan results
- `docker-compose-config.yml` - Rendered compose configuration
- `container-state.json` - Post-deployment container inspection

**Example Absolute Path**: `/tmp/pmdl-deploy-evidence/20260222T221500Z-operator-production/`

**Absolute Path Glob**: `/tmp/pmdl-deploy-evidence/*-*/`

---

### Supply-Chain Reports

Standalone supply-chain runs (outside deployment) generate reports in:

**Location**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/reports/supply-chain/`

**Contents**: Same as evidence bundle supply-chain artifacts

**Example Absolute Path**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/reports/supply-chain/2026-02-22-221500/`

**Absolute Path Glob**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/reports/supply-chain/*/`

---

## Hardening Overlays

### docker-compose.hardening.yml

**Purpose**: Overlay file that applies maximum hardening to all services

**Controls Implemented**:
- `cap_drop: ALL` on all services (except databases during init)
- `cap_add` selectively for required capabilities (NET_BIND_SERVICE for Traefik, CHOWN/DAC_OVERRIDE/FOWNER/SETGID/SETUID for databases)
- `read_only: true` on Traefik (optional, with tmpfs mounts)
- Documented exceptions (socket-proxy, databases)

**Usage**: `docker compose -f docker-compose.yml -f docker-compose.hardening.yml up -d`

**Absolute Path**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.hardening.yml`

**Rationale**: Documented in GOTCHAS.md entries #9, #10, #11, #12

---

## Security Reports

### Security Findings Tracker

| Document | Content | Status |
|----------|---------|--------|
| `.dev/ai/security/SECURITY-FINDINGS.md` | Tracked security findings (SEC-001 through SEC-009) | 1 open, 8 mitigated |

**Absolute Path**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/.dev/ai/security/SECURITY-FINDINGS.md`

**Findings Summary**:
- **Open**: SEC-009 (Content Trust not enabled)
- **Mitigated**: SEC-001 (Docker socket), SEC-002 (root in databases), SEC-003 (env var secrets), SEC-004 (SSH keys in CI), SEC-005 (Traefik dashboard), SEC-006 (centralized logging), SEC-007 (read-only filesystems), SEC-008 (image scanning in CI)

---

### Docker Bench Security Results

| Report | Run Date | Location |
|--------|----------|----------|
| Latest docker-bench run | 2026-02-17 | `.dev/ai/security/docker-bench-2026-02-17-232636.log` |

**Absolute Path**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/.dev/ai/security/docker-bench-2026-02-17-232636.log`

**Note**: docker-bench-security runs are triggered manually via `scripts/security/run-docker-bench.sh` and logged with timestamps.

---

## Quick Reference: Key Security Artifacts by Control Type

### Network Isolation
- **Config**: `docker-compose.yml` (networks section)
- **ADR**: `docs/decisions/0002-four-network-topology.md`
- **Tests**: `tests/integration/test-module-lifecycle.bats` (network membership)

### Secrets Management
- **Config**: `docker-compose.yml` (secrets section)
- **Script**: `scripts/generate-secrets.sh`
- **ADR**: `docs/decisions/0003-file-based-secrets.md`, `docs/decisions/0202-sops-age-secrets-encryption.md`
- **Docs**: `docs/SECRETS-MANAGEMENT.md`

### Container Hardening
- **Config**: `docker-compose.hardening.yml`, `foundation/docker-compose.base.yml` (x-secured-service anchor)
- **ADR**: `docs/decisions/0201-security-anchors.md`, `docs/decisions/0200-non-root-containers.md`
- **Gotchas**: `docs/GOTCHAS.md` (entries #9-12)

### API Protection
- **Config**: `docker-compose.yml` (socket-proxy service)
- **ADR**: `docs/decisions/0004-docker-socket-proxy.md`

### Supply-Chain Security
- **Scripts**: `scripts/security/validate-supply-chain.sh`, `scripts/security/validate-image-policy.sh`, `scripts/security/generate-sbom.sh`
- **Docs**: `docs/SUPPLY-CHAIN-SECURITY.md`, `docs/ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md`, `docs/IMAGE-DIGEST-BASELINE.md`

### Deployment Security
- **Script**: `scripts/deploy.sh`
- **Docs**: `docs/DEPLOYMENT.md`, `docs/WEBHOOK-DEPLOYMENT.md`, `docs/DEPLOYMENT-PROMOTION-RUNBOOK.md`
- **ADR**: `docs/decisions/0301-deployment-scripts.md`

### Security Framework (Phase 1A)
- **Interfaces**: `foundation/interfaces/identity.py`, `encryption.py`, `contract.py` (+ TS versions)
- **Schemas**: `foundation/schemas/security.schema.json`, `contract-manifest.schema.json`, `security-event.schema.json`
- **Docs**: `foundation/docs/SECURITY-FRAMEWORK.md`

---

## Artifact Maintenance

### Last Updated
- Inventory: 2026-02-22 (WO-PMDL-2026-02-22-062)
- Security Architecture: 2026-02-21
- Security Findings: 2026-01-21
- ADRs: Ongoing (versioned individually)

### Review Cycle
- **Quarterly**: Threat model, security findings, audit readiness
- **Per Release**: Evidence inventory, supply-chain reports
- **Ad Hoc**: After significant architecture changes or security incidents

---

## Related Documentation

- **Threat Model**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/security/THREAT-MODEL.md`
- **Audit Readiness Checklist**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/security/AUDIT-READINESS-CHECKLIST.md`
- **OSS Audit Results**: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/security/OSS-AUDIT-RESULTS.md`

---

**Document Prepared**: 2026-02-22
**Audit Package**: Professional Security Firm Review (WO-PMDL-2026-02-22-062)
**Revision**: 1.0.0
