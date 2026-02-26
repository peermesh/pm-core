#!/bin/bash
# ==============================================================
# Top-Level Backup Orchestrator
# ==============================================================
# Purpose: Detect active database profiles and orchestrate backups
#          across all running services plus configuration files
# Features:
#   - Auto-detects running database containers (postgres, mysql, mongodb)
#   - Delegates to per-profile backup scripts where available
#   - Backs up configuration files (docker-compose.yml, .env, secrets/)
#   - SHA-256 checksums for all backup artifacts
#   - Timestamp-based filenames with latest symlinks
#   - Structured logging to /var/backups/pmdl/logs/
#   - Secrets read from file-based paths (never env vars)
#
# Usage: scripts/backup.sh [all|postgres|mysql|mongodb|config] [--help]
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pmdl}"
SECRET_DIR="${SECRET_DIR:-${PROJECT_ROOT}/secrets}"

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
    log "--- PostgreSQL Backup ---"

    if ! container_running "$POSTGRES_CONTAINER"; then
        error_exit "PostgreSQL container not running: $POSTGRES_CONTAINER"
    fi

    local pg_script="${PROJECT_ROOT}/scripts/backup/backup-postgres.sh"
    if [[ -x "$pg_script" ]]; then
        log "Delegating to: $pg_script"
        BACKUP_DIR="${BACKUP_DIR}/postgres" \
        CONTAINER_NAME="$POSTGRES_CONTAINER" \
        SECRET_DIR="$SECRET_DIR" \
        PROJECT_ROOT="$PROJECT_ROOT" \
            "$pg_script" all
    else
        # Fallback: inline pg_dumpall
        log "backup-postgres.sh not found, using inline pg_dumpall"
        local output_dir="${BACKUP_DIR}/daily"
        local output_file="${output_dir}/postgres-all-${TIMESTAMP}.sql.gz"
        local checksum_file="${output_file}.sha256"

        ensure_dir "$output_dir"

        docker exec "$POSTGRES_CONTAINER" pg_dumpall \
            -U postgres \
            --clean \
            --if-exists \
            2>> "$LOG_FILE" \
            | gzip > "$output_file" \
            || error_exit "pg_dumpall failed"

        sha256sum "$output_file" > "$checksum_file"
        gzip -t "$output_file" || error_exit "PostgreSQL backup verification failed - corrupt gzip"

        local size
        size=$(du -h "$output_file" | cut -f1)
        log "PostgreSQL backup complete: $output_file ($size)"

        update_symlink "$output_file" "${output_dir}/postgres-all-latest.sql.gz"
    fi

    log "PostgreSQL backup finished"
}

backup_mysql() {
    log "--- MySQL Backup ---"

    if ! container_running "$MYSQL_CONTAINER"; then
        error_exit "MySQL container not running: $MYSQL_CONTAINER"
    fi

    local output_dir="${BACKUP_DIR}/daily"
    local output_file="${output_dir}/mysql-all-${TIMESTAMP}.sql.gz"
    local checksum_file="${output_file}.sha256"

    ensure_dir "$output_dir"

    # Read MySQL root password from file-based secret
    local mysql_root_password
    mysql_root_password=$(read_secret "mysql_root_password")
    if [[ -z "$mysql_root_password" ]]; then
        mysql_root_password=$(read_secret "MYSQL_ROOT_PASSWORD")
    fi
    if [[ -z "$mysql_root_password" ]]; then
        error_exit "MySQL root password secret not found (tried mysql_root_password, MYSQL_ROOT_PASSWORD)"
    fi

    # Execute mysqldump --all-databases via docker exec
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

    # Generate checksum
    sha256sum "$output_file" > "$checksum_file"

    # Verify backup integrity
    gzip -t "$output_file" || error_exit "MySQL backup verification failed - corrupt gzip"

    local size
    size=$(du -h "$output_file" | cut -f1)
    log "MySQL backup complete: $output_file ($size)"

    # Update latest symlink
    update_symlink "$output_file" "${output_dir}/mysql-all-latest.sql.gz"

    log "MySQL backup finished"
}

backup_mongodb() {
    log "--- MongoDB Backup ---"

    if ! container_running "$MONGODB_CONTAINER"; then
        error_exit "MongoDB container not running: $MONGODB_CONTAINER"
    fi

    local output_dir="${BACKUP_DIR}/daily"
    local archive_file="${output_dir}/mongodb-all-${TIMESTAMP}.archive.gz"
    local checksum_file="${archive_file}.sha256"

    ensure_dir "$output_dir"

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

    # Execute mongodump via docker exec, producing gzipped archive
    # shellcheck disable=SC2086
    docker exec "$MONGODB_CONTAINER" mongodump \
        $auth_args \
        --archive \
        --gzip \
        2>> "$LOG_FILE" \
        > "$archive_file" \
        || error_exit "mongodump failed"

    # Generate checksum
    sha256sum "$archive_file" > "$checksum_file"

    # Verify non-empty archive
    local file_size
    file_size=$(stat -f%z "$archive_file" 2>/dev/null || stat -c%s "$archive_file" 2>/dev/null || echo "0")
    if [[ "$file_size" -eq 0 ]]; then
        error_exit "MongoDB backup verification failed - empty archive"
    fi

    local size
    size=$(du -h "$archive_file" | cut -f1)
    log "MongoDB backup complete: $archive_file ($size)"

    # Update latest symlink
    update_symlink "$archive_file" "${output_dir}/mongodb-all-latest.archive.gz"

    log "MongoDB backup finished"
}

backup_config() {
    log "--- Configuration Backup ---"

    local output_dir="${BACKUP_DIR}/daily"
    local output_file="${output_dir}/config-${TIMESTAMP}.tar.gz"
    local checksum_file="${output_file}.sha256"

    ensure_dir "$output_dir"

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

    # Create compressed tar from project root
    tar -czf "$output_file" \
        -C "$PROJECT_ROOT" \
        "${tar_args[@]}" \
        2>> "$LOG_FILE" \
        || error_exit "Configuration backup tar failed"

    # Generate checksum
    sha256sum "$output_file" > "$checksum_file"

    # Verify backup integrity
    gzip -t "$output_file" || error_exit "Config backup verification failed - corrupt gzip"

    local size
    size=$(du -h "$output_file" | cut -f1)
    log "Configuration backup complete: $output_file ($size)"

    # Update latest symlink
    update_symlink "$output_file" "${output_dir}/config-latest.tar.gz"

    log "Configuration backup finished"
}

# ==============================================================
# Usage
# ==============================================================

usage() {
    cat <<EOF
Usage: $0 [command] [options]

Commands:
    all         Backup all active databases + config [default]
    postgres    Backup PostgreSQL only
    mysql       Backup MySQL only
    mongodb     Backup MongoDB only
    config      Backup configuration files only

Options:
    -h, --help  Show this help

Behavior:
    When 'all' is specified (or no command given), the script auto-detects
    which database containers are running (pmdl_postgres, pmdl_mysql,
    pmdl_mongodb) and backs up each active profile plus configuration.

    Backups are written to: ${BACKUP_DIR}/daily/
    Logs are written to:    ${BACKUP_DIR}/logs/backup-YYYY-MM-DD.log
    Checksums (.sha256) are generated for every backup artifact.
    A 'latest' symlink is updated for each backup type.
    A .last_successful_backup timestamp file is written on success.

Environment Variables:
    PROJECT_ROOT            Project root directory (auto-detected)
    BACKUP_DIR              Backup base directory (default: /var/backups/pmdl)
    SECRET_DIR              Secrets directory (default: \$PROJECT_ROOT/secrets)
    POSTGRES_CONTAINER      PostgreSQL container name (default: pmdl_postgres)
    MYSQL_CONTAINER         MySQL container name (default: pmdl_mysql)
    MONGODB_CONTAINER       MongoDB container name (default: pmdl_mongodb)

Examples:
    $0                      # Backup all active profiles + config
    $0 all                  # Same as above
    $0 postgres             # Backup PostgreSQL only
    $0 mysql                # Backup MySQL only
    $0 mongodb              # Backup MongoDB only
    $0 config               # Backup configuration files only

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

    # Ensure log and daily directories exist
    ensure_dir "${BACKUP_DIR}/logs"
    ensure_dir "${BACKUP_DIR}/daily"

    log "========================================"
    log "PMDL Backup Orchestrator Started"
    log "Project Root: $PROJECT_ROOT"
    log "Backup Dir:   $BACKUP_DIR"
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

    # Record success timestamp
    date -Iseconds > "${BACKUP_DIR}/.last_successful_backup"

    log "========================================"
    log "PMDL Backup Orchestrator Complete"
    log "Backups performed: $backup_count"
    log "========================================"

    exit 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
