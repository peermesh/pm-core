# Supporting Tech Profile: Observability Lite (Netdata + Uptime Kuma)

**Version**: Netdata stable + Uptime Kuma 1.x
**Category**: Observability / Health Monitoring
**Status**: Baseline
**Last Updated**: 2026-02-19

## Purpose

Provide a low-operations observability baseline suitable for commodity VPS deployments.

Default recommendation for current cycle:

- Primary profile: Observability Lite (`netdata` + `uptime-kuma`)
- Fallback/upgrade profile: Prometheus + Grafana + Loki (enterprise depth)

## Activation

```bash
docker compose -f docker-compose.yml -f profiles/observability-lite/docker-compose.observability-lite.yml up -d
```

## Rollback/Upgrade Notes

- Rollback to no-observability baseline:
  ```bash
  docker compose -f docker-compose.yml -f profiles/observability-lite/docker-compose.observability-lite.yml down
  ```
- Upgrade path to enterprise profile remains allowed; treat as additive migration with explicit gate evidence.

## Validation

```bash
./scripts/validate-observability-profile.sh
```
