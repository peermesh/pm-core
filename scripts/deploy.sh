#!/usr/bin/env bash
# ==============================================================
# Deployment Helper Script
# ==============================================================
# Orchestrates the complete deployment workflow:
# 1. Validates prerequisites and configuration
# 2. Validates required secrets for active profiles
# 3. Pre-creates containers/volumes
# 4. Initializes non-root volume ownership
# 5. Starts services and monitors health
#
# Usage:
#   ./scripts/deploy.sh
#   ./scripts/deploy.sh --validate
#   ./scripts/deploy.sh --profiles
#   ./scripts/deploy.sh -f docker-compose.dc.yml
# ============================================================== 

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

VALIDATE_ONLY=false
SHOW_PROFILES_ONLY=false
PROFILES_OVERRIDE=""
WAIT_SECONDS=180
COMPOSE_ARGS=()

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --validate, -v          Validate configuration and secrets only
  --profiles, -p          Show active profiles and exit
  --set-profiles LIST     Override COMPOSE_PROFILES for this run
  -f FILE                 Include additional compose file (repeatable)
  --wait-seconds N        Health wait timeout (default: 180)
  --help, -h              Show this help
USAGE
}

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

show_active_profiles() {
    local profiles="${COMPOSE_PROFILES:-}"
    if [[ -z "$profiles" ]]; then
        echo "none (foundation-only)"
    else
        echo "$profiles"
    fi
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

    if [[ ! -x "$SCRIPT_DIR/generate-secrets.sh" ]]; then
        log_error "Missing executable: scripts/generate-secrets.sh"
        failed=1
    fi

    if [[ ! -x "$SCRIPT_DIR/init-volumes.sh" ]]; then
        log_warn "scripts/init-volumes.sh missing or not executable"
    fi

    return $failed
}

validate_compose_config() {
    log_info "Validating compose configuration..."
    if docker compose "${COMPOSE_ARGS[@]}" config -q; then
        log_ok "docker compose config is valid"
        return 0
    fi

    log_error "docker compose config validation failed"
    return 1
}

validate_configuration() {
    local failed=0

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

    if ! "$SCRIPT_DIR/generate-secrets.sh" --validate; then
        failed=1
    fi

    if ! validate_compose_config; then
        failed=1
    fi

    return $failed
}

prepare_volumes() {
    log_info "Pre-creating containers/volumes (no start)..."
    docker compose "${COMPOSE_ARGS[@]}" up -d --no-start

    if [[ -x "$SCRIPT_DIR/init-volumes.sh" ]]; then
        "$SCRIPT_DIR/init-volumes.sh"
    else
        log_warn "Skipping volume ownership initialization"
    fi
}

start_services() {
    log_info "Pulling latest images..."
    docker compose "${COMPOSE_ARGS[@]}" pull

    log_info "Starting services..."
    docker compose "${COMPOSE_ARGS[@]}" up -d

    log_ok "Services started"
}

monitor_health() {
    local timeout="$WAIT_SECONDS"
    local interval=5
    local elapsed=0

    log_info "Waiting for healthy services (${timeout}s timeout)..."

    while [[ $elapsed -lt $timeout ]]; do
        sleep "$interval"
        elapsed=$((elapsed + interval))

        local total unhealthy healthy
        total=$(docker compose "${COMPOSE_ARGS[@]}" ps --format json 2>/dev/null | wc -l | tr -d ' ')
        unhealthy=$(docker compose "${COMPOSE_ARGS[@]}" ps --format json 2>/dev/null | grep -c '"unhealthy"' || true)
        healthy=$(docker compose "${COMPOSE_ARGS[@]}" ps --format json 2>/dev/null | grep -c '"healthy"' || true)

        if [[ "$total" -gt 0 && "$unhealthy" -eq 0 && "$healthy" -gt 0 ]]; then
            log_ok "Health checks passed (${healthy}/${total} healthy)"
            return 0
        fi

        log_info "Health wait ${elapsed}s/${timeout}s (healthy=${healthy}, unhealthy=${unhealthy}, total=${total})"
    done

    log_warn "Timeout reached before all services reported healthy"
    return 1
}

main() {
    echo ""
    echo "=========================================="
    echo "  Peer Mesh Docker Lab - Deployment"
    echo "=========================================="
    echo ""

    check_prerequisites || exit 1
    load_env || exit 1

    if [[ "$SHOW_PROFILES_ONLY" == true ]]; then
        echo "Active profiles: $(show_active_profiles)"
        exit 0
    fi

    if ! validate_configuration; then
        log_error "Validation failed"
        exit 1
    fi

    if [[ "$VALIDATE_ONLY" == true ]]; then
        log_ok "Validation passed"
        exit 0
    fi

    prepare_volumes
    start_services

    if ! monitor_health; then
        log_warn "Run 'docker compose ${COMPOSE_ARGS[*]} ps' and inspect unhealthy services"
    fi

    echo ""
    echo "=========================================="
    echo "  Deployment Complete"
    echo "=========================================="
    echo ""

    docker compose "${COMPOSE_ARGS[@]}" ps
}

main "$@"
