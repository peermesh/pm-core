# Version Compatibility Guide

This document explains how PeerMesh Foundation handles versioning, compatibility declarations, and migrations between versions.

## Table of Contents

- [Semantic Versioning](#semantic-versioning)
- [Module Compatibility Declaration](#module-compatibility-declaration)
- [Checking Compatibility](#checking-compatibility)
- [Version Range Expressions](#version-range-expressions)
- [Breaking Change Policy](#breaking-change-policy)
- [Migration System](#migration-system)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Semantic Versioning

PeerMesh Foundation uses [Semantic Versioning 2.0.0](https://semver.org/) for all version numbers.

### Version Format

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

| Component | Description | Example |
|-----------|-------------|---------|
| MAJOR | Breaking changes | `2.0.0` |
| MINOR | New features (backward compatible) | `1.1.0` |
| PATCH | Bug fixes (backward compatible) | `1.0.1` |
| PRERELEASE | Pre-release identifier (optional) | `1.0.0-alpha.1` |
| BUILD | Build metadata (optional) | `1.0.0+build.123` |

### Version Precedence

Versions are compared component by component:

1. MAJOR, MINOR, PATCH compared numerically
2. Versions without prerelease have higher precedence than with prerelease
3. Prerelease identifiers compared left to right
4. Build metadata is ignored in comparisons

Examples (lowest to highest):
```
1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0 < 1.0.1 < 1.1.0 < 2.0.0
```

## Module Compatibility Declaration

Every module must declare which foundation versions it supports in its `module.json`:

```json
{
  "id": "my-module",
  "version": "1.0.0",
  "name": "My Module",
  "foundation": {
    "minVersion": "1.0.0",
    "maxVersion": "2.0.0"
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `minVersion` | Yes | Minimum foundation version (inclusive) |
| `maxVersion` | No | Maximum foundation version (exclusive by default) |

### Compatibility Rules

A module is **compatible** with a foundation version when:

1. `foundationVersion >= minVersion`
2. If `maxVersion` is specified: `foundationVersion < maxVersion`

### Examples

```json
// Compatible with Foundation 1.x only
{
  "foundation": {
    "minVersion": "1.0.0",
    "maxVersion": "2.0.0"
  }
}

// Compatible with Foundation 1.5.0 and above (no upper limit)
{
  "foundation": {
    "minVersion": "1.5.0"
  }
}

// Compatible with Foundation 2.0.0 to 2.x
{
  "foundation": {
    "minVersion": "2.0.0",
    "maxVersion": "3.0.0"
  }
}
```

## Checking Compatibility

Use the `version-check.sh` script to verify compatibility.

### CLI Usage

```bash
# Check module compatibility with current foundation
./lib/version-check.sh module my-module

# Check against specific foundation version
./lib/version-check.sh module my-module --foundation-version 1.5.0

# JSON output for scripting
./lib/version-check.sh module my-module --json
```

### Example Output

```
Module: My Module (my-module)
  Module Version:     1.0.0
  Foundation Version: 1.5.0
  Required Range:     [1.0.0, 2.0.0)
  Status:             Compatible
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Compatible |
| 1 | Incompatible |
| 2 | Module not found |
| 3 | Invalid version format |

### Library Usage

Source the script to use functions in your own scripts:

```bash
#!/usr/bin/env bash
source /path/to/foundation/lib/version-check.sh

# Check if version is in range
if version_compatible "1.5.0" "1.0.0" "2.0.0"; then
    echo "Compatible!"
fi

# Compare versions
result=$(version_compare "1.0.0" "2.0.0")
case $result in
    -1) echo "1.0.0 is older" ;;
    0)  echo "Versions are equal" ;;
    1)  echo "1.0.0 is newer" ;;
esac

# Parse version components
read major minor patch prerelease build <<< "$(version_parse "1.2.3-alpha.1")"
echo "Major: $major, Minor: $minor, Patch: $patch"
```

## Version Range Expressions

The version checker supports several operators for flexible version constraints.

### Operators

| Operator | Meaning | Example | Matches |
|----------|---------|---------|---------|
| `=` | Exact match | `=1.0.0` | Only 1.0.0 |
| `>` | Greater than | `>1.0.0` | 1.0.1, 1.1.0, 2.0.0 |
| `<` | Less than | `<2.0.0` | 1.0.0, 1.9.9 |
| `>=` | Greater or equal | `>=1.0.0` | 1.0.0, 1.0.1, 2.0.0 |
| `<=` | Less or equal | `<=1.0.0` | 0.9.0, 1.0.0 |
| `^` | Compatible | `^1.2.0` | 1.2.0, 1.3.0, 1.9.9 (not 2.0.0) |
| `~` | Approximately | `~1.2.0` | 1.2.0, 1.2.1, 1.2.9 (not 1.3.0) |

### Range Expressions

Combine constraints with spaces:

```bash
# Version 1.x only
./lib/version-check.sh range 1.5.0 ">=1.0.0 <2.0.0"

# Version 1.2.x only (patch updates)
./lib/version-check.sh range 1.2.3 "~1.2.0"

# Compatible with 1.2.0 (same major)
./lib/version-check.sh range 1.5.0 "^1.2.0"
```

### Caret (^) vs Tilde (~)

- **Caret (^)**: Allows changes that do not modify the left-most non-zero digit
  - `^1.2.3` matches `>=1.2.3 <2.0.0`
  - `^0.2.3` matches `>=0.2.3 <0.3.0` (special case for 0.x)

- **Tilde (~)**: Allows patch-level changes
  - `~1.2.3` matches `>=1.2.3 <1.3.0`
  - Only the patch version can change

## Breaking Change Policy

PeerMesh Foundation follows a strict breaking change policy to ensure module compatibility.

### What Constitutes a Breaking Change

1. **Removing** a property from a schema
2. **Renaming** a property without backward compatibility
3. **Changing** the type of a property
4. **Adding** a new required property
5. **Changing** the behavior of lifecycle hooks
6. **Modifying** the event bus interface contract
7. **Altering** connection resolution logic

### What Is NOT a Breaking Change

1. **Adding** optional properties to schemas
2. **Adding** new event types
3. **Adding** new lifecycle hooks (if optional)
4. **Performance improvements**
5. **Bug fixes** (unless relied upon)

### Major Version Bumps

The major version is incremented when:

- Breaking changes are introduced
- Schema structure changes incompatibly
- API contracts change
- Minimum requirements change (e.g., new system dependencies)

### Deprecation Process

1. Feature marked deprecated in version X.Y.0
2. Warning emitted when deprecated feature is used
3. Feature removed in version (X+1).0.0
4. Migration path documented

## Migration System

When upgrading between major versions, migrations may be required.

### Migration Manifest

The foundation maintains a migration manifest at `foundation/migrations.json`:

```json
{
  "$schema": "https://peermesh.io/foundation/v1/version.schema.json",
  "component": "foundation",
  "currentVersion": "2.0.0",
  "breakingChanges": [
    {
      "version": "2.0.0",
      "description": "Renamed 'requires.connections.name' to 'requires.connections.alias'",
      "migration": "Run migration script: scripts/migrate-2.0.sh",
      "affectedFeatures": ["module.json", "connection resolution"]
    }
  ],
  "migrations": [
    {
      "from": "1.0.0",
      "to": "2.0.0",
      "steps": [
        {
          "type": "script",
          "description": "Update module.json schema",
          "script": "scripts/migrate-1-to-2.sh"
        },
        {
          "type": "config",
          "description": "Rename connection properties",
          "changes": {
            "rename": {
              "requires.connections.name": "requires.connections.alias"
            }
          }
        }
      ],
      "estimatedTime": "5 minutes",
      "requiresDowntime": false,
      "backupRequired": true
    }
  ]
}
```

### Migration Types

| Type | Description |
|------|-------------|
| `script` | Run a migration script |
| `manual` | Requires manual intervention |
| `config` | Configuration file changes |
| `schema` | Schema updates |

### Running Migrations

```bash
# Check if migration is needed
./bin/migrate.sh check

# Run migration with backup
./bin/migrate.sh run --backup

# Dry run (show what would change)
./bin/migrate.sh run --dry-run
```

## Examples

### Example 1: New Module

Creating a module compatible with Foundation 1.x:

```json
{
  "$schema": "https://peermesh.io/foundation/v1/module.schema.json",
  "id": "my-new-module",
  "version": "1.0.0",
  "name": "My New Module",
  "foundation": {
    "minVersion": "1.0.0",
    "maxVersion": "2.0.0"
  }
}
```

### Example 2: Checking Compatibility in CI

```bash
#!/usr/bin/env bash
set -e

source ./foundation/lib/version-check.sh

# Get foundation version
FOUNDATION_VERSION=$(get_foundation_version)

# Check all modules
for module_dir in modules/*/; do
    module_id=$(basename "$module_dir")

    if ! ./foundation/lib/version-check.sh module "$module_id" --quiet; then
        echo "ERROR: Module $module_id is not compatible with Foundation $FOUNDATION_VERSION"
        exit 1
    fi
done

echo "All modules compatible with Foundation $FOUNDATION_VERSION"
```

### Example 3: Version Comparison Script

```bash
#!/usr/bin/env bash
source ./foundation/lib/version-check.sh

current="1.5.0"
required="1.0.0"
max="2.0.0"

echo "Current version: $current"
echo "Required range: [$required, $max)"

if version_compatible "$current" "$required" "$max"; then
    echo "Version is compatible"
else
    # Determine why it's incompatible
    if [[ $(version_compare "$current" "$required") -lt 0 ]]; then
        echo "Version is too old (below $required)"
    else
        echo "Version is too new (at or above $max)"
    fi
fi
```

### Example 4: Pre-flight Compatibility Check

```bash
#!/usr/bin/env bash
# Run before starting services

./lib/version-check.sh module my-module --json | jq -e '.compatible' > /dev/null

if [[ $? -ne 0 ]]; then
    echo "Module is not compatible with current foundation version"
    echo "Please update the module or foundation before proceeding"
    exit 1
fi

echo "Compatibility check passed"
```

## Troubleshooting

### Module Shows as Incompatible

1. Check the module's `foundation.minVersion` and `foundation.maxVersion`
2. Verify the current foundation version with `get_foundation_version`
3. If foundation is too old, consider upgrading
4. If foundation is too new, check for module updates or use an older foundation

### Version Parse Errors

```bash
# Validate a version string
./lib/version-check.sh parse "1.2.3"

# Common issues:
# - Leading zeros: 01.02.03 (invalid, use 1.2.3)
# - Missing components: 1.2 (invalid, use 1.2.0)
# - Invalid characters: v1.2.3 (invalid, use 1.2.3)
```

### Migration Failures

1. Ensure you have a backup before migrating
2. Check the migration manifest for step requirements
3. Run with `--dry-run` first to preview changes
4. Check logs for specific error messages

### Finding Compatible Modules

```bash
# List all modules and their compatibility
for module in modules/*/; do
    ./lib/version-check.sh module "$(basename "$module")" 2>/dev/null || true
done
```

## Related Documentation

- [Module Manifest Reference](MODULE-MANIFEST.md)
- [Lifecycle Hooks Guide](LIFECYCLE-HOOKS.md)
- [JSON Schema: version.schema.json](../schemas/version.schema.json)
- [Semantic Versioning Specification](https://semver.org/)
