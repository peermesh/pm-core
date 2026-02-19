#!/usr/bin/env bash
# ==============================================================
# Scalability + Resilience Wave-1 Validator
# ==============================================================
# Produces a measurable add-host vs scale-up decision matrix and
# captures repeatable non-functional validation outputs.
#
# Exit codes:
#   0 = validation completed (no blocking execution failures)
#   1 = one or more non-functional checks failed
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

OUTPUT_DIR=""
RUN_NONFUNCTIONAL=true

CPU_24H_P95=""
MEM_24H_P95=""
DISK_UTIL_P95=""
LATENCY_P99_MS=""
ERROR_RATE_PCT=""
RTO_MIN=""
RPO_HOURS=""

CPU_SCALE_UP_THRESHOLD=60
CPU_ADD_HOST_THRESHOLD=70
MEM_SCALE_UP_THRESHOLD=70
MEM_ADD_HOST_THRESHOLD=80
DISK_SCALE_UP_THRESHOLD=75
DISK_ADD_HOST_THRESHOLD=85
LATENCY_SCALE_UP_THRESHOLD=180
LATENCY_ADD_HOST_THRESHOLD=250
ERROR_SCALE_UP_THRESHOLD=0.5
ERROR_ADD_HOST_THRESHOLD=1.0
RTO_TARGET_MIN=30
RPO_TARGET_HOURS=24

WARNINGS=0
CHECK_FAILURES=0
CHECK_PASSES=0
ADD_HOST_COUNT=0
SCALE_UP_COUNT=0
UNKNOWN_COUNT=0

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --output-dir DIR          Output directory for validation artifacts
  --cpu-24h-p95 VALUE       CPU p95 percent over last 24h
  --mem-24h-p95 VALUE       Memory p95 percent over last 24h
  --disk-util-p95 VALUE     Disk utilization p95 percent
  --latency-p99-ms VALUE    p99 latency in milliseconds
  --error-rate-pct VALUE    Error rate percentage
  --rto-min VALUE           Recovery time objective observed (minutes)
  --rpo-hours VALUE         Recovery point objective observed (hours)
  --skip-nonfunctional      Skip non-functional check suite
  --help, -h                Show help
USAGE
}

num_ge() {
    awk -v a="$1" -v b="$2" 'BEGIN {exit !(a >= b)}'
}

num_lt() {
    awk -v a="$1" -v b="$2" 'BEGIN {exit !(a < b)}'
}

is_number() {
    [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]
}

log_warn() {
    WARNINGS=$((WARNINGS + 1))
    echo "[WARN] $1"
}

log_info() {
    echo "[INFO] $1"
}

log_pass() {
    CHECK_PASSES=$((CHECK_PASSES + 1))
    echo "[PASS] $1"
}

log_check_fail() {
    CHECK_FAILURES=$((CHECK_FAILURES + 1))
    echo "[FAIL] $1"
}

derive_cpu_snapshot_pct() {
    local cpus load1

    if command -v sysctl >/dev/null 2>&1; then
        cpus="$(sysctl -n hw.ncpu 2>/dev/null || true)"
    fi
    if [[ -z "${cpus:-}" ]] && command -v nproc >/dev/null 2>&1; then
        cpus="$(nproc 2>/dev/null || true)"
    fi

    if command -v uptime >/dev/null 2>&1; then
        load1="$(uptime | sed 's/,//g' | awk -F'load averages?: ' '{print $2}' | awk '{print $1}' | tr -d ' ' || true)"
    fi

    if [[ -n "${cpus:-}" ]] && [[ -n "${load1:-}" ]] && is_number "$cpus" && is_number "$load1" && num_lt 0 "$cpus"; then
        awk -v l="$load1" -v c="$cpus" 'BEGIN {printf "%.2f", (l / c) * 100}'
    else
        echo ""
    fi
}

derive_mem_snapshot_pct() {
    if command -v free >/dev/null 2>&1; then
        free -m | awk '/^Mem:/ { if ($2 > 0) {printf "%.2f", ($3/$2)*100} }'
        return 0
    fi

    if command -v vm_stat >/dev/null 2>&1; then
        vm_stat | awk '
            /Pages active/ {active=$3}
            /Pages wired down/ {wired=$4}
            /Pages occupied by compressor/ {compressed=$5}
            /Pages free/ {free=$3}
            /Pages speculative/ {spec=$3}
            END {
                gsub("\\.","",active); gsub("\\.","",wired); gsub("\\.","",compressed); gsub("\\.","",free); gsub("\\.","",spec)
                used = active + wired + compressed
                total = used + free + spec
                if (total > 0) {
                    printf "%.2f", (used / total) * 100
                }
            }
        '
        return 0
    fi

    echo ""
}

derive_disk_snapshot_pct() {
    df -Pk / | awk 'NR==2 {gsub("%", "", $5); print $5}'
}

run_check() {
    local name="$1"
    shift

    local log_file="$NONFUNCTIONAL_DIR/${name}.log"

    set +e
    "$@" >"$log_file" 2>&1
    local rc=$?
    set -e

    if [[ "$rc" -eq 0 ]]; then
        log_pass "$name"
        echo -e "${name}\tPASS\t${rc}\t${log_file}" >>"$NONFUNCTIONAL_TABLE"
    else
        log_check_fail "$name (rc=${rc})"
        echo -e "${name}\tFAIL\t${rc}\t${log_file}" >>"$NONFUNCTIONAL_TABLE"
    fi
}

evaluate_metric() {
    local dimension="$1"
    local value="$2"
    local scale_up_threshold="$3"
    local add_host_threshold="$4"
    local action_scale="$5"
    local action_add="$6"

    local status action

    if [[ -z "$value" ]] || ! is_number "$value"; then
        status="UNKNOWN"
        action="collect-metric"
        UNKNOWN_COUNT=$((UNKNOWN_COUNT + 1))
        log_warn "${dimension}: metric unavailable"
    elif num_ge "$value" "$add_host_threshold"; then
        status="ADD_HOST"
        action="$action_add"
        ADD_HOST_COUNT=$((ADD_HOST_COUNT + 1))
    elif num_ge "$value" "$scale_up_threshold"; then
        status="SCALE_UP"
        action="$action_scale"
        SCALE_UP_COUNT=$((SCALE_UP_COUNT + 1))
    else
        status="PASS"
        action="monitor"
    fi

    echo -e "${dimension}\t${value:-na}\t${scale_up_threshold}\t${add_host_threshold}\t${status}\t${action}" >>"$TRIGGER_MATRIX"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --output-dir)
            OUTPUT_DIR="${2:-}"
            if [[ -z "$OUTPUT_DIR" ]]; then
                echo "[ERROR] --output-dir requires a value"
                exit 1
            fi
            shift 2
            ;;
        --cpu-24h-p95)
            CPU_24H_P95="${2:-}"
            shift 2
            ;;
        --mem-24h-p95)
            MEM_24H_P95="${2:-}"
            shift 2
            ;;
        --disk-util-p95)
            DISK_UTIL_P95="${2:-}"
            shift 2
            ;;
        --latency-p99-ms)
            LATENCY_P99_MS="${2:-}"
            shift 2
            ;;
        --error-rate-pct)
            ERROR_RATE_PCT="${2:-}"
            shift 2
            ;;
        --rto-min)
            RTO_MIN="${2:-}"
            shift 2
            ;;
        --rpo-hours)
            RPO_HOURS="${2:-}"
            shift 2
            ;;
        --skip-nonfunctional)
            RUN_NONFUNCTIONAL=false
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$PROJECT_DIR/reports/scalability/$(date -u +%Y-%m-%d-%H%M%S)-wave1"
fi

mkdir -p "$OUTPUT_DIR"
NONFUNCTIONAL_DIR="$OUTPUT_DIR/nonfunctional"
mkdir -p "$NONFUNCTIONAL_DIR"

TRIGGER_MATRIX="$OUTPUT_DIR/trigger-matrix.tsv"
SUMMARY_ENV="$OUTPUT_DIR/wave1-summary.env"
FINDINGS_MD="$OUTPUT_DIR/wave1-findings.md"
QUEUE_MAP="$OUTPUT_DIR/next-queue-map.tsv"
NONFUNCTIONAL_TABLE="$OUTPUT_DIR/nonfunctional-checks.tsv"

{
    echo -e "dimension\tvalue\tscale_up_threshold\tadd_host_threshold\tstatus\trecommended_action"
} >"$TRIGGER_MATRIX"

{
    echo -e "check\tstatus\texit_code\tlog"
} >"$NONFUNCTIONAL_TABLE"

if [[ -z "$CPU_24H_P95" ]]; then
    CPU_24H_P95="$(derive_cpu_snapshot_pct || true)"
    log_info "cpu_24h_p95 not provided; using current snapshot estimate"
fi

if [[ -z "$MEM_24H_P95" ]]; then
    MEM_24H_P95="$(derive_mem_snapshot_pct || true)"
    log_info "mem_24h_p95 not provided; using current snapshot estimate"
fi

if [[ -z "$DISK_UTIL_P95" ]]; then
    DISK_UTIL_P95="$(derive_disk_snapshot_pct || true)"
    log_info "disk_util_p95 not provided; using current snapshot estimate"
fi

evaluate_metric "cpu_24h_p95_pct" "$CPU_24H_P95" "$CPU_SCALE_UP_THRESHOLD" "$CPU_ADD_HOST_THRESHOLD" "scale-up-current-host" "add-host-role-split"
evaluate_metric "mem_24h_p95_pct" "$MEM_24H_P95" "$MEM_SCALE_UP_THRESHOLD" "$MEM_ADD_HOST_THRESHOLD" "scale-up-memory" "add-host-role-split"
evaluate_metric "disk_util_p95_pct" "$DISK_UTIL_P95" "$DISK_SCALE_UP_THRESHOLD" "$DISK_ADD_HOST_THRESHOLD" "scale-up-storage" "add-host-stateful-split"
evaluate_metric "latency_p99_ms" "$LATENCY_P99_MS" "$LATENCY_SCALE_UP_THRESHOLD" "$LATENCY_ADD_HOST_THRESHOLD" "scale-up-service-capacity" "add-host-app-tier"
evaluate_metric "error_rate_pct" "$ERROR_RATE_PCT" "$ERROR_SCALE_UP_THRESHOLD" "$ERROR_ADD_HOST_THRESHOLD" "scale-up-and-debug" "add-host-failure-domain-split"

# RTO and RPO are target-max metrics.
if [[ -n "$RTO_MIN" ]] && is_number "$RTO_MIN"; then
    if num_ge "$RTO_MIN" "$RTO_TARGET_MIN"; then
        echo -e "rto_min\t${RTO_MIN}\t${RTO_TARGET_MIN}\t${RTO_TARGET_MIN}\tADD_HOST\tadd-host-recovery-isolation" >>"$TRIGGER_MATRIX"
        ADD_HOST_COUNT=$((ADD_HOST_COUNT + 1))
    else
        echo -e "rto_min\t${RTO_MIN}\t${RTO_TARGET_MIN}\t${RTO_TARGET_MIN}\tPASS\tmonitor" >>"$TRIGGER_MATRIX"
    fi
else
    echo -e "rto_min\t${RTO_MIN:-na}\t${RTO_TARGET_MIN}\t${RTO_TARGET_MIN}\tUNKNOWN\tcollect-drill-evidence" >>"$TRIGGER_MATRIX"
    UNKNOWN_COUNT=$((UNKNOWN_COUNT + 1))
    log_warn "rto_min metric unavailable"
fi

if [[ -n "$RPO_HOURS" ]] && is_number "$RPO_HOURS"; then
    if num_ge "$RPO_HOURS" "$RPO_TARGET_HOURS"; then
        echo -e "rpo_hours\t${RPO_HOURS}\t${RPO_TARGET_HOURS}\t${RPO_TARGET_HOURS}\tADD_HOST\tadd-host-data-resilience" >>"$TRIGGER_MATRIX"
        ADD_HOST_COUNT=$((ADD_HOST_COUNT + 1))
    else
        echo -e "rpo_hours\t${RPO_HOURS}\t${RPO_TARGET_HOURS}\t${RPO_TARGET_HOURS}\tPASS\tmonitor" >>"$TRIGGER_MATRIX"
    fi
else
    echo -e "rpo_hours\t${RPO_HOURS:-na}\t${RPO_TARGET_HOURS}\t${RPO_TARGET_HOURS}\tUNKNOWN\tcollect-backup-restore-evidence" >>"$TRIGGER_MATRIX"
    UNKNOWN_COUNT=$((UNKNOWN_COUNT + 1))
    log_warn "rpo_hours metric unavailable"
fi

if [[ "$RUN_NONFUNCTIONAL" == true ]]; then
    run_check "compose-config" docker compose -f "$PROJECT_DIR/docker-compose.yml" config -q
    run_check "observability-profile" "$PROJECT_DIR/scripts/validate-observability-profile.sh"
    run_check "supply-chain-baseline" "$PROJECT_DIR/scripts/security/validate-supply-chain.sh" --severity-threshold CRITICAL --output-dir "$OUTPUT_DIR/supply-chain"
    run_check "deploy-validate" "$PROJECT_DIR/scripts/deploy.sh" --validate --environment dev --evidence-root "$OUTPUT_DIR/deploy-evidence" --evidence-tag "wave1-validation"
else
    echo -e "nonfunctional-suite\tSKIPPED\t0\t" >>"$NONFUNCTIONAL_TABLE"
fi

overall_decision="NO_ACTION"
if [[ "$ADD_HOST_COUNT" -gt 0 ]]; then
    overall_decision="ADD_HOST"
elif [[ "$SCALE_UP_COUNT" -gt 0 ]]; then
    overall_decision="SCALE_UP"
fi

if [[ "$UNKNOWN_COUNT" -gt 0 && "$overall_decision" == "NO_ACTION" ]]; then
    overall_decision="NO_ACTION_WITH_GAPS"
fi

{
    echo -e "trigger_status\trecommended_queue_action\tnotes"
    if [[ "$overall_decision" == "ADD_HOST" ]]; then
        echo -e "ADD_HOST\tWO-NEXT-MULTI-VPS-EXPANSION\tPromote host-role split using OpenTofu multi-VPS topology plan"
    elif [[ "$overall_decision" == "SCALE_UP" ]]; then
        echo -e "SCALE_UP\tWO-NEXT-CAPACITY-TUNING\tTune resource profile and service placement on existing host"
    else
        echo -e "NO_ACTION\tWO-NEXT-MONITORING-ONLY\tKeep periodic validation cadence and collect longer-window metrics"
    fi

    if [[ "$UNKNOWN_COUNT" -gt 0 ]]; then
        echo -e "GAPS\tWO-NEXT-METRICS-INSTRUMENTATION\tCollect 24h p95 latency/error/RTO/RPO evidence"
    fi
} >"$QUEUE_MAP"

cat >"$FINDINGS_MD" <<FINDINGS
# Scalability And Resilience Wave-1 Findings

- Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Overall decision: ${overall_decision}
- Add-host trigger count: ${ADD_HOST_COUNT}
- Scale-up trigger count: ${SCALE_UP_COUNT}
- Unknown metric count: ${UNKNOWN_COUNT}
- Non-functional check passes: ${CHECK_PASSES}
- Non-functional check failures: ${CHECK_FAILURES}

## Trigger Matrix

See: ${TRIGGER_MATRIX}

## Next Queue Mapping

See: ${QUEUE_MAP}

## Non-Functional Validation

See: ${NONFUNCTIONAL_TABLE}
FINDINGS

cat >"$SUMMARY_ENV" <<SUMMARY
WAVE1_OUTPUT_DIR=$OUTPUT_DIR
WAVE1_TRIGGER_MATRIX=$TRIGGER_MATRIX
WAVE1_FINDINGS=$FINDINGS_MD
WAVE1_QUEUE_MAP=$QUEUE_MAP
WAVE1_NONFUNCTIONAL_TABLE=$NONFUNCTIONAL_TABLE
WAVE1_OVERALL_DECISION=$overall_decision
WAVE1_ADD_HOST_COUNT=$ADD_HOST_COUNT
WAVE1_SCALE_UP_COUNT=$SCALE_UP_COUNT
WAVE1_UNKNOWN_COUNT=$UNKNOWN_COUNT
WAVE1_WARNINGS=$WARNINGS
WAVE1_CHECK_PASSES=$CHECK_PASSES
WAVE1_CHECK_FAILURES=$CHECK_FAILURES
SUMMARY

echo ""
echo "Wave-1 summary: decision=${overall_decision} add_host=${ADD_HOST_COUNT} scale_up=${SCALE_UP_COUNT} unknown=${UNKNOWN_COUNT}"
echo "Non-functional checks: passes=${CHECK_PASSES} failures=${CHECK_FAILURES}"
echo "Summary file: $SUMMARY_ENV"

if [[ "$CHECK_FAILURES" -gt 0 ]]; then
    exit 1
fi

exit 0
