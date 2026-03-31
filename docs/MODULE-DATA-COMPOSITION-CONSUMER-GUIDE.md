# Module Data Composition Consumer Guide

This guide defines how a consumer module depends on provider-owned shared data surfaces under ARCH-009.

## Consumer dependency declaration

Declare provider dependency in `module.json` using `requires.connections`.

Example consumer snippet:

```json
{
  "id": "consumer-example",
  "version": "0.1.0",
  "requires": {
    "connections": {
      "social-shared": {
        "source": "social",
        "type": "postgresql",
        "purpose": "read-only access to shared social views"
      }
    }
  }
}
```

Rules:

- provider module owns schema and migration lifecycle.
- consumer module never writes provider shared surfaces.
- consumer module never reads provider private schemas.

## Shared surface contract references

Current baseline shared surfaces:

- **Social**
  - shared schema: `social_profiles`
  - shared schema: `social_graph`
  - private schemas: `social_federation`, `social_keys`, `social_pipeline`
  - reader role: `social_lab_reader`
  - lifecycle validator: `sub-repos/core/scripts/validation/run-arch009-schema-acl-integration.sh`

- **Universal Manifest (UM)**
  - shared schema: `universal_manifest_api`
  - private schema: `um`
  - reader role: `universal_manifest_api_reader`
  - lifecycle validator: `sub-repos/core/scripts/validation/run-arch009-um-schema-acl-integration.sh`

## Schema contract usage pattern

Consumer runtime should:

1. connect with the provider reader role credential.
2. query shared views/tables only.
3. treat provider shared contracts as versioned interfaces.
4. fail closed when provider schema contract is unavailable or incompatible.

## Validation commands

From `sub-repos/core`:

```bash
./scripts/validation/run-arch009-schema-acl-integration.sh
./scripts/validation/run-arch009-um-schema-acl-integration.sh
./scripts/validation/run-arch009-sqlite-migration-compat.sh
```

These checks verify read-only behavior, private-schema isolation, lifecycle resilience, and baseline SQLite compatibility reporting.
