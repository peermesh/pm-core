#!/usr/bin/env bash
# ==============================================================================
# Deployment Helper Script (Canonical Entrypoint)
# ==============================================================================
# Canonical deployment path for operator and webhook usage.
# Implements promotion gates (dev -> staging -> production), preflight checks,
# rollback pointer capture, and release evidence generation.
#
# Usage examples:
#   ./scripts/deploy.sh
#   ./scripts/deploy.sh --validate
#   ./scripts/deploy.sh --environment staging --promotion-from dev
#   ./scripts/deploy.sh --environment production --promotion-from staging -f docker-compose.dc.yml
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

timestamp_utc() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
timestamp_compact() { date -u +"%Y%m%dT%H%M%SZ"; }

VALIDATE_ONLY=false
SHOW_PROFILES_ONLY=false
PROFILES_OVERRIDE=""
WAIT_SECONDS=180
DEPLOY_ENVIRONMENT="dev"
PROMOTION_FROM=""
PROMOTION_ID=""
ALLOW_PROMOTION_BYPASS=false
DEPLOY_MODE="operator"
EVIDENCE_ROOT="${DEPLOY_EVIDENCE_ROOT:-/tmp/pmdl-deploy-evidence}"
EVIDENCE_TAG=""
AUTO_ROLLBACK=false
SKIP_PULL=false
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/pmdl-deploy.lock}"
RESTART_SAFETY_POLICY_FILE="${RESTART_SAFETY_POLICY_FILE:-$PROJECT_DIR/configs/deploy/restart-safety.env}"
RESTART_SAFETY_CRITICAL_SERVICES="${RESTART_SAFETY_CRITICAL_SERVICES:-traefik socket-proxy}"
RESTART_SAFETY_STATEFUL_SERVICES="${RESTART_SAFETY_STATEFUL_SERVICES:-postgres mysql mongodb redis minio}"
COMPOSE_ARGS=()
ORIGINAL_ARGS=("$@")

LOCK_ACQUIRED=false
EVIDENCE_DIR=""
EVIDENCE_MANIFEST=""
GATES_FILE=""
ROLLBACK_POINTER_FILE=""
PRE_DEPLOY_GIT_SHA=""
POST_DEPLOY_GIT_SHA=""
PROMOTION_GATE_STATUS="PENDING"
APPLY_GATE_STATUS="PENDING"
CONFIDENCE_GATE_STATUS="PENDING"
SUPPLY_CHAIN_GATE_STATUS="PENDING"

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --validate, -v                 Validate configuration, promotion policy, and secrets only
  --profiles, -p                 Show active profiles and exit
  --set-profiles LIST            Override COMPOSE_PROFILES for this run
  --environment ENV              Deployment environment: dev|staging|production (default: dev)
  --promotion-from ENV           Source environment for promotion checks
  --promotion-id ID              Change ticket / promotion reference (required by policy for non-dev; auto-generated if omitted)
  --allow-promotion-bypass       Bypass strict environment progression checks (audited in evidence bundle)
  --deploy-mode MODE             Deployment mode label: operator|webhook|manual (default: operator)
  --evidence-root DIR            Evidence bundle root directory (default: /tmp/pmdl-deploy-evidence)
  --evidence-tag TAG             Extra tag appended to evidence folder name
  --auto-rollback                Attempt automatic rollback on apply/smoke failure (webhook mode only)
  --skip-pull                    Skip docker compose pull
  --restart-safety-policy FILE   Override restart safety policy file path
  -f FILE                        Include additional compose file (repeatable)
  --wait-seconds N               Health wait timeout (default: 180)
  --help, -h                     Show this help
USAGE
}

slugify() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9._-' '-'
}

compose_args_string() {
    local rendered=""
    local arg
    for arg in "${COMPOSE_ARGS[@]}"; do
        rendered+="${arg} "
    done
    echo "${rendered% }"
}

append_manifest() {
    local key="$1"
    local value="$2"
    if [[ -n "$EVIDENCE_MANIFEST" ]]; then
        printf '%s=%q\n' "$key" "$value" >>"$EVIDENCE_MANIFEST"
    fi
}

record_gate() {
    local gate="$1"
    local status="$2"
    local detail="$3"
    if [[ -n "$GATES_FILE" ]]; then
        printf '%s\t%s\t%s\t%s\n' "$(timestamp_utc)" "$gate" "$status" "$detail" >>"$GATES_FILE"
    fi
}

run_and_capture() {
    local label="$1"
    shift
    local output_file="$EVIDENCE_DIR/${label}.log"
    local label_key
    label_key="$(echo "$label" | tr '[:lower:]-' '[:upper:]_')"

    {
        echo "# timestamp: $(timestamp_utc)"
        echo "# command: $*"
        echo ""
    } >"$output_file"

    set +e
    "$@" >>"$output_file" 2>&1
    local rc=$?
    set -e

    append_manifest "CMD_${label_key}_EXIT_CODE" "$rc"
    return $rc
}

cleanup() {
    if [[ "$LOCK_ACQUIRED" == true && -e "$LOCK_FILE" ]] && command -v flock >/dev/null 2>&1; then
        flock -u 200 || true
    fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
    case "$1" in
        --validate|-v)
            VALIDATE_ONLY=true
            shift
            ;;
        --profiles|-p)
            SHOW_PROFILES_ONLY=true
            shift
            ;;
        --set-profiles)
            PROFILES_OVERRIDE="${2:-}"
            if [[ -z "$PROFILES_OVERRIDE" ]]; then
                log_error "--set-profiles requires a value"
                exit 1
            fi
            shift 2
            ;;
        --environment)
            DEPLOY_ENVIRONMENT="${2:-}"
            if [[ -z "$DEPLOY_ENVIRONMENT" ]]; then
                log_error "--environment requires a value"
                exit 1
            fi
            shift 2
            ;;
        --promotion-from)
            PROMOTION_FROM="${2:-}"
            if [[ -z "$PROMOTION_FROM" ]]; then
                log_error "--promotion-from requires a value"
                exit 1
            fi
            shift 2
            ;;
        --promotion-id)
            PROMOTION_ID="${2:-}"
            if [[ -z "$PROMOTION_ID" ]]; then
                log_error "--promotion-id requires a value"
                exit 1
            fi
            shift 2
            ;;
        --allow-promotion-bypass)
            ALLOW_PROMOTION_BYPASS=true
            shift
            ;;
        --deploy-mode)
            DEPLOY_MODE="${2:-}"
            if [[ -z "$DEPLOY_MODE" ]]; then
                log_error "--deploy-mode requires a value"
                exit 1
            fi
            shift 2
            ;;
        --evidence-root)
            EVIDENCE_ROOT="${2:-}"
            if [[ -z "$EVIDENCE_ROOT" ]]; then
                log_error "--evidence-root requires a value"
                exit 1
            fi
            shift 2
            ;;
        --evidence-tag)
            EVIDENCE_TAG="${2:-}"
            if [[ -z "$EVIDENCE_TAG" ]]; then
                log_error "--evidence-tag requires a value"
                exit 1
            fi
            shift 2
            ;;
        --auto-rollback)
            AUTO_ROLLBACK=true
            shift
            ;;
        --skip-pull)
            SKIP_PULL=true
            shift
            ;;
        --restart-safety-policy)
            RESTART_SAFETY_POLICY_FILE="${2:-}"
            if [[ -z "$RESTART_SAFETY_POLICY_FILE" ]]; then
                log_error "--restart-safety-policy requires a value"
                exit 1
            fi
            shift 2
            ;;
        -f)
            if [[ -z "${2:-}" ]]; then
                log_error "-f requires a file"
                exit 1
            fi
            COMPOSE_ARGS+=("-f" "$2")
            shift 2
            ;;
        --wait-seconds)
            WAIT_SECONDS="${2:-}"
            if ! [[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]]; then
                log_error "--wait-seconds must be an integer"
                exit 1
            fi
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

if [[ ${#COMPOSE_ARGS[@]} -eq 0 ]]; then
    COMPOSE_ARGS=("-f" "docker-compose.yml")
fi

if [[ -n "$PROFILES_OVERRIDE" ]]; then
    export COMPOSE_PROFILES="$PROFILES_OVERRIDE"
fi

environment_rank() {
    case "$1" in
        dev) echo 1 ;;
        staging) echo 2 ;;
        production) echo 3 ;;
        *) return 1 ;;
    esac
}

validate_environment_value() {
    case "$1" in
        dev|staging|production) return 0 ;;
        *)
            log_error "Invalid environment: $1 (must be dev|staging|production)"
            return 1
            ;;
    esac
}

validate_compose_files_exist() {
    local failed=0
    local idx=0
    while [[ $idx -lt ${#COMPOSE_ARGS[@]} ]]; do
        local file="${COMPOSE_ARGS[$((idx + 1))]}"
        if [[ ! -f "$file" ]]; then
            log_error "Compose file not found: $file"
            failed=1
        fi
        idx=$((idx + 2))
    done
    return $failed
}

load_env() {
    if [[ ! -f .env ]]; then
        if [[ -f .env.example ]]; then
            cp .env.example .env
            log_warn ".env missing; copied .env.example to .env"
        else
            log_error ".env and .env.example are both missing"
            return 1
        fi
    fi

    set -a
    # shellcheck disable=SC1091
    source .env
    set +a

    if [[ -n "$PROFILES_OVERRIDE" ]]; then
        export COMPOSE_PROFILES="$PROFILES_OVERRIDE"
    fi
}

load_restart_safety_policy() {
    if [[ -f "$RESTART_SAFETY_POLICY_FILE" ]]; then
        # shellcheck disable=SC1090
        source "$RESTART_SAFETY_POLICY_FILE"
        log_info "Loaded restart safety policy: $RESTART_SAFETY_POLICY_FILE"
    else
        log_warn "Restart safety policy file not found, using defaults: $RESTART_SAFETY_POLICY_FILE"
    fi
}

show_active_profiles() {
    local profiles="${COMPOSE_PROFILES:-}"
    if [[ -z "$profiles" ]]; then
        echo "none (foundation-only)"
    else
        echo "$profiles"
    fi
}

init_evidence_bundle() {
    local run_id tag
    run_id="$(timestamp_compact)"
    tag="$(slugify "${EVIDENCE_TAG:-${DEPLOY_MODE}-${DEPLOY_ENVIRONMENT}}")"
    EVIDENCE_DIR="${EVIDENCE_ROOT%/}/${run_id}-${tag}"
    mkdir -p "$EVIDENCE_DIR"

    EVIDENCE_MANIFEST="$EVIDENCE_DIR/manifest.env"
    GATES_FILE="$EVIDENCE_DIR/gates.tsv"
    : >"$EVIDENCE_MANIFEST"
    : >"$GATES_FILE"

    append_manifest "RUN_ID" "$run_id"
    append_manifest "RUN_TIMESTAMP_UTC" "$(timestamp_utc)"
    append_manifest "DEPLOY_MODE" "$DEPLOY_MODE"
    append_manifest "DEPLOY_ENVIRONMENT" "$DEPLOY_ENVIRONMENT"
    append_manifest "PROMOTION_FROM" "$PROMOTION_FROM"
    append_manifest "PROMOTION_ID" "$PROMOTION_ID"
    append_manifest "ALLOW_PROMOTION_BYPASS" "$ALLOW_PROMOTION_BYPASS"
    append_manifest "AUTO_ROLLBACK" "$AUTO_ROLLBACK"
    append_manifest "COMPOSE_ARGS" "$(compose_args_string)"
    append_manifest "COMPOSE_PROFILES" "${COMPOSE_PROFILES:-}"
    append_manifest "PWD" "$PROJECT_DIR"

    local cmdline
    printf -v cmdline '%q ' "$0" "${ORIGINAL_ARGS[@]}"
    append_manifest "COMMAND_LINE" "${cmdline% }"
}

acquire_deploy_lock() {
    if ! command -v flock >/dev/null 2>&1; then
        log_warn "flock is not available; continuing without deployment lock"
        append_manifest "DEPLOY_LOCK" "not-available"
        return 0
    fi

    exec 200>"$LOCK_FILE"
    if ! flock -n 200; then
        log_error "Another deployment is already in progress (lock: $LOCK_FILE)"
        append_manifest "DEPLOY_LOCK" "acquire-failed"
        return 1
    fi

    LOCK_ACQUIRED=true
    append_manifest "DEPLOY_LOCK" "$LOCK_FILE"
    log_ok "Acquired deployment lock: $LOCK_FILE"
    return 0
}

check_prerequisites() {
    local failed=0

    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed"
        failed=1
    else
        log_ok "Docker installed"
    fi

    if ! docker compose version >/dev/null 2>&1; then
        log_error "Docker Compose v2 is not available"
        failed=1
    else
        log_ok "Docker Compose v2 available"
    fi

    if ! command -v git >/dev/null 2>&1; then
        log_warn "git is not installed; rollback commit pointer will be unavailable"
    fi

    if [[ ! -x "$SCRIPT_DIR/generate-secrets.sh" ]]; then
        log_error "Missing executable: scripts/generate-secrets.sh"
        failed=1
    fi

    if [[ ! -x "$SCRIPT_DIR/validate-secret-parity.sh" ]]; then
        log_error "Missing executable: scripts/validate-secret-parity.sh"
        failed=1
    fi

    if [[ ! -x "$SCRIPT_DIR/validate-federation-adapter-boundary.sh" ]]; then
        log_error "Missing executable: scripts/validate-federation-adapter-boundary.sh"
        failed=1
    fi

    if [[ ! -x "$SCRIPT_DIR/security/validate-supply-chain.sh" ]]; then
        log_error "Missing executable: scripts/security/validate-supply-chain.sh"
        failed=1
    fi

    if [[ ! -x "$SCRIPT_DIR/init-volumes.sh" ]]; then
        log_warn "scripts/init-volumes.sh missing or not executable"
    fi

    if ! validate_compose_files_exist; then
        failed=1
    fi

    return $failed
}

validate_promotion_policy() {
    local failed=0
    local expected_prev=""
    local current_rank prev_rank

    if ! validate_environment_value "$DEPLOY_ENVIRONMENT"; then
        failed=1
    fi

    if [[ -n "$PROMOTION_FROM" ]] && ! validate_environment_value "$PROMOTION_FROM"; then
        failed=1
    fi

    case "$DEPLOY_ENVIRONMENT" in
        dev) expected_prev="" ;;
        staging) expected_prev="dev" ;;
        production) expected_prev="staging" ;;
    esac

    if [[ -n "$PROMOTION_FROM" ]]; then
        current_rank="$(environment_rank "$DEPLOY_ENVIRONMENT" || echo 0)"
        prev_rank="$(environment_rank "$PROMOTION_FROM" || echo 0)"
        if [[ "$prev_rank" -ge "$current_rank" ]]; then
            log_error "Invalid promotion direction: $PROMOTION_FROM -> $DEPLOY_ENVIRONMENT"
            failed=1
        fi
    fi

    if [[ -n "$expected_prev" ]]; then
        if [[ -z "$PROMOTION_ID" ]]; then
            PROMOTION_ID="auto-${DEPLOY_ENVIRONMENT}-$(timestamp_compact)"
            log_warn "--promotion-id missing; generated $PROMOTION_ID"
        fi

        if [[ "$ALLOW_PROMOTION_BYPASS" == true ]]; then
            log_warn "Promotion bypass enabled for ${DEPLOY_ENVIRONMENT}; expected source is ${expected_prev}"
        elif [[ "$PROMOTION_FROM" != "$expected_prev" ]]; then
            log_error "Promotion to ${DEPLOY_ENVIRONMENT} requires --promotion-from ${expected_prev}"
            failed=1
        fi
    elif [[ -n "$PROMOTION_FROM" ]]; then
        log_warn "Promotion source provided for dev deployment; ignoring strict promotion policy"
    fi

    append_manifest "PROMOTION_EXPECTED_FROM" "$expected_prev"
    return $failed
}

validate_configuration() {
    local failed=0

    if ! validate_promotion_policy; then
        failed=1
    fi

    if [[ -z "${DOMAIN:-}" || "${DOMAIN}" == "example.com" ]]; then
        log_error "DOMAIN is not configured (still example.com)"
        failed=1
    else
        log_ok "DOMAIN=${DOMAIN}"
    fi

    if [[ -z "${ADMIN_EMAIL:-}" || "${ADMIN_EMAIL}" == "admin@example.com" ]]; then
        log_warn "ADMIN_EMAIL is using default placeholder"
    else
        log_ok "ADMIN_EMAIL=${ADMIN_EMAIL}"
    fi

    log_info "Active profiles: $(show_active_profiles)"

    cat >"$EVIDENCE_DIR/preflight-profile-matrix.txt" <<EOF
timestamp_utc=$(timestamp_utc)
environment=${DEPLOY_ENVIRONMENT}
promotion_from=${PROMOTION_FROM}
promotion_id=${PROMOTION_ID}
deploy_mode=${DEPLOY_MODE}
compose_profiles=${COMPOSE_PROFILES:-}
compose_args=$(compose_args_string)
EOF

    if run_and_capture "preflight-secrets-validate" "$SCRIPT_DIR/generate-secrets.sh" --validate; then
        log_ok "Secrets preflight passed"
    else
        log_error "Secrets preflight failed (see ${EVIDENCE_DIR}/preflight-secrets-validate.log)"
        failed=1
    fi

    if run_and_capture "preflight-secret-parity" "$SCRIPT_DIR/validate-secret-parity.sh" --environment "$DEPLOY_ENVIRONMENT"; then
        log_ok "Secret parity preflight passed"
    else
        log_error "Secret parity preflight failed (see ${EVIDENCE_DIR}/preflight-secret-parity.log)"
        failed=1
    fi

    if run_and_capture "preflight-federation-adapter-boundary" "$SCRIPT_DIR/validate-federation-adapter-boundary.sh"; then
        log_ok "Federation adapter boundary preflight passed"
    else
        log_error "Federation adapter boundary preflight failed (see ${EVIDENCE_DIR}/preflight-federation-adapter-boundary.log)"
        failed=1
    fi

    if run_and_capture "preflight-compose-config" docker compose "${COMPOSE_ARGS[@]}" config; then
        local config_hash
        if command -v sha256sum >/dev/null 2>&1; then
            config_hash="$(sha256sum "$EVIDENCE_DIR/preflight-compose-config.log" | awk '{print $1}')"
        elif command -v shasum >/dev/null 2>&1; then
            config_hash="$(shasum -a 256 "$EVIDENCE_DIR/preflight-compose-config.log" | awk '{print $1}')"
        else
            config_hash="unavailable"
        fi
        append_manifest "COMPOSE_CONFIG_SHA256" "$config_hash"
        log_ok "Compose config preflight passed"
    else
        log_error "Compose config preflight failed (see ${EVIDENCE_DIR}/preflight-compose-config.log)"
        failed=1
    fi

    local supply_chain_args=()
    local supply_chain_threshold
    local supply_chain_strict
    local supply_chain_fail_on_latest
    local supply_chain_pull_missing
    local supply_chain_allow_auth_degraded
    local idx=0
    supply_chain_threshold="${SUPPLY_CHAIN_SEVERITY_THRESHOLD:-CRITICAL}"
    supply_chain_strict="${SUPPLY_CHAIN_STRICT:-true}"
    supply_chain_fail_on_latest="${SUPPLY_CHAIN_FAIL_ON_LATEST:-true}"
    supply_chain_pull_missing="${SUPPLY_CHAIN_PULL_MISSING:-false}"
    supply_chain_allow_auth_degraded="${SUPPLY_CHAIN_ALLOW_AUTH_DEGRADED:-false}"

    while [[ $idx -lt ${#COMPOSE_ARGS[@]} ]]; do
        supply_chain_args+=(--compose-file "${COMPOSE_ARGS[$((idx + 1))]}")
        idx=$((idx + 2))
    done

    supply_chain_args+=(--output-dir "$EVIDENCE_DIR/supply-chain")
    supply_chain_args+=(--severity-threshold "$supply_chain_threshold")

    if [[ "$supply_chain_strict" == true ]]; then
        supply_chain_args+=(--strict)
    fi
    if [[ "$supply_chain_fail_on_latest" == true ]]; then
        supply_chain_args+=(--fail-on-latest)
    fi
    if [[ "$supply_chain_pull_missing" == true ]]; then
        supply_chain_args+=(--pull-missing)
    fi
    if [[ "$supply_chain_allow_auth_degraded" == true ]]; then
        supply_chain_args+=(--allow-auth-degraded)
    fi

    if run_and_capture "preflight-supply-chain" "$SCRIPT_DIR/security/validate-supply-chain.sh" "${supply_chain_args[@]}"; then
        SUPPLY_CHAIN_GATE_STATUS="PASS"
        append_manifest "SUPPLY_CHAIN_SUMMARY_FILE" "$EVIDENCE_DIR/supply-chain/supply-chain-summary.env"
        append_manifest "SUPPLY_CHAIN_SEVERITY_THRESHOLD" "$supply_chain_threshold"
        append_manifest "SUPPLY_CHAIN_STRICT" "$supply_chain_strict"
        append_manifest "SUPPLY_CHAIN_ALLOW_AUTH_DEGRADED" "$supply_chain_allow_auth_degraded"
        record_gate "supply-chain-baseline" "PASS" "image-policy sbom vulnerability-threshold"
        log_ok "Supply-chain preflight passed"
    else
        SUPPLY_CHAIN_GATE_STATUS="FAIL"
        record_gate "supply-chain-baseline" "FAIL" "see preflight-supply-chain.log"
        log_error "Supply-chain preflight failed (see ${EVIDENCE_DIR}/preflight-supply-chain.log)"
        failed=1
    fi

    return $failed
}

capture_rollback_pointer() {
    local svc
    ROLLBACK_POINTER_FILE="$EVIDENCE_DIR/rollback-pointer.env"
    : >"$ROLLBACK_POINTER_FILE"

    if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        PRE_DEPLOY_GIT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
        append_manifest "PRE_DEPLOY_GIT_SHA" "$PRE_DEPLOY_GIT_SHA"
        run_and_capture "pre-deploy-git-status" git status --short || true
    fi

    {
        echo "ROLLBACK_CAPTURED_AT=$(timestamp_utc)"
        echo "DEPLOY_ENVIRONMENT=${DEPLOY_ENVIRONMENT}"
        echo "PROMOTION_FROM=${PROMOTION_FROM}"
        echo "PROMOTION_ID=${PROMOTION_ID}"
        echo "DEPLOY_MODE=${DEPLOY_MODE}"
        echo "COMPOSE_ARGS=$(compose_args_string)"
        echo "COMPOSE_PROFILES=${COMPOSE_PROFILES:-}"
        echo "PRE_DEPLOY_GIT_SHA=${PRE_DEPLOY_GIT_SHA}"
    } >>"$ROLLBACK_POINTER_FILE"

    run_and_capture "pre-deploy-compose-ps" docker compose "${COMPOSE_ARGS[@]}" ps || true
    run_and_capture "pre-deploy-compose-images" docker compose "${COMPOSE_ARGS[@]}" images || true

    while IFS= read -r svc; do
        [[ -z "$svc" ]] && continue

        local container_id image_ref image_id state health key
        container_id="$(docker compose "${COMPOSE_ARGS[@]}" ps -q "$svc" 2>/dev/null || true)"
        key="$(echo "$svc" | tr '[:lower:]-' '[:upper:]_')"

        if [[ -z "$container_id" ]]; then
            {
                echo "SERVICE_${key}_CONTAINER=none"
                echo "SERVICE_${key}_IMAGE=none"
                echo "SERVICE_${key}_IMAGE_ID=none"
                echo "SERVICE_${key}_STATE=not-running"
                echo "SERVICE_${key}_HEALTH=none"
            } >>"$ROLLBACK_POINTER_FILE"
            continue
        fi

        image_ref="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || echo unknown)"
        image_id="$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || echo unknown)"
        state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || echo unknown)"
        health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo unknown)"

        {
            echo "SERVICE_${key}_CONTAINER=${container_id}"
            echo "SERVICE_${key}_IMAGE=${image_ref}"
            echo "SERVICE_${key}_IMAGE_ID=${image_id}"
            echo "SERVICE_${key}_STATE=${state}"
            echo "SERVICE_${key}_HEALTH=${health}"
        } >>"$ROLLBACK_POINTER_FILE"
    done < <(docker compose "${COMPOSE_ARGS[@]}" config --services 2>/dev/null || true)

    append_manifest "ROLLBACK_POINTER_FILE" "$ROLLBACK_POINTER_FILE"
}

write_rollback_plan() {
    local rollback_file="$EVIDENCE_DIR/rollback-plan.md"
    local compose_flags
    compose_flags="$(compose_args_string)"

    cat >"$rollback_file" <<EOF
# Rollback Plan

Generated: $(timestamp_utc)
Environment: ${DEPLOY_ENVIRONMENT}
Promotion Source: ${PROMOTION_FROM:-n/a}
Promotion ID: ${PROMOTION_ID:-n/a}
Rollback Pointer: ${ROLLBACK_POINTER_FILE}

## Step 1: Inspect Pre-Deploy Pointer
\`\`\`bash
cat "${ROLLBACK_POINTER_FILE}"
\`\`\`

## Step 2: (Webhook/Git Mode) Restore Previous Commit
EOF

    if [[ -n "$PRE_DEPLOY_GIT_SHA" ]]; then
        cat >>"$rollback_file" <<EOF
\`\`\`bash
git reset --hard ${PRE_DEPLOY_GIT_SHA}
\`\`\`
EOF
    else
        cat >>"$rollback_file" <<'EOF'
No pre-deploy git commit was captured. Skip this step.
EOF
    fi

    cat >>"$rollback_file" <<EOF

## Step 3: Re-apply Known-Good Runtime
\`\`\`bash
./scripts/deploy.sh --environment ${DEPLOY_ENVIRONMENT} --deploy-mode manual --skip-pull ${compose_flags}
\`\`\`
EOF

    append_manifest "ROLLBACK_PLAN_FILE" "$rollback_file"
}

prepare_volumes() {
    log_info "Pre-creating containers/volumes (no start)..."
    if ! run_and_capture "apply-up-no-start" docker compose "${COMPOSE_ARGS[@]}" up -d --no-start; then
        log_error "Failed to pre-create containers/volumes"
        return 1
    fi

    if [[ -x "$SCRIPT_DIR/init-volumes.sh" ]]; then
        if ! run_and_capture "apply-init-volumes" "$SCRIPT_DIR/init-volumes.sh"; then
            log_error "Volume initialization failed"
            return 1
        fi
    else
        log_warn "Skipping volume ownership initialization"
    fi
}

start_services() {
    if [[ "$SKIP_PULL" == false ]]; then
        log_info "Pulling latest images..."
        if ! run_and_capture "apply-compose-pull" docker compose "${COMPOSE_ARGS[@]}" pull; then
            log_error "Image pull failed"
            return 1
        fi
    else
        log_warn "Skipping image pull due to --skip-pull"
    fi

    log_info "Starting services..."
    if ! run_and_capture "apply-compose-up" docker compose "${COMPOSE_ARGS[@]}" up -d; then
        log_error "docker compose up failed"
        return 1
    fi

    log_ok "Services started"
}

monitor_health() {
    local timeout="$WAIT_SECONDS"
    local interval=5
    local elapsed=0
    local health_progress_file="$EVIDENCE_DIR/health-progress.log"
    : >"$health_progress_file"

    log_info "Waiting for healthy services (${timeout}s timeout)..."

    while [[ $elapsed -lt $timeout ]]; do
        local total=0 running=0 unhealthy=0 starting=0 stopped=0 svc container_id state health

        while IFS= read -r svc; do
            [[ -z "$svc" ]] && continue
            total=$((total + 1))

            container_id="$(docker compose "${COMPOSE_ARGS[@]}" ps -q "$svc" 2>/dev/null || true)"
            if [[ -z "$container_id" ]]; then
                stopped=$((stopped + 1))
                continue
            fi

            state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || echo unknown)"
            health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo unknown)"

            if [[ "$state" != "running" ]]; then
                stopped=$((stopped + 1))
            fi

            case "$health" in
                unhealthy) unhealthy=$((unhealthy + 1)) ;;
                starting) starting=$((starting + 1)) ;;
            esac

            if [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
                running=$((running + 1))
            fi
        done < <(docker compose "${COMPOSE_ARGS[@]}" config --services 2>/dev/null || true)

        printf '%s elapsed=%ss total=%s running=%s starting=%s unhealthy=%s stopped=%s\n' \
            "$(timestamp_utc)" "$elapsed" "$total" "$running" "$starting" "$unhealthy" "$stopped" >>"$health_progress_file"

        if [[ "$total" -gt 0 && "$unhealthy" -eq 0 && "$starting" -eq 0 && "$stopped" -eq 0 && "$running" -eq "$total" ]]; then
            log_ok "Health checks passed (${running}/${total} services ready)"
            return 0
        fi

        log_info "Health wait ${elapsed}s/${timeout}s (running=${running}/${total}, starting=${starting}, unhealthy=${unhealthy}, stopped=${stopped})"
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done

    log_error "Health gate failed before timeout (${timeout}s)"
    run_and_capture "apply-post-health-ps" docker compose "${COMPOSE_ARGS[@]}" ps || true
    return 1
}

evaluate_restart_safety() {
    local policy_report="$EVIDENCE_DIR/restart-safety-policy.log"
    local failed=0
    local svc container_id state health key pre_image_id post_image_id changed

    : >"$policy_report"
    {
        echo "timestamp=$(timestamp_utc)"
        echo "policy_file=${RESTART_SAFETY_POLICY_FILE}"
        echo "critical_services=${RESTART_SAFETY_CRITICAL_SERVICES}"
        echo "stateful_services=${RESTART_SAFETY_STATEFUL_SERVICES}"
        echo ""
    } >>"$policy_report"

    append_manifest "RESTART_SAFETY_POLICY_FILE" "$RESTART_SAFETY_POLICY_FILE"
    append_manifest "RESTART_SAFETY_CRITICAL_SERVICES" "$RESTART_SAFETY_CRITICAL_SERVICES"
    append_manifest "RESTART_SAFETY_STATEFUL_SERVICES" "$RESTART_SAFETY_STATEFUL_SERVICES"

    for svc in $RESTART_SAFETY_CRITICAL_SERVICES; do
        key="$(echo "$svc" | tr '[:lower:]-' '[:upper:]_')"
        container_id="$(docker compose "${COMPOSE_ARGS[@]}" ps -q "$svc" 2>/dev/null || true)"

        if [[ -z "$container_id" ]]; then
            printf '%s class=critical service=%s state=missing health=missing\n' "$(timestamp_utc)" "$svc" >>"$policy_report"
            failed=1
            continue
        fi

        state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || echo unknown)"
        health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo unknown)"
        pre_image_id="$(grep "^SERVICE_${key}_IMAGE_ID=" "$ROLLBACK_POINTER_FILE" 2>/dev/null | head -n 1 | cut -d= -f2- || true)"
        post_image_id="$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || echo unknown)"

        if [[ "$pre_image_id" != "$post_image_id" ]]; then
            changed="yes"
        else
            changed="no"
        fi

        printf '%s class=critical service=%s state=%s health=%s image_changed=%s\n' \
            "$(timestamp_utc)" "$svc" "$state" "$health" "$changed" >>"$policy_report"

        if [[ "$state" != "running" || ( "$health" != "healthy" && "$health" != "none" ) ]]; then
            failed=1
        fi
    done

    for svc in $RESTART_SAFETY_STATEFUL_SERVICES; do
        container_id="$(docker compose "${COMPOSE_ARGS[@]}" ps -q "$svc" 2>/dev/null || true)"
        if [[ -z "$container_id" ]]; then
            printf '%s class=stateful service=%s state=not-in-stack\n' "$(timestamp_utc)" "$svc" >>"$policy_report"
            continue
        fi
        state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || echo unknown)"
        health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo unknown)"
        printf '%s class=stateful service=%s state=%s health=%s\n' "$(timestamp_utc)" "$svc" "$state" "$health" >>"$policy_report"
    done

    if [[ "$failed" -ne 0 ]]; then
        log_error "Restart safety policy check failed (see ${policy_report})"
        record_gate "restart-safety-policy" "FAIL" "critical-service-state-check-failed"
        return 1
    fi

    log_ok "Restart safety policy check passed"
    record_gate "restart-safety-policy" "PASS" "critical-service-state-check-passed"
    return 0
}

run_smoke_checks() {
    local running_count
    running_count="$(docker compose "${COMPOSE_ARGS[@]}" ps --services --status running 2>/dev/null | wc -l | tr -d ' ')"

    if [[ "${running_count:-0}" -lt 1 ]]; then
        log_error "Smoke checks failed: no running services detected"
        return 1
    fi

    log_ok "Smoke checks passed: ${running_count} service(s) running"

    if command -v curl >/dev/null 2>&1 && [[ -n "${DOMAIN:-}" && "${DOMAIN}" != "example.com" ]]; then
        if curl -fsS --max-time 10 "https://${DOMAIN}" >/dev/null 2>&1; then
            log_ok "External smoke check passed: https://${DOMAIN}"
        else
            log_warn "External smoke check failed for https://${DOMAIN} (non-blocking)"
        fi
    fi

    run_and_capture "post-apply-compose-ps" docker compose "${COMPOSE_ARGS[@]}" ps || true
    run_and_capture "post-apply-compose-images" docker compose "${COMPOSE_ARGS[@]}" images || true
    return 0
}

attempt_auto_rollback() {
    if [[ "$AUTO_ROLLBACK" != true ]]; then
        return 0
    fi

    log_warn "Auto-rollback requested after deployment failure"

    if [[ "$DEPLOY_MODE" != "webhook" ]]; then
        log_warn "Auto-rollback is only supported in webhook mode; skipping"
        append_manifest "AUTO_ROLLBACK_RESULT" "skipped-not-webhook-mode"
        return 0
    fi

    if [[ -z "$PRE_DEPLOY_GIT_SHA" ]]; then
        log_warn "No pre-deploy git SHA captured; skipping auto-rollback"
        append_manifest "AUTO_ROLLBACK_RESULT" "skipped-no-commit-pointer"
        return 0
    fi

    if ! run_and_capture "rollback-git-reset" git reset --hard "$PRE_DEPLOY_GIT_SHA"; then
        log_error "Auto-rollback failed during git reset"
        append_manifest "AUTO_ROLLBACK_RESULT" "failed-git-reset"
        return 1
    fi

    if ! run_and_capture "rollback-compose-up" docker compose "${COMPOSE_ARGS[@]}" up -d; then
        log_error "Auto-rollback failed during docker compose up"
        append_manifest "AUTO_ROLLBACK_RESULT" "failed-compose-up"
        return 1
    fi

    run_and_capture "rollback-compose-ps" docker compose "${COMPOSE_ARGS[@]}" ps || true
    append_manifest "AUTO_ROLLBACK_RESULT" "success"
    log_ok "Auto-rollback completed"
    return 0
}

write_release_evidence() {
    local report="$EVIDENCE_DIR/RELEASE-EVIDENCE.md"

    if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        POST_DEPLOY_GIT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
    fi
    append_manifest "POST_DEPLOY_GIT_SHA" "$POST_DEPLOY_GIT_SHA"
    append_manifest "PROMOTION_GATE_STATUS" "$PROMOTION_GATE_STATUS"
    append_manifest "APPLY_GATE_STATUS" "$APPLY_GATE_STATUS"
    append_manifest "CONFIDENCE_GATE_STATUS" "$CONFIDENCE_GATE_STATUS"
    append_manifest "SUPPLY_CHAIN_GATE_STATUS" "$SUPPLY_CHAIN_GATE_STATUS"

    cat >"$report" <<EOF
# Release Evidence Bundle

Generated: $(timestamp_utc)
Environment: ${DEPLOY_ENVIRONMENT}
Deployment Mode: ${DEPLOY_MODE}
Promotion From: ${PROMOTION_FROM:-n/a}
Promotion ID: ${PROMOTION_ID:-n/a}
Promotion Bypass: ${ALLOW_PROMOTION_BYPASS}
Compose Profiles: ${COMPOSE_PROFILES:-none (foundation-only)}
Compose Args: $(compose_args_string)
Rollback Pointer: ${ROLLBACK_POINTER_FILE:-not-captured}
Pre-Deploy Commit: ${PRE_DEPLOY_GIT_SHA:-n/a}
Post-Deploy Commit: ${POST_DEPLOY_GIT_SHA:-n/a}

## Gate Status
- Promotion readiness: ${PROMOTION_GATE_STATUS}
- Apply safety: ${APPLY_GATE_STATUS}
- Post-apply confidence: ${CONFIDENCE_GATE_STATUS}
- Supply-chain baseline: ${SUPPLY_CHAIN_GATE_STATUS}

## Evidence Artifacts
- Manifest: ${EVIDENCE_MANIFEST}
- Gates log: ${GATES_FILE}
- Preflight profile matrix: ${EVIDENCE_DIR}/preflight-profile-matrix.txt
- Compose preflight output: ${EVIDENCE_DIR}/preflight-compose-config.log
- Secrets preflight output: ${EVIDENCE_DIR}/preflight-secrets-validate.log
- Supply-chain preflight output: ${EVIDENCE_DIR}/preflight-supply-chain.log
- Supply-chain summary: ${EVIDENCE_DIR}/supply-chain/supply-chain-summary.env
- Rollback pointer: ${ROLLBACK_POINTER_FILE:-not-captured}
- Rollback plan: ${EVIDENCE_DIR}/rollback-plan.md
- Health progress: ${EVIDENCE_DIR}/health-progress.log
- Restart safety policy: ${EVIDENCE_DIR}/restart-safety-policy.log
- Post-apply compose state: ${EVIDENCE_DIR}/post-apply-compose-ps.log
EOF

    append_manifest "RELEASE_EVIDENCE_FILE" "$report"
}

main() {
    echo ""
    echo "=========================================="
    echo "  Peer Mesh Docker Lab - Deployment"
    echo "=========================================="
    echo ""

    check_prerequisites || exit 1
    load_env || exit 1
    load_restart_safety_policy
    init_evidence_bundle
    acquire_deploy_lock || exit 1

    append_manifest "COMPOSE_PROFILES" "${COMPOSE_PROFILES:-}"
    log_info "Evidence bundle: $EVIDENCE_DIR"

    if [[ "$SHOW_PROFILES_ONLY" == true ]]; then
        echo "Active profiles: $(show_active_profiles)"
        PROMOTION_GATE_STATUS="SKIPPED"
        APPLY_GATE_STATUS="SKIPPED"
        CONFIDENCE_GATE_STATUS="SKIPPED"
        SUPPLY_CHAIN_GATE_STATUS="SKIPPED"
        record_gate "profiles" "PASS" "profile-inspection-only"
        write_release_evidence
        exit 0
    fi

    if validate_configuration; then
        PROMOTION_GATE_STATUS="PASS"
        record_gate "promotion-readiness" "PASS" "config-resolve profile-matrix secrets-validation"
    else
        PROMOTION_GATE_STATUS="FAIL"
        record_gate "promotion-readiness" "FAIL" "preflight-validation-failed"
        write_release_evidence
        log_error "Validation failed"
        exit 1
    fi

    if [[ "$VALIDATE_ONLY" == true ]]; then
        APPLY_GATE_STATUS="SKIPPED"
        CONFIDENCE_GATE_STATUS="SKIPPED"
        write_release_evidence
        log_ok "Validation passed"
        log_info "Evidence bundle: $EVIDENCE_DIR"
        exit 0
    fi

    capture_rollback_pointer
    write_rollback_plan

    if prepare_volumes && start_services && monitor_health && evaluate_restart_safety; then
        APPLY_GATE_STATUS="PASS"
        record_gate "apply-safety" "PASS" "idempotent-apply health-pass restart-safety-pass rollback-pointer-captured"
    else
        APPLY_GATE_STATUS="FAIL"
        record_gate "apply-safety" "FAIL" "apply-health-or-restart-safety-failed"
        attempt_auto_rollback || true
        write_release_evidence
        log_error "Apply safety gate failed"
        log_info "Evidence bundle: $EVIDENCE_DIR"
        exit 1
    fi

    if run_smoke_checks; then
        CONFIDENCE_GATE_STATUS="PASS"
        record_gate "post-apply-confidence" "PASS" "smoke-checks and release evidence generated"
    else
        CONFIDENCE_GATE_STATUS="FAIL"
        record_gate "post-apply-confidence" "FAIL" "smoke-checks-failed"
        attempt_auto_rollback || true
        write_release_evidence
        log_error "Post-apply confidence gate failed"
        log_info "Evidence bundle: $EVIDENCE_DIR"
        exit 1
    fi

    write_release_evidence

    echo ""
    echo "=========================================="
    echo "  Deployment Complete"
    echo "=========================================="
    echo ""

    docker compose "${COMPOSE_ARGS[@]}" ps
    log_ok "Release evidence captured at: $EVIDENCE_DIR"
}

main "$@"
