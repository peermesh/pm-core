#!/bin/bash
# ==============================================================
# Docker Volume Backup Script
# ==============================================================
# Purpose: Create compressed, verified backups of Docker volumes
# Features:
#   - Backs up named Docker volumes to tar.gz archives
#   - Optionally uses restic for deduplication and encryption
#   - Supports selective volume backup by prefix/pattern
#   - SHA-256 checksum generation
#   - Atomic symlink updates for "latest" pointer
#   - Pre/post hooks for database quiescence
#
# Documentation: scripts/backup/README.md
# Decision Reference: docs/decisions/0102-backup-architecture.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

# Paths
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl/volumes}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Volume filter (default: all pmdl_ prefixed volumes)
VOLUME_PREFIX="${VOLUME_PREFIX:-pmdl_}"

# Backup settings
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DATE=$(date +%Y-%m-%d)
LOG_FILE="${BACKUP_DIR}/logs/backup-${DATE}.log"

# Restic settings (optional)
RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-}"

# Hooks
PRE_BACKUP_HOOK="${PRE_BACKUP_HOOK:-}"
POST_BACKUP_HOOK="${POST_BACKUP_HOOK:-}"

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    if [[ -d "$(dirname "$LOG_FILE")" ]]; then
        echo "$msg" >> "$LOG_FILE"
    fi
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

warn() {
    log "WARNING: $*"
}

ensure_dir() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        log "Created directory: $dir"
    fi
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# List volumes matching prefix
list_volumes() {
    local prefix="${1:-$VOLUME_PREFIX}"
    docker volume ls --format '{{.Name}}' | grep "^${prefix}" || true
}

# Get volume size (approximate)
get_volume_size() {
    local volume="$1"
    # Run a container to check the size
    docker run --rm -v "${volume}:/data:ro" alpine du -sh /data 2>/dev/null | cut -f1 || echo "unknown"
}

# Update atomic symlink
update_symlink() {
    local target="$1"
    local link_path="$2"

    ln -sf "$(basename "$target")" "${link_path}.new"
    mv "${link_path}.new" "$link_path"
}

# ==============================================================
# Backup Functions
# ==============================================================

# Backup a single volume to tar.gz
backup_volume_tar() {
    local volume="$1"
    local output_dir="${BACKUP_DIR}/tar"
    local output_file="${output_dir}/${volume}-${TIMESTAMP}.tar.gz"
    local checksum_file="${output_file}.sha256"

    ensure_dir "$output_dir"

    log "Backing up volume: $volume"

    # Check if volume exists
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
        error_exit "Volume not found: $volume"
    fi

    # Get volume size for logging
    local size=$(get_volume_size "$volume")
    log "  Volume size: $size"

    # Create backup using alpine container
    # Using busybox for minimal footprint
    docker run --rm \
        -v "${volume}:/source:ro" \
        -v "${output_dir}:/backup" \
        alpine:3.19 \
        tar -czf "/backup/$(basename "$output_file")" -C /source . \
        2>> "$LOG_FILE" \
        || error_exit "Failed to backup volume: $volume"

    # Generate checksum
    sha256sum "$output_file" > "$checksum_file"

    # Verify backup integrity
    gzip -t "$output_file" || error_exit "Backup verification failed - corrupt gzip"

    local backup_size=$(du -h "$output_file" | cut -f1)
    log "  Backup complete: $output_file ($backup_size)"

    # Update latest symlink
    update_symlink "$output_file" "${output_dir}/${volume}-latest.tar.gz"

    echo "$output_file"
}

# Backup volumes using restic
backup_volumes_restic() {
    local volumes="$1"

    if [[ -z "$RESTIC_REPOSITORY" ]]; then
        error_exit "RESTIC_REPOSITORY not set"
    fi

    if [[ -z "$RESTIC_PASSWORD_FILE" ]] && [[ -z "${RESTIC_PASSWORD:-}" ]]; then
        error_exit "RESTIC_PASSWORD_FILE or RESTIC_PASSWORD required"
    fi

    # Export restic environment
    export RESTIC_REPOSITORY
    if [[ -n "$RESTIC_PASSWORD_FILE" ]]; then
        export RESTIC_PASSWORD_FILE
    fi

    # Check if repository exists, initialize if not
    if ! restic snapshots >/dev/null 2>&1; then
        log "Initializing restic repository: $RESTIC_REPOSITORY"
        restic init || error_exit "Failed to initialize restic repository"
    fi

    log "Starting restic backup of volumes..."

    # Create a temporary directory to mount volumes
    local temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    # Backup each volume
    for volume in $volumes; do
        log "Backing up volume with restic: $volume"

        local mount_point="${temp_dir}/${volume}"
        mkdir -p "$mount_point"

        # Use docker to copy volume contents
        docker run --rm \
            -v "${volume}:/source:ro" \
            -v "${temp_dir}:/dest" \
            alpine:3.19 \
            cp -a /source/. "/dest/${volume}/" \
            2>> "$LOG_FILE" \
            || { warn "Failed to copy volume: $volume"; continue; }

        # Backup with restic
        restic backup "${mount_point}" \
            --tag "volume:${volume}" \
            --tag "host:$(hostname)" \
            2>> "$LOG_FILE" \
            || { warn "Restic backup failed for: $volume"; continue; }

        log "  Volume backed up: $volume"
    done

    log "Restic backup complete"

    # Show snapshot info
    restic snapshots --latest 1 --json | head -20
}

# Apply retention policy
apply_retention() {
    local days="${1:-7}"
    local backup_type="${2:-tar}"

    log "Applying retention policy: keep ${days} days of ${backup_type} backups"

    case "$backup_type" in
        tar)
            # Remove tar backups older than retention period
            find "${BACKUP_DIR}/tar" -name "*.tar.gz" -mtime "+${days}" -type f -delete 2>/dev/null || true
            find "${BACKUP_DIR}/tar" -name "*.sha256" -mtime "+${days}" -type f -delete 2>/dev/null || true
            ;;
        restic)
            if [[ -n "$RESTIC_REPOSITORY" ]]; then
                export RESTIC_REPOSITORY
                [[ -n "$RESTIC_PASSWORD_FILE" ]] && export RESTIC_PASSWORD_FILE

                restic forget \
                    --keep-daily "$days" \
                    --keep-weekly 4 \
                    --keep-monthly 3 \
                    --prune \
                    2>> "$LOG_FILE" \
                    || warn "Restic retention cleanup failed"
            fi
            ;;
    esac

    log "Retention policy applied"
}

# Run pre-backup hooks (e.g., database flush)
run_pre_hooks() {
    if [[ -n "$PRE_BACKUP_HOOK" ]] && [[ -x "$PRE_BACKUP_HOOK" ]]; then
        log "Running pre-backup hook: $PRE_BACKUP_HOOK"
        "$PRE_BACKUP_HOOK" 2>> "$LOG_FILE" || warn "Pre-backup hook failed"
    fi

    # Built-in hooks for databases
    # PostgreSQL: checkpoint
    if docker ps --format '{{.Names}}' | grep -q "pmdl_postgres"; then
        log "Running PostgreSQL checkpoint..."
        docker exec pmdl_postgres psql -U postgres -c "CHECKPOINT;" 2>> "$LOG_FILE" || true
    fi

    # Redis: BGSAVE
    if docker ps --format '{{.Names}}' | grep -q "pmdl_redis"; then
        log "Running Redis BGSAVE..."
        docker exec pmdl_redis redis-cli BGSAVE 2>> "$LOG_FILE" || true
        sleep 2  # Wait for save to complete
    fi
}

# Run post-backup hooks
run_post_hooks() {
    if [[ -n "$POST_BACKUP_HOOK" ]] && [[ -x "$POST_BACKUP_HOOK" ]]; then
        log "Running post-backup hook: $POST_BACKUP_HOOK"
        "$POST_BACKUP_HOOK" 2>> "$LOG_FILE" || warn "Post-backup hook failed"
    fi
}

# ==============================================================
# Restore Functions
# ==============================================================

restore_volume_tar() {
    local backup_file="$1"
    local volume="$2"

    [[ -f "$backup_file" ]] || error_exit "Backup file not found: $backup_file"

    log "Restoring volume: $volume from $backup_file"

    # Verify checksum if available
    local checksum_file="${backup_file}.sha256"
    if [[ -f "$checksum_file" ]]; then
        log "  Verifying checksum..."
        sha256sum -c "$checksum_file" || error_exit "Checksum verification failed!"
    fi

    # Verify gzip integrity
    gzip -t "$backup_file" || error_exit "Backup file is corrupt"

    # Create volume if it doesn't exist
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
        log "  Creating volume: $volume"
        docker volume create "$volume"
    fi

    # Restore using alpine container
    docker run --rm \
        -v "${volume}:/dest" \
        -v "$(dirname "$backup_file"):/backup:ro" \
        alpine:3.19 \
        sh -c "rm -rf /dest/* && tar -xzf '/backup/$(basename "$backup_file")' -C /dest" \
        || error_exit "Failed to restore volume: $volume"

    log "  Volume restored: $volume"
}

list_backups() {
    log "Available volume backups:"
    echo ""

    echo "=== Tar Backups ==="
    if [[ -d "${BACKUP_DIR}/tar" ]]; then
        ls -lh "${BACKUP_DIR}/tar"/*.tar.gz 2>/dev/null | tail -20 || echo "  (none)"
    else
        echo "  (directory not found)"
    fi
    echo ""

    if [[ -n "$RESTIC_REPOSITORY" ]]; then
        echo "=== Restic Snapshots ==="
        export RESTIC_REPOSITORY
        [[ -n "$RESTIC_PASSWORD_FILE" ]] && export RESTIC_PASSWORD_FILE
        restic snapshots 2>/dev/null || echo "  (unable to connect to repository)"
    fi
}

# ==============================================================
# Main Execution
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [command] [options]

Commands:
    backup      Backup volumes (default)
    restore     Restore a volume from backup
    list        List available backups
    retention   Apply retention policy

Options:
    -v, --volume NAME      Specific volume to backup/restore
    -p, --prefix PREFIX    Volume prefix filter (default: pmdl_)
    -f, --file PATH        Backup file for restore
    -r, --restic           Use restic for backup (requires configuration)
    -d, --days DAYS        Retention days (default: 7)
    --all                  Backup all matching volumes
    -h, --help             Show this help

Environment Variables:
    BACKUP_DIR              Backup destination directory
    VOLUME_PREFIX           Filter volumes by prefix
    RESTIC_REPOSITORY       Restic repository URL (optional)
    RESTIC_PASSWORD_FILE    Path to restic password file
    PRE_BACKUP_HOOK         Script to run before backup
    POST_BACKUP_HOOK        Script to run after backup

Examples:
    $0 backup --all                          # Backup all pmdl_ volumes
    $0 backup -v pmdl_postgres_data          # Backup specific volume
    $0 backup --all --restic                 # Use restic for dedup/encryption
    $0 restore -v pmdl_postgres_data -f backup.tar.gz
    $0 list                                  # List available backups
    $0 retention -d 7                        # Keep only 7 days of backups

EOF
    exit 0
}

main() {
    local command="${1:-backup}"
    local volume=""
    local backup_file=""
    local use_restic=false
    local backup_all=false
    local retention_days=7

    # Parse arguments
    shift || true
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -v|--volume)
                volume="$2"
                shift 2
                ;;
            -p|--prefix)
                VOLUME_PREFIX="$2"
                shift 2
                ;;
            -f|--file)
                backup_file="$2"
                shift 2
                ;;
            -r|--restic)
                use_restic=true
                shift
                ;;
            -d|--days)
                retention_days="$2"
                shift 2
                ;;
            --all)
                backup_all=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                error_exit "Unknown option: $1"
                ;;
        esac
    done

    # Ensure directories exist
    ensure_dir "${BACKUP_DIR}/logs"
    ensure_dir "${BACKUP_DIR}/tar"

    case "$command" in
        backup)
            log "========================================"
            log "Docker Volume Backup Started"
            log "Backup Dir: $BACKUP_DIR"
            log "========================================"

            # Determine volumes to backup
            local volumes=""
            if [[ -n "$volume" ]]; then
                volumes="$volume"
            elif [[ "$backup_all" == true ]]; then
                volumes=$(list_volumes "$VOLUME_PREFIX")
                if [[ -z "$volumes" ]]; then
                    error_exit "No volumes found matching prefix: $VOLUME_PREFIX"
                fi
            else
                error_exit "Specify --volume or --all"
            fi

            log "Volumes to backup: $(echo $volumes | tr '\n' ' ')"

            # Run pre-backup hooks
            run_pre_hooks

            # Perform backup
            if [[ "$use_restic" == true ]]; then
                if ! command_exists restic; then
                    error_exit "restic not found. Install with: apt install restic"
                fi
                backup_volumes_restic "$volumes"
            else
                for vol in $volumes; do
                    backup_volume_tar "$vol"
                done
            fi

            # Run post-backup hooks
            run_post_hooks

            # Record success timestamp
            date -Iseconds > "${BACKUP_DIR}/.last_successful_backup"

            log "========================================"
            log "Docker Volume Backup Complete"
            log "========================================"
            ;;

        restore)
            [[ -z "$volume" ]] && error_exit "Volume name required (-v flag)"
            [[ -z "$backup_file" ]] && error_exit "Backup file required (-f flag)"

            log "========================================"
            log "Docker Volume Restore Started"
            log "Volume: $volume"
            log "Backup: $backup_file"
            log "========================================"

            echo ""
            echo "WARNING: This will overwrite the volume: $volume"
            echo "Ensure the associated containers are stopped!"
            echo ""
            read -p "Type 'RESTORE' to confirm: " confirm

            if [[ "$confirm" != "RESTORE" ]]; then
                log "Restore cancelled by user"
                exit 0
            fi

            restore_volume_tar "$backup_file" "$volume"

            log "========================================"
            log "Docker Volume Restore Complete"
            log "========================================"
            ;;

        list)
            list_backups
            ;;

        retention)
            log "========================================"
            log "Applying Retention Policy"
            log "========================================"

            apply_retention "$retention_days" "tar"

            if [[ "$use_restic" == true ]] || [[ -n "$RESTIC_REPOSITORY" ]]; then
                apply_retention "$retention_days" "restic"
            fi

            log "========================================"
            log "Retention Policy Applied"
            log "========================================"
            ;;

        *)
            error_exit "Unknown command: $command"
            ;;
    esac

    exit 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
