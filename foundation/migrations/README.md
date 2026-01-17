# Foundation Migrations

This directory contains migration scripts for foundation version upgrades and rollbacks.

## Overview

The migration framework enables safe, versioned updates to the foundation. Each migration is a self-contained unit that transforms the system from one version to another.

## Directory Structure

```
migrations/
├── README.md                    # This file
├── 0.0.0-to-1.0.0/              # Migration from version 0.0.0 to 1.0.0
│   ├── up.sh                    # Upgrade script (required)
│   ├── down.sh                  # Rollback script (required)
│   └── MIGRATION.md             # Migration documentation
├── 1.0.0-to-1.1.0/              # Next migration
│   ├── up.sh
│   ├── down.sh
│   └── MIGRATION.md
└── ...
```

## Naming Convention

Migration directories follow strict semver naming:

```
<from-version>-to-<to-version>
```

Examples:
- `0.0.0-to-1.0.0` - Initial setup (fresh install bootstrap)
- `1.0.0-to-1.1.0` - Minor version upgrade
- `1.1.0-to-2.0.0` - Major version upgrade (breaking changes)

**Rules:**
- Use only semantic version numbers: `MAJOR.MINOR.PATCH`
- The "from" version must be less than the "to" version
- Migrations must chain: `1.0.0-to-1.1.0` followed by `1.1.0-to-2.0.0`
- No gaps allowed in the chain

## Creating a New Migration

### 1. Create Migration Directory

```bash
# Calculate next version from current foundation version
CURRENT_VERSION="1.0.0"
NEW_VERSION="1.1.0"

mkdir -p migrations/${CURRENT_VERSION}-to-${NEW_VERSION}
```

### 2. Create up.sh (Upgrade Script)

The `up.sh` script runs when upgrading to the new version.

```bash
#!/usr/bin/env bash
#
# Migration: 1.0.0 -> 1.1.0
# Description: Add new feature directories
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"

echo "Migrating to 1.1.0..."

# Add your migration logic here
mkdir -p "$FOUNDATION_DIR/new-feature"

echo "Migration complete."
exit 0
```

**Requirements:**
- Must be executable (`chmod +x up.sh`)
- Must exit with code 0 on success
- Must be idempotent (safe to run multiple times)
- Should output progress information
- Must not require user input

### 3. Create down.sh (Rollback Script)

The `down.sh` script reverses the changes made by `up.sh`.

```bash
#!/usr/bin/env bash
#
# Rollback: 1.1.0 -> 1.0.0
# Description: Remove new feature directories
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"

echo "Rolling back from 1.1.0 to 1.0.0..."

# Reverse the up.sh changes
rm -rf "$FOUNDATION_DIR/new-feature"

echo "Rollback complete."
exit 0
```

**Requirements:**
- Must exactly reverse `up.sh` changes
- Must be executable (`chmod +x down.sh`)
- Must exit with code 0 on success
- Should handle cases where `up.sh` partially completed

### 4. Create MIGRATION.md (Documentation)

Document the migration for future reference.

```markdown
# Migration: 1.0.0 to 1.1.0

## Summary
Brief description of what this migration does.

## Changes
- Added `new-feature/` directory for X functionality
- Updated schema files to support Y

## Breaking Changes
None (or list breaking changes)

## Manual Steps
None (or list required manual actions)

## Rollback Notes
Standard rollback supported. No data loss expected.
```

## Using the Migration Tool

### Check for Pending Migrations

```bash
./lib/migration.sh check
```

### Run All Pending Migrations

```bash
./lib/migration.sh run
```

### Dry Run (Preview Changes)

```bash
./lib/migration.sh run --dry-run
```

### Rollback to Specific Version

```bash
./lib/migration.sh rollback --target 1.0.0
```

### View Migration Status

```bash
./lib/migration.sh status
./lib/migration.sh status --json
```

## Migration State

The migration framework tracks state in `.migration-state`:

```json
{
  "installedVersion": "1.1.0",
  "lastMigration": "1.0.0-to-1.1.0",
  "migratedAt": "2024-01-15T10:30:00Z",
  "history": [
    {
      "migration": "0.0.0-to-1.0.0",
      "direction": "up",
      "timestamp": "2024-01-10T08:00:00Z"
    },
    {
      "migration": "1.0.0-to-1.1.0",
      "direction": "up",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Note:** The `.migration-state` file should be in `.gitignore` as it represents local installation state, not repository state.

## Best Practices

### 1. Atomic Changes

Each migration should represent a single logical change. Don't bundle unrelated changes.

### 2. Idempotency

Scripts should be safe to run multiple times:

```bash
# Good: Check before creating
if [[ ! -d "$FOUNDATION_DIR/new-dir" ]]; then
    mkdir -p "$FOUNDATION_DIR/new-dir"
fi

# Bad: Assume fresh state
mkdir "$FOUNDATION_DIR/new-dir"  # Fails if exists
```

### 3. Fail Fast

Stop on first error using `set -euo pipefail`:

```bash
set -euo pipefail

# Commands will exit immediately on failure
cp important-file new-location
chmod 755 new-location  # Only runs if cp succeeded
```

### 4. Preserve Data

Never delete user data without explicit confirmation:

```bash
# Good: Backup before modification
if [[ -f "$CONFIG_FILE" ]]; then
    cp "$CONFIG_FILE" "${CONFIG_FILE}.backup.$(date +%s)"
fi

# Bad: Overwrite without backup
cp new-config "$CONFIG_FILE"
```

### 5. Reversibility

Every `up.sh` change should have a corresponding `down.sh` reversal:

| up.sh Action | down.sh Reversal |
|--------------|------------------|
| `mkdir dir` | `rmdir dir` or `rm -rf dir` |
| `cp file dest` | `rm dest` |
| `add config key` | `remove config key` |
| `create table` | `drop table` |

### 6. Documentation

Always explain:
- **What** the migration does
- **Why** it's needed
- **Breaking changes** if any
- **Manual steps** users must take

## Handling Failures

If a migration fails:

1. **Check Logs**: Review the error output
2. **Fix Issue**: Resolve the underlying problem
3. **Retry**: Run `migration.sh run` again (idempotent scripts are safe)
4. **Manual Recovery**: If needed, manually complete or reverse changes
5. **Update State**: If manually fixed, update `.migration-state`

## Testing Migrations

Before releasing a migration:

1. **Fresh Install Test**: Run on clean foundation installation
2. **Upgrade Test**: Run from previous version
3. **Rollback Test**: Verify `down.sh` completely reverses changes
4. **Idempotency Test**: Run `up.sh` twice, ensure no errors
5. **Partial Failure Test**: Simulate failures, verify recovery

## Version Numbering Guidelines

Follow semantic versioning for migration targets:

- **Major (X.0.0)**: Breaking changes, schema modifications
- **Minor (x.Y.0)**: New features, backward-compatible changes
- **Patch (x.y.Z)**: Bug fixes, documentation updates

Migrations typically correspond to minor or major version bumps.
