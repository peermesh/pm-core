# ADR-0201: Security Anchors Pattern

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

Security configurations must be applied consistently across all services. Without a systematic approach:

- Settings get copied inconsistently between services
- Security drift occurs as configurations diverge
- New services may miss security settings
- Audit becomes difficult without consistent patterns

The project needs a mechanism to:

- Define security settings once
- Apply them uniformly to all services
- Make exceptions explicit and documented
- Keep configuration DRY (Don't Repeat Yourself)

---

## Decision

**We will use YAML extension fields (anchors) to define reusable security configurations** that all services inherit.

Extension fields use the `x-` prefix and define anchors that can be referenced with `<<: *anchor-name` syntax:

```yaml
x-security-baseline: &security-baseline
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  read_only: true

services:
  app:
    <<: *security-baseline
    # Service-specific configuration
```

This pattern extends to health checks, logging, and restart policies.

---

## Alternatives Considered

### Option A: Copy Settings Per-Service

**Description**: Duplicate security configurations in each service definition.

**Pros**:
- Explicit - all settings visible per service
- No YAML features to learn

**Cons**:
- 100+ lines of duplicated configuration
- Changes must be made in multiple places
- Easy to miss services when updating

**Why not chosen**: Duplication leads to drift. When security settings change, some services will be missed.

### Option B: External Include Files

**Description**: Use Docker Compose `include` directive to pull in common configurations.

**Pros**:
- Separate files for different concerns
- Could share across projects

**Cons**:
- Requires Compose 2.20+
- File dependencies add complexity
- Conflicts with single-file pattern decision

**Why not chosen**: Version compatibility concerns and the single-file composition pattern decision (ADR-0400) preclude external includes.

### Option C: Environment-Based Templating

**Description**: Use tools like envsubst or gomplate to generate compose files.

**Pros**:
- Maximum flexibility
- Can generate complex configurations

**Cons**:
- Adds build step
- Generated files harder to debug
- Breaks Docker Compose's native tooling

**Why not chosen**: Introduces build step complexity. YAML anchors provide sufficient capability without external tooling.

---

## Consequences

### Positive

- Security settings defined in single location
- All services automatically inherit updates
- Exceptions are visually obvious (missing anchor reference)
- Configuration stays DRY
- Native Compose feature, no external tools

### Negative

- YAML anchor syntax has learning curve
- Cannot extend arrays (only maps)
- Anchors only work within single file

### Neutral

- Extension fields (`x-`) are ignored by Docker but preserved in file

---

## Implementation Notes

### Standard Anchors

```yaml
# Security baseline - all services should use this
x-security-baseline: &security-baseline
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  read_only: true
  tmpfs:
    - /tmp:size=64m,noexec,nosuid,nodev
    - /run:size=16m,noexec,nosuid,nodev

# Common logging configuration
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

# Restart policy
x-restart-policy: &restart-policy
  restart: unless-stopped

# Health check defaults
x-healthcheck-defaults: &healthcheck-defaults
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s
```

### Service Usage

```yaml
services:
  # Standard service with all anchors
  ghost:
    image: ghost:5-alpine
    <<: *security-baseline
    <<: *restart-policy
    user: "1000:1000"
    logging: *default-logging
    healthcheck:
      <<: *healthcheck-defaults
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:2368/health"]

  # Service with exception (documented)
  socket-proxy:
    image: tecnativa/docker-socket-proxy
    <<: *restart-policy
    # NOTE: Does NOT use security-baseline
    # Exception: Must run as root to access Docker socket
    user: "0:0"
    logging: *default-logging
```

### Anchor Combination

Combine multiple anchors:

```yaml
services:
  app:
    <<: *security-baseline
    <<: *restart-policy
    logging: *default-logging
    # All three anchors applied
```

### Override Values

Override specific values from an anchor:

```yaml
services:
  app:
    <<: *security-baseline
    read_only: false  # Override from anchor
    # Other security settings still apply
```

### Validation

Check that security anchors are applied:

```bash
# Expand compose file to see final configuration
docker compose config

# Grep for security settings
docker compose config | grep -A2 "security_opt:"
```

---

## References

### Documentation

- [Compose Extension Fields](https://docs.docker.com/compose/compose-file/11-extension/) - Official documentation
- [YAML Anchors](https://yaml.org/spec/1.2.2/#3222-anchors-and-aliases) - YAML specification

### Related ADRs

- [ADR-0200: Non-Root Containers](./0200-non-root-containers.md) - Security baseline details
- [ADR-0400: Profile System](./0400-profile-system.md) - Single-file composition pattern

### Internal Reference

- D3.2-CONTAINER-SECURITY.md - Security anchor definitions
- D5.1-SERVICE-COMPOSITION.md - Extension field patterns

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |
