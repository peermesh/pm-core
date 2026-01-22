#!/bin/sh
# deploy/webhook/deploy.sh
# Deployment script triggered by GitHub webhook
# Part of Pull-Based deployment pattern (ADR-009)
# Note: Uses POSIX sh for Alpine Linux compatibility (no bash)
#
# Security: This script verifies no sensitive files are present after pull.
# Reference: FIND-006 (Private Files Leaked to VPS), FIND-008 (CI/CD Security)
#
set -eu

# Configuration
DEPLOY_DIR="${DEPLOY_DIR:-/app}"
LOG_DIR="${LOG_DIR:-/tmp/deploy-logs}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DEPLOYIGNORE_FILE="${DEPLOY_DIR}/.deployignore"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Log file with timestamp
LOG_FILE="${LOG_DIR}/deploy-$(date +%Y%m%d-%H%M%S).log"

# Logging function with timestamps
log() {
    level="${1:-INFO}"
    shift
    echo "[$(date -Iseconds)] [$level] $*" | tee -a "$LOG_FILE"
}

# Verify no sensitive files exist in deployment directory
# This is a safety check to catch files that should never be deployed
verify_no_sensitive_files() {
    log "INFO" "Verifying no sensitive files in deployment..."

    SENSITIVE_FOUND=0

    # Critical files that should NEVER exist on VPS
    # These indicate either git misconfiguration or manual file copying
    CRITICAL_PATTERNS=".env secrets/.*.yaml secrets/.*.env .dev/ deploy/keys/*.key"

    for pattern in $CRITICAL_PATTERNS; do
        # Use find with -maxdepth to avoid deep recursion, check if files exist
        if [ -e "${DEPLOY_DIR}/${pattern}" ] 2>/dev/null || \
           find "$DEPLOY_DIR" -maxdepth 3 -path "*/${pattern}" -type f 2>/dev/null | grep -q .; then
            log "WARN" "Sensitive file pattern found: $pattern"
            SENSITIVE_FOUND=1
        fi
    done

    # Check for actual .env file (not .env.example)
    if [ -f "${DEPLOY_DIR}/.env" ]; then
        log "WARN" "Found .env file in deployment directory!"
        log "WARN" "Production .env should be managed separately on VPS, not pulled from git"
        SENSITIVE_FOUND=1
    fi

    # Check for secrets directory with actual secrets
    if [ -d "${DEPLOY_DIR}/secrets" ]; then
        SECRET_COUNT=$(find "${DEPLOY_DIR}/secrets" -type f \
            ! -name '.gitkeep' \
            ! -name 'README.md' \
            ! -name 'justfile' \
            ! -name '*.example' \
            ! -name 'secrets-lib.sh' \
            2>/dev/null | wc -l)
        if [ "$SECRET_COUNT" -gt 0 ]; then
            log "WARN" "Found $SECRET_COUNT secret files in secrets/ directory"
            SENSITIVE_FOUND=1
        fi
    fi

    # Check for .dev directory (AI workspace)
    if [ -d "${DEPLOY_DIR}/.dev" ]; then
        log "WARN" "Found .dev directory - AI workspace should not be deployed"
        SENSITIVE_FOUND=1
    fi

    if [ "$SENSITIVE_FOUND" -eq 1 ]; then
        log "ERROR" "Sensitive files detected! Deployment blocked for security."
        log "ERROR" "Please verify .gitignore configuration and remove sensitive files."
        log "ERROR" "See .deployignore for list of files that should never be deployed."
        return 1
    fi

    log "INFO" "Security verification passed - no sensitive files detected"
    return 0
}

# Main deployment function
main() {
    log "INFO" "=== Deployment Started ==="
    log "INFO" "Deploy directory: $DEPLOY_DIR"
    log "INFO" "Triggered ref: ${1:-main}"
    log "INFO" "Commit SHA: ${2:-unknown}"

    # Change to deploy directory
    cd "$DEPLOY_DIR" || {
        log "ERROR" "Failed to change to deploy directory: $DEPLOY_DIR"
        exit 1
    }

    # Fetch latest changes
    log "INFO" "Fetching latest changes from origin..."
    if ! git fetch origin main 2>&1 | tee -a "$LOG_FILE"; then
        log "ERROR" "Git fetch failed"
        exit 1
    fi

    # Reset to origin/main
    log "INFO" "Resetting to origin/main..."
    if ! git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"; then
        log "ERROR" "Git reset failed"
        exit 1
    fi

    # Log current commit
    CURRENT_COMMIT=$(git rev-parse --short HEAD)
    log "INFO" "Now at commit: $CURRENT_COMMIT"

    # Security verification: Check for sensitive files
    # This catches misconfigurations where sensitive files might have been committed
    if ! verify_no_sensitive_files; then
        log "ERROR" "Security check failed - aborting deployment"
        exit 1
    fi

    # Pull new Docker images
    log "INFO" "Pulling Docker images..."
    if ! docker compose -f "$COMPOSE_FILE" pull 2>&1 | tee -a "$LOG_FILE"; then
        log "WARN" "Docker pull had issues, continuing with available images"
    fi

    # Deploy services
    log "INFO" "Deploying services..."
    if ! docker compose -f "$COMPOSE_FILE" up -d --remove-orphans 2>&1 | tee -a "$LOG_FILE"; then
        log "ERROR" "Docker compose up failed"
        exit 1
    fi

    # Cleanup old images (non-blocking)
    log "INFO" "Cleaning up unused images..."
    docker image prune -f 2>&1 | tee -a "$LOG_FILE" || true

    # Log deployment success
    log "INFO" "=== Deployment Complete ==="
    log "INFO" "Commit: $CURRENT_COMMIT"
    log "INFO" "Log file: $LOG_FILE"

    # Cleanup old log files (keep last 30 days)
    find "$LOG_DIR" -name "deploy-*.log" -mtime +30 -delete 2>/dev/null || true
}

# Execute main function with passed arguments
main "$@"
