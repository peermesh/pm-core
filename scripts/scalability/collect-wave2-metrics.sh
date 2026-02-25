#!/usr/bin/env bash
# ==============================================================
# Wave-2 Metrics Collector (24h Aggregation)
# ==============================================================
# Aggregates canonical raw metric streams into queryable 24h
# signals and writes a summary env file for validator ingestion.
#
# Canonical raw input files (TSV):
#   latency-ms.tsv      <epoch_seconds>\t<latency_ms>
#   error-rate-pct.tsv  <epoch_seconds>\t<error_rate_pct>
#   rto-min.tsv         <epoch_seconds>\t<rto_minutes>
#   rpo-hours.tsv       <epoch_seconds>\t<rpo_hours>
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

INPUT_DIR=""
OUTPUT_DIR=""
WINDOW_HOURS=24
NOW_EPOCH=""

LATENCY_P95=""
LATENCY_P99=""
LATENCY_COUNT=0
ERROR_P95=""
ERROR_COUNT=0
RTO_VALUE=""
RTO_COUNT=0
RPO_VALUE=""
RPO_COUNT=0

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --input-dir DIR      Raw metric input directory (required)
  --output-dir DIR     Output directory (default: reports/scalability/metrics-wave2/<timestamp>)
  --window-hours N     Time window in hours (default: 24)
  --now-epoch SEC      Override current epoch for deterministic runs
  --help, -h           Show help
USAGE
}

is_number() {
    [[ "$1" =~ ^-?[0-9]+([.][0-9]+)?$ ]]
}

quantile_index() {
    local count="$1"
    local q="$2"
    awk -v c="$count" -v q="$q" 'BEGIN {
        i = int((c * q) + 0.999999)
        if (i < 1) i = 1
        if (i > c) i = c
        print i
    }'
}

filter_window() {
    local input_file="$1"
    local output_file="$2"

    awk -v s="$START_EPOCH" -v e="$NOW_EPOCH" '
        ($1 ~ /^[0-9]+$/) && ($2 ~ /^-?[0-9]+(\.[0-9]+)?$/) && ($1 >= s) && ($1 <= e) {
            print $1 "\t" $2
        }
    ' "$input_file" > "$output_file"
}

append_stats() {
    local metric_name="$1"
    local filtered_file="$2"

    local values_file="$TMP_DIR/${metric_name}.values"
    awk '{print $2}' "$filtered_file" | sort -n > "$values_file"

    local count
    count="$(wc -l < "$values_file" | tr -d ' ')"
    if [[ "$count" -eq 0 ]]; then
        echo "[ERROR] No samples in window for metric: $metric_name"
        return 1
    fi

    local min p50 p95 p99 max
    local i50 i95 i99

    min="$(sed -n '1p' "$values_file")"
    max="$(sed -n "${count}p" "$values_file")"

    i50="$(quantile_index "$count" 0.50)"
    i95="$(quantile_index "$count" 0.95)"
    i99="$(quantile_index "$count" 0.99)"

    p50="$(sed -n "${i50}p" "$values_file")"
    p95="$(sed -n "${i95}p" "$values_file")"
    p99="$(sed -n "${i99}p" "$values_file")"

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$metric_name" "$count" "$min" "$p50" "$p95" "$p99" "$max" >> "$QUERY_FILE"

    case "$metric_name" in
        latency_ms)
            LATENCY_COUNT="$count"
            LATENCY_P95="$p95"
            LATENCY_P99="$p99"
            ;;
        error_rate_pct)
            ERROR_COUNT="$count"
            ERROR_P95="$p95"
            ;;
        rto_min)
            RTO_COUNT="$count"
            RTO_VALUE="$max"
            ;;
        rpo_hours)
            RPO_COUNT="$count"
            RPO_VALUE="$max"
            ;;
    esac
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input-dir)
            INPUT_DIR="${2:-}"
            [[ -n "$INPUT_DIR" ]] || { echo "[ERROR] --input-dir requires a value"; exit 1; }
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="${2:-}"
            [[ -n "$OUTPUT_DIR" ]] || { echo "[ERROR] --output-dir requires a value"; exit 1; }
            shift 2
            ;;
        --window-hours)
            WINDOW_HOURS="${2:-}"
            [[ -n "$WINDOW_HOURS" ]] || { echo "[ERROR] --window-hours requires a value"; exit 1; }
            if ! [[ "$WINDOW_HOURS" =~ ^[0-9]+$ ]]; then
                echo "[ERROR] --window-hours must be an integer"
                exit 1
            fi
            shift 2
            ;;
        --now-epoch)
            NOW_EPOCH="${2:-}"
            [[ -n "$NOW_EPOCH" ]] || { echo "[ERROR] --now-epoch requires a value"; exit 1; }
            if ! [[ "$NOW_EPOCH" =~ ^[0-9]+$ ]]; then
                echo "[ERROR] --now-epoch must be epoch seconds"
                exit 1
            fi
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

if [[ -z "$INPUT_DIR" ]]; then
    echo "[ERROR] --input-dir is required"
    exit 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
    echo "[ERROR] Input directory does not exist: $INPUT_DIR"
    exit 1
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$PROJECT_DIR/reports/scalability/metrics-wave2/$(date -u +%Y-%m-%d-%H%M%S)"
fi

if [[ -z "$NOW_EPOCH" ]]; then
    NOW_EPOCH="$(date -u +%s)"
fi

START_EPOCH="$((NOW_EPOCH - (WINDOW_HOURS * 3600)))"

mkdir -p "$OUTPUT_DIR"
RAW_24H_DIR="$OUTPUT_DIR/raw-24h"
mkdir -p "$RAW_24H_DIR"

QUERY_FILE="$OUTPUT_DIR/metrics-query.tsv"
SUMMARY_FILE="$OUTPUT_DIR/wave2-metrics-summary.env"
WINDOW_FILE="$OUTPUT_DIR/window.env"

TMP_DIR="$(mktemp -d)"
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

LATENCY_INPUT="$INPUT_DIR/latency-ms.tsv"
ERROR_INPUT="$INPUT_DIR/error-rate-pct.tsv"
RTO_INPUT="$INPUT_DIR/rto-min.tsv"
RPO_INPUT="$INPUT_DIR/rpo-hours.tsv"

for required in "$LATENCY_INPUT" "$ERROR_INPUT" "$RTO_INPUT" "$RPO_INPUT"; do
    if [[ ! -f "$required" ]]; then
        echo "[ERROR] Missing required raw metric file: $required"
        exit 1
    fi
done

LATENCY_24H="$RAW_24H_DIR/latency-ms.tsv"
ERROR_24H="$RAW_24H_DIR/error-rate-pct.tsv"
RTO_24H="$RAW_24H_DIR/rto-min.tsv"
RPO_24H="$RAW_24H_DIR/rpo-hours.tsv"

filter_window "$LATENCY_INPUT" "$LATENCY_24H"
filter_window "$ERROR_INPUT" "$ERROR_24H"
filter_window "$RTO_INPUT" "$RTO_24H"
filter_window "$RPO_INPUT" "$RPO_24H"

printf 'metric\tcount\tmin\tp50\tp95\tp99\tmax\n' > "$QUERY_FILE"
append_stats "latency_ms" "$LATENCY_24H"
append_stats "error_rate_pct" "$ERROR_24H"
append_stats "rto_min" "$RTO_24H"
append_stats "rpo_hours" "$RPO_24H"

cat > "$WINDOW_FILE" <<EOF_WINDOW
WAVE2_WINDOW_HOURS=$WINDOW_HOURS
WAVE2_WINDOW_START_EPOCH=$START_EPOCH
WAVE2_WINDOW_END_EPOCH=$NOW_EPOCH
EOF_WINDOW

cat > "$SUMMARY_FILE" <<EOF_SUMMARY
WAVE2_METRICS_OUTPUT_DIR=$OUTPUT_DIR
WAVE2_WINDOW_HOURS=$WINDOW_HOURS
WAVE2_WINDOW_START_EPOCH=$START_EPOCH
WAVE2_WINDOW_END_EPOCH=$NOW_EPOCH
WAVE2_QUERY_FILE=$QUERY_FILE
WAVE2_RAW_24H_DIR=$RAW_24H_DIR
WAVE2_LATENCY_COUNT=$LATENCY_COUNT
WAVE2_LATENCY_P95_MS=$LATENCY_P95
WAVE2_LATENCY_P99_MS=$LATENCY_P99
WAVE2_ERROR_RATE_COUNT=$ERROR_COUNT
WAVE2_ERROR_RATE_P95_PCT=$ERROR_P95
WAVE2_RTO_COUNT=$RTO_COUNT
WAVE2_RTO_MIN=$RTO_VALUE
WAVE2_RPO_COUNT=$RPO_COUNT
WAVE2_RPO_HOURS=$RPO_VALUE
EOF_SUMMARY

echo "Wave-2 metrics collection complete"
echo "Summary file: $SUMMARY_FILE"
echo "Query file:   $QUERY_FILE"
