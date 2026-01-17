# Docker Compose Base Patterns

This document describes how to use the foundation's Docker Compose base patterns for consistent, secure, and resource-efficient module configurations.

## Overview

The foundation provides `docker-compose.base.yml` containing extendable service definitions that ensure:

- Consistent logging and restart policies across all modules
- Standardized healthcheck timing configurations
- Resource limits aligned with VISION.md profiles
- Security hardening defaults

## Using the Base File

### The `extends` Directive

Use the `extends` directive to inherit from base service definitions:

```yaml
services:
  my-service:
    extends:
      file: ../../foundation/docker-compose.base.yml
      service: _module-defaults
    image: my-image:latest
    # ... additional configuration
```

The path is relative to your module's location. Adjust as needed based on your module's directory depth.

> **IMPORTANT**: YAML anchors (`&anchor`/`*anchor`) do NOT work across files. Always use `extends` for cross-file inheritance.

### Available Base Services

The foundation provides several base services prefixed with `_` (abstract, not deployed directly):

| Service | Purpose |
|---------|---------|
| `_module-defaults` | Restart policy + logging only |
| `_service-lite` | Defaults + lite resources (256MB) |
| `_service-standard` | Defaults + standard resources (512MB) |
| `_service-heavy` | Defaults + heavy resources (1GB) |
| `_security-hardened` | Defaults + security hardening |
| `_resource-limits-lite` | Resource limits only (256MB) |
| `_resource-limits-standard` | Resource limits only (512MB) |
| `_resource-limits-heavy` | Resource limits only (1GB) |

### Recommended Pattern

For most services, use the combined `_service-*` bases:

```yaml
services:
  my-app:
    extends:
      file: ../../foundation/docker-compose.base.yml
      service: _service-standard
    image: myimage:latest
```

This gives you restart policy, logging, AND resource limits in one extend.

## Base Service Details

### Module Defaults (`_module-defaults`)

Standard configuration for all services:

- `restart: unless-stopped`
- JSON file logging with 10MB max size, 3 file rotation

```yaml
services:
  my-service:
    extends:
      file: ../../foundation/docker-compose.base.yml
      service: _module-defaults
    image: my-image:latest
```

### Healthcheck Timing

Three timing profiles for different service startup characteristics. Since these are YAML anchors (not `extends`-compatible), copy the values directly:

| Profile | Interval | Timeout | Retries | Start Period | Use Case |
|---------|----------|---------|---------|--------------|----------|
| defaults | 30s | 10s | 3 | 40s | Most services |
| fast | 10s | 5s | 3 | 20s | Lightweight services |
| slow | 60s | 30s | 5 | 120s | Heavy services (databases) |

```yaml
services:
  my-service:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Resource Limit Profiles

Aligned with VISION.md resource profiles:

| Service | Memory Limit | CPU Limit | Memory Reserved | Target Profile |
|---------|--------------|-----------|-----------------|----------------|
| `_resource-limits-lite` | 256M | 0.5 | 64M | lite (512MB total) |
| `_resource-limits-standard` | 512M | 1.0 | 128M | core (2GB total) |
| `_resource-limits-heavy` | 1G | 2.0 | 256M | full (4GB total) |

```yaml
services:
  my-service:
    extends:
      file: ../../foundation/docker-compose.base.yml
      service: _resource-limits-standard
    image: my-image:latest
```

**Planning Resource Usage**:

When designing your module, sum the limits of all services:

- **lite profile** (512MB total): Use `_service-lite` for most services
- **core profile** (2GB total): Use `_service-standard` as default
- **full profile** (4GB total): Use `_service-heavy` for resource-intensive services

### Security Hardening (`_security-hardened`)

Security hardening following VISION.md requirements:

- `no-new-privileges: true`
- Drop all Linux capabilities

```yaml
services:
  my-service:
    extends:
      file: ../../foundation/docker-compose.base.yml
      service: _security-hardened
    image: my-image:latest
```

## Network Segmentation

### Network Types

| Network | Purpose | Configuration |
|---------|---------|---------------|
| `module-internal` | Inter-service communication | Bridge, internal only |
| `module-external` | External access | Bridge, routable |

### Best Practices

1. **Default to internal**: Services should use `module-internal` unless external access is required
2. **Expose minimally**: Only the entry point service should be on `module-external`
3. **Declare networks**: Reference networks in your compose file

```yaml
services:
  # Internal service - no external access
  database:
    networks:
      - module-internal

  # Gateway service - externally accessible
  api:
    networks:
      - module-internal
      - module-external

networks:
  module-internal:
    external: true
    name: module-internal
  module-external:
    external: true
    name: module-external
```

## Healthcheck Best Practices

### Pattern: HTTP Health Endpoint

For web services with health endpoints:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
  <<: *healthcheck-defaults
```

### Pattern: TCP Port Check

For services without HTTP endpoints:

```yaml
healthcheck:
  test: ["CMD-SHELL", "nc -z localhost 5432 || exit 1"]
  <<: *healthcheck-defaults
```

### Pattern: Custom Script

For complex health logic:

```yaml
healthcheck:
  test: ["CMD", "/scripts/health.sh"]
  <<: *healthcheck-slow
```

### Using depends_on with Healthchecks

Ensure services start in order:

```yaml
services:
  database:
    healthcheck:
      test: ["CMD", "pg_isready"]
      <<: *healthcheck-slow

  app:
    depends_on:
      database:
        condition: service_healthy
```

## Complete Example

A module with database and API services using `extends`:

```yaml
services:
  my-module-db:
    extends:
      file: ../../foundation/docker-compose.base.yml
      service: _service-standard
    image: postgres:16-alpine
    container_name: my-module-db
    environment:
      POSTGRES_DB: ${MY_MODULE_DB_NAME:-mymodule}
      POSTGRES_USER: ${MY_MODULE_DB_USER:-mymodule}
      POSTGRES_PASSWORD: ${MY_MODULE_DB_PASSWORD}
    volumes:
      - my-module-db-data:/var/lib/postgresql/data
    networks:
      - module-internal
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "${MY_MODULE_DB_USER:-mymodule}"]
      interval: 60s
      timeout: 30s
      retries: 5
      start_period: 120s

  my-module-api:
    extends:
      file: ../../foundation/docker-compose.base.yml
      service: _service-lite
    image: my-module-api:latest
    container_name: my-module-api
    environment:
      DATABASE_URL: postgres://${MY_MODULE_DB_USER:-mymodule}:${MY_MODULE_DB_PASSWORD}@my-module-db:5432/${MY_MODULE_DB_NAME:-mymodule}
    depends_on:
      my-module-db:
        condition: service_healthy
    networks:
      - module-internal
      - module-external
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  my-module-db-data:
    name: my-module-db-data

networks:
  module-internal:
    external: true
    name: module-internal
  module-external:
    external: true
    name: module-external
```

> **Note**: The `extends` directive does not require an `include` directive - it references the base file directly.

## Troubleshooting

### Service Not Found in Extends

**Error**: `service "_module-defaults" not found in ...`

**Cause**: The path to the base file is incorrect or the service name is misspelled.

**Solution**: Verify the `file:` path is correct relative to your compose file. Check the service name matches exactly (including the underscore prefix).

### Resource Limits Not Applied

**Cause**: Docker Compose may not apply deploy resources in non-swarm mode.

**Solution**: Use `docker compose --compatibility up` or ensure Docker Compose V2 is installed.

### Network Not Found

**Error**: `network module-internal declared as external, but could not be found`

**Solution**: Create the network first:

```bash
docker network create module-internal
docker network create module-external
```

Or remove `external: true` to let Docker Compose create them.

## Related Documentation

- [Module Manifest Reference](./MODULE-MANIFEST.md)
- [Lifecycle Hooks Guide](./LIFECYCLE-HOOKS.md)
- [Event Bus Interface](./EVENT-BUS-INTERFACE.md)
