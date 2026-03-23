#!/bin/bash
# ==============================================================
# Universal Manifest Module - Install Hook
# ==============================================================
# Purpose: Validate environment, check dependencies, create database,
#          run migrations, and initialize secrets.
# Called: Before first deployment, or via: ./hooks/install.sh
#
# Actions:
#   1. Check dependencies (Docker, Docker Compose)
#   2. Check foundation networks (pmdl_proxy-external, pmdl_db-internal)
#   3. Check Traefik is running
#   4. Auto-create .env from .env.example if missing
#   5. Validate DOMAIN is set and not example.com
#   6. Create secrets/ directory and generate password if missing
#   7. Test PostgreSQL connectivity
#   8. Create universal_manifest database if not exists
#   9. Create um user if not exists
#  10. Run initial migration SQL
#  11. Report status
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (installation failed)
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_NAME="universal-manifest"
CONTAINER_NAME="um"

# Database defaults (overridable via .env)
DB_HOST="${UM_DB_HOST:-postgres}"
DB_PORT="${UM_DB_PORT:-5432}"
DB_NAME="${UM_DB_NAME:-universal_manifest}"
DB_USER="${UM_DB_USER:-um}"

# Auto-create .env from .env.example if not present
if [[ -f "${MODULE_DIR}/.env.example" ]] && [[ ! -f "${MODULE_DIR}/.env" ]]; then
    cp "${MODULE_DIR}/.env.example" "${MODULE_DIR}/.env"
    printf "[%s] Created .env from .env.example\n" "$(date '+%Y-%m-%d %H:%M:%S')"
fi

# Source .env if present
if [[ -f "${MODULE_DIR}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    source "${MODULE_DIR}/.env"
    set +a
    DB_HOST="${UM_DB_HOST:-postgres}"
    DB_PORT="${UM_DB_PORT:-5432}"
    DB_NAME="${UM_DB_NAME:-universal_manifest}"
    DB_USER="${UM_DB_USER:-um}"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()         { printf "[%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
log_success() { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
log_warn()    { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
log_error()   { printf "${RED}[ERROR]${NC} %s\n" "$*"; }
log_info()    { printf "${BLUE}[INFO]${NC} %s\n" "$*"; }

# ==============================================================
# Pre-flight Checks
# ==============================================================

check_dependencies() {
    log "Checking dependencies..."

    local missing=()

    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi

    if ! docker compose version &> /dev/null; then
        missing+=("docker-compose-plugin")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing dependencies: ${missing[*]}"
        log_error "Install Docker and the Compose plugin before continuing."
        return 1
    fi

    log_success "Docker and Docker Compose available"
    return 0
}

check_foundation() {
    log "Checking foundation stack..."

    local warnings=0

    if docker network inspect pmdl_proxy-external &> /dev/null; then
        log_success "Foundation network pmdl_proxy-external exists"
    else
        log_warn "Foundation network pmdl_proxy-external not found"
        log_warn "Make sure the foundation stack is running before starting this module"
        ((warnings++))
    fi

    if docker network inspect pmdl_db-internal &> /dev/null; then
        log_success "Foundation network pmdl_db-internal exists"
    else
        log_warn "Foundation network pmdl_db-internal not found"
        log_warn "PostgreSQL connectivity requires this network"
        ((warnings++))
    fi

    if docker ps --filter "name=traefik" --filter "status=running" -q 2>/dev/null | grep -q .; then
        log_success "Traefik is running"
    else
        log_warn "Traefik does not appear to be running"
        log_warn "The module will start but HTTPS routing will not work until Traefik is up"
        ((warnings++))
    fi

    return 0
}

check_configuration() {
    log "Checking configuration..."

    local warnings=0

    if [[ -f "${MODULE_DIR}/.env" ]]; then
        log_success ".env file exists"

        if grep -q "^DOMAIN=" "${MODULE_DIR}/.env" 2>/dev/null; then
            local domain
            domain=$(grep "^DOMAIN=" "${MODULE_DIR}/.env" | cut -d= -f2-)
            if [[ "$domain" == "example.com" ]]; then
                log_warn "DOMAIN is still set to example.com -- update it to your actual domain"
                ((warnings++))
            elif [[ -z "$domain" ]]; then
                log_error "DOMAIN is empty in .env -- Traefik routing will not work"
                return 1
            else
                log_success "DOMAIN configured: ${domain}"
            fi
        else
            log_error "DOMAIN not set in .env -- this is a required configuration"
            return 1
        fi
    else
        log_error ".env file not found"
        log_info "Create it from the template: cp .env.example .env"
        return 1
    fi

    if [[ $warnings -gt 0 ]]; then
        log_warn "Configuration has ${warnings} warning(s) -- review before starting"
    else
        log_success "Configuration validated"
    fi

    return 0
}

# ==============================================================
# Secrets Management
# ==============================================================

setup_secrets() {
    log "Setting up secrets..."

    if [[ ! -d "${MODULE_DIR}/secrets" ]]; then
        mkdir -p "${MODULE_DIR}/secrets"
        log_success "Created secrets/ directory"
    fi

    if [[ ! -f "${MODULE_DIR}/secrets/um_db_password" ]]; then
        openssl rand -base64 32 > "${MODULE_DIR}/secrets/um_db_password"
        chmod 600 "${MODULE_DIR}/secrets/um_db_password"
        log_success "Generated secrets/um_db_password"
    else
        log_success "secrets/um_db_password already exists"
    fi

    return 0
}

# ==============================================================
# Database Setup
# ==============================================================

find_postgres_container() {
    local pg_container
    pg_container=$(docker ps --filter "network=pmdl_db-internal" --filter "status=running" \
        --format '{{.Names}}' 2>/dev/null | grep -i "postgres" | head -1 || printf "")

    if [[ -z "$pg_container" ]]; then
        for name in postgres pmdl_postgres postgresql pmdl-postgres; do
            if docker ps --filter "name=${name}" --filter "status=running" -q 2>/dev/null | grep -q .; then
                pg_container="$name"
                break
            fi
        done
    fi

    printf "%s" "$pg_container"
}

test_postgres_connectivity() {
    log "Testing PostgreSQL connectivity..."

    local pg_container
    pg_container=$(find_postgres_container)

    if [[ -z "$pg_container" ]]; then
        log_error "No PostgreSQL container found on pmdl_db-internal network"
        log_info "Ensure the foundation database profile is running"
        return 1
    fi

    log_info "Found PostgreSQL container: ${pg_container}"

    if docker exec "$pg_container" pg_isready -h 127.0.0.1 -p "${DB_PORT}" &> /dev/null; then
        log_success "PostgreSQL is accepting connections"
        return 0
    else
        log_error "PostgreSQL is not accepting connections on port ${DB_PORT}"
        return 1
    fi
}

setup_database() {
    log "Setting up database..."

    local pg_container
    pg_container=$(find_postgres_container)

    if [[ -z "$pg_container" ]]; then
        log_error "No PostgreSQL container found -- cannot set up database"
        return 1
    fi

    local db_password=""
    if [[ -f "${MODULE_DIR}/secrets/um_db_password" ]]; then
        db_password=$(cat "${MODULE_DIR}/secrets/um_db_password")
    fi

    if [[ -z "$db_password" ]]; then
        log_error "Database password not found in secrets/um_db_password"
        return 1
    fi

    local psql_prefix="psql -h 127.0.0.1 -p ${DB_PORT} -U postgres"

    # Create database if not exists
    local db_exists
    db_exists=$(docker exec "$pg_container" sh -c "${psql_prefix} -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';\"" 2>/dev/null || printf "")

    if [[ "$db_exists" != "1" ]]; then
        if docker exec "$pg_container" sh -c "${psql_prefix} -c \"CREATE DATABASE ${DB_NAME};\"" 2>/dev/null; then
            log_success "Created database: ${DB_NAME}"
        else
            log_error "Failed to create database: ${DB_NAME}"
            return 1
        fi
    else
        log_success "Database already exists: ${DB_NAME}"
    fi

    # Create user if not exists
    local user_exists
    user_exists=$(docker exec "$pg_container" sh -c "${psql_prefix} -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}';\"" 2>/dev/null || printf "")

    if [[ "$user_exists" != "1" ]]; then
        local escaped_password="${db_password//\'/\'\'}"
        if docker exec "$pg_container" sh -c "${psql_prefix} -c \"CREATE USER ${DB_USER} WITH PASSWORD '${escaped_password}';\"" 2>/dev/null; then
            log_success "Created database user: ${DB_USER}"
        else
            log_error "Failed to create database user: ${DB_USER}"
            return 1
        fi
    else
        log_success "Database user already exists: ${DB_USER}"
    fi

    # Grant privileges
    docker exec "$pg_container" sh -c "${psql_prefix} -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\"" 2>/dev/null || true
    docker exec "$pg_container" sh -c "${psql_prefix} -d ${DB_NAME} -c \"GRANT ALL ON SCHEMA public TO ${DB_USER};\"" 2>/dev/null || true
    docker exec "$pg_container" sh -c "${psql_prefix} -d ${DB_NAME} -c \"GRANT CREATE ON DATABASE ${DB_NAME} TO ${DB_USER};\"" 2>/dev/null || true
    log_success "Granted privileges to ${DB_USER} on ${DB_NAME}"

    return 0
}

run_migrations() {
    log "Running database migrations..."

    local pg_container
    pg_container=$(find_postgres_container)

    if [[ -z "$pg_container" ]]; then
        log_error "No PostgreSQL container found -- cannot run migrations"
        return 1
    fi

    local migration_file="${MODULE_DIR}/migrations/001_initial.sql"

    if [[ ! -f "$migration_file" ]]; then
        log_warn "Migration file not found: ${migration_file}"
        log_info "Skipping migrations (no migration files present)"
        return 0
    fi

    local psql_prefix="psql -h 127.0.0.1 -p ${DB_PORT} -U postgres -d ${DB_NAME}"

    # Check if migration already applied
    local migration_applied
    migration_applied=$(docker exec "$pg_container" sh -c "${psql_prefix} -tAc \"SELECT 1 FROM um.schema_migrations WHERE version='001';\"" 2>/dev/null || printf "")

    if [[ "$migration_applied" == "1" ]]; then
        log_success "Migration 001 already applied"
        return 0
    fi

    # Copy migration file into container and execute
    docker cp "$migration_file" "${pg_container}:/tmp/001_initial.sql"

    if docker exec "$pg_container" sh -c "${psql_prefix} -f /tmp/001_initial.sql" 2>/dev/null; then
        log_success "Migration 001 applied successfully"
    else
        log_error "Failed to apply migration 001"
        return 1
    fi

    # Clean up temp file
    docker exec "$pg_container" rm -f /tmp/001_initial.sql 2>/dev/null || true

    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Installing ${MODULE_NAME}"
    log "========================================"
    log ""

    local errors=0

    check_dependencies || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "Pre-flight checks failed"
        exit 1
    fi

    check_foundation
    check_configuration || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "Configuration checks failed"
        exit 1
    fi

    setup_secrets || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "Secrets setup failed"
        exit 1
    fi

    # Database setup
    test_postgres_connectivity || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "PostgreSQL is not reachable -- database setup skipped"
        log_info "Ensure the foundation database profile is running, then re-run install"
        exit 1
    fi

    setup_database || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "Database setup failed"
        exit 1
    fi

    run_migrations || ((errors++))

    log ""
    log "========================================"

    if [[ $errors -gt 0 ]]; then
        log_error "Installation completed with ${errors} error(s)"
        exit 1
    fi

    log_success "${MODULE_NAME} installed successfully"
    log ""
    log "Next steps:"
    log "  1. Review .env configuration:"
    log "     \$EDITOR ${MODULE_DIR}/.env"
    log ""
    log "  2. Start the module:"
    log "     ./hooks/start.sh"
    log "     # or: docker compose up -d"
    log ""
    log "  3. Verify it works:"
    log "     ./hooks/health.sh"
    log ""
    log "========================================"

    exit 0
}

main "$@"
