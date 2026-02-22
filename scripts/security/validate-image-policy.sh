#!/usr/bin/env bash
# ==============================================================
# Image Policy Validator
# ==============================================================
# Enforces minimum image policy for compose-resolved image references:
# - image must include a tag or digest
# - latest tags are failures by default (can be relaxed with --allow-latest)
# - external images require immutable digests by default
#
# Exit codes:
#   0 = policy passed
#   1 = policy failures detected
#   2 = warnings detected in --strict mode
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

STRICT=false
FAIL_ON_LATEST=true
REQUIRE_EXTERNAL_DIGEST=true
REPORT_FILE=""
SUMMARY_FILE=""
COMPOSE_FILES=("docker-compose.yml")
COMPOSE_FILES_CUSTOM=false

FAILURES=0
WARNINGS=0
PASSES=0

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --compose-file FILE     Compose file to include (repeatable)
  --report-file FILE      Output TSV report path
  --summary-file FILE     Output summary env path
  --fail-on-latest        Treat latest tag as failure (default behavior)
  --allow-latest          Treat latest tag as warning (legacy compatibility)
  --allow-external-tags   Allow explicit external tags without digest (legacy compatibility)
  --strict                Fail if any warnings are present
  --help, -h              Show help
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

safe_mkdir_parent() {
    local target="$1"
    local parent
    parent="$(dirname "$target")"
    mkdir -p "$parent"
}

is_local_project_image() {
    local image="$1"
    local project_name="${COMPOSE_PROJECT_NAME:-pmdl}"

    if [[ "$image" == "${project_name}/"* ]]; then
        return 0
    fi
    if [[ "$image" == "${project_name}-"* ]]; then
        return 0
    fi
    if [[ "$image" == "pmdl/"* ]]; then
        return 0
    fi
    if [[ "$image" == "pmdl-"* ]]; then
        return 0
    fi
    return 1
}

compose_images() {
    local compose_args=()
    local file
    for file in "${COMPOSE_FILES[@]}"; do
        compose_args+=("-f" "$file")
    done

    if docker compose "${compose_args[@]}" config --images >/dev/null 2>&1; then
        docker compose "${compose_args[@]}" config --images | sed '/^[[:space:]]*$/d' | sort -u
        return 0
    fi

    docker compose "${compose_args[@]}" config \
        | awk '/^[[:space:]]*image:[[:space:]]*/ {print $2}' \
        | sed '/^[[:space:]]*$/d' \
        | sort -u
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --compose-file)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --compose-file requires a value"
                exit 1
            fi
            if [[ "$COMPOSE_FILES_CUSTOM" == false ]]; then
                COMPOSE_FILES=()
                COMPOSE_FILES_CUSTOM=true
            fi
            COMPOSE_FILES+=("$2")
            shift 2
            ;;
        --report-file)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --report-file requires a value"
                exit 1
            fi
            REPORT_FILE="$2"
            shift 2
            ;;
        --summary-file)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --summary-file requires a value"
                exit 1
            fi
            SUMMARY_FILE="$2"
            shift 2
            ;;
        --fail-on-latest)
            FAIL_ON_LATEST=true
            shift
            ;;
        --allow-latest)
            FAIL_ON_LATEST=false
            shift
            ;;
        --allow-external-tags)
            REQUIRE_EXTERNAL_DIGEST=false
            shift
            ;;
        --strict)
            STRICT=true
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

if [[ -z "$REPORT_FILE" ]]; then
    REPORT_FILE="$PROJECT_DIR/reports/supply-chain/image-policy.tsv"
fi

safe_mkdir_parent "$REPORT_FILE"
{
    echo -e "image\tstatus\treason"
} >"$REPORT_FILE"

# Validate compose file existence early for clearer errors.
for compose_file in "${COMPOSE_FILES[@]}"; do
    if [[ ! -f "$PROJECT_DIR/$compose_file" && ! -f "$compose_file" ]]; then
        log_fail "Compose file missing: $compose_file"
    fi
done

if [[ "$FAILURES" -gt 0 ]]; then
    echo "Image policy summary: FAILURES=${FAILURES} WARNINGS=${WARNINGS} PASSES=${PASSES}"
    exit 1
fi

image_count=0
while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    image_count=$((image_count + 1))

    status="PASS"
    reason=""

    if [[ "$image" == *"@sha256:"* ]]; then
        reason="digest-pinned"
        log_pass "$image uses immutable digest"
    else
        image_tail="${image##*/}"
        if [[ "$image_tail" != *":"* ]]; then
            status="FAIL"
            reason="missing-tag-or-digest"
            log_fail "$image has no explicit tag or digest"
        else
            tag="${image_tail##*:}"
            if [[ -z "$tag" ]]; then
                status="FAIL"
                reason="empty-tag"
                log_fail "$image has an empty tag"
            elif [[ "$tag" == "latest" ]]; then
                if [[ "$FAIL_ON_LATEST" == true ]]; then
                    status="FAIL"
                    reason="floating-latest-tag"
                    log_fail "$image uses latest tag (forbidden by policy)"
                else
                    status="WARN"
                    reason="floating-latest-tag"
                    log_warn "$image uses latest tag"
                fi
            else
                if [[ "$REQUIRE_EXTERNAL_DIGEST" == true ]] && ! is_local_project_image "$image"; then
                    status="FAIL"
                    reason="external-tag-without-digest"
                    log_fail "$image uses tag '$tag' without immutable digest"
                else
                    reason="explicit-tag"
                    log_pass "$image uses explicit tag: $tag"
                fi
            fi
        fi
    fi

    echo -e "${image}\t${status}\t${reason}" >>"$REPORT_FILE"
done < <(compose_images)

if [[ "$image_count" -eq 0 ]]; then
    log_fail "No images resolved from compose configuration"
fi

echo ""
echo "Image policy summary: FAILURES=${FAILURES} WARNINGS=${WARNINGS} PASSES=${PASSES}"
echo "Image policy report: $REPORT_FILE"

if [[ -n "$SUMMARY_FILE" ]]; then
    safe_mkdir_parent "$SUMMARY_FILE"
    cat >"$SUMMARY_FILE" <<SUMMARY
IMAGE_POLICY_REPORT=$REPORT_FILE
IMAGE_POLICY_FAILURES=$FAILURES
IMAGE_POLICY_WARNINGS=$WARNINGS
IMAGE_POLICY_PASSES=$PASSES
IMAGE_POLICY_FAIL_ON_LATEST=$FAIL_ON_LATEST
IMAGE_POLICY_REQUIRE_EXTERNAL_DIGEST=$REQUIRE_EXTERNAL_DIGEST
IMAGE_POLICY_STRICT=$STRICT
SUMMARY
fi

if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
fi

if [[ "$STRICT" == true && "$WARNINGS" -gt 0 ]]; then
    exit 2
fi

exit 0
