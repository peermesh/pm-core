# PeerMesh Module Foundation

The Foundation is the core layer that enables modular, swappable, and extensible deployments in the PeerMesh Docker Lab ecosystem.

## Core Principle: Interfaces Over Implementations

The Foundation contains **only interfaces and schemas**. It defines:
- What a module looks like (manifest schema)
- How modules communicate (event bus interface)
- What modules can require (connection abstractions)
- When module code runs (lifecycle hooks)

The Foundation does **NOT** contain:
- Event bus implementations (install `eventbus-redis`, `eventbus-nats`, or `eventbus-memory`)
- Database adapters (install `provider-postgres`, `provider-mysql`, etc.)
- Dashboard UI (install `dashboard-ui`)

This separation means the core has **zero runtime dependencies** and works out of the box.

## Quick Start

### Creating a New Module

1. Copy the template:
   ```bash
   cp -r foundation/templates/module-template my-module
   cd my-module
   ```

2. Edit `module.json` with your module details:
   ```json
   {
     "id": "my-module",
     "version": "1.0.0",
     "name": "My Module",
     "foundation": {
       "minVersion": "1.0.0"
     }
   }
   ```

3. Implement lifecycle hooks as needed:
   ```bash
   mkdir scripts
   # Create install.sh, health.sh, etc.
   ```

4. Add your Docker Compose services in `docker-compose.yml`

### Module Structure

```
my-module/
├── module.json           # Module manifest (required)
├── docker-compose.yml    # Service definitions
├── scripts/
│   ├── install.sh        # One-time setup
│   ├── start.sh          # Service activation
│   ├── stop.sh           # Graceful shutdown
│   ├── uninstall.sh      # Cleanup
│   └── health.sh         # Health check
├── config/               # Configuration files
└── README.md             # Module documentation
```

## Foundation Components

### 1. Module Manifest Schema

Defines the structure of `module.json` files. See [`schemas/module.schema.json`](schemas/module.schema.json).

Key sections:
- **id, version, name**: Module identity
- **foundation**: Version compatibility
- **requires**: Dependencies (connections, other modules)
- **provides**: What this module offers (connections, events)
- **dashboard**: UI registration
- **lifecycle**: Hook scripts

Documentation: [`docs/MODULE-MANIFEST.md`](docs/MODULE-MANIFEST.md)

### 2. Lifecycle Hooks

Standardized entry points for module operations. See [`schemas/lifecycle.schema.json`](schemas/lifecycle.schema.json).

| Hook | When Called | Purpose |
|------|-------------|---------|
| `install` | Module added | One-time setup |
| `start` | Module activated | Start services |
| `stop` | Module deactivated | Graceful shutdown |
| `uninstall` | Module removed | Cleanup |
| `health` | Periodic/on-demand | Return status |

Documentation: [`docs/LIFECYCLE-HOOKS.md`](docs/LIFECYCLE-HOOKS.md)

### 3. Event Bus Interface

Modules communicate via a shared event bus. The foundation defines:
- Event format (id, timestamp, source, type, payload)
- Standard event types (`foundation.module.*`)
- Topic naming convention (`module-id.entity.action`)

See [`schemas/event.schema.json`](schemas/event.schema.json).

**Important**: The foundation only defines the interface. To use the event bus, install an implementation module like `eventbus-memory` (dev) or `eventbus-redis` (production).

### 4. Connection Abstraction

Modules declare what they need, not how it's provided:

```json
{
  "requires": {
    "connections": [
      {
        "type": "database",
        "providers": ["postgres", "mysql", "sqlite"],
        "required": true
      }
    ]
  }
}
```

The system matches requirements to available providers at runtime.

### 5. Dashboard Registration

Modules can register UI elements with the dashboard:

```json
{
  "dashboard": {
    "displayName": "My Module",
    "icon": "puzzle",
    "routes": [
      {"path": "/my-module", "nav": {"label": "My Module"}}
    ]
  }
}
```

If no dashboard is installed, registration is a no-op.

## Version Compatibility

Modules declare which foundation versions they support:

```json
{
  "foundation": {
    "minVersion": "1.0.0",
    "maxVersion": "2.0.0"
  }
}
```

- `minVersion`: Required. Minimum foundation version.
- `maxVersion`: Optional. Maximum supported version (for breaking changes).

### Version Checking

Use the version-check script to verify module compatibility:

```bash
# Check if a module is compatible with current foundation
./lib/version-check.sh module my-module

# Check against specific foundation version
./lib/version-check.sh module my-module --foundation-version 1.5.0

# Compare two versions
./lib/version-check.sh compare 1.0.0 2.0.0

# Check version range
./lib/version-check.sh range 1.5.0 ">=1.0.0 <2.0.0"
```

Documentation: [`docs/VERSION-COMPATIBILITY.md`](docs/VERSION-COMPATIBILITY.md)

### 6. Docker Compose Base Patterns

Reusable YAML anchors for consistent module configuration:

```yaml
include:
  - path: ../../foundation/docker-compose.base.yml

services:
  my-service:
    <<: *module-defaults
    <<: *resource-limits-lite
```

Available patterns:

- **Module defaults**: Restart policy, logging configuration
- **Healthcheck timing**: Fast, default, slow profiles
- **Resource limits**: Lite (256M), standard (512M), heavy (1G)
- **Security defaults**: No-new-privileges, capability dropping
- **Networks**: Internal and external network definitions

Documentation: [`docs/COMPOSE-PATTERNS.md`](docs/COMPOSE-PATTERNS.md)

### 7. Migration System

The foundation includes a complete migration system for version upgrades:

```bash
# Check current migration status
./bin/foundation migrate status

# Apply pending migrations
./bin/foundation migrate up

# Rollback to a previous version
./bin/foundation migrate down 1.0.0

# Show migration history
./bin/foundation migrate history
```

Key features:

- **Automatic Detection**: Detects version changes on startup
- **Idempotent Migrations**: Safe to run multiple times
- **Rollback Support**: Downgrade when needed
- **JSON Output**: Machine-readable output for scripting

Documentation: [`docs/MIGRATION-GUIDE.md`](docs/MIGRATION-GUIDE.md)

### 8. Foundation CLI

The `foundation` command provides a unified interface for all foundation operations:

```bash
# Show foundation version
./bin/foundation version

# List installed modules
./bin/foundation module list

# Validate module manifest
./bin/foundation module validate ./my-module

# Generate .env files from configuration
./bin/foundation config env ./my-module

# Validate foundation configuration
./bin/foundation config validate
```

Run `./bin/foundation --help` for complete documentation.

## Directory Structure

```
foundation/
├── README.md                    # This file
├── VERSION                      # Current foundation version
├── docker-compose.base.yml      # Reusable Compose patterns
├── bin/
│   ├── foundation               # Main CLI entry point
│   └── migrate                  # Migration management CLI
├── schemas/
│   ├── module.schema.json       # Module manifest schema
│   ├── lifecycle.schema.json    # Lifecycle hooks schema
│   ├── event.schema.json        # Event format schema
│   ├── connection.schema.json   # Connection abstraction schema
│   ├── dashboard.schema.json    # Dashboard registration schema
│   ├── config.schema.json       # Configuration schema
│   ├── version.schema.json      # Version compatibility schema
│   ├── security.schema.json     # Security policy schema
│   ├── security-event.schema.json # Security event schema
│   └── contract-manifest.schema.json # Capability contract schema
├── lib/
│   ├── version-check.sh         # Version compatibility checker
│   ├── connection-resolve.sh    # Connection resolution script
│   ├── dashboard-register.sh    # Dashboard registration script
│   ├── env-generate.sh          # Environment generation script
│   └── eventbus-noop.sh         # No-op event bus fallback
├── interfaces/
│   ├── eventbus.ts              # Event bus TypeScript interface
│   ├── eventbus.py              # Event bus Python interface
│   ├── connection.ts            # Connection TypeScript interface
│   ├── connection.py            # Connection Python interface
│   ├── dashboard.ts             # Dashboard TypeScript interface
│   ├── dashboard.py             # Dashboard Python interface
│   ├── contract.ts              # Contract TypeScript interface
│   ├── contract.py              # Contract Python interface
│   ├── identity.ts              # Identity TypeScript interface
│   ├── identity.py              # Identity Python interface
│   ├── encryption.ts            # Encryption TypeScript interface
│   └── encryption.py            # Encryption Python interface
├── docs/
│   ├── decisions/               # Foundation ADR symlinks
│   │   └── README.md            # Decision mapping guide
│   ├── MODULE-MANIFEST.md       # Manifest documentation
│   ├── LIFECYCLE-HOOKS.md       # Lifecycle documentation
│   ├── COMPOSE-PATTERNS.md      # Docker Compose patterns
│   ├── EVENT-BUS-INTERFACE.md   # Event bus documentation
│   ├── CONNECTION-ABSTRACTION.md # Connection documentation
│   ├── DASHBOARD-REGISTRATION.md # Dashboard documentation
│   ├── CONFIGURATION-SCHEMA.md  # Configuration documentation
│   ├── MIGRATION-GUIDE.md       # Migration system guide
│   └── VERSION-COMPATIBILITY.md # Version compatibility guide
└── templates/
    └── module-template/         # New module template
        ├── module.json
        ├── docker-compose.yml
        └── README.md
```

## Design Principles

1. **Zero Runtime Dependencies**: Core works with nothing installed
2. **Interfaces Not Implementations**: Core defines contracts, add-ons implement
3. **BYOK (Bring Your Own Keys)**: Users provide credentials, never stored in code
4. **Swappable Connections**: Same module works with different backends
5. **Optional Dashboard**: Headless/CLI deployments are first-class
6. **Semantic Versioning**: Clear compatibility and migration paths

## Related Documentation

### Foundation Docs

- [Module Manifest Reference](docs/MODULE-MANIFEST.md)
- [Lifecycle Hooks Guide](docs/LIFECYCLE-HOOKS.md)
- [Docker Compose Patterns](docs/COMPOSE-PATTERNS.md)
- [Event Bus Interface](docs/EVENT-BUS-INTERFACE.md)
- [Connection Abstraction](docs/CONNECTION-ABSTRACTION.md)
- [Dashboard Registration](docs/DASHBOARD-REGISTRATION.md)
- [Configuration Schema](docs/CONFIGURATION-SCHEMA.md)
- [Migration Guide](docs/MIGRATION-GUIDE.md)
- [Version Compatibility](docs/VERSION-COMPATIBILITY.md)

### Architecture

- [System Architecture](../docs/ARCHITECTURE.md) - Four-tier modular architecture overview
- [Foundation Decisions](docs/decisions/) - ADR symlinks with legacy reference mapping
- [Full ADR Index](../docs/decisions/INDEX.md) - Complete decision record index

## License

See repository root LICENSE file.
