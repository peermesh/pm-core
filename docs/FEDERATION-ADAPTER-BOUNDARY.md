# Federation Adapter Boundary Contract

Defines the boundary rules for optional federation/syndication capabilities.

## Intent

Federation support must be additive, not foundational. Core deployment must remain stable without federation adapters.

## Boundary Rules

1. Adapter services are optional modules and must never be required for root runtime startup.
2. Adapter activation must be explicit: include adapter compose + enable profile.
3. Adapter auth/ingress/queue assumptions must be declared in module contract.
4. Adapter data paths must stay isolated from core secret and database contracts unless explicitly mapped.
5. Adapter changes require migration and rollback notes before release promotion.

## Activation Pattern

```bash
# Core only (default)
docker compose -f docker-compose.yml config -q

# Explicit adapter enablement
FEDERATION_ADAPTER_ENABLED=true \
  docker compose -f docker-compose.yml \
                 -f modules/federation-adapter/docker-compose.yml \
                 --profile federation-adapter \
                 config -q
```

## Validation Gate

```bash
./scripts/validate-federation-adapter-boundary.sh
```

Pass criteria:
- root compose validates without adapter
- adapter service absent from root-only service graph
- adapter compose validates when explicitly included
- adapter service appears in explicit adapter graph

## Security + Release Controls

- Adapter enablement flag: `FEDERATION_ADAPTER_ENABLED`
- Adapter mode flag: `FEDERATION_ADAPTER_MODE`
- Adapter auth strategy flag: `FEDERATION_ADAPTER_AUTH_STRATEGY`
- Release checklist must include adapter-boundary validation when adapter mode is enabled.

## Initial Scaffold

- Module manifest: `modules/federation-adapter/module.json`
- Module compose: `modules/federation-adapter/docker-compose.yml`
- Lifecycle hooks: `modules/federation-adapter/hooks/*.sh`

This scaffold is contract-first and intentionally uses placeholder runtime behavior until dedicated federation implementation work orders land.
