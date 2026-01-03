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
