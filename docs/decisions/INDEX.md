# Decision Record Index

A categorized index of all Architecture Decision Records in this project.

---

## Foundation (0000-0099)

Core infrastructure decisions that shape the fundamental architecture.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0000](./0000-template.md) | ADR Template | reference | - |
| [0001](./0001-traefik-reverse-proxy.md) | Traefik as Reverse Proxy | **accepted** | 2026-01-02 |
| [0002](./0002-four-network-topology.md) | Four-Network Topology | **accepted** | 2026-01-02 |
| [0003](./0003-file-based-secrets.md) | File-Based Secrets Management | **accepted** | 2026-01-02 |
| [0004](./0004-docker-socket-proxy.md) | Docker Socket Proxy | **accepted** | 2026-01-02 |

---

## Databases (0100-0199)

Decisions about database selection, configuration, and data persistence.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0100](./0100-multi-database-profiles.md) | Multi-Database Profiles | **accepted** | 2026-01-02 |
| [0101](./0101-postgresql-pgvector.md) | PostgreSQL with pgvector Extension | **accepted** | 2026-01-02 |

---

## Security (0200-0299)

Security architecture and hardening decisions.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0200](./0200-non-root-containers.md) | Non-Root Container Execution | **accepted** | 2026-01-02 |
| [0201](./0201-security-anchors.md) | Security Anchors Pattern | **accepted** | 2026-01-02 |
| [0202](./0202-sops-age-secrets-encryption.md) | SOPS and Age Secrets Encryption | **accepted** | 2026-01-03 |

---

## Operations (0300-0399)

Deployment, monitoring, and operational decisions.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0300](./0300-health-check-strategy.md) | Health Check Strategy | **accepted** | 2026-01-02 |
| [0301](./0301-deployment-scripts.md) | Deployment Scripts | **accepted** | 2026-01-02 |

---

## Structure (0400-0499)

Project organization and compose file structure decisions.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0400](./0400-profile-system.md) | Docker Compose Profile System | **accepted** | 2026-01-02 |
| [0401](./0401-example-application-pattern.md) | Example Application Pattern | **accepted** | 2026-01-02 |

---

## Legend

| Status | Meaning |
|--------|---------|
| reference | Template or reference document |
| proposed | Draft under discussion |
| **accepted** | Currently in effect |
| ~~deprecated~~ | No longer recommended |
| superseded | Replaced by newer ADR |

---

## Statistics

- **Total Decisions**: 12 accepted
- **Last Updated**: 2026-01-02

---

## ADR Summary by Topic

### Why Traefik?
- [ADR-0001](./0001-traefik-reverse-proxy.md) explains why Traefik was chosen over Caddy and nginx for reverse proxy duties.

### How are networks organized?
- [ADR-0002](./0002-four-network-topology.md) describes the four-network security architecture.

### How are secrets managed?
- [ADR-0003](./0003-file-based-secrets.md) covers file-based secrets over environment variables.

### Why use a Docker socket proxy?
- [ADR-0004](./0004-docker-socket-proxy.md) explains the security benefits of filtered Docker API access.

### How are databases organized?
- [ADR-0100](./0100-multi-database-profiles.md) describes the multi-database profile approach.
- [ADR-0101](./0101-postgresql-pgvector.md) details the PostgreSQL image selection with pgvector.

### What security measures are in place?
- [ADR-0200](./0200-non-root-containers.md) covers non-root execution and security baselines.
- [ADR-0201](./0201-security-anchors.md) explains the YAML anchor pattern for consistent security.

### How do health checks work?
- [ADR-0300](./0300-health-check-strategy.md) describes the shallow health check approach.

### How do I deploy?
- [ADR-0301](./0301-deployment-scripts.md) covers the deployment script architecture.

### How are profiles organized?
- [ADR-0400](./0400-profile-system.md) explains the Docker Compose profile system.

### How do I add my application?
- [ADR-0401](./0401-example-application-pattern.md) describes the example application pattern.

---

## Contributing

When adding a new decision:

1. Assign the next available number in the appropriate range
2. Create the ADR using [0000-template.md](./0000-template.md)
3. Add an entry to this index
4. Update the statistics section

### Number Ranges

| Range | Category |
|-------|----------|
| 0000-0099 | Foundation / Infrastructure |
| 0100-0199 | Databases |
| 0200-0299 | Security |
| 0300-0399 | Operations |
| 0400-0499 | Structure / Organization |
