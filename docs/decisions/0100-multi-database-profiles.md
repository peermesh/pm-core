# ADR-0100: Multi-Database Profiles

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

Different applications require different databases:

- **PostgreSQL**: Required by Matrix Synapse, LibreChat (relational data)
- **MySQL**: Required by Ghost CMS (Ghost dropped PostgreSQL support)
- **MongoDB**: Required by LibreChat (conversation storage)

The project must support multiple database engines while:

- Allowing users to enable only what they need
- Providing production-ready configurations for each
- Maintaining isolation between database instances
- Keeping memory usage predictable

---

## Decision

**We will provide PostgreSQL, MySQL, and MongoDB as separate Docker Compose profiles**, each with production-tuned configurations and explicit memory limits.

Users enable databases via `COMPOSE_PROFILES`:

```bash
# Enable PostgreSQL only
COMPOSE_PROFILES=postgresql

# Enable PostgreSQL and MongoDB
COMPOSE_PROFILES=postgresql,mongodb

# Enable all databases
COMPOSE_PROFILES=postgresql,mysql,mongodb
```

Each database runs as an independent container with:
- Dedicated named volume for data persistence
- Internal network isolation (db-internal)
- Health checks for dependency ordering
- Memory limits based on resource profile

---

## Alternatives Considered

### Option A: PostgreSQL Only

**Description**: Standardize on PostgreSQL for all applications.

**Pros**:
- Simpler architecture
- Single backup strategy
- Lower total memory usage

**Cons**:
- Ghost CMS officially supports only MySQL
- MongoDB required for LibreChat conversations
- Would limit application compatibility

**Why not chosen**: Ghost CMS dropped PostgreSQL support. Forcing PostgreSQL would exclude Ghost and applications requiring document databases.

### Option B: Shared Database Instances

**Description**: Multiple applications share the same database server (separate databases).

**Pros**:
- Lower memory overhead
- Fewer containers to manage

**Cons**:
- Single point of failure affects multiple apps
- Resource contention between applications
- Complicates backup/restore for individual apps
- Version upgrade affects all consumers

**Why not chosen**: Failure isolation is more important than memory savings. Independent containers allow upgrading one database without affecting others.

### Option C: Always-On All Databases

**Description**: Start all databases regardless of whether applications need them.

**Pros**:
- Simplest configuration
- Ready for any application

**Cons**:
- Wastes 1-2GB RAM on unused databases
- Unnecessary attack surface
- Violates principle of enabling only what's needed

**Why not chosen**: Commodity VPS have limited RAM. Running unused databases wastes resources and increases attack surface.

---

## Consequences

### Positive

- Users enable only databases their applications need
- Each database independently tunable
- Failure isolation - MySQL crash doesn't affect PostgreSQL
- Clear ownership - each database's purpose is unambiguous
- Independent backup/restore per database

### Negative

- Higher total memory when using multiple databases
- Users must know which profiles their applications need
- Configuration spread across profile documentation

### Neutral

- Each database type has its own init scripts directory

---

## Implementation Notes

### Profile Definitions

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    profiles:
      - postgresql
    networks:
      - db-internal
    # ... configuration

  mysql:
    image: mysql:8.0
    profiles:
      - mysql
    networks:
      - db-internal
    # ... configuration

  mongodb:
    image: mongo:7.0
    profiles:
      - mongodb
    networks:
      - db-internal
    # ... configuration
```

### Memory Allocation (Core Profile)

| Database | Container Limit | Reservation | Internal Config |
|----------|-----------------|-------------|-----------------|
| PostgreSQL | 1GB | 512MB | shared_buffers=256MB |
| MySQL | 1GB | 512MB | innodb_buffer_pool_size=384MB |
| MongoDB | 1GB | 512MB | wiredTigerCacheSizeGB=0.25 |

### Application-to-Database Mapping

| Application | Required Profile(s) |
|-------------|---------------------|
| Ghost CMS | mysql |
| Matrix Synapse | postgresql |
| LibreChat | postgresql, mongodb |
| Solid Server | postgresql |

### Network Isolation

All databases connect only to `db-internal` network:
- No direct internet access
- Only application containers on `db-internal` can reach databases
- No external port exposure

---

## References

### Documentation

- [Docker Compose Profiles](https://docs.docker.com/compose/profiles/) - Official profile documentation

### Related ADRs

- [ADR-0101: PostgreSQL pgvector](./0101-postgresql-pgvector.md) - PostgreSQL image selection
- [ADR-0002: Four-Network Topology](./0002-four-network-topology.md) - Database network isolation
- [ADR-0400: Profile System](./0400-profile-system.md) - Overall profile architecture

### Internal Reference

- D2.1-DATABASE-SELECTION.md - Original decision document with full database analysis

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |
