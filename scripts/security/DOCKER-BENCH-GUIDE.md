# Docker Bench Security Guide

This guide explains how to run docker-bench-security and interpret results for PeerMesh Docker Lab.

## Quick Start

```bash
# Run full security scan (recommended with sudo)
sudo ./scripts/security/run-docker-bench.sh

# Run quick scan (skip host checks, good for development)
./scripts/security/run-docker-bench.sh --quick
```

## What is Docker Bench Security?

[Docker Bench Security](https://github.com/docker/docker-bench-security) is an official Docker tool that checks for dozens of common best practices around deploying Docker containers in production. It's based on the [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker).

## Test Sections

Docker Bench runs checks in these categories:

| Section | Description | Requires Root |
|---------|-------------|---------------|
| 1 - Host Configuration | Linux kernel, audit rules | Yes |
| 2 - Docker Daemon Configuration | Daemon settings, logging | Yes |
| 3 - Docker Daemon Config Files | File permissions | Yes |
| 4 - Container Images | Base images, scanning | No |
| 5 - Container Runtime | Running container security | No |
| 6 - Docker Security Operations | Centralized logging | No |
| 7 - Docker Swarm | Swarm-specific (N/A for us) | No |

## Expected Findings for PeerMesh Docker Lab

### Expected PASS Results

Our architecture is designed to pass these checks:

| Check | Description | Implementation |
|-------|-------------|----------------|
| 5.4 | No-new-privileges | `security_opt: no-new-privileges:true` |
| 5.9 | Host network namespace | Only traefik uses host network for ports |
| 5.10 | Memory limits | All services have `deploy.resources.limits` |
| 5.12 | PID limits | Set via deploy resources |
| 5.25 | Container restart policy | `restart: unless-stopped` |
| 5.26 | Host process namespace | Not shared (except socket-proxy) |
| 5.31 | Host user namespace | Not shared |

### Expected WARN Results (Acceptable)

These warnings are expected and acceptable for our architecture:

#### 1. Docker Socket Access (socket-proxy)

```
[WARN] 5.31 - Ensure that the Docker socket is not mounted inside any containers
```

**Status**: Acceptable / Mitigated
**Reason**: We use tecnativa/docker-socket-proxy which:
- Mounts socket read-only (`:ro`)
- Filters API calls to read-only operations
- Runs on isolated internal network
- Only exposes CONTAINERS, NETWORKS, INFO, VERSION endpoints

**Mitigation**: See [ADR-0004: Docker Socket Proxy](../../docs/decisions/0004-docker-socket-proxy.md)

#### 2. Root User in Some Containers

```
[WARN] 4.1 - Ensure that a user for the container has been created
```

**Status**: Acceptable for specific services
**Reason**: Some official images require root for initialization:
- `socket-proxy` - Requires root to access Docker socket
- `postgres` - Requires root for initial setup, drops to postgres user
- `mysql` - Requires root for initial setup, drops to mysql user
- `mongodb` - Requires root for initial setup

**Mitigation**:
- Services that can run as non-root do: traefik, redis, dashboard
- Database containers drop privileges after initialization
- See [ADR-0200: Non-Root Containers](../../docs/decisions/0200-non-root-containers.md)

#### 3. Sensitive Host Directories

```
[WARN] 5.5 - Ensure sensitive host system directories are not mounted
```

**Status**: Expected
**Reason**: Socket-proxy mounts `/var/run/docker.sock` which is required for Traefik service discovery.

**Mitigation**: Socket is mounted read-only and access is filtered.

#### 4. Container CPU Priority

```
[WARN] 5.11 - Ensure CPU priority is set appropriately
```

**Status**: Low priority
**Reason**: CPU priority (nice) is not set. Our resource limits use CPU quotas instead.

**Mitigation**: Consider adding `cpu_shares` if needed.

#### 5. Read-only Root Filesystem

```
[WARN] 5.12 - Ensure that the container's root filesystem is mounted as read only
```

**Status**: Partial implementation
**Reason**: Not all containers support read-only root filesystems due to application requirements.

**Mitigation**:
- Traefik: `read_only: true` can be enabled
- Database containers: Require writable root for operation
- Application containers: Varies by application

### Expected INFO Results

These are informational, not security issues:

```
[INFO] 4.5 - Ensure Content trust for Docker is enabled
```

**Status**: Not enabled
**Reason**: Content trust (image signing) adds deployment complexity. For a self-hosted lab environment, pulling from official registries is acceptable.

**Enhancement**: Consider implementing for production deployments.

## Running the Benchmark

### Full Scan (Recommended for Production)

```bash
# Must run as root for complete host checks
sudo ./scripts/security/run-docker-bench.sh
```

### Quick Scan (Development)

```bash
# Skip host checks, run container-only checks
./scripts/security/run-docker-bench.sh --quick
```

### Manual Run with Docker

```bash
docker run --rm --net host --pid host --userns host --cap-add audit_control \
    -e DOCKER_CONTENT_TRUST=$DOCKER_CONTENT_TRUST \
    -v /var/lib:/var/lib:ro \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v /usr/lib/systemd:/usr/lib/systemd:ro \
    -v /etc:/etc:ro \
    --label docker_bench_security \
    docker/docker-bench-security
```

## Interpreting Results

### Result Types

| Symbol | Meaning | Action Required |
|--------|---------|-----------------|
| `[PASS]` | Check passed | None |
| `[WARN]` | Potential issue | Review and document |
| `[INFO]` | Informational | Optional improvement |
| `[NOTE]` | Cannot check | May need manual verification |

### Prioritizing Fixes

1. **Critical** - Any `[WARN]` related to:
   - Privileged containers (unless justified)
   - Secrets exposure
   - Network exposure

2. **High** - Any `[WARN]` related to:
   - Docker socket access
   - User namespace issues
   - Missing resource limits

3. **Medium** - Any `[WARN]` related to:
   - Non-root user setup
   - Read-only filesystems
   - Logging configuration

4. **Low** - Any `[INFO]` items

## Report Location

Reports are saved to:
```
../../.dev/ai/security/docker-bench-YYYY-MM-DD-HHMMSS.log
```

View the latest report:
```bash
ls -la ../../.dev/ai/security/docker-bench-*.log | tail -1
```

## Continuous Monitoring

Consider running docker-bench-security:

- **Weekly** during development
- **Before each release** to production
- **After infrastructure changes**
- **As part of security audits**

## Related Documentation

- [Security Guide](../../docs/SECURITY.md)
- [ADR-0004: Docker Socket Proxy](../../docs/decisions/0004-docker-socket-proxy.md)
- [ADR-0200: Non-Root Containers](../../docs/decisions/0200-non-root-containers.md)
- [ADR-0201: Security Anchors](../../docs/decisions/0201-security-anchors.md)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
