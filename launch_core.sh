#!/usr/bin/env bash
# ==============================================================
# PeerMesh Core - Unified Deployment CLI
# Previously: launch_peermesh.sh
# ==============================================================
# Single entry point for all deployment operations.
#
# Usage:
#   ./launch_core.sh                    # Interactive menu
#   ./launch_core.sh [command] [args]   # Direct command
#   ./launch_core.sh --help             # Show help
#
# Commands:
#   status   - Show deployment status
#   up       - Start services
#   down     - Stop services
#   deploy   - Deploy to target
#   sync     - Trigger sync on remote
#   logs     - View service logs
#   health   - Run health checks
#   backup   - Run backup operations
#   module   - Module management
#   config   - Configuration management
#   env      - Switch environment (local/staging/production)
#   check-updates - Check for upstream Core updates
#
# Documentation: docs/cli.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

readonly SCRIPT_NAME="launch_core.sh"
readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration file paths (in order of precedence)
readonly CONFIG_PATHS=(
    "$SCRIPT_DIR/.peermesh.yml"
    "$SCRIPT_DIR/config/targets.yml"
    "$HOME/.config/peermesh/targets.yml"
)

# ==============================================================
# Colors and Formatting
# ==============================================================

# Check if terminal supports colors
if [[ -t 1 ]] && command -v tput &>/dev/null; then
    readonly RED=$(tput setaf 1)
    readonly GREEN=$(tput setaf 2)
    readonly YELLOW=$(tput setaf 3)
    readonly BLUE=$(tput setaf 4)
    readonly MAGENTA=$(tput setaf 5)
    readonly CYAN=$(tput setaf 6)
    readonly WHITE=$(tput setaf 7)
    readonly BOLD=$(tput bold)
    readonly DIM=$(tput dim)
    readonly NC=$(tput sgr0)
else
    readonly RED=''
    readonly GREEN=''
    readonly YELLOW=''
    readonly BLUE=''
    readonly MAGENTA=''
    readonly CYAN=''
    readonly WHITE=''
    readonly BOLD=''
    readonly DIM=''
    readonly NC=''
fi

# ==============================================================
# Logging Functions
# ==============================================================

log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_debug()   { [[ "${DEBUG:-false}" == "true" ]] && echo -e "${DIM}[DEBUG]${NC} $*" || true; }

# Header with box drawing
print_header() {
    local title="$1"
    local width=50
    echo ""
    echo "${BOLD}${CYAN}$(printf '=%.0s' $(seq 1 $width))${NC}"
    printf "${BOLD}${CYAN}  %s${NC}\n" "$title"
    echo "${BOLD}${CYAN}$(printf '=%.0s' $(seq 1 $width))${NC}"
    echo ""
}

# ==============================================================
# Utility Functions
# ==============================================================

# Check if command exists
cmd_exists() {
    command -v "$1" &>/dev/null
}

# Check prerequisites
check_prerequisites() {
    local errors=0

    if ! cmd_exists docker; then
        log_error "Docker is not installed"
        ((errors++)) || true
    fi

    if ! docker compose version &>/dev/null 2>&1; then
        log_error "Docker Compose v2 is not installed"
        ((errors++)) || true
    fi

    return $errors
}

# Get project directory (where docker-compose.yml lives)
get_project_dir() {
    echo "$SCRIPT_DIR"
}

# Load environment
load_env() {
    local project_dir
    project_dir="$(get_project_dir)"

    if [[ -f "$project_dir/.env" ]]; then
        set -a
        # shellcheck disable=SC1091
        source "$project_dir/.env"
        set +a
    fi
}

# Get available profiles from docker-compose.yml and profile directories
get_available_profiles() {
    local project_dir
    project_dir="$(get_project_dir)"
    local profiles=()

    # Extract profiles from main docker-compose.yml
    if [[ -f "$project_dir/docker-compose.yml" ]]; then
        while IFS= read -r profile; do
            profiles+=("$profile")
        done < <(grep -E '^\s+- (postgresql|mysql|mongodb|redis|minio|monitoring|backup|dev|webhook|identity)$' "$project_dir/docker-compose.yml" 2>/dev/null | sed 's/.*- //' | sort -u || true)
    fi

    # Add profiles from profiles/ directory
    if [[ -d "$project_dir/profiles" ]]; then
        for dir in "$project_dir/profiles"/*/; do
            local profile_name
            profile_name=$(basename "$dir")
            if [[ "$profile_name" != "_template" ]] && [[ ! " ${profiles[*]} " =~ " ${profile_name} " ]]; then
                profiles+=("$profile_name")
            fi
        done
    fi

    printf '%s\n' "${profiles[@]}" | sort -u
}

# Get installed modules
get_installed_modules() {
    local project_dir
    project_dir="$(get_project_dir)"

    if [[ -d "$project_dir/modules" ]]; then
        for dir in "$project_dir/modules"/*/; do
            local module_name
            module_name=$(basename "$dir")
            if [[ -f "$dir/docker-compose.yml" ]] || [[ -f "$dir/module.yml" ]]; then
                echo "$module_name"
            fi
        done
    fi
}

# Get running services
get_running_services() {
    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"
    docker compose ps --format '{{.Name}}' 2>/dev/null || true
}

# Parse YAML value (simple parser for key: value)
yaml_get() {
    local file="$1"
    local key="$2"

    if [[ -f "$file" ]] && cmd_exists grep; then
        grep -E "^${key}:" "$file" 2>/dev/null | sed "s/^${key}:[[:space:]]*//" | tr -d '"' || true
    fi
}

# Load target configuration
load_target_config() {
    local target="$1"
    local config_file=""

    # Find config file
    for path in "${CONFIG_PATHS[@]}"; do
        if [[ -f "$path" ]]; then
            config_file="$path"
            break
        fi
    done

    if [[ -z "$config_file" ]]; then
        return 1
    fi

    # Export target settings
    # This is a simple YAML parser - for complex configs, consider yq
    export TARGET_NAME="$target"
    export TARGET_HOST=""
    export TARGET_PORT=""
    export TARGET_TOKEN=""
    export TARGET_PROFILES=""

    log_debug "Loading target '$target' from $config_file"

    return 0
}

# ==============================================================
# Status Command
# ==============================================================

cmd_status() {
    print_header "PeerMesh Core - Status"

    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"

    load_env

    # Environment info
    echo "${BOLD}Environment:${NC}"
    echo "  Domain:   ${DOMAIN:-not set}"
    echo "  Profiles: ${COMPOSE_PROFILES:-none}"
    echo ""

    # Docker info
    echo "${BOLD}Docker:${NC}"
    if docker info &>/dev/null 2>&1; then
        echo "  Status: ${GREEN}Running${NC}"
        local containers_running
        containers_running=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')
        echo "  Containers: $containers_running running"
    else
        echo "  Status: ${RED}Not running${NC}"
    fi
    echo ""

    # Services
    echo "${BOLD}Services:${NC}"
    if docker compose ps --format '{{.Name}}\t{{.Status}}' 2>/dev/null | head -20; then
        :
    else
        echo "  No services running"
    fi
    echo ""

    # Networks
    echo "${BOLD}Networks:${NC}"
    docker network ls --filter "name=pmdl_" --format "  {{.Name}}" 2>/dev/null || echo "  No project networks"
    echo ""

    # Volumes
    echo "${BOLD}Volumes:${NC}"
    docker volume ls --filter "name=pmdl_" --format "  {{.Name}}" 2>/dev/null || echo "  No project volumes"
}

# ==============================================================
# Up Command
# ==============================================================

cmd_up() {
    local profiles=()
    local detach=true
    local build=false
    local wait_healthy=false
    local compose_files=()

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --profile=*|--profiles=*)
                IFS=',' read -ra ADDR <<< "${1#*=}"
                profiles+=("${ADDR[@]}")
                shift
                ;;
            -p)
                IFS=',' read -ra ADDR <<< "$2"
                profiles+=("${ADDR[@]}")
                shift 2
                ;;
            --build)
                build=true
                shift
                ;;
            --wait)
                wait_healthy=true
                shift
                ;;
            --no-detach)
                detach=false
                shift
                ;;
            -f)
                compose_files+=("-f" "$2")
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Usage: $SCRIPT_NAME up [--profile=NAME,...] [--build] [--wait]"
                return 1
                ;;
        esac
    done

    print_header "Starting Services"

    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"

    load_env

    # Set profiles
    if [[ ${#profiles[@]} -gt 0 ]]; then
        export COMPOSE_PROFILES
        COMPOSE_PROFILES=$(IFS=','; echo "${profiles[*]}")
        log_info "Profiles: $COMPOSE_PROFILES"
    elif [[ -n "${COMPOSE_PROFILES:-}" ]]; then
        log_info "Using profiles from .env: $COMPOSE_PROFILES"
    fi

    # Build compose command
    local compose_cmd="docker compose"

    if [[ ${#compose_files[@]} -gt 0 ]]; then
        compose_cmd="$compose_cmd ${compose_files[*]}"
    fi

    # Pull images
    log_info "Pulling images..."
    $compose_cmd pull --quiet 2>/dev/null || true

    # Build if requested
    if [[ "$build" == true ]]; then
        log_info "Building images..."
        $compose_cmd build
    fi

    # Start services
    log_info "Starting containers..."
    local up_args=()
    [[ "$detach" == true ]] && up_args+=("-d")
    [[ "$wait_healthy" == true ]] && up_args+=("--wait")

    $compose_cmd up "${up_args[@]}"

    log_success "Services started"

    # Show running services
    echo ""
    $compose_cmd ps
}

# ==============================================================
# Down Command
# ==============================================================

cmd_down() {
    local remove_volumes=false
    local remove_orphans=true
    local timeout=10

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--volumes)
                remove_volumes=true
                shift
                ;;
            --timeout=*)
                timeout="${1#*=}"
                shift
                ;;
            --keep-orphans)
                remove_orphans=false
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Usage: $SCRIPT_NAME down [-v|--volumes] [--timeout=N]"
                return 1
                ;;
        esac
    done

    print_header "Stopping Services"

    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"

    load_env

    local down_args=("--timeout" "$timeout")
    [[ "$remove_volumes" == true ]] && down_args+=("-v")
    [[ "$remove_orphans" == true ]] && down_args+=("--remove-orphans")

    log_info "Stopping containers..."
    docker compose down "${down_args[@]}"

    log_success "Services stopped"
}

# ==============================================================
# Deploy Command
# ==============================================================

cmd_deploy() {
    local target="local"
    local skip_backup=false
    local profiles=()

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --target=*)
                target="${1#*=}"
                shift
                ;;
            -t)
                target="$2"
                shift 2
                ;;
            --skip-backup)
                skip_backup=true
                shift
                ;;
            --profile=*|--profiles=*)
                IFS=',' read -ra ADDR <<< "${1#*=}"
                profiles+=("${ADDR[@]}")
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Usage: $SCRIPT_NAME deploy [--target=local|staging|prod] [--skip-backup]"
                return 1
                ;;
        esac
    done

    print_header "Deploying to: $target"

    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"

    load_env

    case "$target" in
        local)
            log_info "Deploying locally..."

            # Run existing deploy script if available
            if [[ -x "$project_dir/scripts/deploy.sh" ]]; then
                "$project_dir/scripts/deploy.sh"
            else
                # Manual deployment steps
                cmd_up "${profiles[@]/#/--profile=}"
            fi
            ;;

        staging|production|prod)
            log_info "Deploying to remote target: $target"

            # Load target configuration
            if ! load_target_config "$target"; then
                log_error "Target configuration not found. Create config/targets.yml"
                return 1
            fi

            # Trigger webhook-based deployment
            cmd_sync --target="$target"
            ;;

        *)
            log_error "Unknown target: $target"
            echo "Available targets: local, staging, production"
            return 1
            ;;
    esac

    log_success "Deployment complete"
}

# ==============================================================
# Sync Command
# ==============================================================

cmd_sync() {
    local target=""
    local webhook_url=""
    local webhook_secret=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --target=*)
                target="${1#*=}"
                shift
                ;;
            -t)
                target="$2"
                shift 2
                ;;
            --url=*)
                webhook_url="${1#*=}"
                shift
                ;;
            --secret=*)
                webhook_secret="${1#*=}"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Usage: $SCRIPT_NAME sync --target=NAME [--url=URL] [--secret=TOKEN]"
                return 1
                ;;
        esac
    done

    if [[ -z "$target" ]] && [[ -z "$webhook_url" ]]; then
        log_error "Target or URL required"
        echo "Usage: $SCRIPT_NAME sync --target=NAME"
        return 1
    fi

    print_header "Triggering Sync: ${target:-$webhook_url}"

    local project_dir
    project_dir="$(get_project_dir)"
    load_env

    # Load from config if target specified
    if [[ -n "$target" ]]; then
        # Try to find config
        local config_file=""
        for path in "${CONFIG_PATHS[@]}"; do
            if [[ -f "$path" ]]; then
                config_file="$path"
                break
            fi
        done

        if [[ -z "$config_file" ]]; then
            log_error "No configuration file found"
            log_info "Create one of: ${CONFIG_PATHS[*]}"
            return 1
        fi

        # Simple config parsing (for complex YAML, use yq)
        # Look for target.host, target.webhook_url, etc.
        log_warn "Remote sync requires webhook configuration in $config_file"
        log_info "Example webhook trigger:"
        echo ""
        echo "  curl -X POST https://webhook.example.com/hooks/deploy \\"
        echo "       -H 'X-Webhook-Token: YOUR_SECRET'"
        echo ""
        return 0
    fi

    # Direct webhook call if URL provided
    if [[ -n "$webhook_url" ]]; then
        log_info "Triggering webhook..."

        local curl_args=("-X" "POST" "-s" "-w" "%{http_code}")

        if [[ -n "$webhook_secret" ]]; then
            curl_args+=("-H" "X-Webhook-Token: $webhook_secret")
        fi

        local response
        response=$(curl "${curl_args[@]}" "$webhook_url" 2>/dev/null || echo "000")

        if [[ "$response" == "200" ]] || [[ "$response" == "202" ]]; then
            log_success "Sync triggered successfully"
        else
            log_error "Sync failed with HTTP $response"
            return 1
        fi
    fi
}

# ==============================================================
# Logs Command
# ==============================================================

cmd_logs() {
    local service=""
    local follow=false
    local tail=100
    local timestamps=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--follow)
                follow=true
                shift
                ;;
            -n|--tail)
                tail="$2"
                shift 2
                ;;
            --tail=*)
                tail="${1#*=}"
                shift
                ;;
            -t|--timestamps)
                timestamps=true
                shift
                ;;
            -*)
                log_error "Unknown option: $1"
                echo "Usage: $SCRIPT_NAME logs [SERVICE] [-f] [-n LINES]"
                return 1
                ;;
            *)
                service="$1"
                shift
                ;;
        esac
    done

    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"

    load_env

    local logs_args=("--tail" "$tail")
    [[ "$follow" == true ]] && logs_args+=("-f")
    [[ "$timestamps" == true ]] && logs_args+=("-t")

    if [[ -n "$service" ]]; then
        docker compose logs "${logs_args[@]}" "$service"
    else
        docker compose logs "${logs_args[@]}"
    fi
}

# ==============================================================
# Health Command
# ==============================================================

cmd_health() {
    local verbose=false
    local service=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                verbose=true
                shift
                ;;
            -*)
                log_error "Unknown option: $1"
                echo "Usage: $SCRIPT_NAME health [-v] [SERVICE]"
                return 1
                ;;
            *)
                service="$1"
                shift
                ;;
        esac
    done

    print_header "Health Check"

    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"

    load_env

    local healthy=0
    local unhealthy=0
    local starting=0
    local no_check=0

    echo "${BOLD}Service Health Status:${NC}"
    echo ""

    # Get container health info
    while IFS=$'\t' read -r name status health; do
        local icon=""
        local color=""

        case "$health" in
            healthy)
                icon="[OK]"
                color="$GREEN"
                ((healthy++)) || true
                ;;
            unhealthy)
                icon="[FAIL]"
                color="$RED"
                ((unhealthy++)) || true
                ;;
            starting)
                icon="[...]"
                color="$YELLOW"
                ((starting++)) || true
                ;;
            *)
                icon="[--]"
                color="$DIM"
                ((no_check++)) || true
                ;;
        esac

        if [[ -z "$service" ]] || [[ "$name" == *"$service"* ]]; then
            printf "  ${color}%-8s${NC} %-30s %s\n" "$icon" "$name" "$status"
        fi
    done < <(docker compose ps --format '{{.Name}}\t{{.Status}}\t{{.Health}}' 2>/dev/null || echo "")

    echo ""
    echo "${BOLD}Summary:${NC}"
    echo "  Healthy:   $healthy"
    echo "  Unhealthy: $unhealthy"
    echo "  Starting:  $starting"
    echo "  No check:  $no_check"

    # Verbose: check endpoints
    if [[ "$verbose" == true ]]; then
        echo ""
        echo "${BOLD}Endpoint Checks:${NC}"

        # check traefik ping from inside container for deterministic local health
        if docker compose exec -T traefik wget --no-verbose --tries=1 --spider "http://localhost:8080/ping" &>/dev/null; then
            echo "  ${GREEN}[OK]${NC} Traefik API"
        else
            echo "  ${RED}[FAIL]${NC} Traefik API"
        fi

        # check dashboard health directly in the dashboard container
        if docker compose exec -T dashboard wget --no-verbose --tries=1 --spider "http://localhost:8080/health" &>/dev/null 2>&1; then
            echo "  ${GREEN}[OK]${NC} Dashboard"
        else
            echo "  ${RED}[FAIL]${NC} Dashboard"
        fi
    fi

    # Return exit code based on health
    [[ $unhealthy -eq 0 ]] && return 0 || return 1
}

# ==============================================================
# Backup Command
# ==============================================================

cmd_backup() {
    local action="run"
    local target="all"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            run|status|list|restore)
                action="$1"
                shift
                ;;
            --target=*)
                target="${1#*=}"
                shift
                ;;
            postgres|volumes|all)
                target="$1"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Usage: $SCRIPT_NAME backup [run|status|list] [--target=postgres|volumes|all]"
                return 1
                ;;
        esac
    done

    print_header "Backup Management"

    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"

    load_env

    case "$action" in
        run)
            log_info "Running backup for: $target"

            case "$target" in
                postgres|all)
                    if [[ -x "$project_dir/scripts/backup/backup-postgres.sh" ]]; then
                        log_info "Backing up PostgreSQL..."
                        "$project_dir/scripts/backup/backup-postgres.sh" all
                    else
                        # Try via container
                        if docker ps --format '{{.Names}}' | grep -q "pmdl_backup"; then
                            docker exec pmdl_backup /usr/local/bin/backup-postgres.sh all
                        else
                            log_warn "Backup container not running. Start with: ./launch_core.sh up --profile=backup"
                        fi
                    fi
                    ;;
            esac

            case "$target" in
                volumes|all)
                    if [[ -x "$project_dir/scripts/backup/backup-volumes.sh" ]]; then
                        log_info "Backing up volumes..."
                        "$project_dir/scripts/backup/backup-volumes.sh" backup --all
                    else
                        if docker ps --format '{{.Names}}' | grep -q "pmdl_backup"; then
                            docker exec pmdl_backup /usr/local/bin/backup-volumes.sh backup --all
                        fi
                    fi
                    ;;
            esac

            log_success "Backup complete"
            ;;

        status)
            log_info "Backup status:"

            # Check backup container
            if docker ps --format '{{.Names}}' | grep -q "pmdl_backup"; then
                echo "  Container: ${GREEN}Running${NC}"
            else
                echo "  Container: ${YELLOW}Not running${NC}"
            fi

            # Check last backup
            local backup_dir="${BACKUP_LOCAL_PATH:-/var/backups/pmdl}"
            if [[ -d "$backup_dir" ]]; then
                echo "  Backup dir: $backup_dir"

                local last_pg
                last_pg=$(find "$backup_dir/postgres" -name "*.sql.gz" -type f 2>/dev/null | head -1)
                if [[ -n "$last_pg" ]]; then
                    echo "  Last PostgreSQL: $(basename "$last_pg")"
                fi
            fi
            ;;

        list)
            local backup_dir="${BACKUP_LOCAL_PATH:-/var/backups/pmdl}"
            if [[ -d "$backup_dir" ]]; then
                echo "PostgreSQL backups:"
                find "$backup_dir/postgres" -name "*.sql.gz" -type f 2>/dev/null | sort -r | head -10 || echo "  None found"
                echo ""
                echo "Volume backups:"
                find "$backup_dir/volumes" -name "*.tar.gz" -type f 2>/dev/null | sort -r | head -10 || echo "  None found"
            else
                log_warn "Backup directory not found: $backup_dir"
            fi
            ;;

        restore)
            log_warn "Restore requires manual confirmation. Use the restore scripts directly:"
            echo ""
            echo "  PostgreSQL: ./scripts/backup/restore-postgres.sh <backup-file>"
            echo "  Volumes:    ./scripts/backup/backup-volumes.sh restore --volume=<name>"
            ;;
    esac
}

# ==============================================================
# Post-Deployment Security Gate (advisory, never blocks)
# ==============================================================

post_deploy_security_check() {
    local container_name="$1"
    local score=0
    local max=70

    # Check 1: cap_drop ALL (+10)
    if docker inspect "$container_name" --format '{{.HostConfig.CapDrop}}' 2>/dev/null | grep -q "ALL"; then
        score=$((score + 10))
    else
        log_warn "Security: $container_name missing cap_drop ALL"
    fi

    # Check 2: no-new-privileges (+10)
    if docker inspect "$container_name" --format '{{.HostConfig.SecurityOpt}}' 2>/dev/null | grep -q "no-new-privileges"; then
        score=$((score + 10))
    else
        log_warn "Security: $container_name missing no-new-privileges"
    fi

    # Check 3: resource limits (+10)
    local mem_limit
    mem_limit=$(docker inspect "$container_name" --format '{{.HostConfig.Memory}}' 2>/dev/null) || mem_limit="0"
    if [[ "$mem_limit" != "0" && -n "$mem_limit" ]]; then
        score=$((score + 10))
    else
        log_warn "Security: $container_name has no memory limit"
    fi

    # Check 4: healthcheck (+10)
    local hc
    hc=$(docker inspect "$container_name" --format '{{.Config.Healthcheck}}' 2>/dev/null) || hc=""
    if [[ "$hc" != "<nil>" && -n "$hc" ]]; then
        score=$((score + 10))
    else
        log_warn "Security: $container_name has no healthcheck"
    fi

    # Check 5: non-root user (+10)
    local user
    user=$(docker inspect "$container_name" --format '{{.Config.User}}' 2>/dev/null) || user=""
    if [[ -n "$user" && "$user" != "0" && "$user" != "root" ]]; then
        score=$((score + 10))
    fi

    # Check 6: read_only rootfs (+10)
    if docker inspect "$container_name" --format '{{.HostConfig.ReadonlyRootfs}}' 2>/dev/null | grep -q "true"; then
        score=$((score + 10))
    fi

    # Check 7: image digest pinned (+10)
    local image
    image=$(docker inspect "$container_name" --format '{{.Config.Image}}' 2>/dev/null) || image=""
    if echo "$image" | grep -q "@sha256:"; then
        score=$((score + 10))
    fi

    echo "  Security score: ${score}/${max}"
    if [[ $score -lt 30 ]]; then
        log_warn "Security score is LOW (${score}/${max}). Review container hardening."
    fi
}

# ==============================================================
# Module Command
# ==============================================================

cmd_module() {
    local action="${1:-list}"
    shift || true

    print_header "Module Management"

    local project_dir
    project_dir="$(get_project_dir)"
    cd "$project_dir"

    case "$action" in
        list|ls)
            echo "${BOLD}Installed Modules:${NC}"
            echo ""

            local modules
            modules=$(get_installed_modules)

            if [[ -z "$modules" ]]; then
                echo "  No modules installed"
            else
                while IFS= read -r module; do
                    local status="${DIM}available${NC}"

                    # Check if running
                    if docker compose -f "modules/$module/docker-compose.yml" ps --format '{{.Name}}' 2>/dev/null | grep -q .; then
                        status="${GREEN}running${NC}"
                    fi

                    printf "  %-20s %s\n" "$module" "$status"
                done <<< "$modules"
            fi

            echo ""
            echo "${BOLD}Available Profiles:${NC}"
            echo ""
            get_available_profiles | while read -r profile; do
                printf "  - %s\n" "$profile"
            done
            ;;

        enable|install)
            local module="${1:-}"
            local dry_run=false
            local resolver=""
            local resolver_modules_dir=""
            local module_order=()
            local dep_module=""
            if [[ -z "$module" ]]; then
                log_error "Module name required"
                echo "Usage: $SCRIPT_NAME module enable <name> [--dry-run]"
                return 1
            fi
            shift || true

            while [[ $# -gt 0 ]]; do
                case "$1" in
                    --dry-run)
                        dry_run=true
                        ;;
                    *)
                        log_error "Unknown option for module enable: $1"
                        echo "Usage: $SCRIPT_NAME module enable <name> [--dry-run]"
                        return 1
                        ;;
                esac
                shift
            done

            local module_dir="$project_dir/modules/$module"
            if [[ ! -d "$module_dir" ]]; then
                log_error "Module not found: $module"
                return 1
            fi

            # Validate module.json
            local manifest="$module_dir/module.json"
            if [[ -f "$manifest" ]]; then
                if ! jq empty "$manifest" 2>/dev/null; then
                    log_error "Invalid module.json for $module (malformed JSON)"
                    return 1
                fi
                log_debug "module.json validated for $module"
            else
                log_warn "No module.json found for $module — skipping manifest validation"
            fi

            # Propagate foundation DOMAIN to module .env if not already set
            load_env
            if [[ -n "${DOMAIN:-}" ]] && [[ "${DOMAIN}" != "example.com" ]]; then
                local mod_env="$module_dir/.env"
                if [[ -f "$mod_env" ]]; then
                    if ! grep -q "^DOMAIN=" "$mod_env" 2>/dev/null; then
                        echo "" >> "$mod_env"
                        echo "# Foundation variable (auto-propagated by module enable)" >> "$mod_env"
                        echo "DOMAIN=${DOMAIN}" >> "$mod_env"
                        log_info "Propagated DOMAIN=${DOMAIN} to module .env"
                    else
                        log_debug "DOMAIN already set in module .env"
                    fi
                elif [[ -f "$module_dir/.env.example" ]]; then
                    cp "$module_dir/.env.example" "$mod_env"
                    sed -i '' "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" "$mod_env" 2>/dev/null || \
                        sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" "$mod_env" 2>/dev/null || true
                    log_info "Created module .env from .env.example with DOMAIN=${DOMAIN}"
                fi
            fi

            resolver="$project_dir/foundation/lib/dependency-resolve.sh"
            resolver_modules_dir="$project_dir/modules"

            if [[ ! -x "$resolver" ]]; then
                log_error "Dependency resolver missing or not executable: $resolver"
                return 1
            fi

            if [[ "$dry_run" == true ]]; then
                log_info "Dependency dry-run for module: $module"
                "$resolver" "$module" --modules-dir "$resolver_modules_dir" --dry-run
                return $?
            fi

            if ! mapfile -t module_order < <("$resolver" "$module" --modules-dir "$resolver_modules_dir" --order-only); then
                log_error "Dependency resolution failed for module: $module"
                return 1
            fi

            if [[ ${#module_order[@]} -eq 0 ]]; then
                log_error "Dependency resolver returned empty module order for: $module"
                return 1
            fi

            log_info "Resolved enable order: ${module_order[*]}"

            # --- Connection resolution (after deps, before hooks) ---
            for dep_module in "${module_order[@]}"; do
                local dep_manifest="$project_dir/modules/$dep_module/module.json"
                if [[ -f "$dep_manifest" ]] && cmd_exists jq; then
                    local conn_count
                    conn_count=$(jq -r '.requires.connections // [] | length' "$dep_manifest" 2>/dev/null)
                    if [[ "$conn_count" -gt 0 ]]; then
                        log_info "Resolving connections for module: $dep_module"
                        local conn_resolver="$project_dir/foundation/lib/connection-resolve.sh"
                        if [[ -x "$conn_resolver" ]]; then
                            if ! MODULES_DIR="$project_dir/modules" "$conn_resolver" "$dep_module" --quiet; then
                                # Resolver failed — check which connections are required vs optional
                                local conn_result
                                conn_result=$(MODULES_DIR="$project_dir/modules" "$conn_resolver" "$dep_module" --json 2>/dev/null) || true
                                local has_required_fail=false
                                # Parse unresolved connections
                                local unresolved
                                unresolved=$(echo "$conn_result" | jq -c '.unresolved[]?' 2>/dev/null) || true
                                while IFS= read -r ur; do
                                    [[ -z "$ur" ]] && continue
                                    local ur_name ur_providers
                                    ur_name=$(echo "$ur" | jq -r '.requirement.name // .requirement.type' 2>/dev/null)
                                    ur_providers=$(echo "$ur" | jq -r '.requirement.providers | join(", ")' 2>/dev/null)
                                    # Fallback: check if provider is running as a Docker container (handles profiles)
                                    local ur_container_found=false
                                    for ur_prov in $(echo "$ur" | jq -r '.requirement.providers[]?' 2>/dev/null); do
                                        if docker ps --filter "name=pmdl_${ur_prov}" --format "{{.Names}}" 2>/dev/null | grep -q "${ur_prov}"; then
                                            log_success "Connection provider '${ur_prov}' found as running container (pmdl_${ur_prov})"
                                            ur_container_found=true
                                            break
                                        fi
                                    done
                                    if [[ "$ur_container_found" == "true" ]]; then
                                        continue
                                    fi
                                    # Check if this connection is required in the original manifest
                                    local ur_required
                                    ur_required=$(jq -r --arg name "$ur_name" \
                                        '.requires.connections[] | select(.name == $name or .type == $name or .alias == $name) | .required // true' \
                                        "$dep_manifest" 2>/dev/null)
                                    if [[ "$ur_required" == "false" ]]; then
                                        log_warn "Module $dep_module: optional connection '$ur_name' has no provider ($ur_providers) — continuing"
                                    else
                                        log_error "Module $dep_module requires a $ur_name provider ($ur_providers). Enable the appropriate profile first."
                                        has_required_fail=true
                                    fi
                                done <<< "$unresolved"
                                if [[ "$has_required_fail" == "true" ]]; then
                                    return 1
                                fi
                            else
                                log_success "All connections resolved for $dep_module"
                            fi
                        else
                            # No resolver script — fall back to inline jq check with container fallback
                            log_debug "Connection resolver not found at $conn_resolver — checking inline"
                            local conn_idx=0
                            while IFS= read -r conn; do
                                [[ -z "$conn" ]] && continue
                                local c_providers c_required c_alias c_provider_found
                                c_providers=$(echo "$conn" | jq -r '.providers | join(", ")')
                                c_required=$(echo "$conn" | jq -r '.required // true')
                                c_alias=$(echo "$conn" | jq -r '.alias // .type')
                                c_provider_found=false
                                # Fallback: check if provider is running as a Docker container (handles profiles)
                                for c_prov in $(echo "$conn" | jq -r '.providers[]?' 2>/dev/null); do
                                    if docker ps --filter "name=pmdl_${c_prov}" --format "{{.Names}}" 2>/dev/null | grep -q "${c_prov}"; then
                                        log_success "Connection provider '${c_prov}' found as running container (pmdl_${c_prov})"
                                        c_provider_found=true
                                        break
                                    fi
                                done
                                if [[ "$c_provider_found" == "false" ]]; then
                                    if [[ "$c_required" == "false" ]]; then
                                        log_warn "Module $dep_module: optional connection '$c_alias' ($c_providers) — no provider available"
                                    else
                                        log_warn "Module $dep_module: required connection '$c_alias' ($c_providers) — no provider check available (resolver missing)"
                                    fi
                                fi
                                ((conn_idx++)) || true
                            done < <(jq -c '.requires.connections[]' "$dep_manifest" 2>/dev/null)
                        fi
                    fi
                fi
            done

            for dep_module in "${module_order[@]}"; do
                local dep_module_dir="$project_dir/modules/$dep_module"
                local dep_hooks_dir="$dep_module_dir/hooks"

                log_info "Enabling module: $dep_module"

                # Run install hook (pre-flight checks, directory creation)
                if [[ -x "$dep_hooks_dir/install.sh" ]]; then
                    log_info "  Running install hook for $dep_module..."
                    if ! (cd "$dep_module_dir" && "$dep_hooks_dir/install.sh"); then
                        log_error "Install hook failed for module: $dep_module"
                        return 1
                    fi
                    log_success "  Install hook completed for $dep_module"
                fi

                # Run start hook (compose up + health-wait) or fall back to compose up
                if [[ -x "$dep_hooks_dir/start.sh" ]]; then
                    log_info "  Running start hook for $dep_module..."
                    if ! (cd "$dep_module_dir" && "$dep_hooks_dir/start.sh"); then
                        log_error "Start hook failed for module: $dep_module"
                        return 1
                    fi
                    log_success "  Start hook completed for $dep_module"
                elif [[ -f "$dep_module_dir/docker-compose.yml" ]]; then
                    log_info "  No start hook — running docker compose up for $dep_module..."
                    if ! docker compose -f "$dep_module_dir/docker-compose.yml" up -d; then
                        log_error "Docker compose up failed for module: $dep_module"
                        return 1
                    fi
                    log_success "  Compose up completed for $dep_module"
                else
                    log_error "No start hook or docker-compose.yml found in module: $dep_module"
                    return 1
                fi
                # Post-deployment security gate (advisory, non-blocking)
                local containers_for_gate
                containers_for_gate=$(docker compose -f "$dep_module_dir/docker-compose.yml" \
                    ps --format '{{.Names}}' 2>/dev/null) || containers_for_gate=""
                if [[ -n "$containers_for_gate" ]]; then
                    log_info "  Running post-deployment security checks for $dep_module..."
                    while IFS= read -r gate_container; do
                        [[ -z "$gate_container" ]] && continue
                        post_deploy_security_check "$gate_container" || true
                    done <<< "$containers_for_gate"
                fi
            done

            log_success "Module $module enabled (${#module_order[@]} module(s) in dependency order)"
            ;;

        disable|uninstall)
            local module="${1:-}"
            if [[ -z "$module" ]]; then
                log_error "Module name required"
                echo "Usage: $SCRIPT_NAME module disable <name>"
                return 1
            fi

            local module_dir="$project_dir/modules/$module"
            if [[ ! -d "$module_dir" ]]; then
                log_error "Module not found: $module"
                return 1
            fi

            local resolver="$project_dir/foundation/lib/dependency-resolve.sh"
            local resolver_modules_dir="$project_dir/modules"
            local module_order=()
            local reversed_order=()
            local dep_module=""

            if [[ -x "$resolver" ]]; then
                if ! mapfile -t module_order < <("$resolver" "$module" --modules-dir "$resolver_modules_dir" --order-only 2>/dev/null); then
                    log_warn "Dependency resolution failed — disabling $module only"
                    module_order=("$module")
                fi
            else
                log_warn "Dependency resolver not available — disabling $module only"
                module_order=("$module")
            fi

            # Reverse the topological order for teardown
            local i
            for ((i = ${#module_order[@]} - 1; i >= 0; i--)); do
                reversed_order+=("${module_order[$i]}")
            done

            log_info "Resolved disable order (reverse): ${reversed_order[*]}"

            for dep_module in "${reversed_order[@]}"; do
                local dep_module_dir="$project_dir/modules/$dep_module"
                local dep_hooks_dir="$dep_module_dir/hooks"

                log_info "Disabling module: $dep_module"

                # Run stop hook (graceful compose down) or fall back to compose down
                if [[ -x "$dep_hooks_dir/stop.sh" ]]; then
                    log_info "  Running stop hook for $dep_module..."
                    if ! (cd "$dep_module_dir" && "$dep_hooks_dir/stop.sh"); then
                        log_error "Stop hook failed for module: $dep_module"
                        return 1
                    fi
                    log_success "  Stop hook completed for $dep_module"
                elif [[ -f "$dep_module_dir/docker-compose.yml" ]]; then
                    log_info "  No stop hook — running docker compose down for $dep_module..."
                    if ! docker compose -f "$dep_module_dir/docker-compose.yml" down; then
                        log_error "Docker compose down failed for module: $dep_module"
                        return 1
                    fi
                    log_success "  Compose down completed for $dep_module"
                fi

                # Run uninstall hook (cleanup)
                if [[ -x "$dep_hooks_dir/uninstall.sh" ]]; then
                    log_info "  Running uninstall hook for $dep_module..."
                    if ! (cd "$dep_module_dir" && "$dep_hooks_dir/uninstall.sh"); then
                        log_error "Uninstall hook failed for module: $dep_module"
                        return 1
                    fi
                    log_success "  Uninstall hook completed for $dep_module"
                fi
            done

            log_success "Module $module disabled (${#reversed_order[@]} module(s) in reverse dependency order)"
            ;;

        status)
            local module="${1:-}"
            if [[ -z "$module" ]]; then
                log_error "Module name required"
                echo "Usage: $SCRIPT_NAME module status <name>"
                return 1
            fi

            local module_dir="$project_dir/modules/$module"
            if [[ -f "$module_dir/docker-compose.yml" ]]; then
                docker compose -f "$module_dir/docker-compose.yml" ps
            else
                log_error "Module not found: $module"
                return 1
            fi
            ;;

        health)
            local module="${1:-}"
            local overall_pass=0

            if [[ -n "$module" ]]; then
                # Health check for a specific module
                local module_dir="$project_dir/modules/$module"
                if [[ ! -d "$module_dir" ]]; then
                    log_error "Module not found: $module"
                    return 1
                fi

                local health_hook="$module_dir/hooks/health.sh"
                if [[ -x "$health_hook" ]]; then
                    log_info "Running health check for $module..."
                    if (cd "$module_dir" && "$health_hook"); then
                        log_success "Module $module: healthy"
                    else
                        local exit_code=$?
                        if [[ $exit_code -eq 2 ]]; then
                            log_warn "Module $module: degraded"
                        else
                            log_error "Module $module: unhealthy"
                        fi
                        overall_pass=1
                    fi
                else
                    log_warn "No health hook found for module: $module"
                    # Fall back to checking if compose services are running
                    if [[ -f "$module_dir/docker-compose.yml" ]]; then
                        if docker compose -f "$module_dir/docker-compose.yml" ps --format '{{.Name}}' 2>/dev/null | grep -q .; then
                            log_success "Module $module: running (no health hook)"
                        else
                            log_warn "Module $module: not running (no health hook)"
                            overall_pass=1
                        fi
                    fi
                fi
            else
                # Health check for all enabled modules (those with running containers)
                log_info "Running health checks for all enabled modules..."
                echo ""

                local found_any=false
                for mod_dir in "$project_dir/modules"/*/; do
                    local mod_name
                    mod_name=$(basename "$mod_dir")

                    # Skip modules that are not running
                    if [[ -f "$mod_dir/docker-compose.yml" ]]; then
                        if ! docker compose -f "$mod_dir/docker-compose.yml" ps --format '{{.Name}}' 2>/dev/null | grep -q .; then
                            continue
                        fi
                    else
                        continue
                    fi

                    found_any=true
                    local health_hook="$mod_dir/hooks/health.sh"
                    if [[ -x "$health_hook" ]]; then
                        if (cd "$mod_dir" && "$health_hook"); then
                            log_success "Module $mod_name: healthy"
                        else
                            local exit_code=$?
                            if [[ $exit_code -eq 2 ]]; then
                                log_warn "Module $mod_name: degraded"
                            else
                                log_error "Module $mod_name: unhealthy"
                            fi
                            overall_pass=1
                        fi
                    else
                        log_success "Module $mod_name: running (no health hook)"
                    fi
                done

                if [[ "$found_any" == false ]]; then
                    log_info "No enabled modules found"
                fi
            fi

            return $overall_pass
            ;;

        validate)
            local module="${1:-}"
            local errors=0
            local checked=0
            local schema="$project_dir/foundation/schemas/module.schema.json"

            _validate_module() {
                local mod_name="$1"
                local mod_dir="$project_dir/modules/$mod_name"
                local manifest="$mod_dir/module.json"
                local mod_errors=0

                if [[ ! -d "$mod_dir" ]]; then
                    log_error "Module directory not found: $mod_name"
                    return 1
                fi

                if [[ ! -f "$manifest" ]]; then
                    log_error "[$mod_name] module.json not found"
                    return 1
                fi

                # Deep validation with jq if available
                if cmd_exists jq && [[ -f "$schema" ]]; then
                    # Check valid JSON
                    if ! jq empty "$manifest" 2>/dev/null; then
                        log_error "[$mod_name] module.json is not valid JSON"
                        return 1
                    fi

                    # Required field: id
                    local val
                    val=$(jq -r '.id // empty' "$manifest" 2>/dev/null)
                    if [[ -z "$val" ]]; then
                        log_error "[$mod_name] Missing required field: id"
                        ((mod_errors++)) || true
                    elif [[ ! "$val" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
                        log_error "[$mod_name] Invalid id format: $val (must be lowercase alphanumeric with hyphens)"
                        ((mod_errors++)) || true
                    else
                        log_debug "[$mod_name] id=$val"
                    fi

                    # Required field: version
                    val=$(jq -r '.version // empty' "$manifest" 2>/dev/null)
                    if [[ -z "$val" ]]; then
                        log_error "[$mod_name] Missing required field: version"
                        ((mod_errors++)) || true
                    elif [[ ! "$val" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
                        log_error "[$mod_name] Invalid version format: $val (expected semver)"
                        ((mod_errors++)) || true
                    else
                        log_debug "[$mod_name] version=$val"
                    fi

                    # Required field: name
                    val=$(jq -r '.name // empty' "$manifest" 2>/dev/null)
                    if [[ -z "$val" ]]; then
                        log_error "[$mod_name] Missing required field: name"
                        ((mod_errors++)) || true
                    else
                        log_debug "[$mod_name] name=$val"
                    fi

                    # Required field: foundation.minVersion
                    val=$(jq -r '.foundation.minVersion // empty' "$manifest" 2>/dev/null)
                    if [[ -z "$val" ]]; then
                        log_error "[$mod_name] Missing required field: foundation.minVersion"
                        ((mod_errors++)) || true
                    elif [[ ! "$val" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                        log_error "[$mod_name] Invalid foundation.minVersion format: $val"
                        ((mod_errors++)) || true
                    else
                        log_debug "[$mod_name] foundation.minVersion=$val"
                    fi

                    # Config property validation
                    local has_config_props
                    has_config_props=$(jq -r '.config.properties // empty | length' "$manifest" 2>/dev/null)
                    if [[ -n "$has_config_props" && "$has_config_props" -gt 0 ]]; then
                        log_debug "[$mod_name] Checking config properties ($has_config_props declared)"
                        local mod_env_file="$mod_dir/.env"
                        local config_required_keys
                        config_required_keys=$(jq -r '.config.required // [] | .[]' "$manifest" 2>/dev/null)

                        while IFS= read -r prop_key; do
                            [[ -z "$prop_key" ]] && continue
                            local prop_env prop_default
                            prop_env=$(jq -r --arg k "$prop_key" '.config.properties[$k].env // empty' "$manifest" 2>/dev/null)
                            prop_default=$(jq -r --arg k "$prop_key" '.config.properties[$k].default // empty' "$manifest" 2>/dev/null)

                            if [[ -z "$prop_env" ]]; then
                                log_debug "[$mod_name] Config property '$prop_key' has no env mapping — skipping"
                                continue
                            fi

                            # Check if this property is in the required list
                            local is_required=false
                            for rk in $config_required_keys; do
                                if [[ "$rk" == "$prop_key" ]]; then
                                    is_required=true
                                    break
                                fi
                            done

                            # Check if env var is present in .env file
                            local env_present=false
                            if [[ -f "$mod_env_file" ]]; then
                                if grep -q "^${prop_env}=" "$mod_env_file" 2>/dev/null; then
                                    env_present=true
                                fi
                            fi

                            if [[ "$env_present" == "false" ]]; then
                                if [[ "$is_required" == "true" && -z "$prop_default" ]]; then
                                    log_warn "[$mod_name] Required config '$prop_key' (env: $prop_env) not found in .env"
                                elif [[ -n "$prop_default" ]]; then
                                    log_info "[$mod_name] Config '$prop_key' (env: $prop_env) not in .env — default '$prop_default' will be used"
                                fi
                            else
                                log_debug "[$mod_name] Config '$prop_key' (env: $prop_env) present in .env"
                            fi
                        done < <(jq -r '.config.properties | keys[]' "$manifest" 2>/dev/null)
                    fi
                else
                    # Basic check: valid JSON only
                    if cmd_exists jq; then
                        if ! jq empty "$manifest" 2>/dev/null; then
                            log_error "[$mod_name] module.json is not valid JSON"
                            return 1
                        fi
                    fi
                    log_info "[$mod_name] module.json exists (jq or schema unavailable for deep validation)"
                fi

                if [[ $mod_errors -eq 0 ]]; then
                    log_success "[$mod_name] Valid"
                    return 0
                else
                    log_error "[$mod_name] $mod_errors validation error(s)"
                    return 1
                fi
            }

            if [[ -n "$module" ]]; then
                # Validate a single module
                if _validate_module "$module"; then
                    ((checked++)) || true
                else
                    ((errors++)) || true
                    ((checked++)) || true
                fi
            else
                # Validate all modules
                for mod_dir in "$project_dir/modules"/*/; do
                    local mod_name
                    mod_name=$(basename "$mod_dir")
                    if _validate_module "$mod_name"; then
                        ((checked++)) || true
                    else
                        ((errors++)) || true
                        ((checked++)) || true
                    fi
                done
            fi

            echo ""
            if [[ $checked -eq 0 ]]; then
                log_warn "No modules found to validate"
                return 0
            elif [[ $errors -eq 0 ]]; then
                log_success "All $checked module(s) passed validation"
                return 0
            else
                log_error "$errors of $checked module(s) failed validation"
                return 1
            fi
            ;;

        create)
            local module="${1:-}"
            if [[ -z "$module" ]]; then
                log_error "Module name required"
                echo "Usage: $SCRIPT_NAME module create <name>"
                return 1
            fi

            # Validate module name format (lowercase alphanumeric with hyphens)
            if [[ ! "$module" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
                log_error "Invalid module name: $module"
                log_info "Name must be lowercase alphanumeric with hyphens (e.g., my-module)"
                return 1
            fi

            local module_dir="$project_dir/modules/$module"
            local template_dir="$project_dir/foundation/templates/module-template"

            if [[ -d "$module_dir" ]]; then
                log_error "Module already exists: $module_dir"
                return 1
            fi

            if [[ ! -d "$template_dir" ]]; then
                log_error "Module template not found: $template_dir"
                return 1
            fi

            # Copy template
            log_info "Creating module from template..."
            cp -r "$template_dir" "$module_dir"

            # Titlecase the module name: my-module -> My Module
            local title_name
            title_name=$(echo "$module" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')

            # Replace placeholder values in copied files
            local upper_name
            upper_name=$(echo "$module" | tr '[:lower:]-' '[:upper:]_')

            # Replace placeholders in all text files
            local underscore_name
            underscore_name=$(echo "$module" | tr '-' '_')
            local tpl_file
            for tpl_file in \
                "$module_dir/module.json" \
                "$module_dir/docker-compose.yml" \
                "$module_dir/.env.example" \
                "$module_dir/README.md" \
                "$module_dir/secrets-required.txt" \
                "$module_dir/hooks/install.sh" \
                "$module_dir/hooks/start.sh" \
                "$module_dir/hooks/stop.sh" \
                "$module_dir/hooks/health.sh" \
                "$module_dir/hooks/uninstall.sh"; do
                if [[ -f "$tpl_file" ]]; then
                    sed -i '' \
                        -e "s|my-module|$module|g" \
                        -e "s|my_module|${underscore_name}|g" \
                        -e "s|My Module|$title_name|g" \
                        -e "s|MY_MODULE|${upper_name}|g" \
                        "$tpl_file"
                fi
            done

            # Make hook scripts executable
            chmod +x "$module_dir/hooks/"*.sh 2>/dev/null || true

            # Auto-propagate DOMAIN from foundation .env into created module
            load_env
            if [[ -n "${DOMAIN:-}" ]] && [[ "${DOMAIN}" != "example.com" ]]; then
                if [[ -f "$module_dir/.env.example" ]]; then
                    sed -i '' "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" "$module_dir/.env.example" 2>/dev/null || \
                        sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" "$module_dir/.env.example" 2>/dev/null || true
                    log_info "Set DOMAIN=${DOMAIN} in module .env.example"
                fi
            fi

            log_success "Module created: $module_dir"
            echo ""
            log_info "Next steps:"
            log_info "  1. Edit modules/$module/module.json with your module details"
            log_info "  2. Edit modules/$module/docker-compose.yml with your services"
            log_info "  3. Copy .env.example to .env: cd modules/$module && cp .env.example .env"
            log_info "  4. Enable the module: ./$SCRIPT_NAME module enable $module"
            ;;

        update)
            local module="${1:-}"
            if [[ -z "$module" ]]; then
                log_error "Module name required"
                echo "Usage: $SCRIPT_NAME module update <name>"
                return 1
            fi

            local module_dir="$project_dir/modules/$module"
            if [[ ! -d "$module_dir" ]]; then
                log_error "Module not found: $module"
                return 1
            fi

            local compose_file="$module_dir/docker-compose.yml"
            if [[ ! -f "$compose_file" ]]; then
                log_error "No docker-compose.yml found for module: $module"
                return 1
            fi

            # Verify the module is currently running
            if ! docker compose -f "$compose_file" ps --format '{{.Name}}' 2>/dev/null | grep -q .; then
                log_error "Module $module is not running. Start it first with: $SCRIPT_NAME module enable $module"
                return 1
            fi

            log_info "Updating module: $module"

            # Pull latest images
            log_info "Pulling latest images..."
            if ! (cd "$module_dir" && docker compose pull 2>&1); then
                log_error "Failed to pull images for module: $module"
                return 1
            fi

            # Recreate containers with new images
            log_info "Recreating containers..."
            if ! (cd "$module_dir" && docker compose up -d 2>&1); then
                log_error "Failed to restart module: $module"
                return 1
            fi

            # Wait for health
            log_info "Waiting for health..."
            local max_wait=60
            local waited=0
            while [[ $waited -lt $max_wait ]]; do
                if (cd "$module_dir" && docker compose ps --format json 2>/dev/null | grep -q '"healthy"'); then
                    break
                fi
                sleep 5
                waited=$((waited + 5))
                log_info "  Waiting... ${waited}s/${max_wait}s"
            done

            if [[ $waited -ge $max_wait ]]; then
                log_warn "Module $module may not be healthy yet (timeout after ${max_wait}s)"
            else
                log_success "Module $module is healthy"
            fi

            # Post-deployment security gate (advisory, non-blocking)
            local containers_for_gate
            containers_for_gate=$(docker compose -f "$compose_file" \
                ps --format '{{.Names}}' 2>/dev/null) || containers_for_gate=""
            if [[ -n "$containers_for_gate" ]]; then
                log_info "Running post-deployment security checks..."
                while IFS= read -r gate_container; do
                    [[ -z "$gate_container" ]] && continue
                    post_deploy_security_check "$gate_container" || true
                done <<< "$containers_for_gate"
            fi

            log_success "Module $module updated"
            ;;

        *)
            log_error "Unknown module action: $action"
            echo "Usage: $SCRIPT_NAME module [list|enable|disable|status|health|validate|create|update] [name]"
            return 1
            ;;
    esac
}

# ==============================================================
# Check Updates Command
# ==============================================================

cmd_check_updates() {
    local project_dir
    project_dir="$(get_project_dir)"

    local check_script="$project_dir/scripts/check-upstream-updates.sh"

    if [[ ! -f "$check_script" ]]; then
        log_error "check-upstream-updates.sh not found at: $check_script"
        return 1
    fi

    bash "$check_script" "$project_dir" "$@"
}

# ==============================================================
# Env Command (Environment Switcher)
# ==============================================================

cmd_env() {
    local env_name="${1:-}"
    local project_dir
    project_dir="$(get_project_dir)"

    if [[ -z "$env_name" ]]; then
        echo "${BOLD}Available environments:${NC}"
        echo ""
        for f in "$project_dir"/.env.*.example; do
            [[ -f "$f" ]] || continue
            local name
            name=$(basename "$f" | sed 's/^\.env\.\(.*\)\.example$/\1/')
            local desc
            desc=$(head -3 "$f" | grep -o '# .*Environment' | sed 's/^# //' || true)
            printf "  %-15s %s\n" "$name" "$desc"
        done
        echo ""
        echo "Usage: $SCRIPT_NAME env <local|staging|production>"
        return 0
    fi

    local env_file="$project_dir/.env.${env_name}.example"
    if [[ ! -f "$env_file" ]]; then
        log_error "Environment file not found: .env.${env_name}.example"
        log_info "Available: $(ls "$project_dir"/.env.*.example 2>/dev/null | xargs -I{} basename {} | sed 's/\.env\.\(.*\)\.example/\1/' | tr '\n' ' ')"
        return 1
    fi

    # Back up existing .env if present
    if [[ -f "$project_dir/.env" ]]; then
        cp "$project_dir/.env" "$project_dir/.env.backup"
        log_info "Backed up current .env to .env.backup"
    fi

    cp "$env_file" "$project_dir/.env"
    log_success "Switched to ${BOLD}${env_name}${NC} environment"
    echo ""
    log_info "Source: .env.${env_name}.example"
    log_warn "Review .env and set secrets before starting services"
}

# ==============================================================
# Config Command
# ==============================================================

cmd_config() {
    local action="${1:-show}"
    shift || true

    local project_dir
    project_dir="$(get_project_dir)"

    case "$action" in
        show|view)
            print_header "Configuration"

            echo "${BOLD}Configuration Files:${NC}"
            for path in "${CONFIG_PATHS[@]}"; do
                if [[ -f "$path" ]]; then
                    echo "  ${GREEN}[exists]${NC} $path"
                else
                    echo "  ${DIM}[missing]${NC} $path"
                fi
            done

            echo ""
            echo "${BOLD}Environment (.env):${NC}"
            if [[ -f "$project_dir/.env" ]]; then
                echo "  DOMAIN=${DOMAIN:-not set}"
                echo "  COMPOSE_PROFILES=${COMPOSE_PROFILES:-not set}"
                echo "  RESOURCE_PROFILE=${RESOURCE_PROFILE:-not set}"
            else
                echo "  ${YELLOW}.env file not found${NC}"
            fi
            ;;

        init)
            log_info "Initializing configuration..."

            # Copy .env.example if .env doesn't exist
            if [[ ! -f "$project_dir/.env" ]] && [[ -f "$project_dir/.env.example" ]]; then
                cp "$project_dir/.env.example" "$project_dir/.env"
                log_success "Created .env from .env.example"
            fi

            # Create config directory if needed
            mkdir -p "$project_dir/config"

            # Copy targets.yml.example if it exists
            if [[ ! -f "$project_dir/config/targets.yml" ]] && [[ -f "$project_dir/config/targets.yml.example" ]]; then
                cp "$project_dir/config/targets.yml.example" "$project_dir/config/targets.yml"
                log_success "Created config/targets.yml from example"
            fi

            # Generate secrets
            if [[ -x "$project_dir/scripts/generate-secrets.sh" ]]; then
                log_info "Generating secrets..."
                "$project_dir/scripts/generate-secrets.sh"
            fi

            log_success "Configuration initialized"
            ;;

        validate)
            print_header "Configuration Validation"

            local errors=0

            load_env

            # Check required settings
            if [[ "${DOMAIN:-example.com}" == "example.com" ]]; then
                log_error "DOMAIN not configured (still set to example.com)"
                ((errors++)) || true
            else
                log_success "DOMAIN=$DOMAIN"
            fi

            if [[ -z "${ADMIN_EMAIL:-}" ]] || [[ "${ADMIN_EMAIL:-}" == "admin@example.com" ]]; then
                log_warn "ADMIN_EMAIL not configured"
            else
                log_success "ADMIN_EMAIL=$ADMIN_EMAIL"
            fi

            # Check secrets
            if [[ ! -d "$project_dir/secrets" ]]; then
                log_error "secrets/ directory not found"
                ((errors++)) || true
            else
                local secret_count
                secret_count=$(find "$project_dir/secrets" -type f ! -name ".gitkeep" | wc -l | tr -d ' ')
                if [[ "$secret_count" -eq 0 ]]; then
                    log_warn "No secrets generated. Run: ./scripts/generate-secrets.sh"
                else
                    log_success "Found $secret_count secrets"
                fi
            fi

            # Validate compose files
            log_info "Validating compose configuration..."
            if docker compose config --quiet 2>/dev/null; then
                log_success "Compose configuration valid"
            else
                log_error "Compose configuration invalid"
                ((errors++)) || true
            fi

            echo ""
            if [[ $errors -eq 0 ]]; then
                log_success "All validations passed"
                return 0
            else
                log_error "$errors validation errors found"
                return 1
            fi
            ;;

        edit)
            local editor="${EDITOR:-vim}"
            local file="${1:-$project_dir/.env}"

            if [[ -f "$file" ]]; then
                $editor "$file"
            else
                log_error "File not found: $file"
                return 1
            fi
            ;;

        *)
            log_error "Unknown config action: $action"
            echo "Usage: $SCRIPT_NAME config [show|init|validate|edit]"
            return 1
            ;;
    esac
}

# ==============================================================
# Interactive Menu
# ==============================================================

show_menu() {
    clear
    print_header "PeerMesh Core v$SCRIPT_VERSION"

    load_env

    echo "${DIM}Domain: ${DOMAIN:-not set} | Profiles: ${COMPOSE_PROFILES:-none}${NC}"
    echo ""

    echo "${BOLD}Commands:${NC}"
    echo ""
    echo "  ${CYAN}1)${NC} Status        Show deployment status"
    echo "  ${CYAN}2)${NC} Up            Start services"
    echo "  ${CYAN}3)${NC} Down          Stop services"
    echo "  ${CYAN}4)${NC} Logs          View service logs"
    echo "  ${CYAN}5)${NC} Health        Run health checks"
    echo ""
    echo "  ${CYAN}6)${NC} Deploy        Deploy to target"
    echo "  ${CYAN}7)${NC} Backup        Backup operations"
    echo "  ${CYAN}8)${NC} Module        Module management"
    echo "  ${CYAN}9)${NC} Config        Configuration"
    echo ""
    echo "  ${CYAN}h)${NC} Help          Show detailed help"
    echo "  ${CYAN}q)${NC} Quit          Exit"
    echo ""
}

interactive_menu() {
    while true; do
        show_menu

        read -rp "${BOLD}Select option: ${NC}" choice
        echo ""

        case "$choice" in
            1|status)  cmd_status; read -rp "Press Enter to continue..." ;;
            2|up)      cmd_up; read -rp "Press Enter to continue..." ;;
            3|down)    cmd_down; read -rp "Press Enter to continue..." ;;
            4|logs)    cmd_logs -f; ;;
            5|health)  cmd_health -v; read -rp "Press Enter to continue..." ;;
            6|deploy)  cmd_deploy; read -rp "Press Enter to continue..." ;;
            7|backup)  cmd_backup; read -rp "Press Enter to continue..." ;;
            8|module)  cmd_module; read -rp "Press Enter to continue..." ;;
            9|config)  cmd_config; read -rp "Press Enter to continue..." ;;
            h|help)    show_help; read -rp "Press Enter to continue..." ;;
            q|quit|exit) echo "Goodbye!"; exit 0 ;;
            *)         log_error "Invalid option: $choice"; sleep 1 ;;
        esac
    done
}

# ==============================================================
# Help
# ==============================================================

show_help() {
    cat << 'EOF'
PeerMesh Core - Unified Deployment CLI

USAGE:
    ./launch_core.sh                        Interactive menu
    ./launch_core.sh [COMMAND] [OPTIONS]    Direct command

COMMANDS:
    status              Show current deployment status
    up                  Start services
    down                Stop services
    deploy              Deploy to target (local/staging/prod)
    sync                Trigger sync on remote target
    logs                View service logs
    health              Run health checks
    backup              Run backup operations
    module              Module management
    config              Configuration management
    env                 Switch environment (local/staging/production)
    check-updates       Check for upstream Core core updates

COMMAND OPTIONS:

    up [OPTIONS]
        --profile=NAME      Enable profiles (comma-separated)
        -p NAME             Short form for --profile
        --build             Build images before starting
        --wait              Wait for services to be healthy
        -f FILE             Include additional compose file

    down [OPTIONS]
        -v, --volumes       Remove volumes
        --timeout=N         Timeout in seconds (default: 10)

    deploy [OPTIONS]
        --target=TARGET     Target: local, staging, prod (default: local)
        -t TARGET           Short form for --target
        --skip-backup       Skip pre-deployment backup

    sync [OPTIONS]
        --target=TARGET     Target name from config
        --url=URL           Direct webhook URL
        --secret=TOKEN      Webhook authentication token

    logs [SERVICE] [OPTIONS]
        -f, --follow        Follow log output
        -n, --tail N        Number of lines (default: 100)
        -t, --timestamps    Show timestamps

    health [OPTIONS]
        -v, --verbose       Show detailed endpoint checks

    backup [ACTION] [OPTIONS]
        run                 Run backup now
        status              Show backup status
        list                List available backups
        --target=TYPE       postgres, volumes, or all

    module [ACTION] [NAME]
        list                List available modules
        enable NAME         Enable a module (with dependency resolution and lifecycle hooks)
        disable NAME        Disable a module (reverse order, teardown hooks)
        update NAME         Update a running module to its latest image (pull + recreate)
        status NAME         Show module status
        health [NAME]       Run health check (specific module or all enabled)
        validate [NAME]     Validate module.json (specific module or all)
        create NAME         Scaffold a new module from template

    config [ACTION]
        show                Show current configuration
        init                Initialize configuration files
        validate            Validate configuration
        edit [FILE]         Edit configuration file

    env [NAME]
        local               Switch to local development environment
        staging             Switch to staging environment
        production          Switch to production environment

    check-updates [OPTIONS]
        --quiet             Machine-readable output
        --json              JSON output
        --remote NAME       Upstream remote name (default: upstream)
        --branch NAME       Upstream branch name (default: main)

EXAMPLES:
    # Start with PostgreSQL and Redis profiles
    ./launch_core.sh up --profile=postgresql,redis

    # Deploy to production
    ./launch_core.sh deploy --target=prod

    # View Traefik logs in real-time
    ./launch_core.sh logs traefik -f

    # Run health check with verbose output
    ./launch_core.sh health -v

    # Enable backup module
    ./launch_core.sh module enable backup

    # Update a running module to latest image
    ./launch_core.sh module update backup

    # Switch to staging environment
    ./launch_core.sh env staging

    # Check for upstream Core updates
    ./launch_core.sh check-updates

    # Initialize and validate configuration
    ./launch_core.sh config init
    ./launch_core.sh config validate

CONFIGURATION FILES:
    .peermesh.yml           Project configuration (preferred)
    config/targets.yml      Deployment targets
    .env                    Environment variables

ENVIRONMENT VARIABLES:
    DOMAIN                  Primary domain for services
    COMPOSE_PROFILES        Active profiles (comma-separated)
    ADMIN_EMAIL            Admin email for Let's Encrypt
    DEBUG=true              Enable debug output

For more information, see: docs/cli.md
EOF
}

show_version() {
    echo "$SCRIPT_NAME version $SCRIPT_VERSION"
}

# ==============================================================
# Main Entry Point
# ==============================================================

main() {
    # Change to project directory
    cd "$SCRIPT_DIR"

    # Check prerequisites
    if ! check_prerequisites; then
        log_error "Prerequisites check failed"
        exit 1
    fi

    # No arguments - interactive menu
    if [[ $# -eq 0 ]]; then
        interactive_menu
        exit 0
    fi

    # Parse global options and command
    local command=""
    local args=()

    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help|help)
                show_help
                exit 0
                ;;
            -V|--version|version)
                show_version
                exit 0
                ;;
            --debug)
                export DEBUG=true
                shift
                ;;
            -*)
                # Pass to command
                args+=("$1")
                shift
                ;;
            *)
                if [[ -z "$command" ]]; then
                    command="$1"
                else
                    args+=("$1")
                fi
                shift
                ;;
        esac
    done

    # Execute command
    case "$command" in
        status)    cmd_status "${args[@]:-}" ;;
        up|start)  cmd_up "${args[@]:-}" ;;
        down|stop) cmd_down "${args[@]:-}" ;;
        deploy)    cmd_deploy "${args[@]:-}" ;;
        sync)      cmd_sync "${args[@]:-}" ;;
        logs)      cmd_logs "${args[@]:-}" ;;
        health)    cmd_health "${args[@]:-}" ;;
        backup)    cmd_backup "${args[@]:-}" ;;
        module|mod) cmd_module "${args[@]:-}" ;;
        config|cfg) cmd_config "${args[@]:-}" ;;
        env)            cmd_env "${args[@]:-}" ;;
        check-updates)  cmd_check_updates "${args[@]:-}" ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            echo "Run '$SCRIPT_NAME --help' for usage information"
            exit 1
            ;;
    esac
}

# Run main
main "$@"
