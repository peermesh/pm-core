# ADR-0200: Non-Root Container Execution

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

By default, Docker containers run as root (UID 0). If an attacker escapes the container, they have root access to the host. Container security best practices universally recommend running as non-root users.

The project needs a container security baseline that:

- Prevents privilege escalation
- Reduces blast radius of container compromise
- Aligns with CIS Docker Benchmark Level 1
- Works with standard application images
- Requires no daily maintenance

---

## Decision

**We will run all containers as non-root users** with the following security baseline applied via YAML anchor:

```yaml
x-security-baseline: &security-baseline
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  read_only: true
  tmpfs:
    - /tmp:size=64m,noexec,nosuid,nodev
    - /run:size=16m,noexec,nosuid,nodev
```

All services inherit this baseline. Exceptions are documented with explicit rationale.

---

## Alternatives Considered

### Option A: Default Docker Security (No Hardening)

**Description**: Run containers with Docker's defaults: root user, all capabilities, writable filesystem.

**Pros**:
- Maximum compatibility
- No configuration required

**Cons**:
- Container escape = host root access
- Violates CIS Docker Benchmark
- Would fail security audit

**Why not chosen**: This is fundamentally insecure. Any professional security review would flag this as a critical finding.

### Option B: Selective Hardening (Per-Service)

**Description**: Apply security controls only to "high-risk" services.

**Pros**:
- Less configuration work
- Fewer compatibility issues

**Cons**:
- Inconsistent security posture
- Requires ongoing risk assessment
- "Low-risk" service could become attack vector

**Why not chosen**: Security by exception creates maintenance burden and leaves gaps. Consistent baseline is more defensible.

### Option C: Custom Seccomp/AppArmor Profiles

**Description**: Create application-specific syscall restrictions.

**Pros**:
- Maximum possible restriction
- Blocks specific attack vectors

**Cons**:
- Significant development/testing overhead
- Must update with application changes
- Violates zero-maintenance constraint

**Why not chosen**: Docker's default seccomp profile blocks ~44 dangerous syscalls. Custom profiles add complexity without proportional security gain for typical web applications.

---

## Consequences

### Positive

- Container escape has limited impact (non-root on host)
- Read-only filesystem prevents malware persistence
- `no-new-privileges` blocks SUID exploitation
- `cap_drop: ALL` removes all Linux capabilities
- Consistent security posture across all services

### Negative

- Volume permissions must be set correctly before container start
- Some applications may need specific tmpfs paths
- Bootstrap script required for directory ownership

### Neutral

- Most modern images support non-root operation

---

## Implementation Notes

### YAML Anchor Pattern

All services inherit the security baseline:

```yaml
x-security-baseline: &security-baseline
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  read_only: true
  tmpfs:
    - /tmp:size=64m,noexec,nosuid,nodev
    - /run:size=16m,noexec,nosuid,nodev

services:
  app:
    <<: *security-baseline
    user: "1000:1000"
    # ... rest of service definition
```

### Common User IDs

| Service Type | UID:GID | Rationale |
|--------------|---------|-----------|
| Node.js (Ghost, etc.) | 1000:1000 | Standard node user |
| nginx | 101:101 | Official nginx user |
| PostgreSQL | 999:999 | Official postgres user |
| Python apps | 1000:1000 | Common convention |
| Traefik | 65534:65534 | nobody user |

### Volume Permission Bootstrap

```bash
#!/bin/bash
# Run before first docker compose up

mkdir -p ./data/postgres && chown 999:999 ./data/postgres
mkdir -p ./data/ghost && chown 1000:1000 ./data/ghost
mkdir -p ./data/mongodb && chown 999:999 ./data/mongodb
```

### Exception Documentation

Services requiring elevated privileges must be documented:

| Service | Exception | Justification |
|---------|-----------|---------------|
| socket-proxy | Root user | Must access Docker socket |

### Validation Script

```bash
#!/bin/bash
for container in $(docker ps --format '{{.Names}}'); do
  USER=$(docker exec "$container" id -u 2>/dev/null)
  if [ "$USER" = "0" ]; then
    echo "WARN: $container running as root"
  else
    echo "OK: $container running as UID $USER"
  fi
done
```

---

## References

### Documentation

- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker) - Section 4: Container Runtime
- [Docker Security](https://docs.docker.com/engine/security/) - Official security documentation

### Related ADRs

- [ADR-0201: Security Anchors](./0201-security-anchors.md) - YAML anchor implementation details

### Internal Reference

- D3.2-CONTAINER-SECURITY.md - Original decision document with full security analysis

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |
