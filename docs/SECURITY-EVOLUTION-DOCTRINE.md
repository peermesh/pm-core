# Security Evolution Doctrine

Core's foundational philosophy for continuous security improvement.

**Version**: 1.0.0
**Created**: 2026-03-23
**Blueprint**: `B-ARCH-006` (`.dev/blueprints/architecture/security-evolution.md`)

---

## 1. Why Security Must Be Evolutionary

Core is not an application. It is the foundation that other applications run on. Every project built on Core inherits its security posture — its strengths and its weaknesses.

This creates a multiplier effect in both directions:

- **A fix in Core protects every consumer.** When we harden the foundation, every project built on it gets harder to attack.
- **A vulnerability in Core is a zero-day for every consumer.** If an attacker finds a weakness in the foundation, they can exploit it against every project that uses Core before anyone knows the weakness exists.

This is why static security is not enough.

### The Attack Surface Grows With Every Module

When Core ships with three foundation services (socket-proxy, traefik, dashboard), the attack surface is known and bounded. The moment a module is deployed on top — a CMS, a chat server, a database-backed API — new surfaces appear that did not exist when the foundation was designed:

- New network connections between containers
- New public endpoints exposed through Traefik
- New database access patterns
- New secret requirements
- New upstream images with their own vulnerability histories

The foundation cannot predict every module. It must instead provide mechanisms that detect, constrain, and learn from whatever modules bring.

### Attackers Evolve

Yesterday's best practice becomes tomorrow's known bypass. TLS 1.0 was once secure. SHA-1 was once trusted. Static security postures become obsolete at a rate determined by attacker innovation, not by our release schedule.

**The only sustainable defense is a system that learns faster than attackers can probe.** Every incident, every near-miss, every operational surprise must make the system permanently stronger.

---

## 2. The Learning Loop

Every security event feeds back into the system through a concrete, documented cycle. This is not aspirational — each step maps to a real file or script in the repository.

```
Incident / Discovery
    |
    v
Document in GOTCHAS.md or .dev/ai/findings/
    |
    v
Create automated check (add to run-full-audit.sh)
    |
    v
Update module template (so new modules inherit the fix)
    |
    v
Update module authoring guide (so authors understand why)
    |
    v
Update SECURITY-ARCHITECTURE.md (so the posture reflects reality)
    |
    v
System is now immune to that class of problem
```

Every time we learn something, it becomes four things:

1. **A finding** — documented in `docs/GOTCHAS.md` or `.dev/ai/findings/` so the knowledge is preserved.
2. **A check** — automated in `scripts/security/run-full-audit.sh` so the system can detect it without human memory.
3. **A default** — baked into module templates (`foundation/templates/`) so new modules start hardened.
4. **A guide** — taught in `docs/module-authoring-guide.md` so module authors understand the reasoning.

### Concrete Example: Socket Proxy read_only

We discovered that setting `read_only: true` on `tecnativa/docker-socket-proxy` causes a restart loop because the entrypoint generates `haproxy.cfg` from a template in the same directory. Mounting tmpfs wipes the template.

This became:
- **Finding**: Gotcha #12 in `docs/GOTCHAS.md`
- **Check**: `run-full-audit.sh` verifies socket-proxy is not configured with `read_only`
- **Default**: Hardening overlay (`docker-compose.hardening.yml`) documents the exception
- **Guide**: Module authoring guide warns against blanket `read_only` without verifying entrypoint behavior

The system can never make this mistake again.

---

## 3. Defense Layers and What Each Protects

Security works in layers. No single layer is sufficient. Each layer assumes the layers above it have been breached.

### Layer 1: Network Perimeter

**Implementation**: UFW firewall (host), Traefik as single ingress, four-network isolation
**Key files**: `docker-compose.yml` (network definitions), `docs/SECURITY-ARCHITECTURE.md`

| Control | What it prevents |
|---------|------------------|
| UFW firewall allowing only ports 80, 443, 8448 | Direct access to internal services |
| Traefik as sole public ingress | Uncontrolled entry points |
| `proxy-external` network (internet-facing) | Only Traefik-proxied traffic reaches apps |
| `app-internal` network (`internal: true`) | Application containers cannot reach the internet |
| `db-internal` network (`internal: true`) | Database containers are invisible outside their zone |
| `socket-proxy` network (`internal: true`) | Docker API is unreachable from app containers |

**What it prevents collectively**: Unauthorized access, lateral movement between zones, database exposure to the internet, direct Docker API exploitation.

### Layer 2: Container Hardening

**Implementation**: YAML anchors (`x-secured-service`), per-service resource limits
**Key files**: `docker-compose.yml`, `docker-compose.hardening.yml`

| Control | What it prevents |
|---------|------------------|
| `cap_drop: ALL` on every container | Containers cannot use any Linux capabilities they do not explicitly need |
| `no-new-privileges: true` on every container | Processes inside containers cannot escalate privileges via setuid/setgid |
| `read_only` filesystems where supported | Attackers who gain code execution cannot write to the filesystem |
| Memory limits (`deploy.resources.limits.memory`) | A compromised or buggy container cannot consume all host memory (DoS) |
| CPU limits (`deploy.resources.limits.cpus`) | A compromised container cannot starve other services of CPU |
| Non-root execution where possible | Container escape from a non-root process is significantly harder |

**What it prevents collectively**: Container escape, privilege escalation, resource exhaustion attacks (DoS), filesystem-based persistence.

### Layer 3: Secrets Management

**Implementation**: File-based secrets via Docker Compose `secrets:` directive, SOPS+age encryption at rest
**Key files**: `docs/SECRETS-MANAGEMENT.md`, `docs/SECRETS-PER-APP.md`, `scripts/generate-secrets.sh`

| Control | What it prevents |
|---------|------------------|
| File-based secrets (never environment variables) | Secrets do not appear in `docker inspect`, process listings, or crash dumps |
| `chmod 0600` on host secret files | Other users on the host cannot read secrets |
| Mounted as `/run/secrets/<key>` (read-only) | Containers access secrets through a controlled, read-only path |
| SOPS+age encryption at rest | Secrets in git are encrypted; a repo leak does not expose credentials |
| Keyset parity validation (`scripts/validate-secret-parity.sh`) | Detects drift between documented secrets, generated secrets, and compose declarations |
| No secrets in git (`.gitignore` enforcement) | Plaintext secrets never enter version control |

**What it prevents collectively**: Credential leakage via logs/inspect/environment, unauthorized access from compromised host accounts, secret exposure from repository compromise.

### Layer 4: Supply Chain

**Implementation**: Three-gate validation pipeline
**Key files**: `scripts/security/validate-supply-chain.sh`, `scripts/security/validate-image-policy.sh`, `scripts/security/generate-sbom.sh`, `docs/SUPPLY-CHAIN-SECURITY.md`, `docs/IMAGE-DIGEST-BASELINE.md`

| Control | What it prevents |
|---------|------------------|
| SHA256 digest pinning on all images | A compromised Docker Hub account cannot push a malicious image under the same tag |
| Trivy/Docker Scout scanning for known CVEs | Images with known vulnerabilities are detected before deployment |
| CycloneDX SBOM generation | Complete inventory of every component in every image — nothing hides |
| Image policy enforcement (`validate-image-policy.sh`) | `:latest` tags and unversioned images are rejected |
| Stale digest detection (`scripts/check-stale-digests.sh`) | Outdated pins are detected when upstream publishes security fixes |

**What it prevents collectively**: Supply chain attacks (compromised upstream images), deployment of known-vulnerable software, unknown transitive dependencies.

### Layer 5: Application Security

**Implementation**: Traefik middleware, module-level enforcement
**Key files**: `docs/SECURITY-ARCHITECTURE.md` (security headers section), `docs/SECURITY-CHECKLIST.md`

| Control | What it prevents |
|---------|------------------|
| Parameterized queries (required for all DB-touching modules) | SQL injection |
| Input validation (required for all user-facing endpoints) | Command injection, XSS |
| Auth on all endpoints (Traefik middleware + per-app sessions) | Unauthorized access |
| Rate limiting (Traefik `ratelimit` middleware) | Brute force, credential stuffing, DoS |
| HSTS (`max-age=31536000; includeSubdomains; preload`) | Protocol downgrade attacks |
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing attacks |
| `Content-Security-Policy` | Cross-site scripting, data injection |

**What it prevents collectively**: OWASP Top 10 web application attacks.

### Layer 6: Module Isolation

**Implementation**: Module system with security schema, connection resolver, network policy declarations
**Key files**: `foundation/schemas/security.schema.json`, `foundation/schemas/security-event.schema.json`, `foundation/docs/SECURITY-FRAMEWORK.md`, `docs/MODULE-ARCHITECTURE.md`

| Control | What it prevents |
|---------|------------------|
| `networkPolicy` in `module.json` | Modules declare required networks; undeclared access is denied |
| Connection resolver validates dependencies before startup | Missing or unauthorized dependencies are caught before they cause runtime failures |
| Security schema in `module.json` (identity, encryption, contracts) | Modules declare what security services they need; the foundation can audit compliance |
| Modules extend hardened base (`x-secured-service` anchor) | New modules inherit `cap_drop`, `no-new-privileges`, resource limits automatically |
| No-op fallback with warning logging | Modules work without security providers but log warnings; fail-closed is opt-in |

**What it prevents collectively**: Module-to-module attacks, unauthorized cross-network access, configuration drift, silent security degradation.

### Layer 7: Monitoring and Response

**Implementation**: Health checks, log aggregation, metrics, backup automation
**Key files**: `docs/OBSERVABILITY-PROFILES.md`, `docs/BACKUP-RESTORE.md`, `profiles/observability-lite/`, `profiles/observability-full/`

| Control | What it prevents |
|---------|------------------|
| Container health checks on all services | Undetected service failure |
| Log aggregation (Loki, `profiles/observability-full/`) | Logs scattered across containers with no central analysis |
| Metrics (Prometheus + Grafana, `profiles/observability-full/`) | Slow degradation, resource trends, anomaly detection |
| Uptime monitoring (Uptime Kuma, `profiles/observability-lite/`) | Undetected downtime |
| Backup automation (restic, tested restore, `docs/BACKUP-RESTORE.md`) | Data loss from compromise, corruption, or operational error |
| JSON structured logging with rotation (`max-size: 10m`, `max-file: 3`) | Disk exhaustion from unbounded logs |

**What it prevents collectively**: Undetected compromise, data loss, service degradation without alerting.

---

## 4. The Feedback Mechanisms

### 4a. Automated Feedback (runs on schedule or at deploy time)

These tools run without human intervention and produce machine-readable results.

| Tool | Path | What it checks |
|------|------|----------------|
| `run-full-audit.sh` | `scripts/security/run-full-audit.sh` | Comprehensive security scan across all layers (local + remote modes) |
| `check-stale-digests.sh` | `scripts/check-stale-digests.sh` | Detects image pins older than their upstream latest |
| `validate-supply-chain.sh` | `scripts/security/validate-supply-chain.sh` | Image policy + SBOM + vulnerability threshold gate |
| `audit-ownership.sh` | `scripts/security/audit-ownership.sh` | Container file ownership and permission verification |
| `validate-image-policy.sh` | `scripts/security/validate-image-policy.sh` | Tag/digest contract enforcement |
| `generate-sbom.sh` | `scripts/security/generate-sbom.sh` | CycloneDX SBOM generation for all images |
| `run-docker-bench.sh` | `scripts/security/run-docker-bench.sh` | CIS Docker Benchmark compliance |
| Container healthchecks | Per-service in `docker-compose.yml` | Process-level liveness |

### 4b. Human Feedback (incident-driven)

These artifacts are created by humans (developers, operators, reviewers) when they encounter something the automated tools did not catch.

| Artifact | Path | What it captures |
|----------|------|------------------|
| GOTCHAS.md | `docs/GOTCHAS.md` | Operational pitfalls discovered through hands-on experience |
| Findings registry | `.dev/ai/findings/` | Security and architectural findings with FIND-* identifiers and status tracking |
| External reviewer methodology | `.dev/ai/findings/2026-03-21-external-reviewer-security-methodology.md` | Professional security testing patterns from third-party reviewers (Matsuri/Signus) |
| Security checklist | `docs/SECURITY-CHECKLIST.md` | CIS + OWASP control-by-control compliance status |
| Module author friction reports | Work orders referencing module deployment issues | Real-world gaps discovered when someone tries to build on Core |

### 4c. Structural Feedback (design-driven)

These governance mechanisms ensure that design decisions are preserved and that changes are tracked.

| Mechanism | Path | What it governs |
|-----------|------|-----------------|
| ADRs | `docs/decisions/` | Architectural decisions with alternatives considered and rationale |
| Blueprints | `.dev/blueprints/` | Locked governance contracts — changes require change orders |
| Change orders | `.dev/change-orders/` | Controlled modifications to locked blueprints |
| Module authoring guide | `docs/module-authoring-guide.md` | Teaching material that evolves as we learn what module authors need |
| Security architecture | `docs/SECURITY-ARCHITECTURE.md` | Canonical security posture document |

---

## 5. What Happens When a Vulnerability Is Found

This section provides step-by-step response procedures. A new contributor who discovers a security issue should be able to follow these instructions without asking anyone for guidance.

### 5a. Vulnerability in Core Foundation

1. **Assess severity** using standard ratings:
   - **CRITICAL**: Remote code execution, authentication bypass, data exfiltration without credentials
   - **HIGH**: Privilege escalation, information disclosure of secrets, denial of service
   - **MEDIUM**: Configuration weakness, missing hardening control, partial information disclosure
   - **LOW**: Minor hardening improvement, informational finding

2. **If CRITICAL**: Remediate immediately. Target deployment within hours, not days.

3. **Document the finding**:
   - Create entry in `.dev/ai/findings/` with `SEC-*` or `FIND-*` identifier
   - Add to `docs/GOTCHAS.md` if it is an operational pitfall
   - Update `.dev/ai/findings/FINDINGS_INDEX.md` with status

4. **Add automated detection**:
   - Add a check to `scripts/security/run-full-audit.sh` that would catch this class of issue
   - The audit script must exit non-zero if this condition is detected in the future

5. **Update the security posture**:
   - Update `docs/SECURITY-ARCHITECTURE.md` if the finding changes the documented posture
   - Update `docs/SECURITY-CHECKLIST.md` if a CIS/OWASP control status changed

6. **Notify consumers**:
   - All downstream deployment repos that track Core as an upstream remote receive the fix via `git fetch upstream && git merge upstream/main`
   - If the fix requires manual action (secret rotation, config change), document it in the commit message and in GOTCHAS.md

### 5b. Vulnerability in a Module

1. Module author files a finding or reports the issue.
2. Core maintainers assess: **Is this a foundation gap or a module-specific issue?**
   - **Foundation gap** (e.g., missing network isolation, template missing a hardening default): Core creates a work order and fixes the foundation.
   - **Module-specific** (e.g., application SQL injection, missing input validation): Guidance provided to the module author; module author fixes.
3. **If the pattern could affect other modules**: Add a check to `run-full-audit.sh` and update `docs/module-authoring-guide.md` with prevention guidance.

### 5c. Vulnerability in an Upstream Image

1. `scripts/security/validate-supply-chain.sh` or `scripts/check-stale-digests.sh` detects the CVE.
2. Check if upstream has released a patched image:
   - **If yes**: Update the digest pin in `docs/IMAGE-DIGEST-BASELINE.md`, deploy, verify.
   - **If no**: Document as accepted risk in a finding. Record the CVE, the affected image, and the mitigation (network isolation, disabled feature, etc.). Monitor upstream.
3. `check-stale-digests.sh` runs periodically and will detect when a fix becomes available.

---

## 6. Module Monitoring Requirements

Every module added to Core exposes new attack surfaces. The foundation monitors the following categories for every module, regardless of what the module does.

### Resource Exhaustion

A compromised or buggy module must not be able to take down the host or other services.

| Control | Implementation | Verification |
|---------|----------------|--------------|
| Memory limits | `deploy.resources.limits.memory` in compose | `run-full-audit.sh` checks every service has a memory limit |
| CPU limits | `deploy.resources.limits.cpus` in compose | `run-full-audit.sh` checks every service has a CPU limit |
| Disk usage | Prometheus/Grafana monitoring | Alerting threshold on volume utilization |
| Connection pooling | Per-module database configuration | Module rubric (`docs/MODULE-RUBRIC.md`) requires connection pool documentation |
| Log rotation | `x-logging` YAML anchor (`max-size: 10m`, `max-file: 3`) | `run-full-audit.sh` verifies logging config |

### Network Activity

A module must only communicate on networks it has declared.

| Control | Implementation | Verification |
|---------|----------------|--------------|
| Declared network membership | `networks:` in compose + `networkPolicy` in `module.json` | Connection resolver validates before startup |
| No unauthorized outbound | `internal: true` blocks internet on app-internal and db-internal | `run-full-audit.sh` verifies network flags |
| Rate limiting on public endpoints | Traefik `ratelimit` middleware | Module rubric requires rate limiting declaration |

### Authentication Surface

Every endpoint a module exposes must be protected.

| Control | Implementation | Verification |
|---------|----------------|--------------|
| Auth middleware on all non-public routes | Traefik labels or application-level auth | Module rubric requires auth declaration |
| Session management | HttpOnly, Secure, SameSite cookies | External reviewer testing (MitM/proxy methodology) |
| Brute force protection | Rate limiting + Traefik middleware | `run-full-audit.sh` checks rate limit labels |

### Data Security

Module data must be protected at rest and in transit.

| Control | Implementation | Verification |
|---------|----------------|--------------|
| Database access restricted to `db-internal` | Compose network membership | `run-full-audit.sh` verifies DB containers are only on db-internal |
| Secrets via `/run/secrets/` (read-only) | Docker Compose secrets directive | `audit-ownership.sh` verifies mount permissions |
| No secrets in environment variables | `_FILE` suffix pattern | `run-full-audit.sh` scans for common secret variable names in `environment:` |
| Backup encryption | restic with optional age | `docs/BACKUP-RESTORE.md` documents encryption requirements |

---

## 7. Evolution Triggers

The system improves when any of these events occur. Each trigger follows the learning loop (Section 2).

| Trigger | Example | Learning Loop Output |
|---------|---------|---------------------|
| New module deployed | Social module added | New attack surfaces audited, module rubric applied, network policy verified |
| Vulnerability discovered | CVE in upstream Traefik image | Digest updated, check added to `check-stale-digests.sh`, finding documented |
| Operational incident | Accidentally locked ourselves out by setting a restrictive variable | Gotcha added to `GOTCHAS.md`, audit check prevents recurrence |
| Security tool improves | New Trivy feature for secret scanning | Integrated into `validate-supply-chain.sh`, documented in audit script |
| External reviewer provides methodology | Matsuri shares MitM/sqlmap testing patterns | Documented in findings, testing toolkit expanded, module authoring guide updated |
| Consumer reports friction | Module author cannot figure out secret mounting | Module authoring guide improved, template updated |
| Upstream image updates | PostgreSQL releases security patch | Digest pin updated via `check-stale-digests.sh` detection |

Each trigger produces the same outputs: **document, automate, template, guide.**

---

## 8. What We Will NOT Do

These are deliberate constraints. They are as important as what we do.

**We will NOT pursue "perfect security."** Perfect security does not exist. Any claim of it is either dishonest or delusional. We pursue continuous improvement toward a moving target.

**We will NOT add security theater.** Every check must prevent a real attack or detect a real misconfiguration. A check that produces green output but does not catch anything is noise. If a check cannot explain what attack it prevents, it does not belong in the system.

**We will NOT sacrifice usability by default.** The base configuration must be usable by a new contributor without security expertise. Hardened configurations are provided as overlays (`docker-compose.hardening.yml`) and opt-in enforcement modes (`enforcementMode: "fail-closed"` in `module.json`). Security that nobody uses because it is too hard is security that does not exist.

**We will NOT assume modules are trustworthy.** Every module runs inside Core's constraints: network isolation, capability drops, resource limits, secret scoping. A module cannot opt out of foundation-level security controls. It can only declare additional requirements through `module.json`.

**We will NOT stop evolving.** The moment we think the security posture is "done," we are vulnerable. The learning loop has no terminal state. Every new module, every new CVE, every new attack technique is an input to the loop.

---

## 9. Measuring Progress

### Metrics That Matter

These metrics indicate whether the security posture is actually improving.

| Metric | Target | Where to measure |
|--------|--------|------------------|
| Time from CVE disclosure to remediation | Less than 24 hours for CRITICAL | Finding timestamps in `.dev/ai/findings/` |
| Automated checks in `run-full-audit.sh` | Monotonically increasing | `wc -l` on check functions in the audit script |
| GOTCHAS.md entries | Each entry = a learned lesson | Entry count in `docs/GOTCHAS.md` |
| Module template security defaults | Should increase over time | Default `security:` section in `foundation/templates/` |
| Audit score trend | Should improve or hold, never regress | Historical audit reports in `reports/supply-chain/` |
| Findings with `IMPLEMENTED` status | Should grow as issues are resolved | `.dev/ai/findings/FINDINGS_INDEX.md` |

### Metrics That Do NOT Matter

These metrics look impressive but do not indicate actual security improvement.

| Metric | Why it does not matter |
|--------|----------------------|
| Total line count of security documentation | More docs does not mean more secure |
| Number of security tools installed | Tools without process integration are noise |
| CVE count in upstream images | Upstream CVEs are outside our control; what matters is our response time |
| Percentage of "green" in checklists | A checklist with all green boxes and no real testing is theater |

---

## 10. Key File Reference

Every abstract concept in this doctrine maps to a concrete file. This is the complete reference.

### Security Documentation

| Document | Path |
|----------|------|
| Security Architecture (canonical) | `docs/SECURITY-ARCHITECTURE.md` |
| Supply Chain Security | `docs/SUPPLY-CHAIN-SECURITY.md` |
| Security Checklist (CIS + OWASP) | `docs/SECURITY-CHECKLIST.md` |
| Security Overview | `docs/SECURITY.md` |
| Secrets Management | `docs/SECRETS-MANAGEMENT.md` |
| Secrets Per App | `docs/SECRETS-PER-APP.md` |
| Image Digest Baseline | `docs/IMAGE-DIGEST-BASELINE.md` |
| Operational Gotchas | `docs/GOTCHAS.md` |
| Module Authoring Guide | `docs/module-authoring-guide.md` |
| Module Rubric | `docs/MODULE-RUBRIC.md` |
| Backup and Restore | `docs/BACKUP-RESTORE.md` |

### Security Scripts

| Script | Path |
|--------|------|
| Full security audit | `scripts/security/run-full-audit.sh` |
| Supply chain validation | `scripts/security/validate-supply-chain.sh` |
| Image policy enforcement | `scripts/security/validate-image-policy.sh` |
| SBOM generation | `scripts/security/generate-sbom.sh` |
| Ownership audit | `scripts/security/audit-ownership.sh` |
| CIS Docker Benchmark | `scripts/security/run-docker-bench.sh` |
| SQL injection scanning | `scripts/security/run-sqlmap-scan.sh` |
| Stale digest detection | `scripts/check-stale-digests.sh` |
| Secret generation | `scripts/generate-secrets.sh` |

### Security Framework (Module-Level)

| Component | Path |
|-----------|------|
| Security schema | `foundation/schemas/security.schema.json` |
| Security event schema | `foundation/schemas/security-event.schema.json` |
| Framework documentation | `foundation/docs/SECURITY-FRAMEWORK.md` |
| Identity interface | `foundation/interfaces/identity.{ts,py}` |
| Encryption interface | `foundation/interfaces/encryption.{ts,py}` |
| Contract interface | `foundation/interfaces/contract.{ts,py}` |

### Governance

| Artifact | Path |
|----------|------|
| Security Architecture blueprint | `.dev/blueprints/architecture/security-architecture.md` (B-ARCH-004) |
| Security Framework blueprint | `.dev/blueprints/architecture/security-framework.md` (B-ARCH-005) |
| Security Evolution blueprint | `.dev/blueprints/architecture/security-evolution.md` (B-ARCH-006) |
| Findings registry | `.dev/ai/findings/FINDINGS_INDEX.md` |
| External reviewer methodology | `.dev/ai/findings/2026-03-21-external-reviewer-security-methodology.md` |

---

*This doctrine is a living document. It evolves as Core evolves. Every security incident, every module deployment, every external review makes it more complete. There is no version of this document that is "final" — only the current version, which is better than the last.*
