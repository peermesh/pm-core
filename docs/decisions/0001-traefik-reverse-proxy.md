# ADR-0001: Traefik as Reverse Proxy

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

This project requires a reverse proxy to handle HTTP/HTTPS traffic routing, TLS certificate management, and service discovery for containerized applications. The solution must:

- Work natively with Docker Compose without external orchestration
- Support automatic service discovery via container labels
- Handle TLS certificates automatically (Let's Encrypt)
- Run on commodity VPS with limited resources (2-8GB RAM)
- Support WebSocket connections for real-time applications
- Enable federation protocols (Matrix on port 8448)
- Require zero daily maintenance

The reverse proxy is a core infrastructure component that all other services depend on for external accessibility.

---

## Decision

**We will use Traefik v3 as the reverse proxy** with Coreel-based service discovery, automatic TLS via Let's Encrypt (HTTP-01 challenge, DNS-01 for wildcards), and docker-socket-proxy for secure Docker API access.

Traefik was selected because it provides native Docker integration without plugins, automatic service discovery through container labels, and built-in ACME certificate management. This eliminates the need for central configuration files and allows each service to declare its own routing rules.

---

## Alternatives Considered

### Option A: Caddy v2

**Description**: Modern web server with automatic HTTPS and a growing ecosystem.

**Pros**:
- Automatic HTTPS with zero configuration
- Lower memory footprint (30-50MB typical)
- Simple Caddyfile syntax

**Cons**:
- Coreel-based discovery requires third-party plugin (caddy-docker-proxy)
- Plugin introduces dependency on external maintainer
- Version compatibility between Caddy and plugin must be tracked

**Why not chosen**: The dependency on `caddy-docker-proxy` for label-based discovery introduces third-party maintenance risk. All research sources noted this as a concern for production deployments.

### Option B: nginx with nginx-proxy + acme-companion

**Description**: Battle-tested web server with companion containers for Docker integration and TLS.

**Pros**:
- Extremely battle-tested
- Lowest memory footprint (10-30MB for nginx alone)
- Most documentation and examples available

**Cons**:
- Requires 3 containers for full solution (nginx, nginx-proxy, acme-companion)
- WebSocket support requires explicit header configuration
- Service changes require configuration file updates

**Why not chosen**: The multi-container architecture adds operational complexity. Manual WebSocket configuration and central config file management conflict with our zero-maintenance goal.

---

## Consequences

### Positive

- Services self-register through Coreels - no central routing configuration
- Automatic TLS certificates with Let's Encrypt
- Native WebSocket support without configuration
- Built-in health check endpoint for monitoring
- Dashboard available for debugging (localhost only by default)

### Negative

- Slightly higher memory usage than nginx (50-100MB vs 10-30MB)
- Traefik v3 is newer than v2 (released April 2024)
- Label syntax can become verbose for complex routing rules

### Neutral

- Routing configuration lives in each service's compose definition rather than a central file

---

## Implementation Notes

- Traefik dashboard bound to localhost only (127.0.0.1:8080) for security
- Matrix federation supported via dedicated entrypoint on port 8448
- Docker socket access through socket-proxy container (see ADR-0004)
- ACME certificates stored in named volume with 600 permissions

### Version Compatibility Warning

**Traefik v3.2 is incompatible with Docker 29.x** due to Docker API version mismatch. Traefik v3.2's Docker client uses API v1.24, but Docker 29.x requires API v1.44 or higher.

**Symptoms**: Traefik container fails to start or cannot communicate with Docker socket proxy.

**Workaround**: Use Traefik v2.11 until this is resolved upstream.

```yaml
# Use v2.11 instead of v3.2
services:
  traefik:
    image: traefik:v2.11
```

This issue affects Docker Engine 29.x releases (May 2025+). Monitor the [Traefik GitHub issues](https://github.com/traefik/traefik/issues) for resolution status.

---

## References

### Documentation

- [Traefik Docker Provider](https://doc.traefik.io/traefik/providers/docker/) - Official Docker integration docs
- [Traefik ACME](https://doc.traefik.io/traefik/https/acme/) - Let's Encrypt configuration

### Related ADRs

- [ADR-0004: Docker Socket Proxy](./0004-docker-socket-proxy.md) - Secure Docker API access for Traefik

### Internal Reference

- D1.1-REVERSE-PROXY.md - Original decision document with full research synthesis

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |
