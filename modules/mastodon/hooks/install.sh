#!/bin/bash
# ==============================================================
# Mastodon Module - Install Hook
# ==============================================================
# Purpose: Initialize Mastodon module, generate secrets, and
#          set up database for first-time installation
#
# Called: When module is first installed via pmdl module install mastodon
#
# Prerequisites:
#   - PostgreSQL profile must be enabled
#   - Redis profile must be enabled
#   - Docker and docker compose must be available
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (installation failed)
# ==============================================================

set -euo pipefail

# Configuration
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "${MODULE_DIR}/../.." && pwd)"
CONFIGS_DIR="${MODULE_DIR}/configs"
SECRETS_DIR="${PROJECT_ROOT}/secrets"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
# Pre-flight Checks
# ==============================================================

check_dependencies() {
    log "Checking dependencies..."

    local missing=()

    # Check for Docker
    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi

    # Check for docker compose
    if ! docker compose version &> /dev/null; then
        missing+=("docker-compose-plugin")
    fi

    # Check for openssl (needed for secret generation)
    if ! command -v openssl &> /dev/null; then
        missing+=("openssl")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing dependencies: ${missing[*]}"
        return 1
    fi

    log_success "All dependencies available"
    return 0
}

check_docker_socket() {
    log "Checking Docker socket access..."

    if [[ ! -S /var/run/docker.sock ]]; then
        log_error "Docker socket not found at /var/run/docker.sock"
        return 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Cannot connect to Docker daemon"
        return 1
    fi

    log_success "Docker socket accessible"
    return 0
}

check_networks() {
    log "Checking required Docker networks..."

    local required_networks=("pmdl_db-internal" "pmdl_app-internal" "pmdl_proxy-external")
    local missing=()

    for network in "${required_networks[@]}"; do
        if ! docker network inspect "$network" &> /dev/null; then
            missing+=("$network")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing networks: ${missing[*]}"
        log_error "Please start the foundation services first: docker compose up -d"
        return 1
    fi

    log_success "All required networks exist"
    return 0
}

check_postgres() {
    log "Checking PostgreSQL availability..."

    if docker ps --filter "name=pmdl_postgres" --filter "status=running" --format '{{.Names}}' | grep -q "pmdl_postgres"; then
        log_success "PostgreSQL is running"
        return 0
    else
        log_warn "PostgreSQL container (pmdl_postgres) is not running"
        log_warn "Enable the postgresql profile: COMPOSE_PROFILES=postgresql docker compose up -d postgres"
        return 1
    fi
}

check_redis() {
    log "Checking Redis availability..."

    if docker ps --filter "name=pmdl_redis" --filter "status=running" --format '{{.Names}}' | grep -q "pmdl_redis"; then
        log_success "Redis is running"
        return 0
    else
        log_warn "Redis container (pmdl_redis) is not running"
        log_warn "Enable the redis profile: COMPOSE_PROFILES=redis docker compose up -d redis"
        return 1
    fi
}

# ==============================================================
# Directory Setup
# ==============================================================

create_directories() {
    log "Creating module directories..."

    mkdir -p "${CONFIGS_DIR}"
    mkdir -p "${MODULE_DIR}/init-scripts"

    log_success "Module directories created"
}

# ==============================================================
# Secret Generation
# ==============================================================

generate_secret() {
    # Generate a secure random string
    openssl rand -hex 64
}

generate_secrets() {
    log "Generating Mastodon secrets..."

    local secrets_file="${CONFIGS_DIR}/mastodon_secrets.env"

    # Check if secrets already exist
    if [[ -f "$secrets_file" ]] && [[ -s "$secrets_file" ]]; then
        log_warn "Secrets file already exists: ${secrets_file}"
        log_info "To regenerate, delete the file and run install again"
        return 0
    fi

    # Generate SECRET_KEY_BASE
    local secret_key_base
    secret_key_base=$(generate_secret)
    log_success "Generated SECRET_KEY_BASE"

    # Generate OTP_SECRET
    local otp_secret
    otp_secret=$(generate_secret)
    log_success "Generated OTP_SECRET"

    # Generate VAPID keys for web push
    log_info "Generating VAPID keys for web push notifications..."

    # We'll generate placeholder VAPID keys - real ones need to be generated
    # by the Mastodon container using: docker compose run --rm mastodon-web bundle exec rake mastodon:webpush:generate_vapid_key
    local vapid_private="PLACEHOLDER_GENERATE_WITH_RAKE_TASK"
    local vapid_public="PLACEHOLDER_GENERATE_WITH_RAKE_TASK"

    # Write secrets to file
    cat > "$secrets_file" << EOF
# Mastodon Secrets
# Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
# WARNING: Keep this file secure and never commit to version control

# Rails secret key base - used for session cookies and other security
MASTODON_SECRET_KEY_BASE=${secret_key_base}

# OTP secret - used for two-factor authentication
MASTODON_OTP_SECRET=${otp_secret}

# VAPID keys for web push notifications
# Generate real keys with: docker compose run --rm mastodon-web bundle exec rake mastodon:webpush:generate_vapid_key
MASTODON_VAPID_PRIVATE_KEY=${vapid_private}
MASTODON_VAPID_PUBLIC_KEY=${vapid_public}
EOF

    chmod 600 "$secrets_file"
    log_success "Secrets written to: ${secrets_file}"

    # Create individual secret files for Docker secrets pattern
    echo -n "$secret_key_base" > "${SECRETS_DIR}/mastodon_secret_key_base"
    chmod 600 "${SECRETS_DIR}/mastodon_secret_key_base"

    echo -n "$otp_secret" > "${SECRETS_DIR}/mastodon_otp_secret"
    chmod 600 "${SECRETS_DIR}/mastodon_otp_secret"

    log_success "Individual secret files created in: ${SECRETS_DIR}/"
}

# ==============================================================
# Database Setup
# ==============================================================

create_database_user() {
    log "Creating Mastodon database user..."

    local db_user="${MASTODON_DB_USER:-mastodon}"
    local db_name="${MASTODON_DB_NAME:-mastodon}"

    # Generate database password if not provided
    local db_password
    if [[ -n "${MASTODON_DB_PASSWORD:-}" ]]; then
        db_password="${MASTODON_DB_PASSWORD}"
    else
        db_password=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
        echo -n "$db_password" > "${SECRETS_DIR}/mastodon_db_password"
        chmod 600 "${SECRETS_DIR}/mastodon_db_password"
        log_success "Generated database password: ${SECRETS_DIR}/mastodon_db_password"
    fi

    # Check if user already exists
    local user_exists
    user_exists=$(docker exec pmdl_postgres psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${db_user}';" 2>/dev/null || echo "")

    if [[ "$user_exists" == "1" ]]; then
        log_warn "Database user '${db_user}' already exists"
    else
        # Create user
        docker exec pmdl_postgres psql -U postgres -c "CREATE USER ${db_user} WITH PASSWORD '${db_password}';" 2>/dev/null || {
            log_error "Failed to create database user"
            return 1
        }
        log_success "Created database user: ${db_user}"
    fi

    # Check if database exists
    local db_exists
    db_exists=$(docker exec pmdl_postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}';" 2>/dev/null || echo "")

    if [[ "$db_exists" == "1" ]]; then
        log_warn "Database '${db_name}' already exists"
    else
        # Create database
        docker exec pmdl_postgres psql -U postgres -c "CREATE DATABASE ${db_name} OWNER ${db_user};" 2>/dev/null || {
            log_error "Failed to create database"
            return 1
        }
        log_success "Created database: ${db_name}"
    fi

    # Grant privileges
    docker exec pmdl_postgres psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE ${db_name} TO ${db_user};" 2>/dev/null || true

    # Save connection info
    cat > "${CONFIGS_DIR}/database.env" << EOF
# Mastodon Database Configuration
MASTODON_DB_HOST=postgres
MASTODON_DB_PORT=5432
MASTODON_DB_NAME=${db_name}
MASTODON_DB_USER=${db_user}
# Password stored in: ${SECRETS_DIR}/mastodon_db_password
EOF

    log_success "Database configuration saved to: ${CONFIGS_DIR}/database.env"
    return 0
}

# ==============================================================
# Database Migration
# ==============================================================

run_migrations() {
    log "Running database migrations..."

    cd "${MODULE_DIR}"

    # Check if .env exists with required variables
    if [[ ! -f "${MODULE_DIR}/.env" ]]; then
        log_warn "No .env file found - skipping migrations"
        log_info "Create .env from .env.example and run: docker compose run --rm mastodon-web bundle exec rails db:migrate"
        return 0
    fi

    # Start OpenSearch first (needed for migrations)
    log_info "Starting OpenSearch..."
    docker compose up -d opensearch || {
        log_warn "Could not start OpenSearch - you may need to run migrations manually"
        return 0
    }

    # Wait for OpenSearch
    log_info "Waiting for OpenSearch to be healthy..."
    local max_wait=120
    local wait_count=0
    while [[ $wait_count -lt $max_wait ]]; do
        if docker compose exec -T opensearch curl -s http://localhost:9200/_cluster/health | grep -q '"status":"green\|yellow"' 2>/dev/null; then
            log_success "OpenSearch is ready"
            break
        fi
        sleep 2
        ((wait_count+=2))
    done

    if [[ $wait_count -ge $max_wait ]]; then
        log_warn "OpenSearch did not become healthy in time - skipping migrations"
        return 0
    fi

    # Run migrations
    log_info "Running Rails migrations..."
    if docker compose run --rm mastodon-web bundle exec rails db:migrate 2>&1; then
        log_success "Database migrations completed"
    else
        log_warn "Migrations may have failed - check the output above"
    fi

    return 0
}

# ==============================================================
# Environment Template
# ==============================================================

create_env_example() {
    log "Creating .env.example..."

    if [[ -f "${MODULE_DIR}/.env.example" ]]; then
        log_warn ".env.example already exists"
        return 0
    fi

    cat > "${MODULE_DIR}/.env.example" << 'EOF'
# ==============================================================
# Mastodon Module - Environment Configuration
# ==============================================================
# Copy this file to .env and configure for your instance
#
# Required variables are marked with (REQUIRED)
# Optional variables have sensible defaults
# ==============================================================

# --------------------------------------------------------------
# Instance Configuration (REQUIRED)
# --------------------------------------------------------------

# Your instance domain (e.g., mastodon.example.com)
MASTODON_LOCAL_DOMAIN=mastodon.example.com

# Single user mode (set to true for personal instance)
MASTODON_SINGLE_USER_MODE=false

# Instance title and description
MASTODON_SITE_TITLE=My Mastodon Instance
MASTODON_SITE_DESCRIPTION=A federated social network

# Admin contact email
MASTODON_ADMIN_EMAIL=admin@example.com

# --------------------------------------------------------------
# Security Keys (REQUIRED - auto-generated by install.sh)
# --------------------------------------------------------------
# Load from configs/mastodon_secrets.env or set directly

MASTODON_SECRET_KEY_BASE=
MASTODON_OTP_SECRET=

# VAPID keys for web push (generate with rake task)
MASTODON_VAPID_PRIVATE_KEY=
MASTODON_VAPID_PUBLIC_KEY=

# --------------------------------------------------------------
# Database Configuration
# --------------------------------------------------------------
# Defaults connect to pmdl_postgres container

MASTODON_DB_HOST=postgres
MASTODON_DB_PORT=5432
MASTODON_DB_NAME=mastodon
MASTODON_DB_USER=mastodon
MASTODON_DB_PASSWORD=

# --------------------------------------------------------------
# Redis Configuration
# --------------------------------------------------------------
# Defaults connect to pmdl_redis container

MASTODON_REDIS_HOST=redis
MASTODON_REDIS_PORT=6379
MASTODON_REDIS_PASSWORD=

# --------------------------------------------------------------
# OpenSearch Configuration
# --------------------------------------------------------------

MASTODON_ES_ENABLED=true
MASTODON_ES_HOST=opensearch
MASTODON_ES_PORT=9200

# --------------------------------------------------------------
# Email Configuration (Optional but recommended)
# --------------------------------------------------------------

MASTODON_SMTP_SERVER=
MASTODON_SMTP_PORT=587
MASTODON_SMTP_LOGIN=
MASTODON_SMTP_PASSWORD=
MASTODON_SMTP_FROM_ADDRESS=notifications@${MASTODON_LOCAL_DOMAIN}
MASTODON_SMTP_AUTH_METHOD=plain
MASTODON_SMTP_ENABLE_STARTTLS=auto

# --------------------------------------------------------------
# S3 Storage (Optional - for media files)
# --------------------------------------------------------------

MASTODON_S3_ENABLED=false
MASTODON_S3_BUCKET=
MASTODON_S3_REGION=us-east-1
MASTODON_S3_ENDPOINT=
MASTODON_S3_ACCESS_KEY=
MASTODON_S3_SECRET_KEY=
MASTODON_S3_HOSTNAME=

# --------------------------------------------------------------
# Performance Tuning
# --------------------------------------------------------------

# Puma web workers (default: 2)
MASTODON_WEB_CONCURRENCY=2

# Threads per worker (default: 5)
MASTODON_MAX_THREADS=5

# Streaming server workers (default: 1)
MASTODON_STREAMING_CLUSTER_NUM=1

# Sidekiq concurrency (default: 25)
MASTODON_SIDEKIQ_CONCURRENCY=25

# Log level (debug, info, warn, error)
MASTODON_LOG_LEVEL=warn

# --------------------------------------------------------------
# Federation Settings
# --------------------------------------------------------------

# Require signed fetch for enhanced privacy
MASTODON_AUTHORIZED_FETCH=true

# Limited federation mode (allowlist only)
MASTODON_LIMITED_FEDERATION_MODE=false

# --------------------------------------------------------------
# Feature Flags
# --------------------------------------------------------------

# Maximum post length (default: 500)
MASTODON_MAX_TOOT_CHARS=500

# Registrations mode: open, approval_required, none
MASTODON_REGISTRATIONS_MODE=approval_required
EOF

    log_success "Created .env.example"
}

# ==============================================================
# Validation
# ==============================================================

validate_installation() {
    log "Validating installation..."

    local warnings=0

    # Check configs directory
    if [[ ! -d "$CONFIGS_DIR" ]]; then
        log_warn "Configs directory missing: ${CONFIGS_DIR}"
        ((warnings++))
    fi

    # Check secrets file
    if [[ ! -f "${CONFIGS_DIR}/mastodon_secrets.env" ]]; then
        log_warn "Secrets file missing: ${CONFIGS_DIR}/mastodon_secrets.env"
        ((warnings++))
    fi

    # Check docker-compose.yml
    if [[ ! -f "${MODULE_DIR}/docker-compose.yml" ]]; then
        log_error "docker-compose.yml missing"
        return 1
    fi

    if [[ $warnings -gt 0 ]]; then
        log_warn "Installation has ${warnings} warning(s)"
    else
        log_success "Installation validated"
    fi

    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Mastodon Module Installation"
    log "========================================"
    log ""

    local errors=0

    # Pre-flight checks
    check_dependencies || ((errors++))
    check_docker_socket || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "Pre-flight checks failed with ${errors} error(s)"
        exit 1
    fi

    # Check infrastructure (warnings only)
    check_networks || true
    check_postgres || true
    check_redis || true

    # Setup
    create_directories
    generate_secrets
    create_env_example

    # Database setup (only if postgres is running)
    if docker ps --filter "name=pmdl_postgres" --filter "status=running" --format '{{.Names}}' | grep -q "pmdl_postgres"; then
        create_database_user || log_warn "Database setup skipped or failed"
    else
        log_warn "PostgreSQL not running - database setup skipped"
    fi

    # Validation
    validate_installation || ((errors++))

    log ""
    log "========================================"

    if [[ $errors -gt 0 ]]; then
        log_error "Installation completed with ${errors} error(s)"
        exit 1
    fi

    log_success "Mastodon module installed successfully"
    log ""
    log "Next steps:"
    log ""
    log "  1. Copy and configure environment:"
    log "     cp ${MODULE_DIR}/.env.example ${MODULE_DIR}/.env"
    log "     # Edit .env with your instance domain and settings"
    log ""
    log "  2. Load secrets (add to .env or source):"
    log "     source ${CONFIGS_DIR}/mastodon_secrets.env"
    log ""
    log "  3. Start the module:"
    log "     cd ${MODULE_DIR}"
    log "     docker compose up -d"
    log ""
    log "  4. Run database migrations (first time only):"
    log "     docker compose run --rm mastodon-web bundle exec rails db:migrate"
    log ""
    log "  5. Create admin user:"
    log "     docker compose run --rm mastodon-web tootctl accounts create admin --email=admin@example.com --confirmed --role=Owner"
    log ""
    log "  6. Generate VAPID keys for web push:"
    log "     docker compose run --rm mastodon-web bundle exec rake mastodon:webpush:generate_vapid_key"
    log ""
    log "========================================"

    exit 0
}

main "$@"
