# Security Controls Checklist

Comprehensive security checklist based on CIS Docker Benchmark and OWASP Container Security guidelines.

**Version**: 1.0.0
**Last Updated**: 2026-01-21
**Audit Standard**: CIS Docker Benchmark v1.6.0 + OWASP

---

## Legend

| Symbol | Meaning |
|--------|---------|
| [x] | Implemented and verified |
| [~] | Partially implemented |
| [ ] | Planned / Not implemented |
| [N/A] | Not applicable |

---

## 1. Host Configuration

### 1.1 General Configuration

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 1.1.1 | Ensure a separate partition for containers exists | [~] | VPS dependent |
| 1.1.2 | Ensure the container host has been hardened | [~] | Base VPS setup |
| 1.1.3 | Ensure Docker is up to date | [x] | Use latest stable |
| 1.1.4 | Ensure only trusted users control Docker daemon | [x] | Root/docker group only |

### 1.2 Linux Hosts Specific Configuration

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 1.2.1 | Ensure auditing is configured | [~] | Host dependent |
| 1.2.2 | Ensure appropriate audit rules | [~] | Host dependent |

---

## 2. Docker Daemon Configuration

### 2.1 Network Configuration

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 2.1 | Restrict network traffic between containers | [x] | `internal: true` networks |
| 2.2 | Set logging level | [x] | `--log-level=INFO` |
| 2.3 | Allow Docker to make changes to iptables | [x] | Default behavior |
| 2.4 | Do not use insecure registries | [x] | Only official registries |
| 2.5 | Do not use the aufs storage driver | [x] | Using overlay2 |
| 2.6 | Configure TLS authentication for Docker daemon | [N/A] | Local socket only |

### 2.2 Storage and Volumes

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 2.7 | Set default ulimit | [~] | Docker defaults |
| 2.8 | Enable user namespace support | [~] | Not enabled |
| 2.9 | Use default cgroup driver | [x] | systemd |
| 2.10 | Set base device size | [x] | Host defaults |

---

## 3. Docker Daemon Configuration Files

### 3.1 File Permissions

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 3.1 | Verify docker.service permissions | [x] | Host managed |
| 3.2 | Verify docker.socket permissions | [x] | Host managed |
| 3.3 | Verify /etc/docker directory permissions | [x] | 755 |
| 3.4 | Verify registry certificate permissions | [N/A] | Not using custom certs |
| 3.5 | Verify TLS CA cert permissions | [N/A] | Not using TLS daemon |
| 3.6 | Verify daemon.json permissions | [x] | 644 |

---

## 4. Container Images and Build

### 4.1 Image Security

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 4.1 | Create a user for the container | [~] | Most services non-root |
| 4.2 | Use trusted base images | [x] | Official images only |
| 4.3 | Do not install unnecessary packages | [x] | Alpine/minimal images |
| 4.4 | Scan images for vulnerabilities | [~] | Manual Trivy/Scout |
| 4.5 | Enable Docker Content Trust | [ ] | Planned for production |
| 4.6 | Add HEALTHCHECK instruction | [x] | All services |
| 4.7 | Do not use update instructions alone | [x] | Pinned versions |
| 4.8 | Remove setuid/setgid permissions | [~] | Where applicable |
| 4.9 | Use COPY instead of ADD | [x] | In custom Dockerfiles |
| 4.10 | Do not store secrets in Dockerfiles | [x] | File-based secrets |
| 4.11 | Install verified packages only | [x] | Official repos only |

### 4.2 Container Images Used

| Image | Official | Verified | Scanning |
|-------|----------|----------|----------|
| traefik:v2.11 | Yes | Yes | Manual |
| tecnativa/docker-socket-proxy:0.2 | Community | Yes | Manual |
| pgvector/pgvector:pg16 | Community | Yes | Manual |
| mysql:8.0 | Yes | Yes | Manual |
| mongo:6.0 | Yes | Yes | Manual |
| redis:7-alpine | Yes | Yes | Manual |
| minio/minio:latest | Yes | Yes | Manual |

---

## 5. Container Runtime Configuration

### 5.1 AppArmor/Seccomp

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 5.1 | Do not disable AppArmor profile | [x] | Default enabled |
| 5.2 | Verify SELinux security options | [N/A] | Ubuntu uses AppArmor |
| 5.3 | Restrict Linux kernel capabilities | [x] | `cap_drop: ALL` |
| 5.4 | Do not use privileged containers | [x] | None privileged |
| 5.5 | Do not mount sensitive host directories | [~] | Only socket via proxy |
| 5.6 | Do not run sshd in containers | [x] | No SSH in containers |
| 5.7 | Do not map privileged ports | [x] | Only 80,443,8448 |

### 5.2 Resource Limits

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 5.8 | Do not share host's network namespace | [~] | Traefik uses host ports |
| 5.9 | Limit memory usage | [x] | All services limited |
| 5.10 | Set container CPU priority | [~] | Limits set, not priority |
| 5.11 | Limit container memory | [x] | `deploy.resources.limits` |
| 5.12 | Set read-only root filesystem | [~] | Partial, where supported |

### 5.3 Security Options

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 5.13 | Bind incoming traffic to specific interface | [x] | Traefik handles |
| 5.14 | Set on-failure restart policy | [x] | `unless-stopped` |
| 5.15 | Do not share host process namespace | [x] | Not shared |
| 5.16 | Do not share host IPC namespace | [x] | Not shared |
| 5.17 | Do not share host user namespace | [x] | Not shared |
| 5.18 | Do not expose host devices | [x] | None exposed |
| 5.19 | Override default ulimit | [x] | Container defaults |

### 5.4 Privileges

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 5.20 | Do not set mount propagation mode shared | [x] | Not used |
| 5.21 | Do not share host UTS namespace | [x] | Not shared |
| 5.22 | Do not disable default seccomp profile | [x] | Default enabled |
| 5.23 | Do not docker exec with privileged option | [x] | Blocked via proxy |
| 5.24 | Do not docker exec as user root | [~] | Admin only |
| 5.25 | Confirm cgroup usage | [x] | Standard cgroups |

### 5.5 Container Configuration

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 5.26 | Restrict container from acquiring new privileges | [x] | `no-new-privileges:true` |
| 5.27 | Check health at container level | [x] | All services |
| 5.28 | Use PIDs cgroup limit | [x] | Deploy resources |
| 5.29 | Do not use Docker's default bridge network | [x] | Custom networks |
| 5.30 | Do not share host UTS namespace | [x] | Not shared |
| 5.31 | Do not mount Docker socket | [x] | Via proxy only |

---

## 6. Docker Security Operations

### 6.1 Operations

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 6.1 | Perform security audits regularly | [~] | Manual docker-bench |
| 6.2 | Monitor Docker containers and hosts | [~] | Dashboard monitoring |
| 6.3 | Back up container data | [x] | Backup scripts |

### 6.2 Logging and Monitoring

| # | Control | Status | Notes |
|---|---------|--------|-------|
| 6.4 | Avoid container sprawl | [x] | Compose managed |
| 6.5 | Avoid image sprawl | [x] | Regular cleanup |
| 6.6 | Centralized container logging | [~] | JSON logs, no aggregator |
| 6.7 | Incident response plan | [x] | Documented |

---

## 7. OWASP Container Security Controls

### C1: Image Provenance and Trust

| Control | Status | Implementation |
|---------|--------|----------------|
| Use official images | [x] | All base images official |
| Pin image versions | [x] | Tagged versions used |
| Verify image signatures | [ ] | Content trust planned |
| Document image sources | [x] | ADRs reference images |

### C2: Static Analysis and Scanning

| Control | Status | Implementation |
|---------|--------|----------------|
| Scan for vulnerabilities | [~] | Manual Trivy/Scout |
| Scan for secrets | [x] | No secrets in images |
| Scan for misconfigurations | [~] | docker-bench-security |
| CI/CD integration | [ ] | Planned |

### C3: Secrets Management

| Control | Status | Implementation |
|---------|--------|----------------|
| No secrets in images | [x] | File-based only |
| No secrets in environment | [x] | _FILE suffix |
| Secrets encrypted at rest | [~] | Optional SOPS |
| Secrets rotatable | [x] | generate-secrets.sh |

### C4: Network Segmentation

| Control | Status | Implementation |
|---------|--------|----------------|
| Default deny networking | [x] | Internal networks |
| Explicit network policies | [x] | Four-tier topology |
| TLS for service-to-service | [~] | Public only via Traefik |
| Ingress/egress controls | [x] | Network isolation |

### C5: Secure Configuration

| Control | Status | Implementation |
|---------|--------|----------------|
| Non-root containers | [~] | Most services |
| Read-only filesystems | [~] | Where supported |
| No privileged containers | [x] | None privileged |
| Resource limits | [x] | All services |

### C6: Runtime Security

| Control | Status | Implementation |
|---------|--------|----------------|
| Container monitoring | [x] | Dashboard |
| Anomaly detection | [ ] | Not implemented |
| Immutable containers | [~] | Recreated on deploy |
| Security profiles | [x] | AppArmor defaults |

### C7: Logging and Monitoring

| Control | Status | Implementation |
|---------|--------|----------------|
| Centralized logging | [~] | JSON logs |
| Log rotation | [x] | 10m, 3 files |
| Access logging | [x] | Traefik access logs |
| Security events | [~] | Manual review |

---

## 8. Pre-Deployment Checklist

### Before First Deploy

- [ ] Run `./scripts/generate-secrets.sh`
- [ ] Verify secret permissions: `ls -la secrets/`
- [ ] Review `.env` configuration
- [ ] Configure domain and DNS
- [ ] Verify firewall allows ports 80, 443

### Before Production Deploy

- [ ] Run `./scripts/security/run-docker-bench.sh`
- [ ] Review docker-bench findings
- [ ] Scan images with Trivy: `trivy image <image>`
- [ ] Verify TLS certificates
- [ ] Test authentication flows
- [ ] Backup existing data

### After Deploy

- [ ] Verify all services healthy: `docker compose ps`
- [ ] Test HTTPS access
- [ ] Verify dashboard authentication
- [ ] Check logs for errors
- [ ] Run health checks

---

## 9. Periodic Security Tasks

### Weekly

- [ ] Review container logs for anomalies
- [ ] Check for image updates
- [ ] Verify backup completion

### Monthly

- [ ] Run docker-bench-security
- [ ] Review and apply security updates
- [ ] Rotate webhook secret (if 90 days)
- [ ] Review access logs

### Quarterly

- [ ] Full security audit
- [ ] Review and update documentation
- [ ] Test disaster recovery
- [ ] Review secrets rotation policy

---

## Related Documentation

- [SECURITY.md](SECURITY.md) - Security guide
- [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) - Architecture details
- [SECURITY-FINDINGS.md](../../../.dev/ai/security/SECURITY-FINDINGS.md) - Issue tracking
- [Docker Bench Guide](../scripts/security/DOCKER-BENCH-GUIDE.md) - Benchmark details

---

*Checklist version: 1.0.0*
*Based on CIS Docker Benchmark v1.6.0*
