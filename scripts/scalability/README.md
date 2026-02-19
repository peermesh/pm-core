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
```

### Output

Default output root: `reports/scalability/<timestamp>-wave1/`

Key artifacts:

- `trigger-matrix.tsv`
- `nonfunctional-checks.tsv`
- `next-queue-map.tsv`
- `wave1-findings.md`
- `wave1-summary.env`
