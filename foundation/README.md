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

## Directory Structure

```
foundation/
├── README.md                    # This file
├── schemas/
│   ├── module.schema.json       # Module manifest schema
│   ├── lifecycle.schema.json    # Lifecycle hooks schema
│   └── event.schema.json        # Event format schema
├── docs/
│   ├── MODULE-MANIFEST.md       # Manifest documentation
│   └── LIFECYCLE-HOOKS.md       # Lifecycle documentation
└── templates/
    └── module-template/         # New module template
        ├── module.json
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

- [Module Manifest Reference](docs/MODULE-MANIFEST.md)
- [Lifecycle Hooks Guide](docs/LIFECYCLE-HOOKS.md)

## License

See repository root LICENSE file.
