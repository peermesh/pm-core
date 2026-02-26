# Connection Abstraction

The connection abstraction system allows modules to declare what they need (database, cache, etc.) without specifying a particular implementation. The foundation resolves these requirements to available providers at runtime.

## Core Principle

**Modules declare requirements, not implementations.**

A module that needs "a database" can work with Postgres, MySQL, or SQLite - the foundation matches requirements to available providers.

## How It Works

```
Module declares:                    Foundation resolves:
"I need a database"                 "PostgreSQL is available"
"Prefer postgres, mysql, sqlite"    "Matched: postgres from provider-postgres"
                                    "Here's your connection config"
```

## Connection Types

| Type | Description | Common Providers |
|------|-------------|------------------|
| `database` | Relational or document databases | postgres, mysql, mongodb, sqlite |
| `cache` | Key-value caches | redis, memcached, valkey |
| `storage` | Object/file storage | local, s3, minio |
| `queue` | Message queues | rabbitmq, redis, nats |
| `eventbus` | Event bus for pub/sub | redis, nats, noop |
| `custom` | Custom connection types | Defined by modules |

## Declaring Requirements

In your `module.json`:

```json
{
  "requires": {
    "connections": [
      {
        "type": "database",
        "providers": ["postgres", "mysql", "sqlite"],
        "required": true,
        "name": "primary-db",
        "config": {
          "poolSize": 20,
          "timeout": 30000
        }
      },
      {
        "type": "cache",
        "providers": ["redis", "memcached"],
        "required": false,
        "name": "session-cache"
      }
    ]
  }
}
```

### Requirement Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Connection type (database, cache, etc.) |
| `providers` | Yes | Acceptable providers in preference order |
| `required` | No | Whether module fails without this (default: true) |
| `name` | No | Unique name for this requirement |
| `config` | No | Default configuration options |

## Providing Connections

Provider modules declare what they offer:

```json
{
  "provides": {
    "connections": [
      {
        "name": "postgres",
        "type": "database",
        "provides": ["postgres", "postgresql"],
        "version": "16",
        "config": {
          "host": "postgres",
          "port": 5432
        }
      }
    ]
  }
}
```

### Provider Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Provider identifier |
| `type` | Yes | Connection type provided |
| `provides` | Yes | List of identifiers this satisfies |
| `version` | No | Provider software version |
| `config` | No | Default configuration |

## Resolution Process

1. **Read Requirements**: Foundation reads module's `requires.connections`
2. **Scan Providers**: Check installed modules for `provides.connections`
3. **Match**: For each requirement, find a provider that:
   - Has matching `type`
   - Appears in `providers` list
4. **Merge Config**: Combine provider defaults with requirement config
5. **Return**: Resolved connections or errors

## Using the Resolver

### Command Line

```bash
# Resolve connections for a module
./foundation/lib/connection-resolve.sh my-module

# Output in JSON format
./foundation/lib/connection-resolve.sh my-module --json

# Quiet mode (errors only)
./foundation/lib/connection-resolve.sh my-module --quiet
```

### TypeScript

```typescript
import { ConnectionResolver, ConnectionRequirement } from 'foundation/interfaces/connection';

const requirements: ConnectionRequirement[] = [
  {
    type: 'database',
    providers: ['postgres', 'mysql'],
    required: true,
    name: 'app-db'
  }
];

const result = await resolver.resolve('my-module', requirements);

if (result.success) {
  for (const conn of result.resolved) {
    console.log(`${conn.requirementName} -> ${conn.providerName}`);
    console.log(`Connection string: ${conn.connectionString}`);
  }
} else {
  for (const u of result.unresolved) {
    console.error(`Cannot satisfy: ${u.requirement.name} - ${u.reason}`);
  }
}
```

### Python

```python
from foundation.interfaces.connection import (
    ConnectionRequirement,
    ConnectionType,
)

requirements = [
    ConnectionRequirement(
        type=ConnectionType.DATABASE,
        providers=['postgres', 'mysql'],
        required=True,
        name='app-db'
    )
]

result = await resolver.resolve('my-module', requirements)

if result.success:
    for conn in result.resolved:
        print(f"{conn.requirement_name} -> {conn.provider_name}")
else:
    for u in result.unresolved:
        print(f"Cannot satisfy: {u.requirement.name} - {u.reason}")
```

## Connection Strings

The resolver generates connection strings based on provider type:

```
PostgreSQL: postgresql://user:pass@host:5432/database
MySQL:      mysql://user:pass@host:3306/database
MongoDB:    mongodb://user:pass@host:27017/database
Redis:      redis://user:pass@host:6379/0
SQLite:     /path/to/database.db or :memory:
```

## Environment Variables

Resolved connections can export environment variables:

```json
{
  "requirementName": "primary-db",
  "envVars": {
    "DATABASE_URL": "postgresql://...",
    "DB_HOST": "postgres",
    "DB_PORT": "5432",
    "DB_NAME": "myapp"
  }
}
```

## Best Practices

### For Module Authors

1. **List multiple providers** - Don't require a specific database
2. **Order by preference** - Put preferred providers first
3. **Mark optional connections** - Use `required: false` for non-essential
4. **Name your connections** - Use descriptive names for clarity
5. **Provide sensible defaults** - Set reasonable pool sizes, timeouts

### For Provider Authors

1. **Document requirements** - What does your provider need to run?
2. **Provide defaults** - Include sensible default configuration
3. **Support multiple aliases** - e.g., both "postgres" and "postgresql"
4. **Version your provider** - Help modules check compatibility

## Error Handling

When resolution fails:

```json
{
  "success": false,
  "resolved": [...],
  "unresolved": [
    {
      "requirement": {
        "type": "database",
        "providers": ["postgres"],
        "name": "primary-db"
      },
      "reason": "No matching provider installed"
    }
  ],
  "warnings": ["Optional connection 'metrics-db' not available"]
}
```

## Provider Priority

When multiple providers can satisfy a requirement:

1. Provider order in requirement's `providers` list
2. First match wins
3. No automatic fallback between providers

## Related Documentation

- [Module Manifest](./MODULE-MANIFEST.md) - Full module.json schema
- [Event Bus Interface](./EVENT-BUS-INTERFACE.md) - Inter-module communication
- [Connection Schema](../schemas/connection.schema.json) - JSON Schema
<!-- TODO: Add module development guide -->
<!-- - [Creating Modules](./CREATING-MODULES.md) - Module development guide -->
