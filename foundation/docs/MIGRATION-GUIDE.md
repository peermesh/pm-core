# Foundation Migration Guide

This guide explains how the PeerMesh Foundation migration system works, how to create migrations, and how to handle upgrades and rollbacks.

## Overview

The migration system ensures that foundation upgrades happen safely and predictably. When the foundation version changes, migrations run automatically during startup to update configurations, schemas, and module state.

### Why Migrations?

Migrations solve several problems:

1. **Schema Evolution**: As the foundation evolves, module manifests and configurations may need structural changes
2. **Data Transformation**: Existing module data may need to be transformed to match new formats
3. **Compatibility Checks**: Ensure modules work with new foundation versions before activating them
4. **Rollback Safety**: If an upgrade fails, you can return to a known-good state

## How Migrations Work

### Version Detection

On startup, the foundation:

1. Reads the current version from `foundation/VERSION`
2. Compares it to the applied version in `.foundation/migration-state.json`
3. If versions differ, identifies and runs pending migrations

### Migration State

Migration state is stored in `.foundation/` (sibling to the foundation directory):

```
project-root/
├── foundation/
│   ├── VERSION           # Current foundation version
│   ├── migrations/       # Migration scripts
│   └── ...
└── .foundation/
    ├── migration-state.json   # Current applied version
    └── migration-history.json # Complete migration history
```

### Automatic Detection

Migrations run automatically when:

- Docker containers start up
- The `foundation migrate up` command is run
- A module's install hook detects a version mismatch

## Creating Migrations

### Migration Script Naming

Migration scripts follow two supported naming patterns:

**Pattern 1: Flat files** (recommended for simple migrations)

```
migrations/
├── V1.0.0__initial_setup.sh
├── V1.1.0__add_event_types.sh
└── V1.2.0__update_connection_schema.sh
```

**Pattern 2: Version directories** (recommended for complex migrations)

```
migrations/
├── 1.0.0/
│   ├── up.sh
│   └── down.sh
├── 1.1.0/
│   ├── up.sh
│   └── down.sh
└── 1.2.0/
    ├── up.sh
    └── down.sh
```

### Migration Script Requirements

Every migration script must:

1. **Be Idempotent**: Running multiple times produces the same result
2. **Be Atomic**: Either fully succeeds or fully fails (no partial state)
3. **Handle Errors**: Exit with non-zero code on failure
4. **Be Silent on Success**: Only output errors or important warnings
5. **Support Rollback**: Have a corresponding down migration when possible

### Script Template

```bash
#!/usr/bin/env bash
#
# Migration: V1.1.0 - Add new event types
#
# This migration adds the new module.health event type to all
# existing module manifests.
#

set -euo pipefail

# Get foundation directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
MODULES_DIR="$(dirname "$FOUNDATION_DIR")/modules"

# Idempotency check
check_already_applied() {
    # Check if migration was already applied
    # Return 0 if already applied, 1 if needs to run
    if [[ -f "$FOUNDATION_DIR/.migration-v1.1.0-marker" ]]; then
        return 0
    fi
    return 1
}

# Main migration logic
migrate() {
    # Skip if already applied
    if check_already_applied; then
        echo "Migration V1.1.0 already applied, skipping" >&2
        exit 0
    fi

    # Perform migration
    for manifest in "$MODULES_DIR"/*/module.json; do
        if [[ -f "$manifest" ]]; then
            # Update manifest (example)
            local temp_file
            temp_file=$(mktemp)
            jq '.events += ["module.health"]' "$manifest" > "$temp_file"
            mv "$temp_file" "$manifest"
        fi
    done

    # Mark as applied
    touch "$FOUNDATION_DIR/.migration-v1.1.0-marker"
}

migrate "$@"
```

### Rollback Script Template

```bash
#!/usr/bin/env bash
#
# Rollback: V1.1.0 - Remove new event types
#
# This rollback removes the module.health event type added in V1.1.0.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
MODULES_DIR="$(dirname "$FOUNDATION_DIR")/modules"

rollback() {
    # Revert changes
    for manifest in "$MODULES_DIR"/*/module.json; do
        if [[ -f "$manifest" ]]; then
            local temp_file
            temp_file=$(mktemp)
            jq '.events -= ["module.health"]' "$manifest" > "$temp_file"
            mv "$temp_file" "$manifest"
        fi
    done

    # Remove marker
    rm -f "$FOUNDATION_DIR/.migration-v1.1.0-marker"
}

rollback "$@"
```

## Using the Migration CLI

### Check Status

```bash
# Show current state
foundation migrate status

# JSON output for scripting
foundation migrate status --json
```

Example output:

```
Foundation Migration Status
===========================

  Foundation Version:  1.2.0
  Applied Version:     1.1.0

  Pending Migrations: 1

    - 1.2.0

Warning: Run 'migrate up' to apply pending migrations
```

### Apply Migrations

```bash
# Apply all pending migrations
foundation migrate up

# Apply up to a specific version
foundation migrate up 1.1.0

# Preview without applying
foundation migrate up --dry-run
```

### Rollback Migrations

```bash
# Rollback to a specific version
foundation migrate down 1.0.0

# Preview rollback
foundation migrate down 1.0.0 --dry-run

# Force rollback even if versions match
foundation migrate down 1.0.0 --force
```

### View History

```bash
# Show migration history
foundation migrate history

# JSON output
foundation migrate history --json
```

Example output:

```
Migration History
=================

  VERSION      DIRECTION  RESULT     TIMESTAMP
  -------      ---------  ------     ---------
  1.0.0        up         success    2024-01-15T10:30:00Z
  1.1.0        up         success    2024-01-20T14:00:00Z
  1.1.0        down       success    2024-01-21T09:00:00Z
  1.1.0        up         success    2024-01-22T11:00:00Z
```

## Troubleshooting

### Migration Failed

If a migration fails:

1. **Check the error message** - The migration CLI shows what went wrong
2. **Check migration history** - `foundation migrate history` shows the failed entry
3. **Fix the issue** - Correct the problem in your configuration or data
4. **Retry** - Run `foundation migrate up` again

The migration system is designed to be resumable. Failed migrations are recorded but don't prevent retrying.

### Stuck State

If the migration state gets corrupted:

1. **Backup your data** - Copy `.foundation/` directory
2. **Reset state** - Remove `.foundation/migration-state.json`
3. **Re-run migrations** - `foundation migrate up`

Idempotent migrations will skip already-applied changes.

### Version Mismatch

If modules report version incompatibility:

1. **Check foundation version** - `foundation version`
2. **Check module requirements** - Look at `foundation.minVersion` in module.json
3. **Upgrade or downgrade** as needed

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Migration already applied" | Idempotency check triggered | Safe to ignore; migration is complete |
| "Target version not older" | Trying to rollback to current/future version | Use correct target version |
| "Script not executable" | Missing execute permission | `chmod +x migrations/*.sh` |
| "jq not found" | Missing dependency | `brew install jq` |

## Version Compatibility Matrix

| Foundation | Min Module API | Breaking Changes |
|------------|----------------|------------------|
| 1.0.x | 1.0.0 | Initial release |
| 1.1.x | 1.0.0 | Added event types (backward compatible) |
| 1.2.x | 1.0.0 | Added connection types (backward compatible) |
| 2.0.x | 2.0.0 | Schema v2 (breaking change) |

### Breaking vs Non-Breaking Changes

**Non-Breaking (minor/patch versions)**:

- Adding new optional fields to schemas
- Adding new event types
- Adding new connection providers
- Bug fixes in validation

**Breaking (major versions)**:

- Removing fields from schemas
- Changing field types
- Renaming required fields
- Changing event format

## Best Practices

### 1. Always Test Migrations

```bash
# Create a test environment
cp -r foundation foundation-test
cp -r modules modules-test

# Run migration in test
FOUNDATION_DIR=./foundation-test foundation migrate up --dry-run
FOUNDATION_DIR=./foundation-test foundation migrate up

# Verify results
foundation module validate ./modules-test/my-module
```

### 2. Write Reversible Migrations

Always provide a rollback script. If a migration cannot be reversed (e.g., data deletion), document this clearly.

### 3. Keep Migrations Small

Each migration should do one thing. Multiple small migrations are easier to debug than one large migration.

### 4. Document Breaking Changes

When introducing breaking changes:

1. Increment the major version
2. Update the compatibility matrix
3. Write a detailed migration guide
4. Provide automated migration where possible

### 5. Use Semantic Versioning

Follow [SemVer](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

## Examples

### Example 1: Adding a New Schema Field

Migration to add `healthcheck.timeout` field:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="$(dirname "$(dirname "$SCRIPT_DIR")")/schemas/lifecycle.schema.json"

# Add timeout property if not exists
if ! jq -e '.properties.healthcheck.properties.timeout' "$SCHEMA_FILE" > /dev/null 2>&1; then
    temp=$(mktemp)
    jq '.properties.healthcheck.properties.timeout = {
        "type": "integer",
        "description": "Timeout in seconds",
        "default": 30,
        "minimum": 1,
        "maximum": 300
    }' "$SCHEMA_FILE" > "$temp"
    mv "$temp" "$SCHEMA_FILE"
fi
```

### Example 2: Renaming a Field

Migration to rename `module.icon` to `module.iconName`:

```bash
#!/usr/bin/env bash
set -euo pipefail

MODULES_DIR="$(dirname "${FOUNDATION_DIR:-$(dirname "$(dirname "$0")")}")/modules"

for manifest in "$MODULES_DIR"/*/module.json; do
    if [[ -f "$manifest" ]]; then
        # Rename icon to iconName if icon exists
        if jq -e '.icon' "$manifest" > /dev/null 2>&1; then
            temp=$(mktemp)
            jq 'if .icon then .iconName = .icon | del(.icon) else . end' "$manifest" > "$temp"
            mv "$temp" "$manifest"
        fi
    fi
done
```

### Example 3: Data Format Transformation

Migration to convert string dates to ISO format:

```bash
#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${FOUNDATION_DATA_DIR:-$(dirname "${FOUNDATION_DIR:-$(dirname "$(dirname "$0")")")}/.foundation"

# Transform date formats in state file
if [[ -f "$DATA_DIR/migration-state.json" ]]; then
    temp=$(mktemp)
    jq '.lastMigration |= (if test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$") then . + "T00:00:00Z" else . end)' \
        "$DATA_DIR/migration-state.json" > "$temp"
    mv "$temp" "$DATA_DIR/migration-state.json"
fi
```

## Related Documentation

- [Foundation README](../README.md) - Foundation overview
- [Module Manifest Reference](MODULE-MANIFEST.md) - Manifest schema documentation
- [Lifecycle Hooks Guide](LIFECYCLE-HOOKS.md) - Module lifecycle documentation
