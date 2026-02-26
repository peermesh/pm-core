#!/bin/bash
# ==============================================================
# Pre-Deployment Backup Snapshot
# ==============================================================
# Purpose: Create a quick local snapshot before deployments or
#          password rotations. No encryption, no S3 -- just fast
#          local backups that can be restored immediately if the
#          deployment goes wrong.
# Features:
#   - Auto-detects running database containers
#   - Backs up all active databases + configuration
#   - Writes to /var/backups/pmdl/pre-deploy/ tier
#   - Keeps only the 5 most recent pre-deploy backups (auto-prune)
#   - SHA-256 checksums for every artifact
#   - Secrets read from file-based paths (never env vars)
#
# Usage: scripts/backup-predeploy.sh [all|postgres|mysql|mongodb|config] [--help]
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl}"
SECRET_DIR="${SECRET_DIR:-${PROJECT_ROOT}/secrets}"
PREDEPLOY_DIR="${BACKUP_DIR}/pre-deploy"
MAX_PREDEPLOY_BACKUPS=5

# Container names
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-pmdl_postgres}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-pmdl_mysql}"
MONGODB_CONTAINER="${MONGODB_CONTAINER:-pmdl_mongodb}"

# Timestamps
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DATE=$(date +%Y-%m-%d)
LOG_FILE="${BACKUP_DIR}/logs/backup-${DATE}.log"

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [pre-deploy] $*"
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

# Read password from secrets (container secrets or local file)
read_secret() {
    local secret_name="$1"

    # Try Docker secret path first (when running inside container)
    if [[ -f "/run/secrets/${secret_name}" ]]; then
        cat "/run/secrets/${secret_name}"
        return
    fi

    # Try local secrets directory
    if [[ -f "${SECRET_DIR}/${secret_name}" ]]; then
        cat "${SECRET_DIR}/${secret_name}"
        return
    fi

    # Try project root secrets
    if [[ -f "${PROJECT_ROOT}/secrets/${secret_name}" ]]; then
        cat "${PROJECT_ROOT}/secrets/${secret_name}"
        return
    fi

    # Return empty if not found (let caller decide if required)
    echo ""
}

# Update atomic symlink
update_symlink() {
    local target="$1"
    local link_path="$2"

    ln -sf "$(basename "$target")" "${link_path}.new"
    mv "${link_path}.new" "$link_path"
}

# Check if a container is running
container_running() {
    local container="$1"
    docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null | grep -q "true"
}

# ==============================================================
# Pruning
# ==============================================================

prune_old_backups() {
    log "Pruning pre-deploy backups (keeping newest $MAX_PREDEPLOY_BACKUPS)..."

    # Prune each file type independently
    for pattern in "*.sql.gz" "*.archive.gz" "*.tar.gz"; do
        local count
        count=$(find "$PREDEPLOY_DIR" -maxdepth 1 -name "$pattern" -type f 2>/dev/null | wc -l | tr -d ' ')
        if [[ "$count" -gt "$MAX_PREDEPLOY_BACKUPS" ]]; then
            ls -t "${PREDEPLOY_DIR}"/$pattern 2>/dev/null | tail -n +$((MAX_PREDEPLOY_BACKUPS + 1)) | while read -r old_file; do
                rm -f "$old_file"
                rm -f "${old_file}.sha256"
                log "Pruned old backup: $old_file"
            done
        fi
    done

    # Prune orphaned checksum files (whose backup no longer exists)
    find "$PREDEPLOY_DIR" -maxdepth 1 -name "*.sha256" -type f 2>/dev/null | while read -r checksum_file; do
        local base_file="${checksum_file%.sha256}"
        if [[ ! -f "$base_file" ]]; then
            rm -f "$checksum_file"
        fi
    done

    log "Pruning complete"
}

# ==============================================================
# Detection
# ==============================================================

detect_active_profiles() {
    local profiles=()

    if container_running "$POSTGRES_CONTAINER"; then
        profiles+=("postgres")
        log "Detected running container: $POSTGRES_CONTAINER"
    fi

    if container_running "$MYSQL_CONTAINER"; then
        profiles+=("mysql")
        log "Detected running container: $MYSQL_CONTAINER"
    fi

    if container_running "$MONGODB_CONTAINER"; then
        profiles+=("mongodb")
        log "Detected running container: $MONGODB_CONTAINER"
    fi

    if [[ ${#profiles[@]} -eq 0 ]]; then
        warn "No database containers detected as running"
    fi

    echo "${profiles[@]:-}"
}

# ==============================================================
# Backup Functions
# ==============================================================

backup_postgres() {
    log "--- PostgreSQL Pre-Deploy Snapshot ---"

    if ! container_running "$POSTGRES_CONTAINER"; then
        error_exit "PostgreSQL container not running: $POSTGRES_CONTAINER"
    fi

    local output_file="${PREDEPLOY_DIR}/predeploy-postgres-${TIMESTAMP}.sql.gz"
    local checksum_file="${output_file}.sha256"

    docker exec "$POSTGRES_CONTAINER" pg_dumpall \
        -U postgres \
        --clean \
        --if-exists \
        2>> "$LOG_FILE" \
        | gzip > "$output_file" \
        || error_exit "pg_dumpall failed"

    sha256sum "$output_file" > "$checksum_file"
    gzip -t "$output_file" || error_exit "PostgreSQL pre-deploy backup verification failed"

    local size
    size=$(du -h "$output_file" | cut -f1)
    log "PostgreSQL pre-deploy snapshot: $output_file ($size)"

    update_symlink "$output_file" "${PREDEPLOY_DIR}/predeploy-postgres-latest.sql.gz"
}

backup_mysql() {
    log "--- MySQL Pre-Deploy Snapshot ---"

    if ! container_running "$MYSQL_CONTAINER"; then
        error_exit "MySQL container not running: $MYSQL_CONTAINER"
    fi

    local output_file="${PREDEPLOY_DIR}/predeploy-mysql-${TIMESTAMP}.sql.gz"
    local checksum_file="${output_file}.sha256"

    # Read MySQL root password from file-based secret
    local mysql_root_password
    mysql_root_password=$(read_secret "mysql_root_password")
    if [[ -z "$mysql_root_password" ]]; then
        mysql_root_password=$(read_secret "MYSQL_ROOT_PASSWORD")
    fi
    if [[ -z "$mysql_root_password" ]]; then
        error_exit "MySQL root password secret not found (tried mysql_root_password, MYSQL_ROOT_PASSWORD)"
    fi

    docker exec "$MYSQL_CONTAINER" mysqldump \
        -u root \
        --password="$mysql_root_password" \
        --all-databases \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        2>> "$LOG_FILE" \
        | gzip > "$output_file" \
        || error_exit "mysqldump failed"

    sha256sum "$output_file" > "$checksum_file"
    gzip -t "$output_file" || error_exit "MySQL pre-deploy backup verification failed"

    local size
    size=$(du -h "$output_file" | cut -f1)
    log "MySQL pre-deploy snapshot: $output_file ($size)"

    update_symlink "$output_file" "${PREDEPLOY_DIR}/predeploy-mysql-latest.sql.gz"
}

backup_mongodb() {
    log "--- MongoDB Pre-Deploy Snapshot ---"

    if ! container_running "$MONGODB_CONTAINER"; then
        error_exit "MongoDB container not running: $MONGODB_CONTAINER"
    fi

    local output_file="${PREDEPLOY_DIR}/predeploy-mongodb-${TIMESTAMP}.archive.gz"
    local checksum_file="${output_file}.sha256"

    # Read MongoDB credentials from file-based secrets
    local mongo_user
    local mongo_password
    mongo_user=$(read_secret "mongo_root_username")
    mongo_password=$(read_secret "mongo_root_password")

    # Build auth args if credentials are available
    local auth_args=""
    if [[ -n "$mongo_user" ]] && [[ -n "$mongo_password" ]]; then
        auth_args="--username=${mongo_user} --password=${mongo_password} --authenticationDatabase=admin"
    fi

    # shellcheck disable=SC2086
    docker exec "$MONGODB_CONTAINER" mongodump \
        $auth_args \
        --archive \
        --gzip \
        2>> "$LOG_FILE" \
        > "$output_file" \
        || error_exit "mongodump failed"

    sha256sum "$output_file" > "$checksum_file"

    # Verify non-empty archive
    local file_size
    file_size=$(stat -f%z "$output_file" 2>/dev/null || stat -c%s "$output_file" 2>/dev/null || echo "0")
    if [[ "$file_size" -eq 0 ]]; then
        error_exit "MongoDB pre-deploy backup verification failed - empty archive"
    fi

    local size
    size=$(du -h "$output_file" | cut -f1)
    log "MongoDB pre-deploy snapshot: $output_file ($size)"

    update_symlink "$output_file" "${PREDEPLOY_DIR}/predeploy-mongodb-latest.archive.gz"
}

backup_config() {
    log "--- Configuration Pre-Deploy Snapshot ---"

    local output_file="${PREDEPLOY_DIR}/predeploy-config-${TIMESTAMP}.tar.gz"
    local checksum_file="${output_file}.sha256"

    # Build list of config files to back up
    local tar_args=()

    if [[ -f "${PROJECT_ROOT}/docker-compose.yml" ]]; then
        tar_args+=("docker-compose.yml")
    fi

    if [[ -f "${PROJECT_ROOT}/.env" ]]; then
        tar_args+=(".env")
    fi

    if [[ -d "${PROJECT_ROOT}/secrets" ]]; then
        tar_args+=("secrets/")
    fi

    if [[ ${#tar_args[@]} -eq 0 ]]; then
        warn "No configuration files found to back up"
        return
    fi

    tar -czf "$output_file" \
        -C "$PROJECT_ROOT" \
        "${tar_args[@]}" \
        2>> "$LOG_FILE" \
        || error_exit "Configuration pre-deploy backup tar failed"

    sha256sum "$output_file" > "$checksum_file"
    gzip -t "$output_file" || error_exit "Config pre-deploy backup verification failed"

    local size
    size=$(du -h "$output_file" | cut -f1)
    log "Configuration pre-deploy snapshot: $output_file ($size)"

    update_symlink "$output_file" "${PREDEPLOY_DIR}/predeploy-config-latest.tar.gz"
}

# ==============================================================
# Usage
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [command] [options]

Pre-deployment backup snapshot tool. Creates quick local backups
before deployments and password rotations.

Commands:
    all         Snapshot all active databases + config [default]
    postgres    Snapshot PostgreSQL only
    mysql       Snapshot MySQL only
    mongodb     Snapshot MongoDB only
    config      Snapshot configuration files only

Options:
    -h, --help  Show this help

Behavior:
    Backups are written to:   ${BACKUP_DIR}/pre-deploy/
    Logs are appended to:     ${BACKUP_DIR}/logs/backup-YYYY-MM-DD.log
    Only the $MAX_PREDEPLOY_BACKUPS most recent snapshots per type are kept.
    No encryption, no S3 -- just fast local snapshots.

Environment Variables:
    PROJECT_ROOT            Project root directory (auto-detected)
    BACKUP_DIR              Backup base directory (default: /var/backups/pmdl)
    SECRET_DIR              Secrets directory (default: \$PROJECT_ROOT/secrets)
    POSTGRES_CONTAINER      PostgreSQL container name (default: pmdl_postgres)
    MYSQL_CONTAINER         MySQL container name (default: pmdl_mysql)
    MONGODB_CONTAINER       MongoDB container name (default: pmdl_mongodb)

Examples:
    $0                      # Snapshot all active profiles + config
    $0 all                  # Same as above
    $0 postgres             # Snapshot PostgreSQL only
    $0 config               # Snapshot config files only

EOF
    exit 0
}

# ==============================================================
# Main Execution
# ==============================================================

main() {
    local command="${1:-all}"

    # Handle help flag anywhere in args
    for arg in "$@"; do
        case "$arg" in
            -h|--help)
                usage
                ;;
        esac
    done

    # Ensure directories exist
    ensure_dir "${BACKUP_DIR}/logs"
    ensure_dir "$PREDEPLOY_DIR"

    log "========================================"
    log "PMDL Pre-Deploy Snapshot Started"
    log "Project Root: $PROJECT_ROOT"
    log "Backup Dir:   $PREDEPLOY_DIR"
    log "Command:      $command"
    log "========================================"

    local backup_count=0

    case "$command" in
        all)
            # Detect active profiles
            local profiles
            profiles=$(detect_active_profiles)

            for profile in $profiles; do
                case "$profile" in
                    postgres)
                        backup_postgres
                        backup_count=$((backup_count + 1))
                        ;;
                    mysql)
                        backup_mysql
                        backup_count=$((backup_count + 1))
                        ;;
                    mongodb)
                        backup_mongodb
                        backup_count=$((backup_count + 1))
                        ;;
                esac
            done

            # Always back up config in 'all' mode
            backup_config
            backup_count=$((backup_count + 1))
            ;;
        postgres)
            backup_postgres
            backup_count=$((backup_count + 1))
            ;;
        mysql)
            backup_mysql
            backup_count=$((backup_count + 1))
            ;;
        mongodb)
            backup_mongodb
            backup_count=$((backup_count + 1))
            ;;
        config)
            backup_config
            backup_count=$((backup_count + 1))
            ;;
        *)
            error_exit "Unknown command: $command (use --help for usage)"
            ;;
    esac

    if [[ $backup_count -eq 0 ]]; then
        warn "No backups were performed (no active profiles detected)"
    fi

    # Prune old pre-deploy backups
    prune_old_backups

    # Record success timestamp
    date -Iseconds > "${BACKUP_DIR}/.last_successful_backup"

    log "========================================"
    log "PMDL Pre-Deploy Snapshot Complete"
    log "Snapshots taken: $backup_count"
    log "========================================"

    exit 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
