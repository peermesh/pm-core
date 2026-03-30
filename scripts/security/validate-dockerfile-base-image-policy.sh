#!/usr/bin/env bash
# ==============================================================
# Dockerfile Base Image Policy Validator
# ==============================================================
# Enforces baseline policy for Dockerfile FROM references:
# - fail on floating latest tags
# - fail on missing tag/digest
# - warn on explicit tags without digests (immutability follow-up)
#
# Exit codes:
#   0 = pass (or warnings in non-strict mode)
#   1 = policy failures
#   2 = warnings present in --strict mode
# ==============================================================

set -euo pipefail

STRICT=false
REPORT_FILE=""
MAX_WARNINGS=""
FAILURES=0
WARNINGS=0
PASSES=0

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --strict            Exit non-zero when warnings are present
  --max-warnings N    Fail when warnings exceed N
  --report-file FILE  Output TSV report path
  --help, -h          Show this help message
USAGE
}

log_pass() {
    PASSES=$((PASSES + 1))
    echo "[PASS] $1"
}

log_warn() {
    WARNINGS=$((WARNINGS + 1))
    echo "[WARN] $1"
}

log_fail() {
    FAILURES=$((FAILURES + 1))
    echo "[FAIL] $1"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --strict)
            STRICT=true
            shift
            ;;
        --report-file)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --report-file requires a value"
                exit 1
            fi
            REPORT_FILE="$2"
            shift 2
            ;;
        --max-warnings)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --max-warnings requires a value"
                exit 1
            fi
            if [[ ! "${2}" =~ ^[0-9]+$ ]]; then
                echo "[ERROR] --max-warnings must be an integer: ${2}"
                exit 1
            fi
            MAX_WARNINGS="$2"
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

if [[ -z "$REPORT_FILE" ]]; then
    REPORT_FILE="reports/supply-chain/dockerfile-base-image-policy.tsv"
fi
mkdir -p "$(dirname "$REPORT_FILE")"
echo -e "dockerfile\tline\timage\tstatus\treason" >"$REPORT_FILE"

dockerfiles=()
while IFS= read -r f; do
    dockerfiles+=("$f")
done < <(find . -type f -name "Dockerfile*" -not -path "./.git/*" -not -path "./tests/lib/*" | sort)

if [[ ${#dockerfiles[@]} -eq 0 ]]; then
    log_fail "No Dockerfile files found"
    exit 1
fi

for dockerfile in "${dockerfiles[@]}"; do
    line_no=0
    while IFS= read -r line; do
        line_no=$((line_no + 1))
        # trim leading spaces
        trimmed="${line#"${line%%[![:space:]]*}"}"
        [[ -z "$trimmed" ]] && continue
        [[ "$trimmed" =~ ^# ]] && continue
        if [[ ! "$trimmed" =~ ^FROM[[:space:]]+ ]]; then
            continue
        fi

        from_rest="${trimmed#FROM }"
        if [[ "$from_rest" == --platform=* ]]; then
            from_rest="${from_rest#* }"
        fi
        image_ref="${from_rest%% *}"
        image_ref="${image_ref%%$'\r'}"

        if [[ -z "$image_ref" ]]; then
            log_fail "${dockerfile}:${line_no} empty FROM reference"
            echo -e "${dockerfile}\t${line_no}\t<empty>\tFAIL\tempty-from" >>"$REPORT_FILE"
            continue
        fi

        if [[ "$image_ref" == *'${'* ]]; then
            log_warn "${dockerfile}:${line_no} variable-based FROM reference: $image_ref"
            echo -e "${dockerfile}\t${line_no}\t${image_ref}\tWARN\tvariable-reference" >>"$REPORT_FILE"
            continue
        fi

        if [[ "$image_ref" == *"@sha256:"* ]]; then
            log_pass "${dockerfile}:${line_no} digest-pinned: $image_ref"
            echo -e "${dockerfile}\t${line_no}\t${image_ref}\tPASS\tdigest-pinned" >>"$REPORT_FILE"
            continue
        fi

        image_tail="${image_ref##*/}"
        if [[ "$image_tail" != *:* ]]; then
            log_fail "${dockerfile}:${line_no} missing tag/digest: $image_ref"
            echo -e "${dockerfile}\t${line_no}\t${image_ref}\tFAIL\tmissing-tag-or-digest" >>"$REPORT_FILE"
            continue
        fi

        tag="${image_tail##*:}"
        if [[ "$tag" == "latest" ]]; then
            log_fail "${dockerfile}:${line_no} uses latest tag: $image_ref"
            echo -e "${dockerfile}\t${line_no}\t${image_ref}\tFAIL\tfloating-latest-tag" >>"$REPORT_FILE"
            continue
        fi

        log_warn "${dockerfile}:${line_no} explicit tag without digest: $image_ref"
        echo -e "${dockerfile}\t${line_no}\t${image_ref}\tWARN\texplicit-tag-no-digest" >>"$REPORT_FILE"
    done <"$dockerfile"
done

echo ""
echo "Dockerfile base image policy summary: FAILURES=${FAILURES} WARNINGS=${WARNINGS} PASSES=${PASSES} STRICT=${STRICT}"
echo "Report: $REPORT_FILE"

if [[ -n "$MAX_WARNINGS" && "$WARNINGS" -gt "$MAX_WARNINGS" ]]; then
    echo "[FAIL] Warning budget exceeded: WARNINGS=${WARNINGS} > MAX_WARNINGS=${MAX_WARNINGS}"
    exit 1
fi

if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
fi

if [[ "$STRICT" == true && "$WARNINGS" -gt 0 ]]; then
    exit 2
fi

exit 0
