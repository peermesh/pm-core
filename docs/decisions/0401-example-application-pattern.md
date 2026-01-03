# ADR-0401: Example Application Pattern

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

The Docker boilerplate provides infrastructure (reverse proxy, databases, security). Users need guidance on how to deploy actual applications on top of this foundation.

Examples must:

- Demonstrate real-world application deployment
- Show integration with foundation services (Traefik, databases)
- Be runnable without modification for testing
- Serve as templates for custom applications
- Not clutter the main compose file

---

## Decision

**We will provide example applications in a dedicated `examples/` directory**, each with its own compose file that references the foundation's networks and services.

Examples are deployed by extending the base compose file:

```bash
docker compose -f docker-compose.yml -f examples/ghost/compose.yaml up -d
```

Each example includes:
- `compose.yaml` - Docker Compose configuration
- `README.md` - Setup instructions and prerequisites
- Configuration files as needed

---

## Alternatives Considered

### Option A: Examples in Main Compose File

**Description**: Add example applications as profiles in the main docker-compose.yml.

**Pros**:
- Single file to manage
- Profiles already understood

**Cons**:
- Main file becomes very large
- Mixing infrastructure with applications
- All examples share same profile namespace

**Why not chosen**: Infrastructure and applications have different lifecycles. The main compose file should remain focused on foundation services.

### Option B: Separate Repositories

**Description**: Each example in its own repository.

**Pros**:
- Complete independence
- Clear ownership
- Could be community-contributed

**Cons**:
- Synchronization complexity
- Foundation changes require updating all repos
- Harder to ensure compatibility

**Why not chosen**: Tight coupling between foundation and examples makes co-location beneficial during development. Separate repos can be considered for mature examples.

### Option C: Examples as Docker Images

**Description**: Pre-built images with example configurations baked in.

**Pros**:
- Faster to run
- No build step

**Cons**:
- Less educational (can't see configuration)
- Harder to customize
- Must maintain image builds

**Why not chosen**: Examples should be educational. Seeing the compose configuration teaches users how to create their own.

---

## Consequences

### Positive

- Clear separation between foundation and applications
- Examples can evolve independently
- Users can pick and choose which examples to explore
- Examples serve as templates for custom applications

### Negative

- Multiple compose files to manage
- Must ensure examples stay compatible with foundation changes
- Users need to understand file composition

### Neutral

- Examples reference foundation networks as external

---

## Implementation Notes

### Directory Structure

```
examples/
├── ghost/
│   ├── compose.yaml
│   ├── README.md
│   └── .env.example
├── librechat/
│   ├── compose.yaml
│   ├── README.md
│   └── config/
├── matrix-synapse/
│   ├── compose.yaml
│   ├── README.md
│   └── homeserver.yaml
├── solid-server/
│   ├── compose.yaml
│   └── README.md
└── _template/
    ├── compose.yaml
    └── README.md
```

### Example compose.yaml Pattern

```yaml
# examples/ghost/compose.yaml
#
# Ghost CMS Example
#
# Prerequisites:
#   - Foundation running (docker compose up -d)
#   - MySQL profile enabled (COMPOSE_PROFILES=mysql)
#
# Deploy:
#   docker compose -f docker-compose.yml -f examples/ghost/compose.yaml up -d

services:
  ghost:
    image: ghost:5-alpine
    container_name: pmdl_ghost
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      url: https://blog.${DOMAIN}
      database__client: mysql
      database__connection__host: mysql
      database__connection__database: ghost
      database__connection__user: ghost
      database__connection__password__file: /run/secrets/ghost_db_password
    secrets:
      - ghost_db_password
    volumes:
      - ghost_content:/var/lib/ghost/content
    networks:
      - pmdl_proxy-external
      - pmdl_db-internal
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ghost.rule=Host(`blog.${DOMAIN}`)"
      - "traefik.http.routers.ghost.entrypoints=websecure"
      - "traefik.http.routers.ghost.tls.certresolver=letsencrypt"
      - "traefik.http.services.ghost.loadbalancer.server.port=2368"

secrets:
  ghost_db_password:
    file: ./secrets/ghost_db_password

volumes:
  ghost_content:

networks:
  pmdl_proxy-external:
    external: true
  pmdl_db-internal:
    external: true
```

### Example README Pattern

```markdown
# Ghost CMS Example

A self-hosted blogging platform deployed on Peer Mesh Docker Lab.

## Prerequisites

- Foundation running with MySQL profile
- Domain configured in .env

## Quick Start

1. Generate additional secrets:
   ```bash
   ./scripts/generate-secrets.sh
   ```

2. Initialize Ghost database:
   ```bash
   docker compose exec mysql mysql -u root -p < examples/ghost/init.sql
   ```

3. Deploy Ghost:
   ```bash
   docker compose -f docker-compose.yml -f examples/ghost/compose.yaml up -d
   ```

4. Access at https://blog.yourdomain.com

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| GHOST_URL | blog.${DOMAIN} | Public URL |

## Maintenance

### Backup
Ghost content stored in `ghost_content` volume.

### Updates
```bash
docker compose -f docker-compose.yml -f examples/ghost/compose.yaml pull
docker compose -f docker-compose.yml -f examples/ghost/compose.yaml up -d
```
```

### Template Example

`examples/_template/` provides starting point for new applications:

```yaml
# examples/_template/compose.yaml
#
# Application Template
#
# Copy this directory and customize for your application.
#
# Checklist:
# - [ ] Update container name
# - [ ] Configure environment variables
# - [ ] Set correct Traefik labels
# - [ ] Add required secrets
# - [ ] Connect to appropriate networks
# - [ ] Update README.md

services:
  app:
    image: your-image:tag
    container_name: pmdl_yourapp
    # ... customize
```

### Running Examples

```bash
# Single example
docker compose -f docker-compose.yml -f examples/ghost/compose.yaml up -d

# Multiple examples
docker compose \
  -f docker-compose.yml \
  -f examples/ghost/compose.yaml \
  -f examples/matrix-synapse/compose.yaml \
  up -d

# Using COMPOSE_FILE environment variable
export COMPOSE_FILE=docker-compose.yml:examples/ghost/compose.yaml
docker compose up -d
```

---

## References

### Documentation

- [Docker Compose Multiple Files](https://docs.docker.com/compose/multiple-compose-files/) - Official documentation

### Related ADRs

- [ADR-0400: Profile System](./0400-profile-system.md) - Profile activation for prerequisites
- [ADR-0002: Four-Network Topology](./0002-four-network-topology.md) - Network references

### Internal Reference

- D13-CORE-DEPLOYMENT.md - Example deployment patterns
- D15-RELEASE-STRUCTURE.md - Directory organization

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |
