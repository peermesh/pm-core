#!/usr/bin/env bash
# ==============================================================
# Observability Promotion Trigger Scorecard
# ==============================================================
# Reads wave metrics and incident signals and outputs a promotion
# decision: HOLD, PROMOTE_FULL_STACK, or REVIEW.
#
# Every input value and scoring step is logged for auditability.
#
# Inputs:
#   --wave1-summary FILE      wave1-summary.env from run-wave1-validation.sh
#   --wave1-summary-prev FILE previous wave1-summary.env (for consecutive check)
#   --wave2-summary FILE      wave2-metrics-summary.env (optional, for unknown check)
#   --incident-count N        manual incident count in evaluation window
#   --config FILE             scorecard-config.env (default: co-located)
#   --output-dir DIR          output directory for scorecard artifacts
#
# Exit codes:
#   0 = scorecard completed successfully
#   1 = invalid input or execution error
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

CONFIG_FILE="$SCRIPT_DIR/scorecard-config.env"
WAVE1_SUMMARY=""
WAVE1_SUMMARY_PREV=""
WAVE2_SUMMARY=""
INCIDENT_COUNT=""
OUTPUT_DIR=""

# ---- Helpers ----

is_number() {
    [[ "$1" =~ ^-?[0-9]+([.][0-9]+)?$ ]]
}

num_ge() {
    awk -v a="$1" -v b="$2" 'BEGIN {exit !(a >= b)}'
}

num_lt() {
    awk -v a="$1" -v b="$2" 'BEGIN {exit !(a < b)}'
}

log_info() {
    local msg="[INFO] $1"
    echo "$msg"
    [[ -n "${AUDIT_LOG:-}" ]] && echo "$msg" >> "$AUDIT_LOG"
}

log_score() {
    local msg="[SCORE] $1"
    echo "$msg"
    [[ -n "${AUDIT_LOG:-}" ]] && echo "$msg" >> "$AUDIT_LOG"
}

log_input() {
    local msg="[INPUT] $1"
    echo "$msg"
    [[ -n "${AUDIT_LOG:-}" ]] && echo "$msg" >> "$AUDIT_LOG"
}

log_decision() {
    local msg="[DECISION] $1"
    echo "$msg"
    [[ -n "${AUDIT_LOG:-}" ]] && echo "$msg" >> "$AUDIT_LOG"
}

log_warn() {
    local msg="[WARN] $1"
    echo "$msg" >&2
    [[ -n "${AUDIT_LOG:-}" ]] && echo "$msg" >> "$AUDIT_LOG"
}

log_error() {
    echo "[ERROR] $1" >&2
    [[ -n "${AUDIT_LOG:-}" ]] && echo "[ERROR] $1" >> "$AUDIT_LOG"
}

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --wave1-summary FILE       Current wave1-summary.env (required)
  --wave1-summary-prev FILE  Previous wave1-summary.env (for consecutive ADD_HOST check)
  --wave2-summary FILE       Wave-2 metrics summary (for unknown dimension check)
  --incident-count N         Manual incident count in evaluation window (default: 0)
  --config FILE              Scorecard config file (default: scorecard-config.env)
  --output-dir DIR           Output directory (default: reports/observability/<timestamp>)
  --help, -h                 Show help

Decision classes:
  HOLD                No action needed; stay on observability-lite
  REVIEW              Evidence warrants human review before promotion
  PROMOTE_FULL_STACK  Evidence supports promotion to enterprise observability
USAGE
}

# ---- Parse arguments ----

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wave1-summary)
            WAVE1_SUMMARY="${2:-}"
            [[ -n "$WAVE1_SUMMARY" ]] || { log_error "--wave1-summary requires a value"; exit 1; }
            shift 2
            ;;
        --wave1-summary-prev)
            WAVE1_SUMMARY_PREV="${2:-}"
            [[ -n "$WAVE1_SUMMARY_PREV" ]] || { log_error "--wave1-summary-prev requires a value"; exit 1; }
            shift 2
            ;;
        --wave2-summary)
            WAVE2_SUMMARY="${2:-}"
            [[ -n "$WAVE2_SUMMARY" ]] || { log_error "--wave2-summary requires a value"; exit 1; }
            shift 2
            ;;
        --incident-count)
            INCIDENT_COUNT="${2:-}"
            [[ -n "$INCIDENT_COUNT" ]] || { log_error "--incident-count requires a value"; exit 1; }
            if ! [[ "$INCIDENT_COUNT" =~ ^[0-9]+$ ]]; then
                log_error "--incident-count must be a non-negative integer"
                exit 1
            fi
            shift 2
            ;;
        --config)
            CONFIG_FILE="${2:-}"
            [[ -n "$CONFIG_FILE" ]] || { log_error "--config requires a value"; exit 1; }
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="${2:-}"
            [[ -n "$OUTPUT_DIR" ]] || { log_error "--output-dir requires a value"; exit 1; }
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# ---- Validate required inputs ----

if [[ -z "$WAVE1_SUMMARY" ]]; then
    log_error "--wave1-summary is required"
    usage
    exit 1
fi

if [[ ! -f "$WAVE1_SUMMARY" ]]; then
    log_error "Wave-1 summary file not found: $WAVE1_SUMMARY"
    exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
    log_error "Config file not found: $CONFIG_FILE"
    exit 1
fi

# ---- Set defaults ----

if [[ -z "$INCIDENT_COUNT" ]]; then
    INCIDENT_COUNT=0
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$PROJECT_DIR/reports/observability/$(date -u +%Y-%m-%d-%H%M%S)-scorecard"
fi

mkdir -p "$OUTPUT_DIR"

AUDIT_LOG="$OUTPUT_DIR/scorecard-audit.log"
SCORECARD_TSV="$OUTPUT_DIR/scorecard.tsv"
SCORECARD_SUMMARY="$OUTPUT_DIR/scorecard-summary.env"
SCORECARD_FINDINGS="$OUTPUT_DIR/scorecard-findings.md"

: > "$AUDIT_LOG"

log_info "Observability promotion trigger scorecard started at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log_info "Config file: $CONFIG_FILE"
log_info "Wave-1 summary: $WAVE1_SUMMARY"
log_info "Wave-1 summary (prev): ${WAVE1_SUMMARY_PREV:-none}"
log_info "Wave-2 summary: ${WAVE2_SUMMARY:-none}"
log_info "Incident count: $INCIDENT_COUNT"
log_info "Output dir: $OUTPUT_DIR"

# ---- Load configuration ----

# shellcheck disable=SC1090
source "$CONFIG_FILE"

log_input "Config: TRIGGER1_CONSECUTIVE_ADD_HOST_WAVES=${TRIGGER1_CONSECUTIVE_ADD_HOST_WAVES}"
log_input "Config: TRIGGER1_WEIGHT=${TRIGGER1_WEIGHT}"
log_input "Config: TRIGGER2_LATENCY_P99_MS_THRESHOLD=${TRIGGER2_LATENCY_P99_MS_THRESHOLD}"
log_input "Config: TRIGGER2_ERROR_RATE_PCT_THRESHOLD=${TRIGGER2_ERROR_RATE_PCT_THRESHOLD}"
log_input "Config: TRIGGER2_WEIGHT=${TRIGGER2_WEIGHT}"
log_input "Config: TRIGGER3_MAX_UNKNOWN_CRITICAL=${TRIGGER3_MAX_UNKNOWN_CRITICAL}"
log_input "Config: TRIGGER3_WEIGHT=${TRIGGER3_WEIGHT}"
log_input "Config: TRIGGER4_INCIDENT_THRESHOLD=${TRIGGER4_INCIDENT_THRESHOLD}"
log_input "Config: TRIGGER4_EVALUATION_WINDOW_DAYS=${TRIGGER4_EVALUATION_WINDOW_DAYS}"
log_input "Config: TRIGGER4_WEIGHT=${TRIGGER4_WEIGHT}"
log_input "Config: PROMOTE_THRESHOLD=${PROMOTE_THRESHOLD}"
log_input "Config: REVIEW_THRESHOLD=${REVIEW_THRESHOLD}"

# ---- Load wave-1 current summary ----

# shellcheck disable=SC1090
source "$WAVE1_SUMMARY"

CURRENT_ADD_HOST="${WAVE1_ADD_HOST_COUNT:-0}"
CURRENT_SCALE_UP="${WAVE1_SCALE_UP_COUNT:-0}"
CURRENT_UNKNOWN="${WAVE1_UNKNOWN_COUNT:-0}"
CURRENT_DECISION="${WAVE1_OVERALL_DECISION:-NO_ACTION}"

log_input "Wave-1 current: ADD_HOST_COUNT=${CURRENT_ADD_HOST}"
log_input "Wave-1 current: SCALE_UP_COUNT=${CURRENT_SCALE_UP}"
log_input "Wave-1 current: UNKNOWN_COUNT=${CURRENT_UNKNOWN}"
log_input "Wave-1 current: OVERALL_DECISION=${CURRENT_DECISION}"

# ---- Load wave-1 previous summary (if provided) ----

PREV_ADD_HOST=0
PREV_DECISION="NONE"

if [[ -n "$WAVE1_SUMMARY_PREV" ]]; then
    if [[ -f "$WAVE1_SUMMARY_PREV" ]]; then
        # shellcheck disable=SC1090
        source "$WAVE1_SUMMARY_PREV"
        PREV_ADD_HOST="${WAVE1_ADD_HOST_COUNT:-0}"
        PREV_DECISION="${WAVE1_OVERALL_DECISION:-NO_ACTION}"
        log_input "Wave-1 previous: ADD_HOST_COUNT=${PREV_ADD_HOST}"
        log_input "Wave-1 previous: OVERALL_DECISION=${PREV_DECISION}"
    else
        log_warn "Previous wave-1 summary not found: $WAVE1_SUMMARY_PREV"
    fi
    # Reload current summary to restore variable state after previous sourcing
    # shellcheck disable=SC1090
    source "$WAVE1_SUMMARY"
fi

# ---- Load wave-2 summary for latency/error/unknown checking ----

W2_LATENCY_P99=""
W2_ERROR_RATE=""
W2_UNKNOWN_CRITICAL=0

if [[ -n "$WAVE2_SUMMARY" && -f "$WAVE2_SUMMARY" ]]; then
    # shellcheck disable=SC1090
    source "$WAVE2_SUMMARY"
    W2_LATENCY_P99="${WAVE2_LATENCY_P99_MS:-}"
    W2_ERROR_RATE="${WAVE2_ERROR_RATE_P95_PCT:-}"
    log_input "Wave-2: LATENCY_P99_MS=${W2_LATENCY_P99:-UNKNOWN}"
    log_input "Wave-2: ERROR_RATE_P95_PCT=${W2_ERROR_RATE:-UNKNOWN}"

    # Count unknown critical dimensions from wave-2
    for dim_var in WAVE2_LATENCY_P99_MS WAVE2_ERROR_RATE_P95_PCT WAVE2_RTO_MIN WAVE2_RPO_HOURS; do
        dim_val="${!dim_var:-}"
        if [[ -z "$dim_val" ]] || ! is_number "$dim_val"; then
            W2_UNKNOWN_CRITICAL=$((W2_UNKNOWN_CRITICAL + 1))
            log_input "Wave-2: ${dim_var} is UNKNOWN"
        fi
    done
    log_input "Wave-2: unknown_critical_count=${W2_UNKNOWN_CRITICAL}"
elif [[ -n "$WAVE2_SUMMARY" ]]; then
    log_warn "Wave-2 summary not found: $WAVE2_SUMMARY"
fi

# ---- Scorecard TSV header ----

{
    printf 'trigger\tname\tfired\tweight\tscore\tevidence\n'
} > "$SCORECARD_TSV"

TOTAL_SCORE=0
TRIGGERS_FIRED=0

# ---- Trigger 1: Consecutive ADD_HOST waves ----

T1_FIRED="false"
T1_SCORE=0
T1_EVIDENCE="current_add_host=${CURRENT_ADD_HOST},prev_add_host=${PREV_ADD_HOST},required=${TRIGGER1_CONSECUTIVE_ADD_HOST_WAVES}"

if [[ "$CURRENT_ADD_HOST" -gt 0 && "$PREV_ADD_HOST" -gt 0 ]]; then
    T1_FIRED="true"
    T1_SCORE="$TRIGGER1_WEIGHT"
    TRIGGERS_FIRED=$((TRIGGERS_FIRED + 1))
    log_score "Trigger 1 FIRED: two consecutive waves with ADD_HOST (current=${CURRENT_ADD_HOST}, prev=${PREV_ADD_HOST})"
else
    log_score "Trigger 1 not fired: consecutive ADD_HOST requirement not met"
fi

TOTAL_SCORE=$((TOTAL_SCORE + T1_SCORE))
printf 'T1\tconsecutive_add_host_waves\t%s\t%s\t%s\t%s\n' "$T1_FIRED" "$TRIGGER1_WEIGHT" "$T1_SCORE" "$T1_EVIDENCE" >> "$SCORECARD_TSV"

# ---- Trigger 2: Single-wave latency + error co-breach ----

T2_FIRED="false"
T2_SCORE=0

# Use wave-2 metrics if available, otherwise fall back to wave-1 trigger matrix status
LATENCY_VAL="${W2_LATENCY_P99:-}"
ERROR_VAL="${W2_ERROR_RATE:-}"
T2_EVIDENCE="latency_p99=${LATENCY_VAL:-UNKNOWN},error_rate=${ERROR_VAL:-UNKNOWN}"
T2_EVIDENCE="${T2_EVIDENCE},latency_threshold=${TRIGGER2_LATENCY_P99_MS_THRESHOLD}"
T2_EVIDENCE="${T2_EVIDENCE},error_threshold=${TRIGGER2_ERROR_RATE_PCT_THRESHOLD}"

if [[ -n "$LATENCY_VAL" ]] && is_number "$LATENCY_VAL" && \
   [[ -n "$ERROR_VAL" ]] && is_number "$ERROR_VAL"; then
    if num_ge "$LATENCY_VAL" "$TRIGGER2_LATENCY_P99_MS_THRESHOLD" && \
       num_ge "$ERROR_VAL" "$TRIGGER2_ERROR_RATE_PCT_THRESHOLD"; then
        T2_FIRED="true"
        T2_SCORE="$TRIGGER2_WEIGHT"
        TRIGGERS_FIRED=$((TRIGGERS_FIRED + 1))
        log_score "Trigger 2 FIRED: latency p99=${LATENCY_VAL}ms >= ${TRIGGER2_LATENCY_P99_MS_THRESHOLD}ms AND error rate=${ERROR_VAL}% >= ${TRIGGER2_ERROR_RATE_PCT_THRESHOLD}%"
    else
        log_score "Trigger 2 not fired: co-breach condition not met (latency=${LATENCY_VAL}, error=${ERROR_VAL})"
    fi
else
    log_score "Trigger 2 not fired: metrics unavailable for evaluation"
fi

TOTAL_SCORE=$((TOTAL_SCORE + T2_SCORE))
printf 'T2\tlatency_error_cobreach\t%s\t%s\t%s\t%s\n' "$T2_FIRED" "$TRIGGER2_WEIGHT" "$T2_SCORE" "$T2_EVIDENCE" >> "$SCORECARD_TSV"

# ---- Trigger 3: Unknown critical dimensions after wave-2 ----

T3_FIRED="false"
T3_SCORE=0
T3_EVIDENCE="unknown_critical=${W2_UNKNOWN_CRITICAL},max_allowed=${TRIGGER3_MAX_UNKNOWN_CRITICAL}"

if [[ -n "$WAVE2_SUMMARY" && -f "$WAVE2_SUMMARY" ]]; then
    if [[ "$W2_UNKNOWN_CRITICAL" -gt "$TRIGGER3_MAX_UNKNOWN_CRITICAL" ]]; then
        T3_FIRED="true"
        T3_SCORE="$TRIGGER3_WEIGHT"
        TRIGGERS_FIRED=$((TRIGGERS_FIRED + 1))
        log_score "Trigger 3 FIRED: ${W2_UNKNOWN_CRITICAL} unknown critical dimensions (max allowed: ${TRIGGER3_MAX_UNKNOWN_CRITICAL})"
    else
        log_score "Trigger 3 not fired: all critical dimensions have values"
    fi
else
    # If no wave-2 summary is provided, check wave-1 unknown count as fallback
    if [[ "$CURRENT_UNKNOWN" -gt "$TRIGGER3_MAX_UNKNOWN_CRITICAL" ]]; then
        T3_FIRED="true"
        T3_SCORE="$TRIGGER3_WEIGHT"
        TRIGGERS_FIRED=$((TRIGGERS_FIRED + 1))
        T3_EVIDENCE="unknown_from_wave1=${CURRENT_UNKNOWN},max_allowed=${TRIGGER3_MAX_UNKNOWN_CRITICAL},source=wave1_fallback"
        log_score "Trigger 3 FIRED (wave-1 fallback): ${CURRENT_UNKNOWN} unknown dimensions"
    else
        T3_EVIDENCE="unknown_from_wave1=${CURRENT_UNKNOWN},max_allowed=${TRIGGER3_MAX_UNKNOWN_CRITICAL},source=wave1_fallback"
        log_score "Trigger 3 not fired: wave-2 summary not available, wave-1 unknowns within tolerance"
    fi
fi

TOTAL_SCORE=$((TOTAL_SCORE + T3_SCORE))
printf 'T3\tunknown_critical_dimensions\t%s\t%s\t%s\t%s\n' "$T3_FIRED" "$TRIGGER3_WEIGHT" "$T3_SCORE" "$T3_EVIDENCE" >> "$SCORECARD_TSV"

# ---- Trigger 4: Incident rate threshold ----

T4_FIRED="false"
T4_SCORE=0
T4_EVIDENCE="incident_count=${INCIDENT_COUNT},threshold=${TRIGGER4_INCIDENT_THRESHOLD},window_days=${TRIGGER4_EVALUATION_WINDOW_DAYS}"

if [[ "$INCIDENT_COUNT" -ge "$TRIGGER4_INCIDENT_THRESHOLD" ]]; then
    T4_FIRED="true"
    T4_SCORE="$TRIGGER4_WEIGHT"
    TRIGGERS_FIRED=$((TRIGGERS_FIRED + 1))
    log_score "Trigger 4 FIRED: incident count ${INCIDENT_COUNT} >= threshold ${TRIGGER4_INCIDENT_THRESHOLD}"
else
    log_score "Trigger 4 not fired: incident count ${INCIDENT_COUNT} < threshold ${TRIGGER4_INCIDENT_THRESHOLD}"
fi

TOTAL_SCORE=$((TOTAL_SCORE + T4_SCORE))
printf 'T4\tincident_rate_exceeded\t%s\t%s\t%s\t%s\n' "$T4_FIRED" "$TRIGGER4_WEIGHT" "$T4_SCORE" "$T4_EVIDENCE" >> "$SCORECARD_TSV"

# ---- Compute decision ----

DECISION="HOLD"
if [[ "$TOTAL_SCORE" -ge "$PROMOTE_THRESHOLD" ]]; then
    DECISION="PROMOTE_FULL_STACK"
elif [[ "$TOTAL_SCORE" -ge "$REVIEW_THRESHOLD" ]]; then
    DECISION="REVIEW"
fi

log_decision "Total score: ${TOTAL_SCORE}/100"
log_decision "Triggers fired: ${TRIGGERS_FIRED}/4"
log_decision "Decision: ${DECISION}"

# ---- Write summary env ----

cat > "$SCORECARD_SUMMARY" <<SUMMARY
SCORECARD_OUTPUT_DIR=$OUTPUT_DIR
SCORECARD_CONFIG_FILE=$CONFIG_FILE
SCORECARD_WAVE1_SUMMARY=$WAVE1_SUMMARY
SCORECARD_WAVE1_SUMMARY_PREV=${WAVE1_SUMMARY_PREV:-}
SCORECARD_WAVE2_SUMMARY=${WAVE2_SUMMARY:-}
SCORECARD_INCIDENT_COUNT=$INCIDENT_COUNT
SCORECARD_TOTAL_SCORE=$TOTAL_SCORE
SCORECARD_TRIGGERS_FIRED=$TRIGGERS_FIRED
SCORECARD_DECISION=$DECISION
SCORECARD_T1_FIRED=$T1_FIRED
SCORECARD_T1_SCORE=$T1_SCORE
SCORECARD_T2_FIRED=$T2_FIRED
SCORECARD_T2_SCORE=$T2_SCORE
SCORECARD_T3_FIRED=$T3_FIRED
SCORECARD_T3_SCORE=$T3_SCORE
SCORECARD_T4_FIRED=$T4_FIRED
SCORECARD_T4_SCORE=$T4_SCORE
SCORECARD_PROMOTE_THRESHOLD=$PROMOTE_THRESHOLD
SCORECARD_REVIEW_THRESHOLD=$REVIEW_THRESHOLD
SCORECARD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SUMMARY

# ---- Write findings markdown ----

cat > "$SCORECARD_FINDINGS" <<FINDINGS
# Observability Promotion Trigger Scorecard

- Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Decision: **${DECISION}**
- Total score: ${TOTAL_SCORE}/100
- Triggers fired: ${TRIGGERS_FIRED}/4

## Trigger Results

| Trigger | Name | Fired | Weight | Score |
|---------|------|-------|--------|-------|
| T1 | Consecutive ADD_HOST waves | ${T1_FIRED} | ${TRIGGER1_WEIGHT} | ${T1_SCORE} |
| T2 | Latency + error co-breach | ${T2_FIRED} | ${TRIGGER2_WEIGHT} | ${T2_SCORE} |
| T3 | Unknown critical dimensions | ${T3_FIRED} | ${TRIGGER3_WEIGHT} | ${T3_SCORE} |
| T4 | Incident rate exceeded | ${T4_FIRED} | ${TRIGGER4_WEIGHT} | ${T4_SCORE} |

## Decision Thresholds

- PROMOTE_FULL_STACK: score >= ${PROMOTE_THRESHOLD}
- REVIEW: score >= ${REVIEW_THRESHOLD}
- HOLD: score < ${REVIEW_THRESHOLD}

## Input Sources

- Wave-1 summary (current): ${WAVE1_SUMMARY}
- Wave-1 summary (previous): ${WAVE1_SUMMARY_PREV:-not provided}
- Wave-2 summary: ${WAVE2_SUMMARY:-not provided}
- Incident count: ${INCIDENT_COUNT}

## Artifacts

- Scorecard TSV: ${SCORECARD_TSV}
- Summary env: ${SCORECARD_SUMMARY}
- Audit log: ${AUDIT_LOG}
FINDINGS

# ---- Final output ----

echo ""
echo "Observability scorecard: decision=${DECISION} score=${TOTAL_SCORE}/100 triggers_fired=${TRIGGERS_FIRED}/4"
echo "Scorecard TSV: $SCORECARD_TSV"
echo "Summary: $SCORECARD_SUMMARY"
echo "Audit log: $AUDIT_LOG"

exit 0
