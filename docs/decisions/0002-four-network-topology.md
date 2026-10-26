---
gas_schema: gas.doc.v1
type: decision
title: Four-Network Topology
status: accepted
created: 2026-10-24T15:20:58Z
updated: 2026-10-24T15:20:58Z
project: peermesh-core
project_root: .
---

# ADR-0002: Four-Network Topology

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

Container network isolation is critical for security. Without explicit network segmentation:

- All containers can communicate with each other by default
- Compromised containers can access databases directly
- Data exfiltration is possible from any container
- The blast radius of security incidents is maximized

The project needs a network architecture that:

- Prevents lateral movement between unrelated services
- Isolates databases from direct internet access
- Allows only the reverse proxy to receive external traffic
- Enables legitimate service-to-service communication
- Follows the principle of least privilege

---

## Decision

**We will use a four-network topology** with explicit segmentation:

1. **socket-proxy** (internal) - Docker API access for Traefik only
2. **db-internal** (internal) - Database network, no external gateway
3. **app-internal** (internal) - Application-to-application communication
4. **proxy-external** - External traffic through Traefik

Networks marked `internal: true` have no default gateway, preventing outbound internet access from containers on those networks.

---

## Alternatives Considered

### Option A: Flat Network (Single Bridge)

**Description**: All containers on the default Docker bridge network.

**Pros**:
- Simplest configuration
- All containers can communicate easily

**Cons**:
- No isolation between services
- Database ports accessible to all containers
- Maximum blast radius for security incidents
- Violates CIS Docker Benchmark

**Why not chosen**: Flat networks are explicitly prohibited by CIS Docker Benchmark for production deployments. Any compromised container could access all other services.

### Option B: Two-Tier (Proxy + Internal)

**Description**: One network for the proxy, one for everything else.

**Pros**:
- Simple to understand
- External/internal separation

**Cons**:
- Databases exposed to all application containers
- No isolation between different applications
- Socket-proxy not isolated

**Why not chosen**: Insufficient granularity. Applications that don't need database access would still have network access to databases.

### Option C: Micro-Segmented (Per-Service Networks)

**Description**: Each service pair gets its own network.

**Pros**:
- Minimal blast radius
- Perfect isolation

**Cons**:
- Exponential network complexity
- Difficult to manage and document
- Overkill for single-VPS deployments

**Why not chosen**: Management complexity exceeds security benefit for our target deployment size.

---

## Consequences

### Positive

- Database containers cannot reach the internet (prevents data exfiltration)
- Compromised application cannot pivot to other applications' databases
- Docker socket isolated from application containers
- Clear network boundaries for security auditing

### Negative

- Applications must be assigned to correct networks explicitly
- Debugging network connectivity requires understanding topology
- Some services need multiple network memberships

### Neutral

- Services use DNS names (container names) for communication within networks
- Docker handles IP assignment automatically

---

## Implementation Notes

### Network Definitions

```yaml
networks:
  socket-proxy:
    internal: true    # No external gateway
    name: pmdl_socket-proxy

  db-internal:
    internal: true    # No external gateway
    name: pmdl_db-internal

  app-internal:
    internal: true    # No external gateway
    name: pmdl_app-internal

  proxy-external:
    name: pmdl_proxy-external
```

### Service Network Assignment

| Service Type | socket-proxy | db-internal | app-internal | proxy-external |
|--------------|--------------|-------------|--------------|----------------|
| socket-proxy | X | | | |
| traefik | X | | | X |
| postgres/mysql/mongodb | | X | | |
| redis | | | X | |
| web applications | | X | X | X |

### Validation

```bash
# Verify database cannot reach internet
docker exec postgres ping -c1 8.8.8.8
# Should fail - no route to host

# Verify application can reach database
docker exec app ping -c1 postgres
# Should succeed
```

---

## References

### Documentation

- [Docker Compose Networking](https://docs.docker.com/compose/networking/) - Official networking documentation
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker) - Security best practices

### Related ADRs

- [ADR-0004: Docker Socket Proxy](./0004-docker-socket-proxy.md) - Socket-proxy network usage

### Internal Reference

- D3.3-NETWORK-ISOLATION.md - Original decision document with full topology details

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |

## 2026-10-24 C11 addendum: dashboard control network

The four-network decision above remains the historical baseline. The canonical
Compose candidate adds a fifth network, `socket-proxy-dashboard`, specifically
to isolate the dashboard's volume-reading Docker API endpoint from Traefik.
This is an explicit extension of the original topology, not a claim that the
earlier four-network diagram already described dashboard access.

The internal `socket-proxy` network contains only Traefik and its narrow proxy.
The internal `socket-proxy-dashboard` network contains only dashboard and its
own proxy. Each proxy joins exactly one control network, has no published port
and has no membership in `proxy-external`, `app-internal` or `db-internal`.
Dashboard and Traefik retain their normal `proxy-external` memberships for HTTP
routing; they share no Docker API network or proxy endpoint. The existing
database/application network assignments remain unchanged.

[ADR-0004](./0004-docker-socket-proxy.md#2026-10-24-c11-addendum-separate-consumer-permissions)
defines the per-consumer permissions, remaining container-metadata exposure and
deployment/rollback boundary. Verification must show an allowed request from
each control network and refusal to connect to the other proxy's actual IP,
not merely failure to resolve its DNS name. The candidate and synthetic fixture
proof do not establish production deployment or full runtime acceptance.
