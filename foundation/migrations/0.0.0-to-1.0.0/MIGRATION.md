# Migration: 0.0.0 to 1.0.0

## Summary

Bootstrap migration for fresh foundation installations. This migration initializes the version tracking system and validates the foundation structure.

## Purpose

This is the **initial migration** that runs on first install. It establishes the foundation's versioning baseline, enabling future migrations to build upon a known state.

## Changes

### Added

1. **VERSION file** (`foundation/VERSION`)
   - Contains the current foundation version: `1.0.0`
   - Used by the migration framework to determine upgrade paths
   - Human-readable single-line file

### Validated

The migration validates the presence of core foundation components:

- `lib/` - Library scripts
- `schemas/` - JSON Schema definitions
- `docs/` - Documentation
- `templates/` - Module templates
- `interfaces/` - Language-specific interface definitions
- `README.md` - Foundation documentation
- `docker-compose.base.yml` - Compose patterns

Missing components generate warnings but do not block the migration.

## Breaking Changes

None. This is the initial version.

## Manual Steps

None required. This migration is fully automated.

## Prerequisites

- Foundation files must be present (cloned/downloaded repository)
- Bash 4.0 or later
- Standard Unix utilities (mkdir, cp, echo)

## Rollback Notes

Rolling back to 0.0.0 removes the VERSION file, returning the foundation to an uninitialized state. Core foundation files are NOT removed during rollback.

To re-initialize after rollback:

```bash
./lib/migration.sh run
```

## Technical Details

### Version Detection

The migration framework uses these sources to determine versions:

1. **Installed Version**: Read from `.migration-state` file (defaults to `0.0.0` if missing)
2. **Foundation Version**: Read from `VERSION` file (defaults to `1.0.0` if missing)

### Idempotency

This migration is idempotent:

- Creating the VERSION file overwrites any existing content
- Directory validation only reports, does not create/modify
- Safe to run multiple times

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Migration successful |
| 1 | Migration failed (see error output) |

## Changelog

- **1.0.0** (Initial Release)
  - Bootstrap migration for foundation versioning
  - VERSION file creation
  - Structure validation
