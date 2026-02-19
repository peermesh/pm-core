#!/bin/sh
# deploy/webhook/deploy.sh
# Canonical webhook deployment wrapper.
# Pulls latest code, verifies security constraints, then executes
# scripts/deploy.sh with production promotion gates and evidence output.

set -eu

DEPLOY_DIR="${DEPLOY_DIR:-/app}"
LOG_DIR="${LOG_DIR:-/tmp/deploy-logs}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-production}"
PROMOTION_FROM="${PROMOTION_FROM:-staging}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-${LOG_DIR}/evidence}"
WAIT_SECONDS="${WAIT_SECONDS:-300}"
DEPLOY_SCRIPT="${DEPLOY_DIR}/scripts/deploy.sh"

mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/deploy-$(date +%Y%m%d-%H%M%S).log"

log() {
    level="${1:-INFO}"
    shift
    printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$*" | tee -a "$LOG_FILE"
}

run_logged() {
    "$@" >>"$LOG_FILE" 2>&1
}

verify_no_sensitive_files() {
    log "INFO" "Verifying no sensitive files in deployment..."
    sensitive_found=0

    # Files that should never be pulled from git into runtime workspace.
    critical_patterns="secrets/.*.yaml secrets/.*.env .dev/ deploy/keys/*.key"

    for pattern in $critical_patterns; do
        if [ -e "${DEPLOY_DIR}/${pattern}" ] 2>/dev/null || \
            find "$DEPLOY_DIR" -maxdepth 3 -path "*/${pattern}" -type f 2>/dev/null | grep -q .; then
            log "WARN" "Sensitive file pattern found: $pattern"
            sensitive_found=1
        fi
    done

    # .env is expected locally on VPS, but it must never be tracked in git.
    if [ -f "${DEPLOY_DIR}/.env" ]; then
        if git ls-files --error-unmatch .env >/dev/null 2>&1; then
            log "ERROR" ".env is tracked by git. This must be untracked."
            sensitive_found=1
        else
            log "INFO" ".env present and untracked (expected for VPS deployment)"
        fi
    fi

    if [ "$sensitive_found" -eq 1 ]; then
        log "ERROR" "Sensitive file verification failed"
        return 1
    fi

    log "INFO" "Security verification passed"
    return 0
}

run_canonical_deploy() {
    promotion_id="$1"

    if [ ! -x "$DEPLOY_SCRIPT" ]; then
        log "ERROR" "Canonical deploy script not executable: $DEPLOY_SCRIPT"
        return 1
    fi

    log "INFO" "Invoking canonical deploy script"
    log "INFO" "Environment=$DEPLOY_ENVIRONMENT PromotionFrom=$PROMOTION_FROM PromotionID=$promotion_id"

    if [ -n "${COMPOSE_PROFILES:-}" ]; then
        run_logged bash "$DEPLOY_SCRIPT" \
            --deploy-mode webhook \
            --environment "$DEPLOY_ENVIRONMENT" \
            --promotion-from "$PROMOTION_FROM" \
            --promotion-id "$promotion_id" \
            --set-profiles "$COMPOSE_PROFILES" \
            --wait-seconds "$WAIT_SECONDS" \
            --evidence-root "$EVIDENCE_ROOT" \
            --auto-rollback \
            -f "$COMPOSE_FILE"
    else
        run_logged bash "$DEPLOY_SCRIPT" \
            --deploy-mode webhook \
            --environment "$DEPLOY_ENVIRONMENT" \
            --promotion-from "$PROMOTION_FROM" \
            --promotion-id "$promotion_id" \
            --wait-seconds "$WAIT_SECONDS" \
            --evidence-root "$EVIDENCE_ROOT" \
            --auto-rollback \
            -f "$COMPOSE_FILE"
    fi
}

manual_rollback() {
    previous_commit="$1"
    promotion_id="$2"

    if [ -z "$previous_commit" ]; then
        log "ERROR" "No previous commit captured; cannot rollback"
        return 1
    fi

    log "WARN" "Attempting rollback to commit $previous_commit"
    if ! run_logged git reset --hard "$previous_commit"; then
        log "ERROR" "Rollback git reset failed"
        return 1
    fi

    rollback_promotion_id="${promotion_id}-rollback"
    if [ -n "${COMPOSE_PROFILES:-}" ]; then
        run_logged bash "$DEPLOY_SCRIPT" \
            --deploy-mode webhook \
            --environment "$DEPLOY_ENVIRONMENT" \
            --promotion-from "$PROMOTION_FROM" \
            --promotion-id "$rollback_promotion_id" \
            --set-profiles "$COMPOSE_PROFILES" \
            --wait-seconds "$WAIT_SECONDS" \
            --evidence-root "$EVIDENCE_ROOT" \
            --skip-pull \
            -f "$COMPOSE_FILE"
    else
        run_logged bash "$DEPLOY_SCRIPT" \
            --deploy-mode webhook \
            --environment "$DEPLOY_ENVIRONMENT" \
            --promotion-from "$PROMOTION_FROM" \
            --promotion-id "$rollback_promotion_id" \
            --wait-seconds "$WAIT_SECONDS" \
            --evidence-root "$EVIDENCE_ROOT" \
            --skip-pull \
            -f "$COMPOSE_FILE"
    fi
}

main() {
    triggered_ref="${1:-refs/heads/main}"
    payload_commit="${2:-unknown}"

    log "INFO" "=== Webhook Deployment Started ==="
    log "INFO" "Deploy directory: $DEPLOY_DIR"
    log "INFO" "Triggered ref: $triggered_ref"
    log "INFO" "Payload commit: $payload_commit"

    cd "$DEPLOY_DIR" || {
        log "ERROR" "Failed to change to deploy directory: $DEPLOY_DIR"
        exit 1
    }

    previous_commit="$(git rev-parse --short HEAD 2>/dev/null || true)"
    log "INFO" "Previous commit: ${previous_commit:-unknown}"

    log "INFO" "Fetching latest changes from origin/main..."
    if ! run_logged git fetch origin main; then
        log "ERROR" "Git fetch failed"
        exit 1
    fi

    log "INFO" "Resetting to origin/main..."
    if ! run_logged git reset --hard origin/main; then
        log "ERROR" "Git reset failed"
        exit 1
    fi

    current_commit="$(git rev-parse --short HEAD)"
    promotion_id="webhook-${current_commit}-$(date -u +%Y%m%dT%H%M%SZ)"
    log "INFO" "Now at commit: $current_commit"

    if ! verify_no_sensitive_files; then
        log "ERROR" "Security check failed; aborting deployment"
        exit 1
    fi

    if ! run_canonical_deploy "$promotion_id"; then
        log "ERROR" "Canonical deployment failed, starting rollback workflow"
        if ! manual_rollback "${previous_commit:-}" "$promotion_id"; then
            log "ERROR" "Rollback failed. Manual intervention required."
            log "ERROR" "See log: $LOG_FILE"
            exit 1
        fi
        log "WARN" "Rollback completed after failed deployment"
        exit 1
    fi

    log "INFO" "=== Webhook Deployment Complete ==="
    log "INFO" "Commit: $current_commit"
    log "INFO" "Log file: $LOG_FILE"

    find "$LOG_DIR" -name "deploy-*.log" -mtime +30 -delete 2>/dev/null || true
}

main "$@"
