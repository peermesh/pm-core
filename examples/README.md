# Example Applications

This directory contains production-ready example configurations demonstrating how to compose the Foundation and Supporting Tech Profiles to build real applications.

---

## What Are Examples?

Examples are **demonstrations, not core infrastructure**. They show how to use the foundation to deploy actual applications:

| Layer | Purpose | Location |
|-------|---------|----------|
| Foundation | Traefik, Networks, Secrets | Core compose files |
| Supporting Tech Profiles | PostgreSQL, MySQL, MongoDB, Redis, MinIO | Inline in compose |
| **Example Applications** | Ghost, LibreChat, Matrix | This directory |

**Examples are optional.** The foundation works without them. They exist to:
1. Demonstrate integration patterns
2. Provide copy-paste starting points
3. Validate that the foundation actually works

---

## Available Examples

| Example | Description | Profiles Used | Status |
|---------|-------------|---------------|--------|
| [Ghost](./ghost/) | Modern publishing platform | MySQL | Ready |
| [LibreChat](./librechat/) | AI assistant interface | MongoDB + PostgreSQL | Ready |
| [Matrix](./matrix/) | Federated communication | PostgreSQL + TURN | Ready |
| [_template](./\_template/) | Add your own application | Your choice | Template |

---

## How to Use an Example

### 1. Ensure Foundation is Running

Examples assume the foundation services are already deployed:

```bash
# From project root
docker compose up -d
```

This starts the core foundation (Traefik, socket-proxy). Database profiles are activated as needed by each example.

### 2. Enable the Required Profiles

Each example specifies which database profiles it needs:

```bash
# Ghost needs MySQL
docker compose -f docker-compose.yml \
               -f profiles/mysql/docker-compose.mysql.yml \
               -f examples/ghost/docker-compose.ghost.yml \
               up -d

# LibreChat needs MongoDB + PostgreSQL
docker compose -f docker-compose.yml \
               -f profiles/mongodb/docker-compose.mongodb.yml \
               -f profiles/postgresql/docker-compose.postgresql.yml \
               -f examples/librechat/docker-compose.librechat.yml \
               up -d
```

### 3. Generate Required Secrets

Each example documents which secrets need to exist:

```bash
# Check example README for required secrets
cat examples/ghost/.env.example

# Generate using project script
./scripts/generate-secrets.sh
```

### 4. Configure Environment

Copy and edit the example's `.env.example`:

```bash
cp examples/ghost/.env.example examples/ghost/.env
# Edit with your domain and settings
```

### 5. Start the Application

```bash
docker compose -f docker-compose.yml \
               -f profiles/mysql/docker-compose.mysql.yml \
               -f examples/ghost/docker-compose.ghost.yml \
               up -d
```

---

## Example Architecture

Each example demonstrates these integration patterns:

### 1. Network Integration

```yaml
services:
  my-app:
    networks:
      - proxy-external  # Traefik can reach it
      - db-internal     # Can reach database
```

### 2. Traefik Routing

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.myapp.rule=Host(`myapp.${DOMAIN}`)"
  - "traefik.http.routers.myapp.entrypoints=websecure"
  - "traefik.http.routers.myapp.tls.certresolver=letsencrypt"
```

### 3. Authelia Protection (Optional - Future)

When Authelia is configured, you can add protection to admin panels:

```yaml
labels:
  # Protect admin panel (uncomment when Authelia available)
  # - "traefik.http.routers.myapp-admin.rule=Host(`myapp.${DOMAIN}`) && PathPrefix(`/admin`)"
  # - "traefik.http.routers.myapp-admin.middlewares=authelia@file"
```

### 4. Database Dependencies

```yaml
services:
  my-app:
    depends_on:
      postgres:
        condition: service_healthy
```

### 5. Resource Limits

```yaml
deploy:
  resources:
    limits:
      memory: 512M
    reservations:
      memory: 256M
```

---

## Adding Your Own Application

See the [_template](./_template/) directory for a complete guide on adding new applications. The template includes:

- Boilerplate docker-compose file with all integration patterns
- .env.example template
- README template explaining what to customize
- Checklist for production readiness

---

## Design Principles

### 1. Examples Use Docker Compose Profiles

Examples are optional and activated explicitly:

```yaml
services:
  ghost:
    profiles:
      - ghost  # Only starts when 'ghost' profile is active
```

### 2. Examples Reference Profiles (Never Duplicate)

Examples reference database profiles, they don't copy configuration:

```yaml
# CORRECT - Reference profile
include:
  - path: ../../profiles/mysql/docker-compose.mysql.yml

# WRONG - Never duplicate profile content in examples
services:
  mysql:
    image: mysql:8.0
    # ... duplicated config
```

### 3. Examples Are Self-Contained Within Their Directory

Each example directory contains everything needed:

```
examples/ghost/
├── README.md              # Complete documentation
├── docker-compose.ghost.yml  # Application compose
└── .env.example           # Required environment variables
```

### 4. Examples Follow Foundation Patterns

All examples use the same patterns established in the foundation:

- Secrets via `_FILE` suffix or mounted files
- Healthchecks for startup ordering
- Resource limits for every container
- Internal networks for database access
- Traefik labels for routing

---

## Relationship to Foundation and Profiles

```
Foundation (always runs)
    ├── Traefik (reverse proxy)
    ├── Docker socket-proxy (secure Docker API)
    └── Networks + Secrets infrastructure

Supporting Tech Profiles (activated per-need)
    ├── PostgreSQL profile
    ├── MySQL profile
    ├── MongoDB profile
    ├── Redis profile
    └── MinIO profile

Example Applications (optional demonstrations)
    ├── Ghost (uses MySQL profile)
    ├── LibreChat (uses MongoDB + PostgreSQL profiles)
    └── Matrix (uses PostgreSQL profile)

Future (planned)
    ├── Authelia (SSO/authentication)
    └── TURN server (for Matrix)
```

---

## Validation

Before considering an example complete, verify:

- [ ] Starts with `docker compose up -d`
- [ ] Healthcheck passes within 60 seconds
- [ ] Accessible via Traefik at configured domain
- [ ] Admin panel protected by Authelia (if applicable)
- [ ] Resource limits enforced (`docker stats`)
- [ ] Logs show no errors (`docker compose logs`)
- [ ] Survives container restart
- [ ] Works with generated (not hardcoded) secrets

---

## References

- Foundation Decisions: `../foundation/docs/decisions/`
- Full ADR Index: `../docs/decisions/INDEX.md`
- Supporting Tech Profiles: `../profiles/`
- Database Profiles: [ADR-0100](../docs/decisions/0100-multi-database-profiles.md)
- Profile System: [ADR-0400](../docs/decisions/0400-profile-system.md)
- Example Application Pattern: [ADR-0401](../docs/decisions/0401-example-application-pattern.md)

---

*Created: 2025-12-31*
*Part of Peer Mesh Docker Lab*
