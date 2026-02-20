#!/usr/bin/env bash
# ==============================================================
# Supply-Chain Baseline Validator
# ==============================================================
# Runs minimum viable supply-chain gates:
# 1) Image policy validation (tag/digest rules)
# 2) SBOM generation for local images
# 3) Vulnerability threshold gate (docker scout)
#
# Exit codes:
#   0 = no critical failures (warnings allowed unless --strict)
#   1 = gate failures detected
#   2 = warnings detected in --strict mode
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

STRICT=false
FAIL_ON_LATEST=false
PULL_MISSING=false
SEVERITY_THRESHOLD="CRITICAL"
OUTPUT_DIR=""
COMPOSE_FILES=("docker-compose.yml")
COMPOSE_FILES_CUSTOM=false
ALLOW_AUTH_DEGRADED="${SUPPLY_CHAIN_ALLOW_AUTH_DEGRADED:-false}"
SCOUT_USERNAME="${DOCKER_SCOUT_USERNAME:-}"
SCOUT_TOKEN="${DOCKER_SCOUT_TOKEN:-}"
SCOUT_TOKEN_FILE="${DOCKER_SCOUT_TOKEN_FILE:-}"
SCOUT_LOGOUT="${DOCKER_SCOUT_LOGOUT:-false}"
SCOUT_AUTHENTICATED=false
SCOUT_AUTH_SOURCE="none"
SCOUT_LOGIN_PERFORMED=false

FAILURES=0
WARNINGS=0
PASSES=0
SCOUT_FAILURES=0
SCOUT_WARNINGS=0
SCOUT_PASSES=0

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --compose-file FILE        Compose file to include (repeatable)
  --output-dir DIR           Output directory for reports
  --severity-threshold LEVEL Vulnerability threshold: LOW|MEDIUM|HIGH|CRITICAL
  --fail-on-latest           Treat latest tag as failure (default: warning)
  --pull-missing             Attempt docker pull for missing local images
  --allow-auth-degraded      Allow unauthenticated scout mode (legacy warning behavior)
  --scout-username USER      Docker Hub username for non-interactive scout login
  --scout-token TOKEN        Docker Hub PAT value for non-interactive scout login
  --scout-token-file FILE    Docker Hub PAT file for non-interactive scout login
  --scout-logout             Logout after scan when non-interactive login is used
  --strict                   Fail if any warnings are present
  --help, -h                 Show help
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

safe_name() {
    printf '%s' "$1" | tr '/:@' '---' | tr -c '[:alnum:]._-' '-'
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

normalize_threshold() {
    local threshold
    threshold="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
    case "$threshold" in
        LOW|MEDIUM|HIGH|CRITICAL)
            echo "$threshold"
            ;;
        *)
            echo ""
            ;;
    esac
}

severity_csv() {
    case "$SEVERITY_THRESHOLD" in
        LOW) echo "low,medium,high,critical" ;;
        MEDIUM) echo "medium,high,critical" ;;
        HIGH) echo "high,critical" ;;
        CRITICAL) echo "critical" ;;
        *) echo "critical" ;;
    esac
}

image_available_locally() {
    docker image inspect "$1" >/dev/null 2>&1
}

ensure_local_image() {
    local image="$1"

    if image_available_locally "$image"; then
        return 0
    fi

    if [[ "$PULL_MISSING" == true ]]; then
        if docker pull "$image" >/dev/null 2>&1 && image_available_locally "$image"; then
            return 0
        fi
    fi

    return 1
}

docker_username() {
    docker info --format '{{.Username}}' 2>/dev/null || true
}

scout_auth_error() {
    local report_file="$1"
    rg -q "Log in with your Docker ID|docker login|Please login|Authentication required" "$report_file"
}

ensure_scout_auth() {
    local existing_user token_value=""

    existing_user="$(docker_username)"
    if [[ -n "$existing_user" ]]; then
        SCOUT_AUTHENTICATED=true
        SCOUT_AUTH_SOURCE="existing-docker-login"
        return 0
    fi

    if [[ -n "$SCOUT_TOKEN_FILE" ]]; then
        if [[ ! -f "$SCOUT_TOKEN_FILE" ]]; then
            echo "[ERROR] --scout-token-file not found: $SCOUT_TOKEN_FILE"
            return 1
        fi
        token_value="$(cat "$SCOUT_TOKEN_FILE")"
    fi

    if [[ -n "$SCOUT_TOKEN" ]]; then
        token_value="$SCOUT_TOKEN"
    fi

    if [[ -n "$SCOUT_USERNAME" && -n "$token_value" ]]; then
        if printf '%s' "$token_value" | docker login --username "$SCOUT_USERNAME" --password-stdin >/dev/null 2>&1; then
            SCOUT_AUTHENTICATED=true
            SCOUT_AUTH_SOURCE="non-interactive-login"
            SCOUT_LOGIN_PERFORMED=true
            return 0
        fi
        echo "[ERROR] docker login failed for --scout-username"
        return 1
    fi

    SCOUT_AUTHENTICATED=false
    SCOUT_AUTH_SOURCE="none"
    return 1
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
        --severity-threshold)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --severity-threshold requires a value"
                exit 1
            fi
            SEVERITY_THRESHOLD="$2"
            shift 2
            ;;
        --fail-on-latest)
            FAIL_ON_LATEST=true
            shift
            ;;
        --pull-missing)
            PULL_MISSING=true
            shift
            ;;
        --allow-auth-degraded)
            ALLOW_AUTH_DEGRADED=true
            shift
            ;;
        --scout-username)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --scout-username requires a value"
                exit 1
            fi
            SCOUT_USERNAME="$2"
            shift 2
            ;;
        --scout-token)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --scout-token requires a value"
                exit 1
            fi
            SCOUT_TOKEN="$2"
            shift 2
            ;;
        --scout-token-file)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --scout-token-file requires a value"
                exit 1
            fi
            SCOUT_TOKEN_FILE="$2"
            shift 2
            ;;
        --scout-logout)
            SCOUT_LOGOUT=true
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

SEVERITY_THRESHOLD="$(normalize_threshold "$SEVERITY_THRESHOLD")"
if [[ -z "$SEVERITY_THRESHOLD" ]]; then
    echo "[ERROR] Invalid --severity-threshold (use LOW|MEDIUM|HIGH|CRITICAL)"
    exit 1
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$PROJECT_DIR/reports/supply-chain/$(date -u +%Y-%m-%d-%H%M%S)"
fi

mkdir -p "$OUTPUT_DIR"
images_file="$OUTPUT_DIR/images.list"
vuln_report="$OUTPUT_DIR/vulnerability-gate.tsv"
summary_file="$OUTPUT_DIR/supply-chain-summary.env"

for compose_file in "${COMPOSE_FILES[@]}"; do
    if [[ ! -f "$PROJECT_DIR/$compose_file" && ! -f "$compose_file" ]]; then
        log_fail "Compose file missing: $compose_file"
    fi
done

if [[ "$FAILURES" -gt 0 ]]; then
    echo "Supply-chain summary: FAILURES=${FAILURES} WARNINGS=${WARNINGS} PASSES=${PASSES}"
    exit 1
fi

compose_images >"$images_file"
image_count="$(wc -l <"$images_file" | tr -d ' ')"
if [[ "$image_count" -eq 0 ]]; then
    log_fail "No images resolved from compose configuration"
fi

policy_args=(
    --report-file "$OUTPUT_DIR/image-policy.tsv"
    --summary-file "$OUTPUT_DIR/image-policy-summary.env"
)

for compose_file in "${COMPOSE_FILES[@]}"; do
    policy_args+=(--compose-file "$compose_file")
done

if [[ "$FAIL_ON_LATEST" == true ]]; then
    policy_args+=(--fail-on-latest)
fi

if [[ "$STRICT" == true ]]; then
    policy_args+=(--strict)
fi

set +e
"$SCRIPT_DIR/validate-image-policy.sh" "${policy_args[@]}"
policy_rc=$?
set -e

if [[ "$policy_rc" -eq 0 ]]; then
    log_pass "Image policy gate passed"
elif [[ "$policy_rc" -eq 2 ]]; then
    log_warn "Image policy produced warnings in strict mode"
else
    log_fail "Image policy gate failed"
fi

sbom_args=(
    --output-dir "$OUTPUT_DIR/sbom"
    --summary-file "$OUTPUT_DIR/sbom-summary.env"
)

for compose_file in "${COMPOSE_FILES[@]}"; do
    sbom_args+=(--compose-file "$compose_file")
done

if [[ "$PULL_MISSING" == true ]]; then
    sbom_args+=(--pull-missing)
fi

if [[ "$STRICT" == true ]]; then
    sbom_args+=(--strict)
fi

set +e
"$SCRIPT_DIR/generate-sbom.sh" "${sbom_args[@]}"
sbom_rc=$?
set -e

if [[ "$sbom_rc" -eq 0 ]]; then
    log_pass "SBOM generation stage completed"
elif [[ "$sbom_rc" -eq 2 ]]; then
    log_warn "SBOM generation produced warnings in strict mode"
else
    log_fail "SBOM generation stage failed"
fi

{
    echo -e "image\tstatus\tseverity_threshold\tnotes\treport"
} >"$vuln_report"

if ! command -v docker >/dev/null 2>&1; then
    log_warn "Docker CLI unavailable; vulnerability gate skipped"
elif ! docker scout --help >/dev/null 2>&1; then
    log_warn "docker scout unavailable; vulnerability gate skipped"
else
    severity_filter="$(severity_csv)"
    if ensure_scout_auth; then
        log_pass "Docker Scout authentication is ready (${SCOUT_AUTH_SOURCE})"
    else
        if [[ "$ALLOW_AUTH_DEGRADED" == true ]]; then
            log_warn "Docker Scout authentication missing; continuing in degraded mode by request"
        else
            log_fail "Docker Scout authentication required. Run docker login or pass --scout-username with --scout-token-file/--scout-token."
            while IFS= read -r image; do
                [[ -z "$image" ]] && continue
                report_file="$OUTPUT_DIR/vuln-$(safe_name "$image").log"
                printf 'docker scout authentication required for image: %s\n' "$image" > "$report_file"
                SCOUT_FAILURES=$((SCOUT_FAILURES + 1))
                echo -e "${image}\tFAIL\t${SEVERITY_THRESHOLD}\tscout-auth-required\t${report_file}" >>"$vuln_report"
            done <"$images_file"
        fi
    fi

    if [[ "$ALLOW_AUTH_DEGRADED" == true || "$SCOUT_AUTHENTICATED" == true ]]; then
        while IFS= read -r image; do
            [[ -z "$image" ]] && continue

            if ! ensure_local_image "$image"; then
                SCOUT_WARNINGS=$((SCOUT_WARNINGS + 1))
                echo -e "${image}\tSKIPPED\t${SEVERITY_THRESHOLD}\timage-not-local\t" >>"$vuln_report"
                continue
            fi

            report_file="$OUTPUT_DIR/vuln-$(safe_name "$image").log"

            set +e
            docker scout cves --only-severity "$severity_filter" --exit-code "local://${image}" >"$report_file" 2>&1
            scout_rc=$?
            set -e

            if [[ "$scout_rc" -eq 0 ]]; then
                SCOUT_PASSES=$((SCOUT_PASSES + 1))
                echo -e "${image}\tPASS\t${SEVERITY_THRESHOLD}\tno-threshold-vulns\t${report_file}" >>"$vuln_report"
            elif [[ "$scout_rc" -eq 2 ]]; then
                SCOUT_FAILURES=$((SCOUT_FAILURES + 1))
                echo -e "${image}\tFAIL\t${SEVERITY_THRESHOLD}\tthreshold-vulnerabilities-detected\t${report_file}" >>"$vuln_report"
            elif scout_auth_error "$report_file"; then
                if [[ "$ALLOW_AUTH_DEGRADED" == true ]]; then
                    SCOUT_WARNINGS=$((SCOUT_WARNINGS + 1))
                    echo -e "${image}\tWARN\t${SEVERITY_THRESHOLD}\tscout-auth-required\t${report_file}" >>"$vuln_report"
                else
                    SCOUT_FAILURES=$((SCOUT_FAILURES + 1))
                    echo -e "${image}\tFAIL\t${SEVERITY_THRESHOLD}\tscout-auth-required\t${report_file}" >>"$vuln_report"
                fi
            else
                SCOUT_WARNINGS=$((SCOUT_WARNINGS + 1))
                echo -e "${image}\tWARN\t${SEVERITY_THRESHOLD}\tscout-scan-error\t${report_file}" >>"$vuln_report"
            fi
        done <"$images_file"
    fi

    if [[ "$SCOUT_FAILURES" -gt 0 ]]; then
        log_fail "Vulnerability threshold gate failed for ${SCOUT_FAILURES} image(s)"
    else
        log_pass "Vulnerability threshold gate passed (threshold=${SEVERITY_THRESHOLD})"
    fi

    if [[ "$SCOUT_WARNINGS" -gt 0 ]]; then
        log_warn "Vulnerability gate warnings: ${SCOUT_WARNINGS} image(s) skipped or scan errors"
    fi
fi

if [[ "$SCOUT_LOGOUT" == true && "$SCOUT_LOGIN_PERFORMED" == true ]]; then
    docker logout >/dev/null 2>&1 || true
fi

cat >"$summary_file" <<SUMMARY
SUPPLY_CHAIN_OUTPUT_DIR=$OUTPUT_DIR
SUPPLY_CHAIN_IMAGES_FILE=$images_file
SUPPLY_CHAIN_IMAGE_COUNT=$image_count
SUPPLY_CHAIN_SEVERITY_THRESHOLD=$SEVERITY_THRESHOLD
SUPPLY_CHAIN_STRICT=$STRICT
SUPPLY_CHAIN_FAIL_ON_LATEST=$FAIL_ON_LATEST
SUPPLY_CHAIN_PULL_MISSING=$PULL_MISSING
SUPPLY_CHAIN_ALLOW_AUTH_DEGRADED=$ALLOW_AUTH_DEGRADED
SUPPLY_CHAIN_SCOUT_AUTHENTICATED=$SCOUT_AUTHENTICATED
SUPPLY_CHAIN_SCOUT_AUTH_SOURCE=$SCOUT_AUTH_SOURCE
SUPPLY_CHAIN_FAILURES=$FAILURES
SUPPLY_CHAIN_WARNINGS=$WARNINGS
SUPPLY_CHAIN_PASSES=$PASSES
SUPPLY_CHAIN_SCOUT_FAILURES=$SCOUT_FAILURES
SUPPLY_CHAIN_SCOUT_WARNINGS=$SCOUT_WARNINGS
SUPPLY_CHAIN_SCOUT_PASSES=$SCOUT_PASSES
SUPPLY_CHAIN_IMAGE_POLICY_REPORT=$OUTPUT_DIR/image-policy.tsv
SUPPLY_CHAIN_VULN_REPORT=$vuln_report
SUPPLY_CHAIN_SBOM_INDEX=$OUTPUT_DIR/sbom/SBOM-INDEX.tsv
SUMMARY

echo ""
echo "Supply-chain summary: FAILURES=${FAILURES} WARNINGS=${WARNINGS} PASSES=${PASSES}"
echo "Vulnerability gate: FAILURES=${SCOUT_FAILURES} WARNINGS=${SCOUT_WARNINGS} PASSES=${SCOUT_PASSES}"
echo "Summary file: $summary_file"

if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
fi

if [[ "$STRICT" == true && "$WARNINGS" -gt 0 ]]; then
    exit 2
fi

exit 0
