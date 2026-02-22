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

## Promotion Trigger Automation

The upgrade decision from Observability Lite to Enterprise Observability is evidence-driven via an automated scorecard. The scorecard evaluates four triggers and produces a weighted score mapped to one of three decision classes.

### Triggers

| ID | Trigger | Weight | Condition |
|----|---------|--------|-----------|
| T1 | Consecutive ADD_HOST waves | 25 | Two consecutive wave-1 validations include at least one ADD_HOST recommendation |
| T2 | Latency + error co-breach | 30 | Single wave records both latency p99 >= 250ms and error rate >= 1.0% |
| T3 | Unknown critical dimensions | 20 | Critical metrics (latency/error/RTO/RPO) remain UNKNOWN after wave-2 instrumentation |
| T4 | Incident rate exceeded | 25 | Manual incident count exceeds operator-only response threshold (default: 3 per 7 days) |

### Decision Classes

| Score Range | Decision | Action |
|-------------|----------|--------|
| >= 50 | PROMOTE_FULL_STACK | Proceed to enterprise observability overlay pilot |
| 25 - 49 | REVIEW | Human review required before promotion decision |
| < 25 | HOLD | Stay on observability-lite; continue periodic validation |

### Running the Scorecard

```bash
# Minimal run (current wave-1 summary only)
just observability-scorecard /path/to/wave1-summary.env

# Full run with previous wave, wave-2 metrics, and incident count
just observability-scorecard \
  /path/to/wave1-summary.env \
  /path/to/prev-wave1-summary.env \
  /path/to/wave2-metrics-summary.env \
  2

# Direct script invocation
./scripts/observability/run-observability-scorecard.sh \
  --wave1-summary /path/to/wave1-summary.env \
  --wave1-summary-prev /path/to/prev-wave1-summary.env \
  --wave2-summary /path/to/wave2-metrics-summary.env \
  --incident-count 2 \
  --output-dir /tmp/scorecard-output
```

### Scorecard Artifacts

Default output path: `reports/observability/<timestamp>-scorecard/`

- `scorecard.tsv` - trigger-level results with evidence
- `scorecard-summary.env` - machine-readable decision summary
- `scorecard-findings.md` - human-readable findings report
- `scorecard-audit.log` - full audit trail of inputs and decisions

### Configuration

Thresholds and weights are defined in `scripts/observability/scorecard-config.env`. Override with `--config` flag:

```bash
./scripts/observability/run-observability-scorecard.sh \
  --config /path/to/custom-config.env \
  --wave1-summary /path/to/wave1-summary.env
```

### Integration with Scalability Waves

The scorecard consumes outputs from the scalability wave pipeline:

1. Run `just validate-scalability-wave1` to produce `wave1-summary.env`
2. Optionally run `just validate-scalability-wave2` to produce `wave2-metrics-summary.env`
3. Feed both summaries into `just observability-scorecard`

This creates a repeatable evidence chain from metric collection through promotion decision.

## Rollback

To remove observability-lite overlay services:

```bash
docker compose -f docker-compose.yml -f .dev/profiles/observability-lite/docker-compose.observability-lite.yml down
```

Then return to foundation-only runtime:

```bash
docker compose -f docker-compose.yml up -d
```
