# Observability Profiles

This document defines the observability defaults and upgrade path.

## Current Default (Primary)

- Profile: Observability Lite
- Stack: Netdata + Uptime Kuma
- Compose overlay: `profiles/observability-lite/docker-compose.observability-lite.yml`

Rationale:

- lower operator burden on commodity VPS
- fast baseline health visibility
- compatible with pull-based deployment model

## Upgrade/Fallback Profile

- Profile: Enterprise Observability
- Stack: Prometheus + Grafana + Loki
- Use when retention depth, query sophistication, or fleet-scale metrics justify higher complexity.

## Validation

Run:

```bash
./scripts/validate-observability-profile.sh
```

Expected result:

- base compose excludes observability-lite services
- overlay compose includes observability-lite services
- compose resolution succeeds in both modes

## Rollback

To remove observability-lite overlay services:

```bash
docker compose -f docker-compose.yml -f profiles/observability-lite/docker-compose.observability-lite.yml down
```

Then return to foundation-only runtime:

```bash
docker compose -f docker-compose.yml up -d
```
