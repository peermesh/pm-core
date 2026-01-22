# Security Findings Tracker

Track security issues, vulnerabilities, and their remediation status.

**Version**: 1.0.0
**Last Updated**: 2026-01-21
**Next Review**: 2026-02-21

---

## Summary

| Severity | Open | Mitigated | Closed | Total |
|----------|------|-----------|--------|-------|
| Critical | 0 | 0 | 0 | 0 |
| High | 0 | 2 | 0 | 2 |
| Medium | 0 | 3 | 0 | 3 |
| Low | 1 | 1 | 0 | 2 |
| Info | 0 | 2 | 0 | 2 |
| **Total** | **1** | **8** | **0** | **9** |

---

## Severity Definitions

| Severity | Definition | Response Time |
|----------|------------|---------------|
| Critical | Active exploitation possible, immediate risk | < 24 hours |
| High | Significant vulnerability, exploitation likely | < 7 days |
| Medium | Vulnerability with limited exploitation | < 30 days |
| Low | Minor vulnerability or hardening opportunity | < 90 days |
| Info | Informational, no direct security impact | As resources allow |

---

## Open Findings

### SEC-009: Content Trust Not Enabled

| Field | Value |
|-------|-------|
| **ID** | SEC-009 |
| **Severity** | Low |
| **Status** | Open |
| **Discovered** | 2026-01-21 |
| **Source** | docker-bench-security |
| **CIS Control** | 4.5 |

**Description**:
Docker Content Trust (DCT) is not enabled. This means image signatures are not verified when pulling images.

**Impact**:
Without DCT, there's no cryptographic verification that images come from trusted publishers. A man-in-the-middle attack could potentially serve malicious images.

**Affected Components**:
- All container images

**Recommendation**:
Enable Docker Content Trust:
```bash
export DOCKER_CONTENT_TRUST=1
```

**Risk Assessment**:
- Low priority for self-hosted lab environment
- All images are pulled from official Docker Hub repositories
- Images are pinned to specific versions
- Higher priority for production deployments

**Target Remediation**: Phase 4 Production Hardening

---

## Mitigated Findings

### SEC-001: Docker Socket Exposure

| Field | Value |
|-------|-------|
| **ID** | SEC-001 |
| **Severity** | High |
| **Status** | Mitigated |
| **Discovered** | 2026-01-01 |
| **Mitigated** | 2026-01-02 |
| **Source** | Architecture Review |
| **CIS Control** | 5.31 |

**Description**:
Traefik requires Docker API access for service discovery. Direct socket mounting grants full Docker control.

**Impact**:
If Traefik is compromised, attacker gains complete Docker host control including:
- Creating privileged containers
- Accessing host filesystem
- Starting/stopping any container

**Mitigation Implemented**:
Docker socket proxy (tecnativa/docker-socket-proxy) with:
- Read-only socket mount (`:ro`)
- Filtered API access (only CONTAINERS, NETWORKS, INFO, VERSION)
- All write operations blocked (POST=0, EXEC=0)
- Isolated internal network

**Residual Risk**: Low
- Attacker could read container information
- Cannot modify, create, or delete containers
- Cannot exec into containers

**ADR**: [ADR-0004: Docker Socket Proxy](../../docs/decisions/0004-docker-socket-proxy.md)

---

### SEC-002: Root User in Database Containers

| Field | Value |
|-------|-------|
| **ID** | SEC-002 |
| **Severity** | Medium |
| **Status** | Mitigated |
| **Discovered** | 2026-01-01 |
| **Mitigated** | 2026-01-02 |
| **Source** | docker-bench-security |
| **CIS Control** | 4.1 |

**Description**:
PostgreSQL, MySQL, and MongoDB containers start as root user for initialization.

**Impact**:
If container is compromised before privilege drop, attacker has root access within container namespace.

**Mitigation Implemented**:
- Official images drop privileges after initialization
- Containers run on isolated internal network (`db-internal`)
- Network has `internal: true` - no internet access
- No external ports exposed
- Resource limits applied

**Residual Risk**: Low
- Root only during brief initialization
- Network isolation limits lateral movement
- File-based secrets prevent credential extraction

**ADR**: [ADR-0200: Non-Root Containers](../../docs/decisions/0200-non-root-containers.md)

---

### SEC-003: Environment Variable Secrets (Legacy)

| Field | Value |
|-------|-------|
| **ID** | SEC-003 |
| **Severity** | High |
| **Status** | Mitigated |
| **Discovered** | 2026-01-01 |
| **Mitigated** | 2026-01-02 |
| **Source** | Architecture Review |

**Description**:
Initial design used environment variables for database passwords.

**Impact**:
Secrets visible in:
- `docker inspect` output
- `/proc/[pid]/environ`
- Process listings
- Log files

**Mitigation Implemented**:
File-based secrets with:
- `_FILE` suffix environment variables
- Secrets mounted to `/run/secrets/`
- File permissions 600
- Directory permissions 700

**Residual Risk**: Minimal
- Secrets not visible in docker inspect
- Not in process listings
- Not in logs

**ADR**: [ADR-0003: File-Based Secrets](../../docs/decisions/0003-file-based-secrets.md)

---

### SEC-004: SSH Keys in CI/CD

| Field | Value |
|-------|-------|
| **ID** | SEC-004 |
| **Severity** | Medium |
| **Status** | Mitigated |
| **Discovered** | 2026-01-01 |
| **Mitigated** | 2026-01-05 |
| **Source** | Architecture Review |

**Description**:
Traditional CI/CD stores SSH keys in GitHub Secrets for push-based deployment.

**Impact**:
If GitHub is compromised, attacker gains direct server access via stored SSH keys.

**Mitigation Implemented**:
Pull-based webhook deployment:
- Credentials only on VPS
- GitHub can only trigger deployments
- Deploy key is read-only
- HMAC signature validation

**Residual Risk**: Low
- Attacker can only trigger deploy of existing code
- Cannot SSH to server
- Cannot modify code

**Documentation**: [WEBHOOK-DEPLOYMENT.md](../../docs/WEBHOOK-DEPLOYMENT.md)

---

### SEC-005: Traefik Dashboard Exposure

| Field | Value |
|-------|-------|
| **ID** | SEC-005 |
| **Severity** | Medium |
| **Status** | Mitigated |
| **Discovered** | 2026-01-10 |
| **Mitigated** | 2026-01-10 |
| **Source** | Configuration Review |

**Description**:
Traefik dashboard could expose infrastructure information if publicly accessible.

**Impact**:
Attackers could:
- View all routing rules
- Identify service endpoints
- Discover internal network topology

**Mitigation Implemented**:
- Dashboard bound to localhost only (`127.0.0.1:8080`)
- Remote access requires SSH tunnel
- Basic auth required if remote route enabled
- Rate limiting middleware

**Residual Risk**: Low
- Requires SSH access to view
- Auth required for remote access

---

### SEC-006: No Centralized Logging

| Field | Value |
|-------|-------|
| **ID** | SEC-006 |
| **Severity** | Low |
| **Status** | Mitigated |
| **Discovered** | 2026-01-15 |
| **Mitigated** | 2026-01-15 |
| **Source** | Operations Review |

**Description**:
Logs are stored locally per container with json-file driver.

**Impact**:
- Difficult to correlate events across services
- Log loss if container is removed
- No alerting capability

**Mitigation Implemented**:
- Log rotation configured (10MB, 3 files)
- Access logs in JSON format
- Docker Compose logs aggregation
- Monitoring profile planned

**Residual Risk**: Medium
- Manual log review required
- No real-time alerting
- Consider Loki/Promtail for production

---

### SEC-007: Read-Only Filesystem Not Universal

| Field | Value |
|-------|-------|
| **ID** | SEC-007 |
| **Severity** | Info |
| **Status** | Mitigated |
| **Discovered** | 2026-01-20 |
| **Mitigated** | 2026-01-20 |
| **Source** | docker-bench-security |
| **CIS Control** | 5.12 |

**Description**:
Not all containers have read-only root filesystems.

**Impact**:
Compromised containers could write malicious files to filesystem.

**Mitigation Implemented**:
- Traefik supports `read_only: true`
- Database containers require writable for operation
- Volumes are used for persistent data
- `no-new-privileges` prevents escalation

**Residual Risk**: Low
- Container breakout still required for host access
- Resource limits prevent disk exhaustion

---

### SEC-008: No Image Vulnerability Scanning in CI

| Field | Value |
|-------|-------|
| **ID** | SEC-008 |
| **Severity** | Info |
| **Status** | Mitigated |
| **Discovered** | 2026-01-21 |
| **Mitigated** | 2026-01-21 |
| **Source** | Process Review |

**Description**:
Image vulnerability scanning is manual, not integrated into CI/CD.

**Impact**:
Vulnerable images could be deployed without detection.

**Mitigation Implemented**:
- Manual scanning with Trivy/Docker Scout documented
- Official images from trusted sources
- Version pinning reduces drift
- Pre-deployment checklist includes scanning

**Residual Risk**: Medium
- Relies on manual process
- Consider automated scanning for production

---

## Closed Findings

*No findings have been fully closed yet.*

---

## Finding Template

```markdown
### SEC-XXX: Title

| Field | Value |
|-------|-------|
| **ID** | SEC-XXX |
| **Severity** | Critical/High/Medium/Low/Info |
| **Status** | Open/Mitigated/Closed |
| **Discovered** | YYYY-MM-DD |
| **Mitigated** | YYYY-MM-DD |
| **Closed** | YYYY-MM-DD |
| **Source** | Where discovered |
| **CIS Control** | If applicable |

**Description**:
What is the issue?

**Impact**:
What could happen if exploited?

**Mitigation Implemented**:
What was done to address it?

**Residual Risk**: High/Medium/Low
What risk remains?

**ADR/Documentation**: Link to relevant docs
```

---

## Review Log

| Date | Reviewer | Findings Reviewed | Notes |
|------|----------|-------------------|-------|
| 2026-01-21 | Initial | All | Initial documentation |

---

## Related Documentation

- [SECURITY-ARCHITECTURE.md](../../docs/SECURITY-ARCHITECTURE.md)
- [SECURITY-CHECKLIST.md](../../docs/SECURITY-CHECKLIST.md)
- [Docker Bench Guide](../../scripts/security/DOCKER-BENCH-GUIDE.md)
- [ADR Index](../../docs/decisions/INDEX.md)
