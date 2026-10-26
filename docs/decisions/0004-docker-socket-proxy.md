---
gas_schema: gas.doc.v1
type: decision
title: Docker Socket Proxy
status: accepted
created: 2026-10-24T15:20:58Z
updated: 2026-10-24T15:20:58Z
project: peermesh-core
project_root: .
---

# ADR-0004: Docker Socket Proxy

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

Traefik requires access to the Docker API to discover services and read container labels for routing configuration. The standard approach is to mount the Docker socket directly:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

However, this grants the container **full control over the Docker host**, including:
- Starting/stopping any container
- Creating privileged containers
- Accessing host filesystem through volume mounts
- Effectively root access to the host

If Traefik is compromised (e.g., through a vulnerability), the attacker gains complete host control.

---

## Decision

**We will use tecnativa/docker-socket-proxy** to provide filtered, read-only Docker API access to Traefik.

The socket proxy:
- Exposes only specific API endpoints (containers, networks)
- Blocks all write operations (POST, DELETE)
- Runs on an isolated internal network
- Provides the minimum API surface needed for service discovery

Traefik connects to `tcp://socket-proxy:2375` instead of mounting the Docker socket directly.

---

## Alternatives Considered

### Option A: Direct Socket Mount

**Description**: Mount `/var/run/docker.sock` directly into Traefik container.

**Pros**:
- Simplest configuration
- No additional containers
- Widely documented approach

**Cons**:
- Full Docker host control if Traefik is compromised
- Cannot restrict to read-only operations
- Violates principle of least privilege

**Why not chosen**: The security risk is unacceptable. A compromised Traefik container would mean complete host compromise.

### Option B: Read-Only Socket Mount

**Description**: Mount socket with `:ro` flag.

**Pros**:
- Signals intent to only read
- Slightly better than unrestricted mount

**Cons**:
- `:ro` flag has no effect on Unix sockets
- Socket access is still full read/write
- Provides false sense of security

**Why not chosen**: The `:ro` flag does not provide actual protection for Unix socket access. It only affects file content, not socket operations.

### Option C: Custom HAProxy Configuration

**Description**: Build custom proxy with HAProxy or similar.

**Pros**:
- Full control over filtering
- Could be optimized for specific use case

**Cons**:
- Requires maintaining custom configuration
- Additional complexity
- Reinventing existing solution

**Why not chosen**: tecnativa/docker-socket-proxy already provides a well-maintained, purpose-built solution.

---

## Consequences

### Positive

- Traefik cannot modify containers or images
- Attack surface limited to read-only container/network information
- Socket-proxy isolated on internal network
- Follows principle of least privilege

### Negative

- Adds one container (~32MB memory)
- Slightly more complex configuration
- Additional network required for isolation

### Neutral

- Traefik configuration changes from socket path to TCP endpoint

---

## Implementation Notes

### Socket Proxy Configuration

```yaml
services:
  socket-proxy:
    image: tecnativa/docker-socket-proxy:0.2
    # Must run as root to access Docker socket
    user: "0:0"
    environment:
      # Read-only access for service discovery
      CONTAINERS: 1
      NETWORKS: 1
      INFO: 1
      VERSION: 1
      # All write operations disabled
      SERVICES: 0
      TASKS: 0
      SWARM: 0
      VOLUMES: 0
      POST: 0
      BUILD: 0
      COMMIT: 0
      EXEC: 0
      IMAGES: 0
      # ... all others disabled
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - socket-proxy
```

### Traefik Configuration

```yaml
services:
  traefik:
    depends_on:
      - socket-proxy
    environment:
      - DOCKER_HOST=tcp://socket-proxy:2375
    networks:
      - socket-proxy
      - proxy-external
    # NO docker.sock volume mount
```

### Network Isolation

The `socket-proxy` network is marked `internal: true`, meaning:
- No external gateway
- Only socket-proxy and traefik can communicate on it
- Application containers cannot reach the Docker API

### Permission Details

| Permission | Value | Purpose |
|------------|-------|---------|
| CONTAINERS | 1 | Read container labels and state |
| NETWORKS | 1 | Read network information |
| INFO | 1 | API version check |
| VERSION | 1 | API compatibility |
| POST | 0 | Block all write operations |
| EXEC | 0 | Block container exec |
| All others | 0 | Deny by default |

---

## References

### Documentation

- [tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) - Official repository and documentation

### Related ADRs

- [ADR-0001: Traefik Reverse Proxy](./0001-traefik-reverse-proxy.md) - Traefik requires Docker API access
- [ADR-0002: Four-Network Topology](./0002-four-network-topology.md) - Socket-proxy network isolation

### Internal Reference

- D1.1-REVERSE-PROXY.md - Contains socket proxy configuration details

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |

## 2026-10-24 C11 addendum: separate consumer permissions

The earlier sections record the original decision. The canonical Compose
candidate extends it with two distinct Docker API networks and endpoints:

- Traefik uses `socket-proxy:2375` on the internal `socket-proxy` network.
- Dashboard uses `socket-proxy-dashboard:2375` on the internal
  `socket-proxy-dashboard` network, with no membership in `socket-proxy`.
- Both proxies retain the same pinned image, root socket-access exception,
  dropped capabilities, no-new-privileges, healthcheck and resource limits.
  Neither proxy publishes a port or joins an application, database or external
  routing network. Neither consumer mounts the Docker socket.

Both proxies permit container, network, info, version, event and ping reads.
Only the dashboard proxy permits volume reads, which its volume-list handler
uses. `IMAGES` and `SYSTEM` remain disabled on both: current dashboard callers
use container inspection/statistics, `/volumes`, `/version`, `/info` and
`/_ping`, not image listing or `/system/df`. `POST`, `EXEC`, `SECRETS` and other
unneeded categories remain disabled. The pinned proxy's default `AUTH` and
container start/stop/restart exceptions remain disabled as well.

The separate networks prevent a consumer on the narrower Docker API network
from reaching the volume-enabled endpoint. Traefik and dashboard still share
the external routing network for normal HTTP routing; neither Docker API proxy
is attached to that network. This is an API-category boundary, not per-container
authorization: permitted container inspection can reveal metadata and environment
values for containers visible to the daemon. Volume listing also exposes host
storage metadata. These residual read capabilities require trusted consumers.

The bounded verification uses the actual pinned proxy image against a synthetic
Unix socket that accepts all fixture requests. Compose-derived permissions,
denial without upstream access, allowed response bodies and cross-network IP
isolation must be proven. This does not establish real daemon discovery,
dashboard-session behavior or deployed Traefik compatibility.

Deployment is a separate step: capture the existing configuration, admit an
exclusive deployment window, add the dashboard proxy/network, update the
dashboard endpoint/membership and narrow Traefik's proxy. Verify actual discovery
and dashboard reads before accepting the change. Rollback restores the previous
Compose configuration and consumer memberships, then removes only the newly
introduced proxy/network after disconnecting its owned consumers. Rollback
restores the former wider shared read surface. No deployment is asserted here.
