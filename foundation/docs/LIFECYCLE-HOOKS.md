# Module Lifecycle Hooks Guide

Lifecycle hooks are scripts that run at specific points in a module's lifecycle. This document describes when each hook is called, expected behavior, and implementation guidelines.

## Schema

JSON Schema: [`../schemas/lifecycle.schema.json`](../schemas/lifecycle.schema.json)

## Hook Overview

| Hook | When Called | Required | Typical Duration |
|------|-------------|----------|------------------|
| `install` | Module is added to system | No | 5-60s |
| `start` | Module is activated | No | 1-30s |
| `stop` | Module is deactivated | No | 1-30s |
| `uninstall` | Module is removed | No | 5-60s |
| `health` | Periodic/on-demand | Recommended | <5s |
| `upgrade` | Version changes | No | 5-120s |
| `validate` | Before install | No | 1-10s |

## Hook Definitions

### `install`

**When Called**: Once when the module is first added to the system.

**Purpose**:
- Create required directories
- Initialize databases/schemas
- Download additional resources
- Generate initial configuration
- Set up file permissions

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General failure |
| 2 | Missing dependencies |
| 3 | Configuration error |
| 4 | Permission denied |

**Example**:
```bash
#!/bin/bash
set -e

MODULE_DIR="$(dirname "$0")/.."
DATA_DIR="${DATA_DIR:-/data/my-module}"

echo "Installing my-module..."

# Create data directories
mkdir -p "$DATA_DIR"/{config,data,logs}

# Set permissions
chmod 700 "$DATA_DIR"

# Initialize database schema if connection available
if [ -n "$DATABASE_URL" ]; then
    echo "Running database migrations..."
    # Run migrations
fi

echo "Installation complete"
exit 0
```

**Best Practices**:
- Make install idempotent (safe to run multiple times)
- Check for existing state before overwriting
- Use environment variables for paths
- Log progress for debugging

---

### `start`

**When Called**: Each time the module is activated.

**Purpose**:
- Start background services
- Establish connections to dependencies
- Register with event bus
- Register with dashboard (if available)
- Begin processing

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success - module is running |
| 1 | General failure |
| 2 | Dependency not available |
| 3 | Connection failed |

**Example**:
```bash
#!/bin/bash
set -e

echo "Starting my-module..."

# Verify dependencies
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker not available"
    exit 2
fi

# Start services
docker compose -f docker-compose.yml up -d

# Wait for health
echo "Waiting for services to be healthy..."
sleep 5

# Verify started
if docker compose ps | grep -q "running"; then
    echo "my-module started successfully"
    exit 0
else
    echo "ERROR: Services failed to start"
    exit 1
fi
```

**Best Practices**:
- Verify dependencies before starting
- Wait for services to be ready before returning
- Set up signal handlers for graceful shutdown
- Log startup progress

---

### `stop`

**When Called**: When the module is deactivated (not removed).

**Purpose**:
- Graceful shutdown of services
- Close connections cleanly
- Flush buffers and caches
- Save state if needed
- Unregister from event bus

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success - clean shutdown |
| 1 | General failure |
| 2 | Timeout waiting for shutdown |

**Example**:
```bash
#!/bin/bash

TIMEOUT=30
echo "Stopping my-module..."

# Signal graceful shutdown
docker compose stop --timeout $TIMEOUT

# Verify stopped
if docker compose ps | grep -q "running"; then
    echo "WARNING: Force killing remaining containers"
    docker compose kill
fi

echo "my-module stopped"
exit 0
```

**Best Practices**:
- Implement graceful shutdown (SIGTERM handling)
- Allow time for in-flight requests to complete
- Save any pending state
- Don't delete data (that's uninstall's job)

---

### `uninstall`

**When Called**: When the module is being removed from the system.

**Purpose**:
- Remove created directories (with confirmation)
- Drop database schemas (with confirmation)
- Clean up Docker resources (volumes, networks)
- Remove configuration files

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success - cleanup complete |
| 1 | General failure |
| 2 | User cancelled |
| 3 | Partial cleanup (some items remain) |

**Example**:
```bash
#!/bin/bash

MODULE_DIR="$(dirname "$0")/.."
DATA_DIR="${DATA_DIR:-/data/my-module}"

echo "Uninstalling my-module..."

# Stop if running
./stop.sh 2>/dev/null || true

# Remove Docker resources
docker compose down -v --remove-orphans

# Optionally remove data (requires confirmation)
if [ "$REMOVE_DATA" = "true" ]; then
    echo "Removing data directory: $DATA_DIR"
    rm -rf "$DATA_DIR"
fi

echo "Uninstall complete"
exit 0
```

**Best Practices**:
- Stop services before cleanup
- Require explicit confirmation for data deletion
- Log what is being removed
- Handle partial failures gracefully
- Consider backup before removal

---

### `health`

**When Called**: Periodically by the foundation, or on-demand via dashboard.

**Purpose**:
- Return current health status
- Check all critical dependencies
- Report degraded state if partially working

**Exit Codes**:
| Code | Meaning | Status |
|------|---------|--------|
| 0 | Healthy | `healthy` |
| 1 | Unhealthy | `unhealthy` |
| 2 | Degraded | `degraded` |

**Output Format** (JSON to stdout):
```json
{
  "status": "healthy",
  "message": "All systems operational",
  "checks": [
    {"name": "database", "status": "pass", "message": "Connected"},
    {"name": "storage", "status": "pass", "message": "1.2GB free"},
    {"name": "api", "status": "pass", "responseTime": 45}
  ],
  "timestamp": 1705420800000
}
```

**Example**:
```bash
#!/bin/bash

check_database() {
    if pg_isready -h "$DB_HOST" -p "$DB_PORT" &>/dev/null; then
        echo '{"name":"database","status":"pass","message":"Connected"}'
        return 0
    else
        echo '{"name":"database","status":"fail","message":"Connection refused"}'
        return 1
    fi
}

check_api() {
    response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)
    if [ "$response" = "200" ]; then
        echo '{"name":"api","status":"pass"}'
        return 0
    else
        echo '{"name":"api","status":"fail","message":"HTTP '$response'"}'
        return 1
    fi
}

# Run checks
checks=()
overall_status="healthy"
exit_code=0

db_check=$(check_database)
if [ $? -ne 0 ]; then
    overall_status="unhealthy"
    exit_code=1
fi
checks+=("$db_check")

api_check=$(check_api)
if [ $? -ne 0 ]; then
    if [ "$overall_status" = "healthy" ]; then
        overall_status="degraded"
        exit_code=2
    fi
fi
checks+=("$api_check")

# Output JSON
echo "{\"status\":\"$overall_status\",\"checks\":[$(IFS=,; echo "${checks[*]}")]}"
exit $exit_code
```

**Best Practices**:
- Keep health checks fast (<5 seconds)
- Check all critical dependencies
- Return structured JSON for parsing
- Use `degraded` for partial functionality
- Include response times where relevant

---

### `upgrade`

**When Called**: When module version changes (after install, before start).

**Purpose**:
- Run version-specific migrations
- Update schemas
- Transform configuration formats
- Handle breaking changes

**Environment Variables**:
| Variable | Description |
|----------|-------------|
| `PREVIOUS_VERSION` | Version being upgraded from |
| `CURRENT_VERSION` | Version being upgraded to |

**Example**:
```bash
#!/bin/bash
set -e

echo "Upgrading from $PREVIOUS_VERSION to $CURRENT_VERSION"

# Run migrations based on version
case "$PREVIOUS_VERSION" in
    1.0.*)
        echo "Running 1.0.x to 1.1.x migration..."
        ./migrations/1.0-to-1.1.sh
        ;;&  # Fall through to next match
    1.1.*)
        echo "Running 1.1.x to 1.2.x migration..."
        ./migrations/1.1-to-1.2.sh
        ;;
esac

echo "Upgrade complete"
exit 0
```

---

### `validate`

**When Called**: Before install, to verify requirements.

**Purpose**:
- Check system requirements
- Verify configuration is valid
- Ensure dependencies are satisfiable
- Return clear error messages

**Example**:
```bash
#!/bin/bash

errors=()

# Check Docker version
docker_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null)
if [ -z "$docker_version" ]; then
    errors+=("Docker is not running")
elif [ "$(printf '%s\n' "20.10.0" "$docker_version" | sort -V | head -n1)" != "20.10.0" ]; then
    errors+=("Docker version must be >= 20.10.0 (found: $docker_version)")
fi

# Check required environment variables
if [ -z "$DATABASE_URL" ]; then
    errors+=("DATABASE_URL environment variable is required")
fi

# Report errors
if [ ${#errors[@]} -gt 0 ]; then
    echo "Validation failed:"
    for error in "${errors[@]}"; do
        echo "  - $error"
    done
    exit 1
fi

echo "Validation passed"
exit 0
```

## Hook Configuration

Hooks can be specified as strings (path only) or objects (with options):

### Simple Format
```json
{
  "lifecycle": {
    "install": "./scripts/install.sh",
    "health": "./scripts/health.sh"
  }
}
```

### Extended Format
```json
{
  "lifecycle": {
    "install": {
      "script": "./scripts/install.sh",
      "timeout": 600,
      "retries": 3,
      "retryDelay": 10,
      "environment": {
        "VERBOSE": "true"
      }
    },
    "health": {
      "script": "./scripts/health.sh",
      "timeout": 30
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `script` | string | - | Path to script (required) |
| `timeout` | integer | 300 | Max execution time in seconds |
| `retries` | integer | 0 | Retry attempts on failure |
| `retryDelay` | integer | 5 | Seconds between retries |
| `environment` | object | - | Additional environment variables |

## Environment Variables

All hooks receive these standard environment variables:

| Variable | Description |
|----------|-------------|
| `MODULE_ID` | Module identifier |
| `MODULE_VERSION` | Module version |
| `MODULE_DIR` | Path to module directory |
| `FOUNDATION_VERSION` | Foundation version |
| `DATA_DIR` | Suggested data directory |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) |

## Execution Order

### Module Installation
1. `validate` - Check requirements
2. `install` - Set up module
3. `start` - Activate module
4. `health` - Verify operational

### Module Removal
1. `stop` - Deactivate module
2. `uninstall` - Clean up

### Module Upgrade
1. `stop` - Deactivate old version
2. `upgrade` - Run migrations
3. `start` - Activate new version
4. `health` - Verify operational

## Error Handling

### Retries

For hooks with `retries` configured:
1. If hook fails, wait `retryDelay` seconds
2. Run hook again
3. Repeat up to `retries` times
4. If all retries fail, report final error

### Timeouts

If a hook exceeds its `timeout`:
1. Send SIGTERM to process
2. Wait 10 seconds for graceful exit
3. Send SIGKILL if still running
4. Report timeout error

### Logging

Hooks should log to:
- **stdout**: Informational messages, JSON output
- **stderr**: Errors and warnings

All output is captured and available in the dashboard and logs.

## Related Documentation

- [Module Manifest Reference](MODULE-MANIFEST.md)
- [Lifecycle Schema](../schemas/lifecycle.schema.json)
- [Event Schema](../schemas/event.schema.json)
