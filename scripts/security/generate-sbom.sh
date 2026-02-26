#!/usr/bin/env bash
# ==============================================================
# SBOM Generator
# ==============================================================
# Generates CycloneDX SBOM artifacts for compose-resolved images.
# Generator preference order:
#   1) syft
#   2) docker sbom
#
# Exit codes:
#   0 = generation completed (warnings allowed unless --strict)
#   1 = hard generation failures
#   2 = warnings detected in --strict mode
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

STRICT=false
PULL_MISSING=false
OUTPUT_DIR=""
SUMMARY_FILE=""
COMPOSE_FILES=("docker-compose.yml")
COMPOSE_FILES_CUSTOM=false

FAILURES=0
WARNINGS=0
GENERATED=0
SKIPPED=0
SBOM_TOOL=""

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --compose-file FILE     Compose file to include (repeatable)
  --output-dir DIR        Output directory for SBOM files
  --summary-file FILE     Output summary env path
  --pull-missing          Attempt docker pull for missing local images
  --strict                Fail if any warnings are present
  --help, -h              Show help
USAGE
}

log_pass() {
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

safe_name() {
    printf '%s' "$1" | tr '/:@' '---' | tr -c '[:alnum:]._-' '-'
}

safe_mkdir_parent() {
    local target="$1"
    local parent
    parent="$(dirname "$target")"
    mkdir -p "$parent"
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

choose_sbom_tool() {
    if command -v syft >/dev/null 2>&1; then
        SBOM_TOOL="syft"
        return 0
    fi

    if docker sbom --help >/dev/null 2>&1; then
        SBOM_TOOL="docker-sbom"
        return 0
    fi

    SBOM_TOOL=""
    return 1
}

image_available_locally() {
    docker image inspect "$1" >/dev/null 2>&1
}

generate_with_tool() {
    local image="$1"
    local artifact="$2"

    if [[ "$SBOM_TOOL" == "syft" ]]; then
        syft "$image" -q -o cyclonedx-json >"$artifact"
    else
        docker sbom --format cyclonedx-json "$image" >"$artifact"
    fi
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
        --output-dir)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --output-dir requires a value"
                exit 1
            fi
            OUTPUT_DIR="$2"
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
        --pull-missing)
            PULL_MISSING=true
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

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$PROJECT_DIR/reports/supply-chain/sbom"
fi

mkdir -p "$OUTPUT_DIR"
index_file="$OUTPUT_DIR/SBOM-INDEX.tsv"
{
    echo -e "image\tstatus\ttool\tartifact\tnotes"
} >"$index_file"

# Validate compose file existence early.
for compose_file in "${COMPOSE_FILES[@]}"; do
    if [[ ! -f "$PROJECT_DIR/$compose_file" && ! -f "$compose_file" ]]; then
        log_fail "Compose file missing: $compose_file"
    fi
done

if [[ "$FAILURES" -gt 0 ]]; then
    echo "SBOM summary: FAILURES=${FAILURES} WARNINGS=${WARNINGS} GENERATED=${GENERATED} SKIPPED=${SKIPPED}"
    exit 1
fi

if ! choose_sbom_tool; then
    log_warn "No SBOM generator available (syft or docker sbom); skipping SBOM generation"
fi

image_count=0
while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    image_count=$((image_count + 1))

    local_available=false
    if image_available_locally "$image"; then
        local_available=true
    elif [[ "$PULL_MISSING" == true ]]; then
        if docker pull "$image" >/dev/null 2>&1 && image_available_locally "$image"; then
            local_available=true
            log_pass "Pulled missing image for SBOM: $image"
        else
            log_warn "Unable to pull missing image for SBOM: $image"
        fi
    fi

    if [[ "$local_available" != true ]]; then
        SKIPPED=$((SKIPPED + 1))
        echo -e "${image}\tSKIPPED\t${SBOM_TOOL:-none}\t\timage-not-local" >>"$index_file"
        continue
    fi

    if [[ -z "$SBOM_TOOL" ]]; then
        SKIPPED=$((SKIPPED + 1))
        echo -e "${image}\tSKIPPED\tnone\t\tsbom-tool-unavailable" >>"$index_file"
        continue
    fi

    artifact="$OUTPUT_DIR/$(safe_name "$image").cyclonedx.json"
    if generate_with_tool "$image" "$artifact" >/dev/null 2>&1; then
        GENERATED=$((GENERATED + 1))
        log_pass "Generated SBOM for $image"
        echo -e "${image}\tGENERATED\t${SBOM_TOOL}\t${artifact}\t" >>"$index_file"
    else
        if [[ "$STRICT" == true ]]; then
            log_fail "SBOM generation failed for $image"
            echo -e "${image}\tFAILED\t${SBOM_TOOL}\t${artifact}\tgeneration-error" >>"$index_file"
        else
            WARNINGS=$((WARNINGS + 1))
            SKIPPED=$((SKIPPED + 1))
            echo "[WARN] SBOM generation failed for $image"
            echo -e "${image}\tSKIPPED\t${SBOM_TOOL}\t${artifact}\tgeneration-error" >>"$index_file"
        fi
    fi
done < <(compose_images)

if [[ "$image_count" -eq 0 ]]; then
    log_fail "No images resolved from compose configuration"
fi

echo ""
echo "SBOM summary: FAILURES=${FAILURES} WARNINGS=${WARNINGS} GENERATED=${GENERATED} SKIPPED=${SKIPPED}"
echo "SBOM index: $index_file"

if [[ -n "$SUMMARY_FILE" ]]; then
    safe_mkdir_parent "$SUMMARY_FILE"
    cat >"$SUMMARY_FILE" <<SUMMARY
SBOM_OUTPUT_DIR=$OUTPUT_DIR
SBOM_INDEX_FILE=$index_file
SBOM_TOOL=${SBOM_TOOL:-none}
SBOM_FAILURES=$FAILURES
SBOM_WARNINGS=$WARNINGS
SBOM_GENERATED=$GENERATED
SBOM_SKIPPED=$SKIPPED
SBOM_STRICT=$STRICT
SBOM_PULL_MISSING=$PULL_MISSING
SUMMARY
fi

if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
fi

if [[ "$STRICT" == true && "$WARNINGS" -gt 0 ]]; then
    exit 2
fi

exit 0
