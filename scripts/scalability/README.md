# Scalability Scripts

## run-wave1-validation.sh

Generates the Wave-1 scalability/resilience validation bundle:

- host expansion trigger matrix (`add-host` vs `scale-up`)
- non-functional check outcomes with logs
- next-queue mapping based on measured thresholds

### Usage

```bash
# Snapshot-driven run
./scripts/scalability/run-wave1-validation.sh

# Explicit metric run
./scripts/scalability/run-wave1-validation.sh \
  --cpu-24h-p95 72 \
  --mem-24h-p95 81 \
  --disk-util-p95 69 \
  --latency-p99-ms 210 \
  --error-rate-pct 0.6 \
  --rto-min 22 \
  --rpo-hours 8

# Ingest wave-2 collected metrics
./scripts/scalability/run-wave1-validation.sh \
  --metrics-summary-file /tmp/pmdl-wo033/aggregated/wave2-metrics-summary.env
```

### Output

Default output root: `reports/scalability/<timestamp>-wave1/`

Key artifacts:

- `trigger-matrix.tsv`
- `nonfunctional-checks.tsv`
- `next-queue-map.tsv`
- `wave1-findings.md`
- `wave1-summary.env`

## capture-wave2-metrics.sh

Captures the canonical wave-2 raw metric streams and immediately runs 24h aggregation.

What it captures:

- latency time series from Traefik access logs (`latency-ms.tsv`)
- error-rate time series from Traefik access logs (`error-rate-pct.tsv`)
- drill-derived RTO/RPO records (`rto-min.tsv`, `rpo-hours.tsv`)

Usage:

```bash
./scripts/scalability/capture-wave2-metrics.sh \
  --ssh-host root@37.27.208.228 \
  --output-dir /tmp/pmdl-wo033
```

Outputs:

- `/tmp/pmdl-wo033/raw/` (raw canonical files)
- `/tmp/pmdl-wo033/aggregated/wave2-metrics-summary.env` (validator ingest)
- `/tmp/pmdl-wo033/aggregated/metrics-query.tsv` (queryable 24h stats)
- `/tmp/pmdl-wo033/capture-summary.env` (capture provenance)

## collect-wave2-metrics.sh

Aggregates the canonical raw streams into queryable 24h quantiles.

Usage:

```bash
./scripts/scalability/collect-wave2-metrics.sh \
  --input-dir /tmp/pmdl-wo033/raw \
  --output-dir /tmp/pmdl-wo033/aggregated \
  --window-hours 24
```
