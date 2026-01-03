#!/bin/sh
# deploy/webhook/deploy.sh
# Deployment script triggered by GitHub webhook
# Part of Pull-Based deployment pattern (ADR-009)
# Note: Uses POSIX sh for Alpine Linux compatibility (no bash)
set -eu

# Configuration
DEPLOY_DIR="${DEPLOY_DIR:-/app}"
LOG_DIR="${LOG_DIR:-/tmp/deploy-logs}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

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
