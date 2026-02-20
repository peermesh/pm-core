#!/usr/bin/env bash
# ==============================================================
# Wave-2 Metrics Capture Pipeline
# ==============================================================
# Captures canonical raw metric files for the wave-2 collector:
#  - latency-ms.tsv and error-rate-pct.tsv from Traefik access logs
#  - rto-min.tsv and rpo-hours.tsv from a local recovery drill
#
# Then runs collect-wave2-metrics.sh to produce queryable 24h outputs.
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

SSH_HOST="${WAVE2_METRICS_SSH_HOST:-}"
WINDOW_HOURS=24
TRAEFIK_CONTAINER="pmdl_traefik"
OUTPUT_DIR=""

RUN_DRILL=true
DRILL_SERVICE="pmdl_dashboard"
DRILL_HEALTH_URL="https://dockerlab.peermesh.org/api/health"
DRILL_TIMEOUT_SEC=180

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --ssh-host HOST          SSH target for Traefik log collection (required, e.g. root@37.27.208.228)
  --window-hours N         Log window in hours (default: 24)
  --traefik-container NAME Traefik container name on target host (default: pmdl_traefik)
  --output-dir DIR         Output root (default: reports/scalability/metrics-wave2/<timestamp>)
  --skip-drill             Skip drill-based RTO/RPO capture (requires existing rto/rpo files)
  --drill-service NAME     Service to restart for RTO drill (default: pmdl_dashboard)
  --drill-health-url URL   Health URL to poll after restart (default: https://dockerlab.peermesh.org/api/health)
  --drill-timeout-sec N    Drill health timeout in seconds (default: 180)
  --help, -h               Show help
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ssh-host)
            SSH_HOST="${2:-}"
            [[ -n "$SSH_HOST" ]] || { echo "[ERROR] --ssh-host requires a value"; exit 1; }
            shift 2
            ;;
        --window-hours)
            WINDOW_HOURS="${2:-}"
            [[ "$WINDOW_HOURS" =~ ^[0-9]+$ ]] || { echo "[ERROR] --window-hours must be an integer"; exit 1; }
            shift 2
            ;;
        --traefik-container)
            TRAEFIK_CONTAINER="${2:-}"
            [[ -n "$TRAEFIK_CONTAINER" ]] || { echo "[ERROR] --traefik-container requires a value"; exit 1; }
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="${2:-}"
            [[ -n "$OUTPUT_DIR" ]] || { echo "[ERROR] --output-dir requires a value"; exit 1; }
            shift 2
            ;;
        --skip-drill)
            RUN_DRILL=false
            shift
            ;;
        --drill-service)
            DRILL_SERVICE="${2:-}"
            [[ -n "$DRILL_SERVICE" ]] || { echo "[ERROR] --drill-service requires a value"; exit 1; }
            shift 2
            ;;
        --drill-health-url)
            DRILL_HEALTH_URL="${2:-}"
            [[ -n "$DRILL_HEALTH_URL" ]] || { echo "[ERROR] --drill-health-url requires a value"; exit 1; }
            shift 2
            ;;
        --drill-timeout-sec)
            DRILL_TIMEOUT_SEC="${2:-}"
            [[ "$DRILL_TIMEOUT_SEC" =~ ^[0-9]+$ ]] || { echo "[ERROR] --drill-timeout-sec must be an integer"; exit 1; }
            shift 2
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

if [[ -z "$SSH_HOST" ]]; then
    echo "[ERROR] Missing SSH host. Provide --ssh-host or WAVE2_METRICS_SSH_HOST"
    exit 1
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$PROJECT_DIR/reports/scalability/metrics-wave2/$(date -u +%Y-%m-%d-%H%M%S)"
fi

RAW_DIR="$OUTPUT_DIR/raw"
AGG_DIR="$OUTPUT_DIR/aggregated"
mkdir -p "$RAW_DIR" "$AGG_DIR"

TRAEFIK_LOG="$RAW_DIR/traefik-${WINDOW_HOURS}h.log"
PARSED_LOG="$RAW_DIR/traefik-parsed.tsv"
LATENCY_FILE="$RAW_DIR/latency-ms.tsv"
ERROR_FILE="$RAW_DIR/error-rate-pct.tsv"
RTO_FILE="$RAW_DIR/rto-min.tsv"
RPO_FILE="$RAW_DIR/rpo-hours.tsv"
DRILL_LOG="$RAW_DIR/drill.log"
CAPTURE_SUMMARY="$OUTPUT_DIR/capture-summary.env"

ssh "$SSH_HOST" "docker logs --since ${WINDOW_HOURS}h ${TRAEFIK_CONTAINER} 2>&1" > "$TRAEFIK_LOG"

jq -Rr '
    try fromjson catch empty
    | select(type == "object")
    | select(has("time") and has("Duration") and has("DownstreamStatus"))
    | [(.time | fromdateiso8601), (.Duration / 1000000), (.DownstreamStatus | tonumber)]
    | @tsv
' "$TRAEFIK_LOG" > "$PARSED_LOG"

parsed_count="$(wc -l < "$PARSED_LOG" | tr -d ' ')"
if [[ "$parsed_count" -eq 0 ]]; then
    echo "[ERROR] No JSON access-log events parsed from Traefik log stream"
    exit 1
fi

awk '{printf "%d\t%.6f\n", $1, $2}' "$PARSED_LOG" > "$LATENCY_FILE"

awk '
    {
        bucket = int($1 / 300) * 300
        total[bucket]++
        if ($3 >= 500) {
            errors[bucket]++
        }
    }
    END {
        for (b in total) {
            e = errors[b] + 0
            printf "%d\t%.6f\n", b, (e / total[b]) * 100
        }
    }
' "$PARSED_LOG" | sort -n > "$ERROR_FILE"

if [[ "$RUN_DRILL" == true ]]; then
    drill_start_epoch="$(date -u +%s)"
    drill_deadline="$((drill_start_epoch + DRILL_TIMEOUT_SEC))"
    drill_recovered=false
    drill_health_code=""

    {
        echo "Starting service recovery drill at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "SSH host: $SSH_HOST"
        echo "Service: $DRILL_SERVICE"
        echo "Health URL: $DRILL_HEALTH_URL"
        ssh "$SSH_HOST" "docker restart $DRILL_SERVICE >/dev/null"
    } > "$DRILL_LOG" 2>&1

    while true; do
        now_epoch="$(date -u +%s)"
        drill_health_code="$(curl -ksS -o /dev/null -w '%{http_code}' "$DRILL_HEALTH_URL" 2>/dev/null || true)"
        if [[ "$drill_health_code" == "200" || "$drill_health_code" == "401" || "$drill_health_code" == "403" ]]; then
            drill_recovered=true
            break
        fi
        if (( now_epoch >= drill_deadline )); then
            break
        fi
        sleep 2
    done

    drill_end_epoch="$(date -u +%s)"
    drill_elapsed_sec="$((drill_end_epoch - drill_start_epoch))"
    rto_minutes="$(awk -v s="$drill_elapsed_sec" 'BEGIN {printf "%.3f", s / 60.0}')"

    if [[ "$drill_recovered" != true ]]; then
        echo "[ERROR] Drill health recovery timeout (${DRILL_TIMEOUT_SEC}s)" >> "$DRILL_LOG"
        exit 1
    fi

    {
        echo "Drill recovered at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "Elapsed seconds: $drill_elapsed_sec"
        echo "Health status code at recovery: $drill_health_code"
        echo "Observed RTO minutes: $rto_minutes"
    } >> "$DRILL_LOG"

    # Current deployed slice is stateless (dashboard + proxy), so observed RPO is zero for this drill.
    rpo_hours="0.000"

    now_epoch="$(date -u +%s)"
    printf '%s\t%s\n' "$now_epoch" "$rto_minutes" > "$RTO_FILE"
    printf '%s\t%s\n' "$now_epoch" "$rpo_hours" > "$RPO_FILE"
else
    if [[ ! -f "$RTO_FILE" || ! -f "$RPO_FILE" ]]; then
        echo "[ERROR] --skip-drill set but $RTO_FILE or $RPO_FILE missing"
        exit 1
    fi
fi

"$SCRIPT_DIR/collect-wave2-metrics.sh" \
    --input-dir "$RAW_DIR" \
    --output-dir "$AGG_DIR" \
    --window-hours "$WINDOW_HOURS"

METRICS_SUMMARY_FILE="$AGG_DIR/wave2-metrics-summary.env"

cat > "$CAPTURE_SUMMARY" <<EOF_SUMMARY
WAVE2_CAPTURE_OUTPUT_DIR=$OUTPUT_DIR
WAVE2_CAPTURE_RAW_DIR=$RAW_DIR
WAVE2_CAPTURE_PARSED_EVENTS=$parsed_count
WAVE2_CAPTURE_WINDOW_HOURS=$WINDOW_HOURS
WAVE2_CAPTURE_SSH_HOST=$SSH_HOST
WAVE2_CAPTURE_TRAEFIK_CONTAINER=$TRAEFIK_CONTAINER
WAVE2_CAPTURE_DRILL_RAN=$RUN_DRILL
WAVE2_CAPTURE_DRILL_SERVICE=$DRILL_SERVICE
WAVE2_CAPTURE_DRILL_HEALTH_URL=$DRILL_HEALTH_URL
WAVE2_CAPTURE_DRILL_TIMEOUT_SEC=$DRILL_TIMEOUT_SEC
WAVE2_CAPTURE_METRICS_SUMMARY_FILE=$METRICS_SUMMARY_FILE
WAVE2_CAPTURE_LATENCY_FILE=$LATENCY_FILE
WAVE2_CAPTURE_ERROR_FILE=$ERROR_FILE
WAVE2_CAPTURE_RTO_FILE=$RTO_FILE
WAVE2_CAPTURE_RPO_FILE=$RPO_FILE
EOF_SUMMARY

echo "Wave-2 capture complete"
echo "Capture summary: $CAPTURE_SUMMARY"
echo "Metrics summary: $METRICS_SUMMARY_FILE"
