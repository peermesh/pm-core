# Scalability And Resilience Wave-1

Wave-1 establishes measurable triggers for deciding between vertical tuning (`scale-up`) and modular host expansion (`add-host`).

## Trigger Matrix

| Dimension | Scale-Up Trigger | Add-Host Trigger | Action Contract |
|---|---|---|---|
| CPU pressure (24h p95) | `>= 60%` | `>= 70%` | Scale existing host first; if sustained at add-host threshold, split role tiers |
| Memory pressure (24h p95) | `>= 70%` | `>= 80%` | Increase host memory/resources; if sustained at add-host threshold, split app/data role |
| Disk utilization (p95) | `>= 75%` | `>= 85%` | Increase storage first; at add-host threshold move stateful services to dedicated host |
| Latency (p99) | `>= 180ms` | `>= 250ms` | Tune/scale local services first; add app-tier host if sustained |
| Error rate | `>= 0.5%` | `>= 1.0%` | Immediate tuning + incident review; add-host if persistence indicates blast-radius pressure |
| RTO observed | monitor | `>= 30 min` | Add host-level recovery isolation |
| RPO observed | monitor | `>= 24 h` | Add host-level data resilience controls |

These thresholds operationalize the multi-VPS policy from:

- `.dev/ai/research/opentofu-integration/OPENTOFU-MULTI-VPS-TOPOLOGY-PLAN.md`

## Execution Command

```bash
./scripts/scalability/run-wave1-validation.sh
```

Explicit metric run example:

```bash
./scripts/scalability/run-wave1-validation.sh \
  --cpu-24h-p95 72 \
  --mem-24h-p95 81 \
  --disk-util-p95 69 \
  --latency-p99-ms 210 \
  --error-rate-pct 0.6 \
  --rto-min 22 \
  --rpo-hours 8
```

## Evidence Outputs

Default path:

- `reports/scalability/<timestamp>-wave1/`

Required artifacts:

- `trigger-matrix.tsv`
- `nonfunctional-checks.tsv`
- `next-queue-map.tsv`
- `wave1-findings.md`
- `wave1-summary.env`

## Queue Mapping Rules

- If any metric status is `ADD_HOST` => queue action `WO-NEXT-MULTI-VPS-EXPANSION`
- Else if any metric status is `SCALE_UP` => queue action `WO-NEXT-CAPACITY-TUNING`
- Else => queue action `WO-NEXT-MONITORING-ONLY`
- Unknown metric gaps => add `WO-NEXT-METRICS-INSTRUMENTATION`
