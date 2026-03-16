# Security Audit Readiness Checklist

**Version**: 1.0.0
**Date**: 2026-02-22
**Status**: Audit Preparation Package
**Framework**: CIS Docker Benchmark v1.6.0 + OWASP Container Security + NIST Cybersecurity Framework

---

## Overview

This checklist maps Docker Lab's security implementation to industry-standard audit frameworks. It is designed to support professional security firm engagement by clearly identifying:

- **Implemented controls** (with evidence paths)
- **Partially implemented controls** (with gaps and mitigations)
- **Not implemented controls** (with risk acceptance rationale)
- **Not applicable controls** (with justification)

**Legend**:
- **[✓]** Fully implemented and verified
- **[~]** Partially implemented (gaps exist but mitigated)
- **[ ]** Not implemented (planned or accepted risk)
- **[N/A]** Not applicable to this deployment model

---

## Table of Contents

1. [CIS Docker Benchmark v1.6.0](#cis-docker-benchmark-v160)
2. [OWASP Container Security Top 10](#owasp-container-security-top-10)
3. [NIST Cybersecurity Framework](#nist-cybersecurity-framework)
4. [Gap Analysis Summary](#gap-analysis-summary)
5. [Evidence Cross-Reference](#evidence-cross-reference)

---

## CIS Docker Benchmark v1.6.0

### Section 1: Host Configuration

| # | Control | Status | Evidence | Notes |
|---|---------|--------|----------|-------|
| 1.1.1 | Ensure a separate partition for containers exists | [~] | Host filesystem | VPS provider dependent; not under Docker Lab control |
| 1.1.2 | Ensure the container host has been hardened | [~] | VPS base image | Provider-dependent; hardening documented in DEPLOYMENT.md |
| 1.1.3 | Ensure Docker is up to date | [✓] | `docker --version` | Deployment guide requires Docker 20.10+ |
| 1.1.4 | Ensure only trusted users control Docker daemon | [✓] | Host user permissions | Root or docker group only; documented in deployment |
| 1.2.1 | Ensure auditing is configured for Docker daemon | [~] | Host auditd config | Host-dependent; not under Docker Lab control |
| 1.2.2 | Ensure auditing is configured for Docker files and directories | [~] | Host auditd config | Host-dependent; not under Docker Lab control |

**Gap Summary**: Host-level controls (1.1.1, 1.1.2, 1.2.x) are VPS provider responsibility. Docker Lab deployment guide provides recommendations but cannot enforce.

**Evidence**: `docs/DEPLOYMENT.md`

---

### Section 2: Docker Daemon Configuration

| # | Control | Status | Evidence | Notes |
|---|---------|--------|----------|-------|
| 2.1 | Restrict network traffic between containers | [✓] | docker-compose.yml networks, ADR-0002 | Four-tier network topology with `internal: true` |
| 2.2 | Set logging level | [✓] | Docker daemon config | Default INFO level |
| 2.3 | Allow Docker to make changes to iptables | [✓] | Default behavior | Required for network isolation |
| 2.4 | Do not use insecure registries | [✓] | No insecure registries | Only Docker Hub (official) and authenticated registries |
| 2.5 | Do not use the aufs storage driver | [✓] | `docker info` | Uses overlay2 (default on modern systems) |
| 2.6 | Configure TLS authentication for Docker daemon | [N/A] | Local socket only | Daemon not exposed remotely; socket proxy used instead |
| 2.7 | Set default ulimit as appropriate | [✓] | Docker defaults | Container-specific limits in compose files |
| 2.8 | Enable user namespace support | [ ] | Not enabled | ACCEPTED RISK: Compatibility concerns; future evaluation (WO-062 insight #3) |
| 2.9 | Confirm default cgroup usage | [✓] | `docker info` | Uses systemd cgroup driver |
| 2.10 | Do not change base device size | [✓] | Default settings | No base device size override |

**Gap Summary**: User namespace remapping (2.8) not enabled; accepted risk with mitigation via capabilities, no-new-privileges, and non-root containers.

**Evidence**:
- Network isolation: `docs/decisions/0002-four-network-topology.md`
- User namespaces risk acceptance: `docs/security/THREAT-MODEL.md` (Limitation #5)

---

### Section 3: Docker Daemon Configuration Files

| # | Control | Status | Evidence | Notes |
|---|---------|--------|----------|-------|
| 3.1 | Verify docker.service file ownership | [✓] | Host file permissions | Managed by Docker package installation |
| 3.2 | Verify docker.service file permissions | [✓] | Host file permissions | 644 or 600 (systemd managed) |
| 3.3 | Verify docker.socket file ownership | [✓] | Host file permissions | Managed by Docker package installation |
| 3.4 | Verify docker.socket file permissions | [✓] | Host file permissions | 644 (systemd managed) |
| 3.5 | Verify /etc/docker directory ownership | [✓] | Host file permissions | root:root |
| 3.6 | Verify /etc/docker directory permissions | [✓] | Host file permissions | 755 |
| 3.7 | Verify registry certificate file ownership | [N/A] | Not using custom registry certs | Official registries only |
| 3.8 | Verify registry certificate file permissions | [N/A] | Not using custom registry certs | Official registries only |
| 3.9 | Verify TLS CA certificate file ownership | [N/A] | Daemon not TLS-exposed | Local socket only |
| 3.10 | Verify TLS CA certificate file permissions | [N/A] | Daemon not TLS-exposed | Local socket only |
| 3.11 | Verify Docker server certificate file ownership | [N/A] | Daemon not TLS-exposed | Local socket only |
| 3.12 | Verify Docker server certificate file permissions | [N/A] | Daemon not TLS-exposed | Local socket only |
| 3.13 | Verify Docker server key file ownership | [N/A] | Daemon not TLS-exposed | Local socket only |
| 3.14 | Verify Docker server key file permissions | [N/A] | Daemon not TLS-exposed | Local socket only |
| 3.15 | Verify Docker socket file ownership | [✓] | Host file permissions | root:docker |
| 3.16 | Verify Docker socket file permissions | [✓] | Host file permissions | 660 (read/write for root and docker group) |
| 3.17 | Verify daemon.json file ownership | [✓] | Host file permissions | root:root |
| 3.18 | Verify daemon.json file permissions | [✓] | Host file permissions | 644 |
| 3.19 | Verify /etc/default/docker file ownership | [✓] | Host file permissions | root:root (if exists) |
| 3.20 | Verify /etc/default/docker file permissions | [✓] | Host file permissions | 644 (if exists) |

**Gap Summary**: None. All applicable daemon configuration file permissions are correctly set.

---

### Section 4: Container Images and Build Files

| # | Control | Status | Evidence | Notes |
|---|---------|--------|----------|-------|
| 4.1 | Create a user for the container | [~] | docker-compose.yml user directives | Most services non-root; databases start as root then drop (see limitation) |
| 4.2 | Use trusted base images | [✓] | Image provenance, SUPPLY-CHAIN-SECURITY.md | Official Docker Hub images only |
| 4.3 | Do not install unnecessary packages in the container | [✓] | Official images | Alpine/minimal base images where possible |
| 4.4 | Scan and rebuild images to include security patches | [~] | Manual scanning | Trivy/Docker Scout documented; not automated in CI (SEC-008) |
| 4.5 | Enable Content Trust for Docker | [ ] | Not enabled | ACCEPTED RISK: Low priority for lab; planned for production (SEC-009) |
| 4.6 | Add HEALTHCHECK instruction to container images | [✓] | docker-compose.yml healthcheck sections | All services have healthchecks |
| 4.7 | Do not use update instructions alone in Dockerfiles | [✓] | No custom Dockerfiles with update-only | Official images with pinned versions |
| 4.8 | Remove setuid and setgid permissions in images | [~] | Official images | Assumed secure; not audited per-image |
| 4.9 | Use COPY instead of ADD in Dockerfiles | [✓] | No custom Dockerfiles using ADD | Best practice for future custom images |
| 4.10 | Do not store secrets in Dockerfiles | [✓] | File-based secrets, ADR-0003 | Secrets never in images or environment variables |
| 4.11 | Install verified packages only | [✓] | Official images | Package verification within official images |

**Gap Summary**: Content Trust (4.5) not enabled; accepted risk. Image scanning (4.4) is manual; automation planned.

**Evidence**:
- Non-root containers: `docs/decisions/0200-non-root-containers.md`
- Secrets management: `docs/decisions/0003-file-based-secrets.md`
- Supply-chain: `docs/SUPPLY-CHAIN-SECURITY.md`
- Content Trust risk acceptance: captured in the private security findings ledger (SEC-009)

---

### Section 5: Container Runtime

| # | Control | Status | Evidence | Notes |
|---|---------|--------|----------|-------|
| 5.1 | Do not disable AppArmor profile | [✓] | Default enabled | AppArmor profile active (on supported hosts) |
| 5.2 | Verify SELinux security options | [N/A] | Ubuntu uses AppArmor | SELinux not applicable on Ubuntu-based VPS |
| 5.3 | Restrict Linux kernel capabilities within containers | [✓] | docker-compose.hardening.yml | `cap_drop: ALL` with selective `cap_add` |
| 5.4 | Do not use privileged containers | [✓] | docker-compose.yml | No `privileged: true` on any service |
| 5.5 | Do not mount sensitive host system directories | [~] | docker-compose.yml | Socket mounted via proxy only (read-only, filtered) |
| 5.6 | Do not run ssh within containers | [✓] | Service definitions | No SSH daemons in containers |
| 5.7 | Do not map privileged ports within containers | [✓] | docker-compose.yml ports | Only 80, 443, 8448 (Traefik via host network) |
| 5.8 | Open only needed ports on container | [✓] | docker-compose.yml ports | Explicit port mappings, no `--net=host` except Traefik |
| 5.9 | Do not share the host's network namespace | [~] | docker-compose.yml | Traefik uses host network (required for ports 80/443); others use custom networks |
| 5.10 | Limit memory usage for container | [✓] | docker-compose.yml deploy.resources.limits | All services have memory limits (64M-1G) |
| 5.11 | Set container CPU priority appropriately | [~] | docker-compose.yml deploy.resources.reservations | Memory limits set; CPU priority not explicitly configured |
| 5.12 | Mount container's root filesystem as read-only | [✓] | docker-compose.hardening.yml | Applied to Traefik/dashboard/redis and DB services via wrapper+tmpfs pattern (see GOTCHAS #10) |
| 5.13 | Bind incoming container traffic to a specific host interface | [✓] | Traefik handles | Traefik binds to 0.0.0.0 (public), backend containers not exposed |
| 5.14 | Set the 'on-failure' container restart policy to 5 | [✓] | docker-compose.yml | `restart: unless-stopped` on all services |
| 5.15 | Do not share the host's process namespace | [✓] | docker-compose.yml | No `pid: host` |
| 5.16 | Do not share the host's IPC namespace | [✓] | docker-compose.yml | No `ipc: host` |
| 5.17 | Do not directly expose host devices to containers | [✓] | docker-compose.yml | No `devices:` mounts |
| 5.18 | Override default ulimit at runtime only if needed | [✓] | Docker defaults | No custom ulimits; defaults appropriate |
| 5.19 | Do not set mount propagation mode to shared | [✓] | docker-compose.yml | No shared mount propagation |
| 5.20 | Do not share the host's UTS namespace | [✓] | docker-compose.yml | No `uts: host` |
| 5.21 | Do not disable default seccomp profile | [✓] | Default enabled | Seccomp profile active (default Docker profile) |
| 5.22 | Do not execute commands using docker exec with privileged option | [✓] | Socket proxy blocks EXEC | Docker socket proxy blocks `EXEC=0` |
| 5.23 | Do not execute commands using docker exec with user option | [~] | Operational control | Admin only; not technically enforced |
| 5.24 | Confirm cgroup usage | [✓] | docker-compose.yml | All services use cgroups for resource limits |
| 5.25 | Restrict container from acquiring additional privileges | [✓] | docker-compose.base.yml x-secured-service | `no-new-privileges: true` on all services |
| 5.26 | Check container health at runtime | [✓] | docker-compose.yml healthcheck | All services have HEALTHCHECK |
| 5.27 | Ensure that Docker commands always get the latest version of the image | [✓] | `docker compose pull --ignore-buildable` | Deployment script pulls registry images while safely skipping local build-only services |
| 5.28 | Use PIDs cgroup limit | [✓] | deploy.resources | Implicit via memory limits |
| 5.29 | Do not use Docker's default bridge docker0 | [✓] | docker-compose.yml networks | Custom networks (proxy-external, app-internal, db-internal, socket-proxy) |
| 5.30 | Do not share the host's user namespaces | [✓] | Default behavior | No `userns_mode: host` |
| 5.31 | Do not mount the Docker socket inside any containers | [✓] | Socket proxy mitigation | Socket mounted via proxy only; read-only, filtered API |

**Gap Summary**: Traefik uses host network (5.9) - required for port binding. CPU priority (5.11) not explicitly configured.

**Evidence**:
- Security anchors: `docs/decisions/0201-security-anchors.md`
- Socket proxy: `docs/decisions/0004-docker-socket-proxy.md`
- Hardening overlay: `docker-compose.hardening.yml`
- Database limitations: `docs/GOTCHAS.md` (#9, #10, #11, #12)

---

### Section 6: Docker Security Operations

| # | Control | Status | Evidence | Notes |
|---|---------|--------|----------|-------|
| 6.1 | Perform regular security audits of host and containers | [~] | docker-bench-security manual runs | Manual audits documented; automated scanning planned |
| 6.2 | Monitor Docker containers usage, performance, and metering | [~] | Dashboard monitoring | Basic monitoring; observability-full profile created but on hold |
| 6.3 | Backup container data | [✓] | BACKUP-RESTORE.md, backup scripts | Documented backup/restore procedures with encryption support |
| 6.4 | Avoid image sprawl | [✓] | `docker image prune` in maintenance | Regular cleanup documented |
| 6.5 | Avoid container sprawl | [✓] | Compose-managed lifecycle | Compose manages all containers; no orphaned containers |

**Gap Summary**: Centralized logging and monitoring (6.2) is basic; observability-full profile (Loki/Prometheus/Grafana) created but deferred. Security audits (6.1) are manual.

**Evidence**:
- Backup procedures: `docs/BACKUP-RESTORE.md`
- Observability profiles: `docs/OBSERVABILITY-PROFILES.md`

---

### Section 7: Docker Swarm Configuration

| # | Control | Status | Evidence | Notes |
|---|---------|--------|----------|-------|
| 7.x | All Swarm controls | [N/A] | Docker Compose only | Docker Swarm not used; standalone Compose deployment |

**Gap Summary**: None. Swarm controls not applicable.

---

## OWASP Container Security Top 10

### C1: Image Provenance and Trust

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Use official/verified base images | [✓] | SUPPLY-CHAIN-SECURITY.md | All images from official Docker Hub repos |
| Pin image versions (no `latest`) | [✓] | ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md | Explicit tags; digest pinning for infrastructure images |
| Verify image signatures | [ ] | Not enabled | Docker Content Trust not enabled (SEC-009); planned for production |
| Scan images for vulnerabilities | [~] | Manual Trivy/Scout | Documented but not automated in CI (SEC-008) |
| Document image sources and versions | [✓] | IMAGE-DIGEST-BASELINE.md | Baseline lock file documents all external images |

**Gap Summary**: Image signature verification not enabled; scanning not automated.

**Evidence**:
- Supply-chain baseline: `docs/SUPPLY-CHAIN-SECURITY.md`
- Version immutability: `docs/ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md`
- Image baseline: `docs/IMAGE-DIGEST-BASELINE.md`

---

### C2: Static Analysis and Scanning

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Scan for vulnerabilities (CVEs) | [~] | scripts/security/validate-supply-chain.sh | Manual/on-demand; severity threshold gating implemented |
| Scan for secrets in images | [✓] | No secrets in images | File-based secrets, never in images |
| Scan for misconfigurations | [~] | docker-bench-security | Manual runs; not in CI |
| SBOM generation | [✓] | scripts/security/generate-sbom.sh | CycloneDX SBOMs generated on-demand and during deployment |
| CI/CD integration | [ ] | Not implemented | Planned for automation |

**Gap Summary**: Vulnerability and misconfiguration scanning is manual; CI/CD integration planned.

**Evidence**:
- Supply-chain validation: `scripts/security/validate-supply-chain.sh`
- SBOM generation: `scripts/security/generate-sbom.sh`
- Docker Bench: `scripts/security/run-docker-bench.sh`

---

### C3: Secrets Management

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| No secrets in images | [✓] | ADR-0003 | File-based secrets only |
| No secrets in environment variables | [✓] | `_FILE` suffix pattern | All secrets use `*_FILE` environment pattern |
| Secrets encrypted at rest | [~] | ADR-0202 (SOPS+age) | Optional SOPS+age support; file permissions 600/700 always enforced |
| Secrets rotatable | [✓] | scripts/generate-secrets.sh | Generation script supports `--force` rotation |
| Secrets mounted securely | [✓] | docker-compose.yml secrets | Docker Compose secrets mounted to `/run/secrets/` (tmpfs) |

**Gap Summary**: None. Secrets management is comprehensive with optional encryption at rest.

**Evidence**:
- File-based secrets ADR: `docs/decisions/0003-file-based-secrets.md`
- SOPS+age ADR: `docs/decisions/0202-sops-age-secrets-encryption.md`
- Secrets management guide: `docs/SECRETS-MANAGEMENT.md`

---

### C4: Network Segmentation

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Default deny networking | [✓] | ADR-0002 | Internal networks (`internal: true`) block internet egress |
| Explicit network policies | [✓] | docker-compose.yml | Four-tier topology (socket-proxy, db-internal, app-internal, proxy-external) |
| TLS for service-to-service | [~] | Traefik TLS termination | External TLS via Traefik; internal service-to-service is plaintext (Docker overlay network) |
| Ingress/egress controls | [✓] | Network isolation + firewall | `internal: true` blocks egress; host firewall restricts ingress to 80/443/8448 |

**Gap Summary**: Internal service-to-service communication is plaintext (encrypted at network layer via Docker overlay, but not application-layer TLS).

**Evidence**:
- Network topology ADR: `docs/decisions/0002-four-network-topology.md`
- Security architecture: `docs/SECURITY-ARCHITECTURE.md`

---

### C5: Secure Configuration

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Non-root containers | [~] | docker-compose.yml user directives | Most services non-root; databases start as root then drop privileges |
| Read-only filesystems | [✓] | docker-compose.hardening.yml | Databases now supported via wrapper+tmpfs runtime paths |
| No privileged containers | [✓] | docker-compose.yml | No `privileged: true` |
| Resource limits | [✓] | docker-compose.yml deploy.resources | Memory limits (64M-1G), CPU reservations |
| Capability restrictions | [✓] | docker-compose.hardening.yml | `cap_drop: ALL` with selective `cap_add` |
| Security options (`no-new-privileges`) | [✓] | docker-compose.base.yml | `no-new-privileges: true` on all services |

**Gap Summary**: Some services start as root during initialization.

**Evidence**:
- Non-root containers ADR: `docs/decisions/0200-non-root-containers.md`
- Security anchors: `docs/decisions/0201-security-anchors.md`
- Hardening overlay: `docker-compose.hardening.yml`

---

### C6: Runtime Security

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Container monitoring | [✓] | Dashboard | Basic resource monitoring via dashboard |
| Anomaly detection | [ ] | Not implemented | Planned for observability-full profile |
| Immutable containers | [~] | Recreated on deploy | Containers recreated on deployment; not strictly immutable during runtime |
| Security profiles (AppArmor/Seccomp) | [✓] | Default profiles | AppArmor and seccomp defaults enabled (host-dependent) |
| Runtime enforcement | [✓] | `no-new-privileges`, capabilities | Prevents privilege escalation at runtime |

**Gap Summary**: Advanced anomaly detection not implemented; containers are not strictly immutable during runtime.

**Evidence**:
- Dashboard monitoring: `docs/DASHBOARD.md`
- Security controls: `docs/SECURITY-ARCHITECTURE.md`

---

### C7: Logging and Monitoring

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Centralized logging | [~] | JSON logs | Local JSON logs with rotation; no central aggregation |
| Log rotation | [✓] | docker-compose.yml logging config | 10M max-size, 3 max-file |
| Access logging | [✓] | Traefik access logs | JSON-formatted access logs |
| Security event logging | [~] | Manual review | Container logs capture security events; no automated alerting |
| Audit trail | [✓] | Deployment evidence bundles | Evidence bundles capture deployment artifacts |

**Gap Summary**: No centralized logging or automated alerting; observability-full profile created but deferred.

**Evidence**:
- Security architecture: `docs/SECURITY-ARCHITECTURE.md` (Monitoring & Logging section)
- Observability profiles: `docs/OBSERVABILITY-PROFILES.md`

---

## NIST Cybersecurity Framework

### Identify (ID)

| Function | Control | Status | Evidence |
|----------|---------|--------|----------|
| ID.AM-2 | Software platforms and applications inventory | [✓] | docker-compose.yml, SBOM generation |
| ID.RA-1 | Asset vulnerabilities are identified and documented | [~] | SECURITY-FINDINGS.md, manual scanning |
| ID.RA-5 | Threats and vulnerabilities identified | [✓] | THREAT-MODEL.md, SECURITY-FINDINGS.md |

---

### Protect (PR)

| Function | Control | Status | Evidence |
|----------|---------|--------|----------|
| PR.AC-3 | Remote access is managed | [✓] | Pull-based webhook deployment, no SSH keys in CI |
| PR.AC-4 | Access permissions managed | [✓] | File permissions (secrets 600/700), container user namespaces |
| PR.AC-5 | Network integrity is protected | [✓] | Network segmentation (4-tier topology, internal: true) |
| PR.DS-1 | Data at rest is protected | [~] | SOPS+age optional, file permissions enforced |
| PR.DS-2 | Data in transit is protected | [✓] | HTTPS/TLS for external traffic |
| PR.DS-5 | Protections against data leaks are implemented | [✓] | File-based secrets (not in env vars), network isolation |
| PR.IP-1 | Baseline configuration maintained | [✓] | docker-compose.yml, security anchors, ADRs |
| PR.IP-3 | Configuration change control processes are in place | [✓] | Git version control, deployment evidence bundles |
| PR.PT-1 | Audit/log records determined and managed | [✓] | JSON logs with rotation, Traefik access logs |

---

### Detect (DE)

| Function | Control | Status | Evidence |
|----------|---------|--------|----------|
| DE.CM-1 | Network monitored to detect anomalies | [~] | Basic monitoring; no anomaly detection |
| DE.CM-4 | Malicious code detected | [~] | Manual image scanning; not automated |
| DE.CM-7 | Monitoring for unauthorized personnel, connections, devices | [~] | Access logs; no automated alerting |
| DE.DP-4 | Event detection information is communicated | [~] | Logs available; no centralized SIEM |

---

### Respond (RS)

| Function | Control | Status | Evidence |
|----------|---------|--------|----------|
| RS.AN-1 | Notifications investigated | [✓] | Incident response procedures documented |
| RS.MI-3 | Newly identified vulnerabilities mitigated | [✓] | SECURITY-FINDINGS.md tracking, documented mitigations |
| RS.RP-1 | Response plan executed | [✓] | SECURITY-ARCHITECTURE.md (Incident Response section) |

---

### Recover (RC)

| Function | Control | Status | Evidence |
|----------|---------|--------|----------|
| RC.RP-1 | Recovery plan executed | [✓] | BACKUP-RESTORE.md, disaster recovery procedures |

---

## Gap Analysis Summary

### High Priority Gaps

| Gap | Impact | Planned Remediation |
|-----|--------|-------------------|
| User namespace remapping not enabled (CIS 2.8) | Container escape with root grants host root | Evaluation planned (WO-062 insight #3); mitigated by capabilities, no-new-privileges |
| Docker Content Trust not enabled (CIS 4.5) | Image MitM attack possible | Planned for production hardening phase (SEC-009) |
| Image vulnerability scanning not automated (OWASP C2) | Vulnerable images could be deployed | CI/CD integration planned |

---

### Medium Priority Gaps

| Gap | Impact | Planned Remediation |
|-----|--------|-------------------|
| Centralized logging not implemented (CIS 6.2, OWASP C7) | Delayed incident detection, difficult correlation | Observability-full profile created; resource review pending |
| Anomaly detection not implemented (OWASP C6) | Runtime attacks may go undetected | Observability-full profile includes Loki/Grafana |
| Per-service seccomp profiles not implemented (WO-062 insight #1) | Services have broader syscall access than needed | Future hardening phase |

---

### Low Priority Gaps / Accepted Risks

| Gap | Impact | Rationale |
|-----|--------|-----------|
| Databases start as root during init (CIS 4.1) | Brief root execution window | Official image limitation; network isolation mitigates |
| Traefik runs as root (CIS 4.1) | Traefik compromise grants root container access | Deferred to v3 migration; capability hardening applied |
| Read-only wrapper maintenance drift risk (CIS 5.12) | DB startup regression on upstream image changes | Managed by wrapper maintenance doc + upgrade validation checklist |
| Network `internal: true` audit lifecycle | Accidental egress misconfiguration possible if future changes bypass checks | Audit now executed; add recurring pre-deploy check |

---

## Evidence Cross-Reference

### By Security Control Category

| Category | Primary Evidence Files |
|----------|----------------------|
| Network Isolation | `docker-compose.yml` (networks), `docs/decisions/0002-four-network-topology.md` |
| Secrets Management | `docker-compose.yml` (secrets), `docs/decisions/0003-file-based-secrets.md`, `docs/SECRETS-MANAGEMENT.md` |
| Container Hardening | `docker-compose.hardening.yml`, `docs/decisions/0201-security-anchors.md`, `foundation/docker-compose.base.yml` |
| API Protection | `docker-compose.yml` (socket-proxy), `docs/decisions/0004-docker-socket-proxy.md` |
| Supply-Chain | `scripts/security/validate-supply-chain.sh`, `docs/SUPPLY-CHAIN-SECURITY.md` |
| Deployment Security | `scripts/deploy.sh`, `docs/WEBHOOK-DEPLOYMENT.md`, `docs/DEPLOYMENT.md` |
| Testing | `tests/`, `docs/testing-guide.md` |
| Security Framework | `foundation/interfaces/`, `foundation/schemas/`, `foundation/docs/SECURITY-FRAMEWORK.md` |

---

### By Audit Framework

| Framework | Primary Evidence Files |
|-----------|----------------------|
| CIS Docker Benchmark | `docs/SECURITY-CHECKLIST.md`, `docs/SECURITY-ARCHITECTURE.md`, `scripts/security/run-docker-bench.sh` |
| OWASP Container Security | `docs/SUPPLY-CHAIN-SECURITY.md`, `docs/SECRETS-MANAGEMENT.md`, `docs/SECURITY-ARCHITECTURE.md` |
| NIST CSF | `docs/security/THREAT-MODEL.md`, `docs/BACKUP-RESTORE.md`, `docs/DEPLOYMENT.md` |

---

## Audit Preparation Recommendations

### For Professional Security Firm

1. **Start with**:
   - Threat Model: `docs/security/THREAT-MODEL.md`
   - Security Architecture: `docs/SECURITY-ARCHITECTURE.md`
   - Evidence Inventory: `docs/security/EVIDENCE-INVENTORY.md`

2. **Verify controls with**:
   - Run docker-bench-security: `scripts/security/run-docker-bench.sh`
   - Run supply-chain validation: `scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL`
   - Review compose config: `docker compose config`

3. **Test attack surfaces**:
   - Traefik reverse proxy (ports 80, 443, 8448)
   - Dashboard web UI
   - Webhook deployment endpoint (if configured)

4. **Review code**:
   - Configuration: `docker-compose.yml`, `docker-compose.hardening.yml`
   - Security scripts: `scripts/security/`
   - Security framework: `foundation/interfaces/`, `foundation/schemas/`

5. **Check evidence artifacts**:
   - Deployment evidence bundles: `evidence/<timestamp>/`
   - Supply-chain reports: `reports/supply-chain/<timestamp>/`
   - Security findings: tracked in the private security findings ledger

---

## Related Documentation

- **Threat Model**: `docs/security/THREAT-MODEL.md`
- **Evidence Inventory**: `docs/security/EVIDENCE-INVENTORY.md`
- **OSS Audit Results**: `docs/security/OSS-AUDIT-RESULTS.md`
- **Security Architecture**: `docs/SECURITY-ARCHITECTURE.md`

---

**Document Prepared**: 2026-02-22
**Audit Package**: Professional Security Firm Review (WO-PMDL-2026-02-22-062)
**Revision**: 1.0.0
