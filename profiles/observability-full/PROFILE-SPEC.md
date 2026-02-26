# Profile: Enterprise Observability (Full Stack)

## Overview

Full-stack observability overlay providing deep metrics, dashboards, and log aggregation.

## Components

- **Prometheus** (v2.51.2) -- Metrics collection and storage, 7-day/1GB retention
- **Grafana** (v10.4.2) -- Dashboards and visualization, auto-provisioned datasources
- **Loki** (v2.9.6) -- Log aggregation, 7-day retention, TSDB storage

## Resource Budget

- Prometheus: 512MB steady / 1GB limit
- Grafana: 128MB steady / 512MB limit
- Loki: 256MB steady / 512MB limit
- Total: ~900MB steady / ~2GB limit envelope

## Activation

```bash
docker compose -f docker-compose.yml \
  -f profiles/observability-full/docker-compose.observability-full.yml up -d
```

## Promotion Criteria

Deploy only when the observability scorecard (`just observability-scorecard`) returns PROMOTE_FULL_STACK. See `docs/OBSERVABILITY-PROFILES.md` for trigger definitions.

## Rollback

```bash
# Tear down full stack
docker compose -f docker-compose.yml \
  -f profiles/observability-full/docker-compose.observability-full.yml down

# Return to lite profile
docker compose -f docker-compose.yml \
  -f profiles/observability-lite/docker-compose.observability-lite.yml up -d
```

## Security

All services run as non-root, with cap_drop ALL and no-new-privileges.
