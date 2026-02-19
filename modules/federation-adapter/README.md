# Federation Adapter Module (Boundary Scaffold)

This module defines an **optional** federation/syndication boundary. It is a scaffold for adapter capabilities and is intentionally decoupled from core runtime deployment.

## Boundary Rules

- Core runtime must remain healthy when this module is absent.
- Adapter activation must be explicit (`-f modules/federation-adapter/docker-compose.yml` + profile).
- Auth, ingress, and queue dependencies must be declared in module config.
- Adapter changes must include migration and rollback notes before release lock.

## Activation

```bash
docker compose -f docker-compose.yml -f modules/federation-adapter/docker-compose.yml --profile federation-adapter config -q
```

## Validation

```bash
./scripts/validate-federation-adapter-boundary.sh
```

## Notes

This scaffold uses `traefik/whoami` as a boundary-safe placeholder service and does not introduce production federation logic by itself.
