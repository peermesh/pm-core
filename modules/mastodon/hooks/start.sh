#!/bin/bash
# ==============================================================
# Mastodon Module - Start Hook
# ==============================================================
# Purpose: Start all Mastodon services
# Called: When module is activated via pmdl module start mastodon
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (start failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${MODULE_DIR}/docker-compose.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

# ==============================================================
# Pre-start Checks
# ==============================================================

check_env_file() {
    log "Checking environment configuration..."

    if [[ ! -f "${MODULE_DIR}/.env" ]]; then
        log_error "Environment file not found: ${MODULE_DIR}/.env"
        log_error "Copy .env.example to .env and configure it"
        return 1
    fi

    # Source .env to check required variables
    source "${MODULE_DIR}/.env"

    local required_vars=(
        "MASTODON_LOCAL_DOMAIN"
        "MASTODON_SECRET_KEY_BASE"
        "MASTODON_OTP_SECRET"
    )

    local missing=()
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing+=("$var")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required environment variables: ${missing[*]}"
        return 1
    fi

    log_success "Environment configuration valid"
    return 0
}

check_compose_file() {
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log_error "Compose file not found: ${COMPOSE_FILE}"
        return 1
    fi
    return 0
}

check_dependencies() {
    log "Checking service dependencies..."

    local warnings=0

    # Check PostgreSQL
    if ! docker ps --filter "name=pmdl_postgres" --filter "status=running" --format '{{.Names}}' | grep -q "pmdl_postgres"; then
        log_warn "PostgreSQL (pmdl_postgres) is not running"
        log_warn "Mastodon requires PostgreSQL - start it first"
        ((warnings++))
    else
        log_success "PostgreSQL is running"
    fi

    # Check Redis
    if ! docker ps --filter "name=pmdl_redis" --filter "status=running" --format '{{.Names}}' | grep -q "pmdl_redis"; then
        log_warn "Redis (pmdl_redis) is not running"
        log_warn "Mastodon requires Redis - start it first"
        ((warnings++))
    else
        log_success "Redis is running"
    fi

    # Check networks
    local required_networks=("pmdl_db-internal" "pmdl_app-internal" "pmdl_proxy-external")
    for network in "${required_networks[@]}"; do
        if ! docker network inspect "$network" &> /dev/null; then
            log_warn "Network ${network} does not exist"
            ((warnings++))
        fi
    done

    if [[ $warnings -gt 0 ]]; then
        log_warn "Some dependencies are not available (${warnings} warning(s))"
        log_warn "Services may fail to start or connect"
    fi

    return 0
}

# ==============================================================
# Start Services
# ==============================================================

start_opensearch() {
    log "Starting OpenSearch..."

    cd "$MODULE_DIR"

    if docker compose up -d opensearch; then
        log_success "OpenSearch container started"
    else
        log_error "Failed to start OpenSearch"
        return 1
    fi

    # Wait for OpenSearch to be healthy
    log_info "Waiting for OpenSearch to be ready..."
    local max_wait=120
    local wait_count=0

    while [[ $wait_count -lt $max_wait ]]; do
        if docker compose exec -T opensearch curl -s http://localhost:9200/_cluster/health 2>/dev/null | grep -q '"status":"green\|yellow"'; then
            log_success "OpenSearch is healthy"
            return 0
        fi
        sleep 2
        ((wait_count+=2))
        if [[ $((wait_count % 20)) -eq 0 ]]; then
            log_info "Still waiting for OpenSearch... (${wait_count}s)"
        fi
    done

    log_warn "OpenSearch health check timed out - continuing anyway"
    return 0
}

start_mastodon_services() {
    log "Starting Mastodon services..."

    cd "$MODULE_DIR"

    # Pull latest images if needed
    log_info "Checking for image updates..."
    docker compose pull --quiet 2>/dev/null || true

    # Start all services
    if docker compose up -d; then
        log_success "Mastodon services started"
        return 0
    else
        log_error "Failed to start Mastodon services"
        return 1
    fi
}

wait_for_healthy() {
    log "Waiting for services to be healthy..."

    local services=("pmdl_mastodon_web" "pmdl_mastodon_streaming" "pmdl_mastodon_sidekiq")
    local max_wait=120
    local all_healthy=false

    for service in "${services[@]}"; do
        log_info "Checking ${service}..."
        local wait_count=0

        while [[ $wait_count -lt $max_wait ]]; do
            local status
            status=$(docker inspect --format='{{.State.Health.Status}}' "$service" 2>/dev/null || echo "not_found")

            case "$status" in
                "healthy")
                    log_success "${service} is healthy"
                    break
                    ;;
                "not_found"|"")
                    # No health check defined - check if running
                    if docker ps --filter "name=${service}" --filter "status=running" --format '{{.Names}}' | grep -q "$service"; then
                        log_success "${service} is running"
                        break
                    fi
                    ;;
                "starting")
                    # Still starting - continue waiting
                    ;;
                "unhealthy")
                    log_warn "${service} is unhealthy - check logs"
                    break
                    ;;
            esac

            sleep 2
            ((wait_count+=2))

            if [[ $((wait_count % 20)) -eq 0 ]]; then
                log_info "Still waiting for ${service}... (${wait_count}s)"
            fi
        done

        if [[ $wait_count -ge $max_wait ]]; then
            log_warn "${service} did not become healthy within ${max_wait}s"
        fi
    done

    return 0
}

show_status() {
    log ""
    log "========================================"
    log "Service Status"
    log "========================================"

    cd "$MODULE_DIR"

    docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
        docker compose ps

    log ""
    log "Instance URL: https://${MASTODON_LOCAL_DOMAIN:-your-domain}"
    log ""
    log "Useful commands:"
    log "  View logs:     docker compose -f ${COMPOSE_FILE} logs -f"
    log "  Web logs:      docker logs -f pmdl_mastodon_web"
    log "  Sidekiq logs:  docker logs -f pmdl_mastodon_sidekiq"
    log ""
    log "Admin commands (run in mastodon-web container):"
    log "  Create admin:  tootctl accounts create admin --email=you@example.com --confirmed --role=Owner"
    log "  List users:    tootctl accounts list"
    log "  Reindex:       tootctl search deploy"
    log ""
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Starting Mastodon Module"
    log "========================================"

    # Pre-checks
    check_compose_file || exit 1
    check_env_file || exit 1
    check_dependencies

    # Start services in order
    start_opensearch || log_warn "OpenSearch may not be ready"
    start_mastodon_services || exit 1
    wait_for_healthy

    show_status

    log "========================================"
    log_success "Mastodon module started successfully"
    log "========================================"

    exit 0
}

main "$@"
