#!/bin/bash
# ==============================================================
# Deployment Helper Script
# ==============================================================
# Orchestrates the complete deployment workflow:
# 1. Validates configuration
# 2. Generates missing secrets
# 3. Initializes volumes
# 4. Starts services
# 5. Monitors health
#
# Usage:
#   ./scripts/deploy.sh              # Full deployment
#   ./scripts/deploy.sh --validate   # Validate only
#   ./scripts/deploy.sh --profiles   # Show active profiles
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
VALIDATE_ONLY=false
SHOW_PROFILES=false
COMPOSE_FILES=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --validate|-v)
            VALIDATE_ONLY=true
            shift
            ;;
        --profiles|-p)
            SHOW_PROFILES=true
            shift
            ;;
        -f)
            COMPOSE_FILES="$COMPOSE_FILES -f $2"
            shift 2
            ;;
        *)
            log_error "Unknown option: $1"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --validate, -v    Validate configuration only"
            echo "  --profiles, -p    Show active profiles"
            echo "  -f FILE           Include additional compose file"
            exit 1
            ;;
    esac
done

# ==============================================================
# Step 1: Check prerequisites
# ==============================================================
check_prerequisites() {
    log_info "Checking prerequisites..."

    local errors=0

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        ((errors++))
    else
        log_ok "Docker installed"
    fi

    # Check Docker Compose v2
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose v2 is not installed"
        ((errors++))
    else
        log_ok "Docker Compose v2 installed"
    fi

    # Check .env file
    if [ ! -f ".env" ]; then
        log_warn ".env file not found - copying from .env.example"
        cp .env.example .env
    else
        log_ok ".env file exists"
    fi

    # Check secrets directory
    if [ ! -d "secrets" ]; then
        log_warn "secrets/ directory not found - will be created"
    else
        log_ok "secrets/ directory exists"
    fi

    return $errors
}

# ==============================================================
# Step 2: Validate configuration
# ==============================================================
validate_config() {
    log_info "Validating configuration..."

    local errors=0

    # Source .env
    set -a
    source .env
    set +a

    # Check DOMAIN
    if [ "${DOMAIN:-}" = "example.com" ] || [ -z "${DOMAIN:-}" ]; then
        log_error "DOMAIN not configured (still set to example.com)"
        ((errors++))
    else
        log_ok "DOMAIN=$DOMAIN"
    fi

    # Check ADMIN_EMAIL
    if [ "${ADMIN_EMAIL:-}" = "admin@example.com" ] || [ -z "${ADMIN_EMAIL:-}" ]; then
        log_warn "ADMIN_EMAIL not configured (using default)"
    else
        log_ok "ADMIN_EMAIL=$ADMIN_EMAIL"
    fi

    # Check COMPOSE_PROFILES
    if [ -z "${COMPOSE_PROFILES:-}" ]; then
        log_warn "COMPOSE_PROFILES is empty - only foundation will start"
    else
        log_ok "COMPOSE_PROFILES=$COMPOSE_PROFILES"
    fi

    return $errors
}

# ==============================================================
# Step 3: Generate secrets
# ==============================================================
generate_secrets() {
    log_info "Checking secrets..."

    if [ -x "$SCRIPT_DIR/generate-secrets.sh" ]; then
        "$SCRIPT_DIR/generate-secrets.sh"
    else
        log_error "generate-secrets.sh not found or not executable"
        return 1
    fi
}

# ==============================================================
# Step 4: Initialize volumes
# ==============================================================
init_volumes() {
    log_info "Initializing volumes..."

    if [ -x "$SCRIPT_DIR/init-volumes.sh" ]; then
        "$SCRIPT_DIR/init-volumes.sh"
    else
        log_warn "init-volumes.sh not found - skipping volume initialization"
    fi
}

# ==============================================================
# Step 5: Start services
# ==============================================================
start_services() {
    log_info "Starting services..."

    local compose_cmd="docker compose"

    # Add compose files if specified
    if [ -n "$COMPOSE_FILES" ]; then
        compose_cmd="$compose_cmd $COMPOSE_FILES"
    fi

    # Pull latest images
    log_info "Pulling latest images..."
    $compose_cmd pull

    # Start services
    log_info "Starting containers..."
    $compose_cmd up -d

    log_ok "Services started"
}

# ==============================================================
# Step 6: Monitor health
# ==============================================================
monitor_health() {
    log_info "Monitoring service health (30s timeout)..."

    local timeout=30
    local elapsed=0
    local interval=5

    while [ $elapsed -lt $timeout ]; do
        sleep $interval
        ((elapsed+=interval))

        # Count container states
        local total=$(docker compose ps --format json 2>/dev/null | wc -l)
        local healthy=$(docker compose ps --format json 2>/dev/null | grep -c '"healthy"' || true)
        local unhealthy=$(docker compose ps --format json 2>/dev/null | grep -c '"unhealthy"' || true)

        if [ "$unhealthy" -eq 0 ] && [ "$healthy" -gt 0 ]; then
            log_ok "All services healthy ($healthy containers)"
            return 0
        fi

        log_info "Waiting for services... ($elapsed/${timeout}s) - healthy: $healthy, unhealthy: $unhealthy"
    done

    log_warn "Some services may still be starting - check with: docker compose ps"
}

# ==============================================================
# Main execution
# ==============================================================
main() {
    echo ""
    echo "=========================================="
    echo "  Peer Mesh Docker Lab - Deployment"
    echo "=========================================="
    echo ""

    # Show profiles mode
    if [ "$SHOW_PROFILES" = true ]; then
        if [ -f ".env" ]; then
            source .env
            echo "Active profiles: ${COMPOSE_PROFILES:-none}"
        else
            echo "No .env file found"
        fi
        exit 0
    fi

    # Run checks
    check_prerequisites || exit 1
    echo ""

    validate_config
    local config_errors=$?
    echo ""

    # Validate only mode
    if [ "$VALIDATE_ONLY" = true ]; then
        if [ $config_errors -gt 0 ]; then
            log_error "Validation failed with $config_errors errors"
            exit 1
        else
            log_ok "Validation passed"
            exit 0
        fi
    fi

    # Full deployment
    generate_secrets
    echo ""

    init_volumes
    echo ""

    start_services
    echo ""

    monitor_health
    echo ""

    echo "=========================================="
    echo "  Deployment Complete"
    echo "=========================================="
    echo ""
    docker compose ps
}

main "$@"
