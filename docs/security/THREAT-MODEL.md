# Docker Lab Threat Model

**Version**: 1.0.0
**Date**: 2026-02-22
**Status**: Active
**Audit Preparation**: Professional Security Firm Review

---

## Executive Summary

This threat model documents the attack surfaces, trust boundaries, threat actors, attack vectors, and mitigations for the Peer Mesh Docker Lab platform. It follows STRIDE methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) and is designed to support professional security audit engagement.

**Deployment Context**: Self-hosted Docker Compose infrastructure on commodity VPS instances, serving as foundation for federated applications and personal cloud services.

**Security Posture**: Defense-in-depth with four-tier network isolation, file-based secrets management, container hardening (capability dropping, resource limits, non-root where possible), Docker socket proxy, pull-based webhook deployment, and supply-chain security gates.

---

## Table of Contents

1. [Trust Boundaries](#trust-boundaries)
2. [Attack Surfaces](#attack-surfaces)
3. [Threat Actors](#threat-actors)
4. [Threat Analysis (STRIDE)](#threat-analysis-stride)
5. [Mitigations](#mitigations)
6. [Known Limitations and Accepted Risks](#known-limitations-and-accepted-risks)
7. [Security Assumptions](#security-assumptions)

---

## Trust Boundaries

Trust boundaries define where security controls transition between different levels of trust.

### Boundary 1: Internet to VPS Host

**Trusted Side**: VPS host operating system
**Untrusted Side**: Public internet

**Controls at Boundary**:
- Host firewall (only ports 80, 443, 8448 exposed)
- Traefik reverse proxy (TLS termination, rate limiting)
- Let's Encrypt TLS certificates (HTTPS enforcement)

**Data Flow**: HTTP/HTTPS requests from external clients → Traefik

**Trust Assumption**: VPS provider secures host OS and hypervisor layer

---

### Boundary 2: Host to Container Runtime

**Trusted Side**: Docker daemon
**Untrusted Side**: Container processes

**Controls at Boundary**:
- Container namespace isolation (PID, NET, IPC, UTS, USER)
- Resource limits (memory, CPU via cgroups)
- Capability restrictions (`cap_drop: ALL`, selective `cap_add`)
- `no-new-privileges` security option
- AppArmor/SELinux profiles (host-dependent)
- Read-only root filesystems (where supported)

**Data Flow**: Container syscalls → Docker daemon → host kernel

**Trust Assumption**: Docker runtime correctly enforces namespace isolation

---

### Boundary 3: Proxy-External to App-Internal Networks

**Trusted Side**: Application containers
**Untrusted Side**: Internet-facing proxy containers

**Controls at Boundary**:
- Network segmentation (explicit network membership required)
- `internal: true` flag on app-internal (blocks internet egress)
- Traefik routing rules (only configured routes accessible)

**Data Flow**: Traefik → Application containers via Docker overlay network

**Trust Assumption**: Docker network driver correctly isolates network namespaces

---

### Boundary 4: App-Internal to DB-Internal Networks

**Trusted Side**: Database containers
**Untrusted Side**: Application containers

**Controls at Boundary**:
- Network segmentation (databases on separate `db-internal` network)
- `internal: true` flag (no internet egress from databases)
- No public ports exposed
- Database authentication (file-based secrets)

**Data Flow**: Application → Database via overlay network

**Trust Assumption**: Databases correctly enforce authentication

---

### Boundary 5: Host Docker Socket to Socket Proxy

**Trusted Side**: Docker daemon
**Untrusted Side**: Traefik (via socket proxy)

**Controls at Boundary**:
- Docker socket proxy (tecnativa/docker-socket-proxy)
- Read-only socket mount (`:ro`)
- Filtered API endpoints (only CONTAINERS, NETWORKS, INFO, VERSION)
- All write operations blocked (POST=0, EXEC=0)
- Isolated internal network

**Data Flow**: Traefik → Socket Proxy → Docker Socket (read-only)

**Trust Assumption**: Socket proxy correctly filters Docker API calls

---

### Boundary 6: CI/CD to Deployment

**Trusted Side**: VPS deployment environment
**Untrusted Side**: GitHub Actions / external CI

**Controls at Boundary**:
- Pull-based webhook deployment (no SSH keys in CI)
- HMAC-SHA256 webhook signature validation
- Read-only deploy key (cannot push to repo)
- Credentials stored only on VPS

**Data Flow**: GitHub → Webhook endpoint → Deploy script → Docker Compose

**Trust Assumption**: HMAC secret remains confidential on VPS

---

## Attack Surfaces

Attack surfaces are the entry points where adversaries can interact with the system.

### Surface 1: Traefik Reverse Proxy (External)

**Exposure**: Ports 80, 443, 8448 (public internet)

**Attack Vectors**:
- HTTP request smuggling
- TLS downgrade attacks
- Request flooding (DoS)
- Path traversal via routing rules
- Exploitation of Traefik vulnerabilities

**Mitigations**:
- TLS 1.2+ only (Traefik defaults)
- HTTP to HTTPS redirect enforced
- Rate limiting middleware (10 req/min avg, 20 burst)
- Security headers (HSTS, XSS protection, frame deny)
- Version pinning (Traefik v2.11)
- Regular image updates

**Residual Risk**: **MEDIUM**
- Traefik runs as root (required for ACME in v2; non-root deferred to v3 migration)
- Traefik has host network access (required for port binding)
- Zero-day vulnerabilities in Traefik possible

**Evidence**:
- Configuration: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.yml` (traefik service)
- Hardening: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.hardening.yml`
- ADR: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/0001-traefik-reverse-proxy.md`

---

### Surface 2: Dashboard Web UI

**Exposure**: HTTPS via Traefik (subdomain: `dashboard.DOMAIN`)

**Attack Vectors**:
- Credential brute-force attacks
- Session hijacking
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Authentication bypass

**Mitigations**:
- HTTP Basic Auth (Traefik middleware)
- Application-level session management
- Rate limiting (10 req/min avg, 20 burst)
- Security headers (XSS protection, content-type nosniff)
- Non-root container execution (user `65534:65534`)
- `cap_drop: ALL`, `no-new-privileges: true`
- Memory limit (64 MiB)

**Residual Risk**: **LOW**
- Basic Auth is not MFA
- Session management is application-implemented (not externally audited)

**Evidence**:
- Configuration: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.yml` (dashboard service)
- Documentation: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/DASHBOARD.md`

---

### Surface 3: Webhook Deployment Endpoint

**Exposure**: HTTPS via Traefik (path: `/webhook`)

**Attack Vectors**:
- HMAC signature bypass
- Replay attacks
- Malicious deployment triggers
- Code injection via webhook payload

**Mitigations**:
- HMAC-SHA256 signature validation (shared secret)
- HTTPS-only transport
- Deploy script sanitizes inputs
- Read-only deploy key (cannot push malicious code)
- Containerized webhook listener

**Residual Risk**: **LOW**
- HMAC secret compromise grants deploy trigger access (but not arbitrary code execution)
- Requires attacker to compromise webhook secret on VPS or in GitHub repo settings

**Evidence**:
- Configuration: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.yml` (webhook service, if deployed)
- Documentation: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/WEBHOOK-DEPLOYMENT.md`

---

### Surface 4: Docker Socket Proxy

**Exposure**: Internal network only (tcp://socket-proxy:2375)

**Attack Vectors**:
- API abuse (read container secrets, enumerate topology)
- Privilege escalation via socket access
- Information disclosure (container configs, network layout)

**Mitigations**:
- Read-only socket mount (`:ro`)
- Filtered endpoints (only CONTAINERS, NETWORKS, INFO, VERSION allowed)
- All write operations blocked (POST=0, EXEC=0, IMAGES=0, VOLUMES=0, etc.)
- Isolated `socket-proxy` network (internal: true)
- Only Traefik has network access

**Residual Risk**: **LOW**
- Attacker with Traefik container access can enumerate topology
- Cannot modify containers, exec into containers, or start new containers

**Evidence**:
- Configuration: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.yml` (socket-proxy service)
- ADR: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/0004-docker-socket-proxy.md`

---

### Surface 5: Database Services (PostgreSQL, MySQL, MongoDB)

**Exposure**: Internal networks only (`db-internal`, no public ports)

**Attack Vectors**:
- SQL injection (from compromised application)
- Credential stuffing (if secrets leaked)
- Data exfiltration via compromised app
- Privilege escalation within database

**Mitigations**:
- Network isolation (`db-internal` with `internal: true`)
- No internet egress
- File-based authentication secrets (not in environment variables)
- Secret file permissions (600, owner-only)
- Resource limits (1 GiB memory per database)
- Official images from trusted registries

**Residual Risk**: **MEDIUM**
- Databases start as root during initialization (entrypoint drops privileges after init)
- `cap_drop: ALL` not applied (breaks database initialization; see Gotcha #9)
- `read_only: true` requires wrapper+tmpfs maintenance (see Gotcha #10)
- Compromise of application grants database access (by design)

**Evidence**:
- Configuration: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docker-compose.yml` (postgres, mysql, mongodb services)
- Hardening rationale: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/GOTCHAS.md` (entries #9, #10)
- ADR: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/0200-non-root-containers.md`

---

### Surface 6: Module Interfaces (Security Framework - WO-079-1A)

**Exposure**: Internal only (module-to-module communication via Foundation interfaces)

**Attack Vectors**:
- Spoofing module identity
- Tampering with encryption keys
- Bypassing capability contracts
- Exploiting no-op fallback implementations

**Mitigations**:
- Identity interface (credential issuance, verification, rotation, revocation)
- Encryption interface (key provisioning, encrypted storage)
- Contract interface (capability evaluation, enforcement)
- Fail-closed enforcement mode (modules can require security providers)
- Security lifecycle hooks (provision, deprovision, rotate, lock)

**Residual Risk**: **LOW** (Phase 1A - interfaces only)
- No production implementations yet (Phase 2)
- No-op fallbacks allow insecure operation (by design for development)
- Modules must explicitly set `enforcementMode: "fail-closed"` to require security

**Evidence**:
- Interfaces: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/foundation/interfaces/` (identity.py, encryption.py, contract.py)
- Schemas: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/foundation/schemas/` (security.schema.json, contract-manifest.schema.json, security-event.schema.json)
- Documentation: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/foundation/docs/SECURITY-FRAMEWORK.md`

---

## Threat Actors

### Actor 1: External Attacker (Internet-Based)

**Motivation**: Data theft, ransomware, resource hijacking (crypto mining), botnet recruitment

**Capabilities**:
- Network scanning, automated exploitation tools
- Access to public exploit databases
- Social engineering (phishing for credentials)

**Access Level**: Public internet only (ports 80, 443, 8448)

**Relevant Surfaces**: Traefik, Dashboard, Webhook endpoint

**Threat Level**: **HIGH**

---

### Actor 2: Compromised Application Container

**Motivation**: Lateral movement, data exfiltration, persistence

**Capabilities**:
- Network access to same-network containers
- File system access within container
- Process execution within container

**Access Level**: Application networks (`proxy-external`, `app-internal`, potentially `db-internal`)

**Relevant Surfaces**: Database services, Docker socket proxy (if on proxy-external), other app containers

**Threat Level**: **MEDIUM**

---

### Actor 3: Malicious Module Developer

**Motivation**: Backdoor installation, data theft, supply-chain attack

**Capabilities**:
- Module manifest manipulation
- Malicious lifecycle hooks
- Exploiting trust in module ecosystem

**Access Level**: Same as legitimate module (depends on module's network/volume configuration)

**Relevant Surfaces**: Module interfaces, other modules via event bus

**Threat Level**: **MEDIUM** (future concern; no third-party modules yet)

---

### Actor 4: VPS Provider Insider

**Motivation**: Surveillance, data theft, compliance violation

**Capabilities**:
- Hypervisor access (can access all VPS memory/storage)
- Network interception
- Snapshot/backup access

**Access Level**: Full system access at hypervisor level

**Relevant Surfaces**: All (host OS, containers, secrets, data)

**Threat Level**: **LOW** (assumed trusted provider, but acknowledged risk)

---

## Threat Analysis (STRIDE)

### Spoofing Identity

| Threat | Attack Vector | Mitigated? | Mitigation |
|--------|--------------|-----------|------------|
| S1: Spoof Traefik routing | DNS spoofing, BGP hijacking | Partial | HTTPS/TLS, HSTS preload, certificate pinning not implemented |
| S2: Spoof module identity | Module manifest tampering, credential theft | No (Phase 1A) | Identity interface defined; implementations in Phase 2 |
| S3: Spoof webhook signature | HMAC secret theft from VPS | Yes | HMAC-SHA256 validation, secret only on VPS |

---

### Tampering with Data

| Threat | Attack Vector | Mitigated? | Mitigation |
|--------|--------------|-----------|------------|
| T1: Tamper with secrets on disk | Host filesystem access | Partial | File permissions 600/700, no disk encryption at rest (host-dependent) |
| T2: Tamper with container config | Docker API access | Yes | Socket proxy blocks POST/PUT/DELETE, read-only socket mount |
| T3: Tamper with database data | SQL injection, compromised app | Partial | Network isolation, input validation (app responsibility) |
| T4: Tamper with deployment artifacts | Git repo compromise | Yes | HMAC webhook validation, read-only deploy key |

---

### Repudiation

| Threat | Attack Vector | Mitigated? | Mitigation |
|--------|--------------|-----------|------------|
| R1: Deny malicious actions | Log tampering, log deletion | Partial | JSON logging, log rotation, no centralized/immutable logging |
| R2: Deny webhook deployment | Replay attack, log manipulation | Yes | Timestamped logs, HMAC signature (non-repudiable) |

---

### Information Disclosure

| Threat | Attack Vector | Mitigated? | Mitigation |
|--------|--------------|-----------|------------|
| I1: Leak secrets via environment | `docker inspect`, process listing | Yes | File-based secrets with `_FILE` suffix, not in environment |
| I2: Leak container topology | Socket proxy abuse | Partial | Read-only access, cannot see secrets, can enumerate containers/networks |
| I3: Leak database credentials | Memory dump, log files | Partial | File-based secrets, logs rotated, no memory encryption |
| I4: Leak TLS private keys | Container compromise | Yes | Traefik stores in volume (not in container image), 600 permissions |

---

### Denial of Service

| Threat | Attack Vector | Mitigated? | Mitigation |
|--------|--------------|-----------|------------|
| D1: Resource exhaustion (CPU) | Request flooding | Partial | Rate limiting (10 req/min avg), no CPU quota enforcement |
| D2: Resource exhaustion (memory) | Memory leak, allocation attack | Yes | Memory limits on all services (64M-1G depending on service) |
| D3: Disk exhaustion | Log flooding | Yes | Log rotation (10M max, 3 files), volume size limits (host-dependent) |
| D4: Network flooding | DDoS attack | Partial | Rate limiting, upstream provider DDoS protection (host-dependent) |

---

### Elevation of Privilege

| Threat | Attack Vector | Mitigated? | Mitigation |
|--------|--------------|-----------|------------|
| E1: Container escape to host | Kernel exploit, Docker vulnerability | Yes | `no-new-privileges:true`, `cap_drop: ALL`, AppArmor/SELinux (host-dependent) |
| E2: Privilege escalation within container | SUID binaries, capability abuse | Yes | `cap_drop: ALL`, non-root user (most services), `no-new-privileges:true` |
| E3: Docker socket privilege escalation | Socket proxy bypass | Yes | Socket proxy blocks all write operations, read-only mount |
| E4: Database privilege escalation | Credential theft, SQL injection | Partial | File-based secrets, network isolation, official images (assumed secure) |

---

## Mitigations

### Network Layer

| Mitigation | Implementation | Evidence |
|-----------|----------------|----------|
| Four-tier network isolation | `proxy-external`, `app-internal`, `db-internal`, `socket-proxy` | docker-compose.yml networks section |
| Internal networks block egress | `internal: true` flag on app-internal, db-internal, socket-proxy | ADR-0002 |
| No database public ports | Databases only on db-internal | docker-compose.yml (no ports exposed) |
| TLS everywhere (external) | Traefik Let's Encrypt, HTTP→HTTPS redirect | Traefik command config |

**File**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/0002-four-network-topology.md`

---

### Container Hardening

| Mitigation | Implementation | Evidence |
|-----------|----------------|----------|
| Capability dropping | `cap_drop: ALL` (except databases, Traefik) | docker-compose.hardening.yml |
| Privilege escalation prevention | `no-new-privileges: true` | Security anchor in docker-compose.base.yml |
| Non-root execution | `user: 65534:65534` (dashboard, redis, others) | docker-compose.yml service definitions |
| Resource limits | Memory limits (64M-1G), CPU reservations | deploy.resources section |
| Read-only filesystems | Applied to stateless services and databases via wrapper+tmpfs pattern | docker-compose.hardening.yml |

**File**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/0201-security-anchors.md`

---

### Secrets Management

| Mitigation | Implementation | Evidence |
|-----------|----------------|----------|
| File-based secrets | Docker Compose `secrets:` directive, mounted to `/run/secrets/` | docker-compose.yml |
| Never in environment | `_FILE` suffix pattern (e.g., `POSTGRES_PASSWORD_FILE`) | ADR-0003 |
| File permissions | 600 (owner read/write only) | scripts/generate-secrets.sh |
| Directory permissions | 700 (owner only) | scripts/generate-secrets.sh |
| Encrypted at rest (optional) | SOPS+age support | ADR-0202, docs/SECRETS-MANAGEMENT.md |

**File**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/0003-file-based-secrets.md`

---

### API Protection

| Mitigation | Implementation | Evidence |
|-----------|----------------|----------|
| Socket proxy filtering | tecnativa/docker-socket-proxy with read-only endpoints | docker-compose.yml socket-proxy service |
| Read-only socket mount | `/var/run/docker.sock:/var/run/docker.sock:ro` | ADR-0004 |
| Blocked write operations | `POST=0, EXEC=0, IMAGES=0, VOLUMES=0, BUILD=0, COMMIT=0` | Environment variables |
| Isolated network | `socket-proxy` network (internal: true) | docker-compose.yml networks |

**File**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/decisions/0004-docker-socket-proxy.md`

---

### Deployment Security

| Mitigation | Implementation | Evidence |
|-----------|----------------|----------|
| Pull-based deployment | Webhook triggers git pull (no SSH keys in CI) | docs/WEBHOOK-DEPLOYMENT.md |
| HMAC signature validation | SHA256 signature verification | Webhook listener code |
| Read-only deploy key | GitHub deploy key has read-only permissions | Deployment guide |
| Supply-chain gates | Image policy, SBOM, vulnerability threshold | scripts/security/validate-supply-chain.sh |
| Fail-closed deployment | Deploy fails if supply-chain gate fails | scripts/deploy.sh |

**File**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/SUPPLY-CHAIN-SECURITY.md`

---

### Supply-Chain Security

| Mitigation | Implementation | Evidence |
|-----------|----------------|----------|
| Image policy validation | Tag/digest contract enforcement | scripts/security/validate-image-policy.sh |
| SBOM generation | CycloneDX artifacts | scripts/security/generate-sbom.sh |
| Vulnerability scanning | Severity threshold gating (CRITICAL default) | scripts/security/validate-supply-chain.sh |
| Official images only | All base images from Docker Hub official repos | Image provenance documented |
| Version pinning | Explicit tags (no `latest` in production) | ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md |
| Digest pinning (external) | SHA256 digests for infrastructure images | IMAGE-DIGEST-BASELINE.md |

**File**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/SUPPLY-CHAIN-SECURITY.md`

---

## Known Limitations and Accepted Risks

### Limitation 1: Database Containers Run as Root During Init

**Description**: PostgreSQL, MySQL, MongoDB official images require root for initialization (chown data directories, create PID files), now wrapped for read_only mode.

**Impact**: Brief window of root execution during first startup.

**Mitigation**: Network isolation (no internet egress), official images (assumed secure), privilege drop after init.

**Accepted Risk**: **YES** (technical limitation of database entrypoints)

**Rationale**: Documented in Gotcha #9 and #10. Read-only hardening is now achieved with wrapper+tmpfs, but initialization root requirement remains an upstream image behavior.

**Evidence**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/GOTCHAS.md` (entries #9, #10)

---

### Limitation 2: Traefik Runs as Root (v2.11)

**Description**: Traefik v2 requires root for ACME certificate storage (`/acme/acme.json` owned by root).

**Impact**: Traefik compromise grants root-level container access.

**Mitigation**: `cap_drop: ALL` + `cap_add: NET_BIND_SERVICE`, hardening overlay, version pinning.

**Accepted Risk**: **YES** (deferred to v3 migration)

**Rationale**: Documented in Gotcha #11. Traefik v3 supports non-root, but requires migration effort. Current hardening (capability dropping) reduces attack surface.

**Evidence**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/GOTCHAS.md` (entry #11)

---

### Limitation 3: Socket Proxy Cannot Use read_only

**Description**: Socket proxy generates HAProxy config from template at startup; `read_only: true` blocks config write.

**Impact**: Socket proxy filesystem is writable.

**Mitigation**: `cap_drop: ALL`, `no-new-privileges: true`, isolated network, read-only Docker socket mount.

**Accepted Risk**: **YES** (technical limitation of socket proxy image)

**Rationale**: Documented in Gotcha #12. Alternative (custom image with pre-generated config) adds maintenance burden. Effective hardening via capabilities and network isolation.

**Evidence**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/GOTCHAS.md` (entry #12)

---

### Limitation 4: No Docker Content Trust (Image Signature Verification)

**Description**: Docker Content Trust (DCT) is not enabled; image signatures not verified.

**Impact**: Man-in-the-middle attack could serve malicious images.

**Mitigation**: Official images only, version/digest pinning, HTTPS registries.

**Accepted Risk**: **YES** (low priority for self-hosted lab)

**Rationale**: All images from trusted registries, explicit version/digest pinning prevents tag mutation. Planned for production hardening phase.

**Evidence**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/security/SECURITY-FINDINGS.md` (SEC-009)

---

### Limitation 5: No User Namespace Remapping

**Description**: Docker user namespace remapping is not enabled; container root UID 0 maps to host UID 0.

**Impact**: Container escape with root grants host root access.

**Mitigation**: `no-new-privileges`, `cap_drop: ALL`, AppArmor/SELinux profiles (host-dependent), non-root containers where possible.

**Accepted Risk**: **YES** (compatibility concerns)

**Rationale**: User namespace remapping requires testing all services for compatibility. Documented in WO-062 for future evaluation.

**Evidence**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/workorders/WO-PMDL-2026-02-22-062.md` (sovereign blueprint insight #3)

---

### Limitation 6: No Per-Service Seccomp Profiles

**Description**: Default Docker seccomp profile used (blocks ~44 of 300+ syscalls); custom profiles not implemented.

**Impact**: Services have broader syscall access than strictly necessary.

**Mitigation**: Default seccomp (blocks dangerous syscalls like keyctl, add_key, ptrace, etc.), `no-new-privileges`, capability dropping.

**Accepted Risk**: **YES** (deferred to future hardening)

**Rationale**: Requires analysis of each service's syscall usage. Documented in WO-062 for OSS audit evaluation.

**Evidence**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/workorders/WO-PMDL-2026-02-22-062.md` (sovereign blueprint insight #1)

---

### Limitation 7: No Centralized Logging / SIEM

**Description**: Logs stored locally per container with JSON-file driver; no aggregation or alerting.

**Impact**: Difficult to correlate security events, delayed incident detection, log loss on container removal.

**Mitigation**: Log rotation (10M, 3 files), access logs in JSON, manual review procedures documented.

**Accepted Risk**: **YES** (medium priority)

**Rationale**: Observability-full profile (Loki/Grafana) created but held for resource review. Documented in MEMORY.md.

**Evidence**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/security/SECURITY-FINDINGS.md` (SEC-006)

---

### Limitation 8: VPS Provider Trust Assumption

**Description**: System assumes VPS provider is trustworthy and secures hypervisor/host OS.

**Impact**: Malicious provider or provider breach grants full system access.

**Mitigation**: None (architectural assumption). Encrypted secrets at rest (SOPS+age) can mitigate secret theft.

**Accepted Risk**: **YES** (inherent to VPS deployment model)

**Rationale**: Self-hosted infrastructure requires trust in hosting provider. Bare-metal deployment eliminates this risk but adds operational burden.

**Evidence**: Deployment model documented in `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/DEPLOYMENT.md`

---

## Security Assumptions

The threat model makes the following security assumptions:

1. **Host OS Security**: VPS provider maintains secure host OS and hypervisor.
2. **Docker Runtime Security**: Docker daemon correctly enforces namespace isolation, cgroups, capabilities.
3. **Network Isolation**: Docker overlay network driver correctly isolates networks.
4. **Official Image Trust**: Official Docker Hub images are free of backdoors and maintained securely.
5. **TLS/PKI Trust**: Let's Encrypt CA is trustworthy; TLS certificate validation is reliable.
6. **Secret Confidentiality**: Secrets stored on VPS host filesystem remain confidential (file permissions, disk encryption if enabled).
7. **HMAC Secret Security**: Webhook HMAC secret stored on VPS is not compromised.
8. **DNS Security**: DNS records for domain are not hijacked (DNSSEC not required).
9. **GitHub Repository Security**: GitHub repository and webhook configuration are not compromised.
10. **Developer Trust**: Module developers and infrastructure operators are not malicious (until module verification/signing implemented).

**Threat Model Review**: Quarterly or upon significant architecture changes.

---

## Related Documentation

- **Security Architecture**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/SECURITY-ARCHITECTURE.md`
- **Security Checklist**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/SECURITY-CHECKLIST.md`
- **Security Findings**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/security/SECURITY-FINDINGS.md`
- **Evidence Inventory**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/security/EVIDENCE-INVENTORY.md`
- **Audit Readiness Checklist**: `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/sub-repos/docker-lab/docs/security/AUDIT-READINESS-CHECKLIST.md`

---

**Document Prepared**: 2026-02-22
**Audit Package**: Professional Security Firm Review (WO-PMDL-2026-02-22-062)
**Revision**: 1.0.0
