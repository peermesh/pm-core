#!/usr/bin/env bash
#
# PeerMesh Foundation - Migration Framework
#
# This script manages foundation version upgrades and rollbacks.
# It detects version changes and executes migration scripts in order.
#
# Usage:
#   ./migration.sh <command> [options]
#
# Commands:
#   check     - Check for pending migrations
#   run       - Run pending migrations (up)
#   rollback  - Rollback to a specific version (down)
#   status    - Show current migration state
#
# Options:
#   --dry-run       - Show what would be done without executing
#   --target <ver>  - Target version for rollback
#   --force         - Force migration even if versions match
#   --json          - Output in JSON format
#   --quiet         - Suppress non-error output
#   --help, -h      - Show this help message
#
# Exit codes:
#   0 - Success (or no migrations needed)
#   1 - Migration failed
#   2 - Invalid arguments or missing dependencies
#   3 - Target version not found
#
# Environment:
#   FOUNDATION_DIR   - Path to foundation directory (default: script's parent)
#   MIGRATIONS_DIR   - Path to migrations directory (default: foundation/migrations)
#   STATE_FILE       - Path to migration state file (default: foundation/.migration-state)
#
# Example:
#   ./migration.sh check
#   ./migration.sh run --dry-run
#   ./migration.sh rollback --target 1.0.0
#   ./migration.sh status --json
#
# Migration State File (.migration-state):
#   {
#     "installedVersion": "1.0.0",
#     "lastMigration": "0.0.0-to-1.0.0",
#     "migratedAt": "2024-01-15T10:30:00Z",
#     "history": [...]
#   }
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Foundation directory (parent of lib/)
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$SCRIPT_DIR")}"

# Migrations directory
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$FOUNDATION_DIR/migrations}"

# State file
STATE_FILE="${STATE_FILE:-$FOUNDATION_DIR/.migration-state}"

# Foundation version file or default
FOUNDATION_VERSION_FILE="$FOUNDATION_DIR/VERSION"

# Default options
DRY_RUN=false
TARGET_VERSION=""
FORCE=false
OUTPUT_JSON=false
QUIET=false
COMMAND=""

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =============================================================================
# Logging Functions
# =============================================================================

log_info() {
    if [[ "$OUTPUT_JSON" == "false" && "$QUIET" == "false" ]]; then
        printf "%s\n" "$1"
    fi
}

log_error() {
    if [[ "$OUTPUT_JSON" == "false" ]]; then
        printf "%bError:%b %s\n" "$RED" "$NC" "$1" >&2
    fi
}

log_success() {
    if [[ "$OUTPUT_JSON" == "false" && "$QUIET" == "false" ]]; then
        printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"
    fi
}

log_warn() {
    if [[ "$OUTPUT_JSON" == "false" && "$QUIET" == "false" ]]; then
        printf "%bWarning:%b %s\n" "$YELLOW" "$NC" "$1" >&2
    fi
}

log_step() {
    if [[ "$OUTPUT_JSON" == "false" && "$QUIET" == "false" ]]; then
        printf "%b→%b %s\n" "$BLUE" "$NC" "$1"
    fi
}

log_dry_run() {
    if [[ "$OUTPUT_JSON" == "false" ]]; then
        printf "%b[DRY-RUN]%b %s\n" "$CYAN" "$NC" "$1"
    fi
}

# =============================================================================
# Help and Usage
# =============================================================================

usage() {
    cat << 'EOF'
Usage: migration.sh <command> [options]

Manage foundation version migrations.

Commands:
  check     Check for pending migrations
  run       Run pending migrations (up)
  rollback  Rollback to a specific version (down)
  status    Show current migration state

Options:
  --dry-run       Show what would be done without executing
  --target <ver>  Target version for rollback
  --force         Force migration even if versions match
  --json          Output in JSON format
  --quiet         Suppress non-error output
  --help, -h      Show this help message

Examples:
  ./migration.sh check
  ./migration.sh run --dry-run
  ./migration.sh rollback --target 1.0.0
  ./migration.sh status --json
EOF
}

# =============================================================================
# Argument Parsing
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            check|run|rollback|status)
                if [[ -z "$COMMAND" ]]; then
                    COMMAND="$1"
                else
                    log_error "Multiple commands specified: $COMMAND and $1"
                    exit 2
                fi
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --target)
                if [[ -z "${2:-}" ]]; then
                    log_error "--target requires a version argument"
                    exit 2
                fi
                TARGET_VERSION="$2"
                shift 2
                ;;
            --force)
                FORCE=true
                shift
                ;;
            --json)
                OUTPUT_JSON=true
                shift
                ;;
            --quiet|-q)
                QUIET=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                usage
                exit 2
                ;;
            *)
                log_error "Unknown argument: $1"
                usage
                exit 2
                ;;
        esac
    done

    if [[ -z "$COMMAND" ]]; then
        log_error "Command required"
        usage
        exit 2
    fi
}

# =============================================================================
# Version Utilities
# =============================================================================

# Get current foundation version from VERSION file or default
get_foundation_version() {
    if [[ -f "$FOUNDATION_VERSION_FILE" ]]; then
        cat "$FOUNDATION_VERSION_FILE" | tr -d '[:space:]'
    else
        # Default to 1.0.0 if no VERSION file exists
        echo "1.0.0"
    fi
}

# Get installed version from migration state
get_installed_version() {
    if [[ -f "$STATE_FILE" ]]; then
        if command -v jq &>/dev/null; then
            jq -r '.installedVersion // "0.0.0"' "$STATE_FILE" 2>/dev/null || echo "0.0.0"
        else
            # Fallback: grep for version
            grep -o '"installedVersion"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" 2>/dev/null | \
                sed 's/.*"\([^"]*\)"$/\1/' || echo "0.0.0"
        fi
    else
        echo "0.0.0"
    fi
}

# Compare two semver versions
# Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
compare_versions() {
    local v1="$1"
    local v2="$2"

    if [[ "$v1" == "$v2" ]]; then
        echo "0"
        return
    fi

    # Split versions into components
    local IFS='.'
    read -ra V1_PARTS <<< "$v1"
    read -ra V2_PARTS <<< "$v2"

    # Compare each component
    for i in 0 1 2; do
        local p1="${V1_PARTS[$i]:-0}"
        local p2="${V2_PARTS[$i]:-0}"

        # Remove any non-numeric suffix
        p1="${p1%%[!0-9]*}"
        p2="${p2%%[!0-9]*}"

        if [[ "$p1" -lt "$p2" ]]; then
            echo "-1"
            return
        elif [[ "$p1" -gt "$p2" ]]; then
            echo "1"
            return
        fi
    done

    echo "0"
}

# Parse migration directory name to get from/to versions
parse_migration_name() {
    local name="$1"
    local part="$2"  # "from" or "to"

    # Expected format: X.Y.Z-to-A.B.C
    if [[ "$part" == "from" ]]; then
        echo "$name" | sed -n 's/^\([0-9]*\.[0-9]*\.[0-9]*\)-to-.*/\1/p'
    else
        echo "$name" | sed -n 's/.*-to-\([0-9]*\.[0-9]*\.[0-9]*\)$/\1/p'
    fi
}

# =============================================================================
# Migration Discovery
# =============================================================================

# Find all migration directories sorted by target version
find_migrations() {
    local migrations=()

    if [[ ! -d "$MIGRATIONS_DIR" ]]; then
        return
    fi

    for dir in "$MIGRATIONS_DIR"/*/; do
        if [[ -d "$dir" ]]; then
            local name
            name=$(basename "$dir")

            # Validate migration name format
            if [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+-to-[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                migrations+=("$name")
            fi
        fi
    done

    # Sort migrations by target version
    printf '%s\n' "${migrations[@]}" | sort -t'-' -k3 -V
}

# Find migrations between two versions (for upgrade path)
find_upgrade_path() {
    local from_version="$1"
    local to_version="$2"
    local path=()

    while IFS= read -r migration; do
        [[ -z "$migration" ]] && continue

        local mig_from mig_to
        mig_from=$(parse_migration_name "$migration" "from")
        mig_to=$(parse_migration_name "$migration" "to")

        # Skip if migration starts before our current version
        if [[ $(compare_versions "$mig_from" "$from_version") -lt 0 ]]; then
            continue
        fi

        # Skip if migration ends after our target
        if [[ $(compare_versions "$mig_to" "$to_version") -gt 0 ]]; then
            continue
        fi

        # Check if this migration connects to our path
        if [[ ${#path[@]} -eq 0 ]]; then
            # First migration must start from our current version
            if [[ "$mig_from" == "$from_version" ]]; then
                path+=("$migration")
            fi
        else
            # Subsequent migrations must chain from previous
            local last_migration="${path[-1]}"
            local last_to
            last_to=$(parse_migration_name "$last_migration" "to")

            if [[ "$mig_from" == "$last_to" ]]; then
                path+=("$migration")
            fi
        fi
    done < <(find_migrations)

    printf '%s\n' "${path[@]}"
}

# Find migrations for rollback (reverse order)
find_rollback_path() {
    local from_version="$1"
    local to_version="$2"
    local path=()

    # Get all migrations in reverse order
    while IFS= read -r migration; do
        [[ -z "$migration" ]] && continue

        local mig_from mig_to
        mig_from=$(parse_migration_name "$migration" "from")
        mig_to=$(parse_migration_name "$migration" "to")

        # For rollback, we need migrations whose target is above our target
        # and whose source is at or below our current version
        if [[ $(compare_versions "$mig_to" "$to_version") -le 0 ]]; then
            continue
        fi

        if [[ $(compare_versions "$mig_to" "$from_version") -gt 0 ]]; then
            continue
        fi

        path+=("$migration")
    done < <(find_migrations | sort -r)

    printf '%s\n' "${path[@]}"
}

# =============================================================================
# State Management
# =============================================================================

# Read current migration state
read_state() {
    if [[ -f "$STATE_FILE" ]]; then
        cat "$STATE_FILE"
    else
        echo '{}'
    fi
}

# Update migration state
update_state() {
    local new_version="$1"
    local migration_name="$2"
    local direction="$3"  # "up" or "down"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "Would update state: version=$new_version, migration=$migration_name"
        return
    fi

    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    local current_state
    current_state=$(read_state)

    if command -v jq &>/dev/null; then
        # Use jq if available
        local history_entry
        history_entry=$(jq -n \
            --arg migration "$migration_name" \
            --arg direction "$direction" \
            --arg timestamp "$timestamp" \
            '{migration: $migration, direction: $direction, timestamp: $timestamp}')

        echo "$current_state" | jq \
            --arg version "$new_version" \
            --arg migration "$migration_name" \
            --arg timestamp "$timestamp" \
            --argjson entry "$history_entry" \
            '.installedVersion = $version | .lastMigration = $migration | .migratedAt = $timestamp | .history = ((.history // []) + [$entry])' \
            > "$STATE_FILE"
    else
        # Fallback: simple state file
        cat > "$STATE_FILE" << EOF
{
  "installedVersion": "$new_version",
  "lastMigration": "$migration_name",
  "migratedAt": "$timestamp",
  "history": []
}
EOF
    fi
}

# =============================================================================
# Migration Execution
# =============================================================================

# Execute a single migration
execute_migration() {
    local migration_name="$1"
    local direction="$2"  # "up" or "down"

    local migration_dir="$MIGRATIONS_DIR/$migration_name"
    local script="$migration_dir/${direction}.sh"

    if [[ ! -f "$script" ]]; then
        log_error "Migration script not found: $script"
        return 1
    fi

    if [[ ! -x "$script" ]]; then
        log_error "Migration script not executable: $script"
        return 1
    fi

    local mig_from mig_to
    mig_from=$(parse_migration_name "$migration_name" "from")
    mig_to=$(parse_migration_name "$migration_name" "to")

    if [[ "$direction" == "up" ]]; then
        log_step "Migrating $mig_from → $mig_to"
    else
        log_step "Rolling back $mig_to → $mig_from"
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "Would execute: $script"
        return 0
    fi

    # Execute migration script
    local exit_code=0
    if ! "$script"; then
        exit_code=$?
        log_error "Migration failed: $migration_name ($direction)"
        return $exit_code
    fi

    # Update state
    local new_version
    if [[ "$direction" == "up" ]]; then
        new_version="$mig_to"
    else
        new_version="$mig_from"
    fi

    update_state "$new_version" "$migration_name" "$direction"

    log_success "Completed: $migration_name ($direction)"
    return 0
}

# =============================================================================
# Commands
# =============================================================================

# Check for pending migrations
cmd_check() {
    local installed_version
    local foundation_version
    local pending_migrations=()

    installed_version=$(get_installed_version)
    foundation_version=$(get_foundation_version)

    log_info "Checking for pending migrations..."
    log_info "  Installed version: $installed_version"
    log_info "  Foundation version: $foundation_version"

    local cmp
    cmp=$(compare_versions "$installed_version" "$foundation_version")

    if [[ "$cmp" -eq 0 && "$FORCE" == "false" ]]; then
        log_info ""
        log_success "No migrations needed. Foundation is up to date."

        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg installed "$installed_version" --arg foundation "$foundation_version" \
                '{needsMigration: false, installedVersion: $installed, foundationVersion: $foundation, pendingMigrations: []}'
        fi
        return 0
    fi

    if [[ "$cmp" -gt 0 ]]; then
        log_warn "Installed version ($installed_version) is newer than foundation ($foundation_version)"
        log_info "Use 'rollback --target $foundation_version' to downgrade"

        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg installed "$installed_version" --arg foundation "$foundation_version" \
                '{needsMigration: false, needsRollback: true, installedVersion: $installed, foundationVersion: $foundation}'
        fi
        return 0
    fi

    # Find upgrade path
    while IFS= read -r migration; do
        [[ -n "$migration" ]] && pending_migrations+=("$migration")
    done < <(find_upgrade_path "$installed_version" "$foundation_version")

    if [[ ${#pending_migrations[@]} -eq 0 ]]; then
        log_warn "No migration path found from $installed_version to $foundation_version"

        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg installed "$installed_version" --arg foundation "$foundation_version" \
                '{needsMigration: true, noPathFound: true, installedVersion: $installed, foundationVersion: $foundation}'
        fi
        return 3
    fi

    log_info ""
    log_info "Pending migrations:"
    for migration in "${pending_migrations[@]}"; do
        log_info "  - $migration"
    done

    if [[ "$OUTPUT_JSON" == "true" ]]; then
        local migrations_json
        migrations_json=$(printf '%s\n' "${pending_migrations[@]}" | jq -R . | jq -s .)
        jq -n --arg installed "$installed_version" --arg foundation "$foundation_version" \
            --argjson migrations "$migrations_json" \
            '{needsMigration: true, installedVersion: $installed, foundationVersion: $foundation, pendingMigrations: $migrations}'
    fi

    return 0
}

# Run pending migrations
cmd_run() {
    local installed_version
    local foundation_version
    local pending_migrations=()

    installed_version=$(get_installed_version)
    foundation_version=$(get_foundation_version)

    log_info "Running migrations..."
    log_info "  From: $installed_version"
    log_info "  To: $foundation_version"

    local cmp
    cmp=$(compare_versions "$installed_version" "$foundation_version")

    if [[ "$cmp" -eq 0 && "$FORCE" == "false" ]]; then
        log_success "Already at target version. No migrations needed."
        return 0
    fi

    if [[ "$cmp" -gt 0 ]]; then
        log_error "Cannot upgrade: installed version ($installed_version) is newer than foundation ($foundation_version)"
        log_info "Use 'rollback' command to downgrade"
        return 1
    fi

    # Find upgrade path
    while IFS= read -r migration; do
        [[ -n "$migration" ]] && pending_migrations+=("$migration")
    done < <(find_upgrade_path "$installed_version" "$foundation_version")

    if [[ ${#pending_migrations[@]} -eq 0 ]]; then
        log_error "No migration path found from $installed_version to $foundation_version"
        return 3
    fi

    log_info ""
    log_info "Executing ${#pending_migrations[@]} migration(s):"

    local success=true
    for migration in "${pending_migrations[@]}"; do
        if ! execute_migration "$migration" "up"; then
            success=false
            break
        fi
    done

    log_info ""

    if [[ "$success" == "true" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            log_dry_run "Would complete migration to $foundation_version"
        else
            log_success "Migration complete! Now at version $foundation_version"
        fi
        return 0
    else
        log_error "Migration failed. Check logs and fix issues before retrying."
        return 1
    fi
}

# Rollback to a specific version
cmd_rollback() {
    if [[ -z "$TARGET_VERSION" ]]; then
        log_error "--target version is required for rollback"
        exit 2
    fi

    local installed_version
    installed_version=$(get_installed_version)

    log_info "Rolling back..."
    log_info "  From: $installed_version"
    log_info "  To: $TARGET_VERSION"

    local cmp
    cmp=$(compare_versions "$TARGET_VERSION" "$installed_version")

    if [[ "$cmp" -ge 0 ]]; then
        log_error "Cannot rollback to same or newer version"
        log_info "Use 'run' command to upgrade"
        return 1
    fi

    # Find rollback path
    local rollback_migrations=()
    while IFS= read -r migration; do
        [[ -n "$migration" ]] && rollback_migrations+=("$migration")
    done < <(find_rollback_path "$installed_version" "$TARGET_VERSION")

    if [[ ${#rollback_migrations[@]} -eq 0 ]]; then
        log_error "No rollback path found from $installed_version to $TARGET_VERSION"
        return 3
    fi

    log_info ""
    log_info "Executing ${#rollback_migrations[@]} rollback(s):"

    local success=true
    for migration in "${rollback_migrations[@]}"; do
        if ! execute_migration "$migration" "down"; then
            success=false
            break
        fi
    done

    log_info ""

    if [[ "$success" == "true" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            log_dry_run "Would complete rollback to $TARGET_VERSION"
        else
            log_success "Rollback complete! Now at version $TARGET_VERSION"
        fi
        return 0
    else
        log_error "Rollback failed. System may be in inconsistent state."
        return 1
    fi
}

# Show migration status
cmd_status() {
    local installed_version
    local foundation_version
    local state

    installed_version=$(get_installed_version)
    foundation_version=$(get_foundation_version)
    state=$(read_state)

    if [[ "$OUTPUT_JSON" == "true" ]]; then
        local migrations_json
        migrations_json=$(find_migrations | jq -R . | jq -s .)

        jq -n \
            --arg installed "$installed_version" \
            --arg foundation "$foundation_version" \
            --argjson state "$state" \
            --argjson migrations "$migrations_json" \
            '{
                installedVersion: $installed,
                foundationVersion: $foundation,
                state: $state,
                availableMigrations: $migrations
            }'
        return 0
    fi

    log_info "Migration Status"
    log_info "================"
    log_info ""
    log_info "Versions:"
    log_info "  Installed:  $installed_version"
    log_info "  Foundation: $foundation_version"

    local cmp
    cmp=$(compare_versions "$installed_version" "$foundation_version")

    if [[ "$cmp" -lt 0 ]]; then
        printf "  Status:     %bUpgrade available%b\n" "$YELLOW" "$NC"
    elif [[ "$cmp" -gt 0 ]]; then
        printf "  Status:     %bInstalled version is newer%b\n" "$YELLOW" "$NC"
    else
        printf "  Status:     %bUp to date%b\n" "$GREEN" "$NC"
    fi

    log_info ""
    log_info "State File: $STATE_FILE"

    if [[ -f "$STATE_FILE" ]] && command -v jq &>/dev/null; then
        local last_migration last_time
        last_migration=$(echo "$state" | jq -r '.lastMigration // "none"')
        last_time=$(echo "$state" | jq -r '.migratedAt // "never"')

        log_info "  Last Migration: $last_migration"
        log_info "  Migrated At:    $last_time"
    elif [[ ! -f "$STATE_FILE" ]]; then
        log_info "  (No migration state file - fresh install)"
    fi

    log_info ""
    log_info "Available Migrations:"

    local found_any=false
    while IFS= read -r migration; do
        [[ -z "$migration" ]] && continue
        found_any=true

        local mig_from mig_to has_up has_down
        mig_from=$(parse_migration_name "$migration" "from")
        mig_to=$(parse_migration_name "$migration" "to")

        has_up="✗"
        has_down="✗"
        [[ -x "$MIGRATIONS_DIR/$migration/up.sh" ]] && has_up="✓"
        [[ -x "$MIGRATIONS_DIR/$migration/down.sh" ]] && has_down="✓"

        log_info "  $migration (up:$has_up down:$has_down)"
    done < <(find_migrations)

    if [[ "$found_any" == "false" ]]; then
        log_info "  (No migrations found in $MIGRATIONS_DIR)"
    fi

    return 0
}

# =============================================================================
# Main
# =============================================================================

main() {
    parse_args "$@"

    # Validate dependencies
    if [[ "$OUTPUT_JSON" == "true" ]] && ! command -v jq &>/dev/null; then
        echo '{"error": "jq required for JSON output"}' >&2
        exit 2
    fi

    # Execute command
    case "$COMMAND" in
        check)
            cmd_check
            ;;
        run)
            cmd_run
            ;;
        rollback)
            cmd_rollback
            ;;
        status)
            cmd_status
            ;;
        *)
            log_error "Unknown command: $COMMAND"
            exit 2
            ;;
    esac
}

# Run main
main "$@"
