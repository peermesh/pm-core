#!/usr/bin/env bash
# ==============================================================
# PeerMesh Docker Lab - Unified Deployment CLI
# ==============================================================
# Single entry point for all deployment operations.
#
# Usage:
#   ./launch_peermesh.sh                    # Interactive menu
#   ./launch_peermesh.sh [command] [args]   # Direct command
#   ./launch_peermesh.sh --help             # Show help
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
#
# Documentation: docs/cli.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

readonly SCRIPT_NAME="launch_peermesh.sh"
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
    print_header "PeerMesh Docker Lab - Status"

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

        # Check Traefik
        if curl -sf "http://localhost:${TRAEFIK_DASHBOARD_PORT:-8080}/ping" &>/dev/null; then
            echo "  ${GREEN}[OK]${NC} Traefik API"
        else
            echo "  ${RED}[FAIL]${NC} Traefik API"
        fi

        # Check Dashboard
        if curl -sf "http://localhost:8080/health" &>/dev/null 2>&1; then
            echo "  ${GREEN}[OK]${NC} Dashboard"
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
                            log_warn "Backup container not running. Start with: ./launch_peermesh.sh up --profile=backup"
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
            local module="$1"
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

        *)
            log_error "Unknown module action: $action"
            echo "Usage: $SCRIPT_NAME module [list|enable|disable|status|health] [name]"
            return 1
            ;;
    esac
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
    print_header "PeerMesh Docker Lab v$SCRIPT_VERSION"

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
PeerMesh Docker Lab - Unified Deployment CLI

USAGE:
    ./launch_peermesh.sh                        Interactive menu
    ./launch_peermesh.sh [COMMAND] [OPTIONS]    Direct command

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
        status NAME         Show module status
        health [NAME]       Run health check (specific module or all enabled)

    config [ACTION]
        show                Show current configuration
        init                Initialize configuration files
        validate            Validate configuration
        edit [FILE]         Edit configuration file

EXAMPLES:
    # Start with PostgreSQL and Redis profiles
    ./launch_peermesh.sh up --profile=postgresql,redis

    # Deploy to production
    ./launch_peermesh.sh deploy --target=prod

    # View Traefik logs in real-time
    ./launch_peermesh.sh logs traefik -f

    # Run health check with verbose output
    ./launch_peermesh.sh health -v

    # Enable backup module
    ./launch_peermesh.sh module enable backup

    # Initialize and validate configuration
    ./launch_peermesh.sh config init
    ./launch_peermesh.sh config validate

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
