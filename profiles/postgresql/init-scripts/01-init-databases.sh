#!/bin/bash
# ==============================================================
# PostgreSQL Database Initialization Script
# ==============================================================
# Purpose: Create application databases, users, and enable extensions
# Execution: First container start with empty data volume ONLY
#
# CRITICAL: This script reads passwords from Docker secrets
#           (/run/secrets/). NEVER hardcode passwords.
#
# Profile: postgresql
# Documentation: profiles/postgresql/PROFILE-SPEC.md
# Decision Reference: D2.3-DATABASE-INIT.md, D2.6-POSTGRESQL-EXTENSIONS.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

# Databases to create
DATABASES=(
    "synapse"       # Matrix Synapse federation server
    "librechat"     # LibreChat AI assistant
)

# Users mapping: user=database (user gets full access to database)
declare -A USER_DB_MAP=(
    ["synapse"]="synapse"
    ["librechat"]="librechat"
)

# Databases requiring pgvector extension
VECTOR_DATABASES=(
    "librechat"
)

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

read_secret() {
    local secret_name="$1"
    local secret_file="/run/secrets/${secret_name}"

    if [[ -f "$secret_file" ]]; then
        cat "$secret_file"
    else
        log "WARNING: Secret file not found: $secret_file"
        echo ""
    fi
}

# ==============================================================
# Main Initialization
# ==============================================================

log "========================================"
log "PostgreSQL Initialization Starting"
log "========================================"

# ----------------------------------------------------------
# Step 1: Create Databases
# ----------------------------------------------------------
log "Step 1: Creating databases..."

for db in "${DATABASES[@]}"; do
    log "  Creating database: $db"

    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        -- Create database if not exists (idempotent)
        SELECT 'CREATE DATABASE $db'
        WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db')
        \gexec

        -- Configure database
        ALTER DATABASE $db SET timezone TO 'UTC';
EOSQL

    log "  Database $db created/verified"
done

# ----------------------------------------------------------
# Step 2: Create Users with Secrets-Based Passwords
# ----------------------------------------------------------
log "Step 2: Creating users..."

for user in "${!USER_DB_MAP[@]}"; do
    db="${USER_DB_MAP[$user]}"
    secret_name="${user}_db_password"

    # Read password from secrets
    password=$(read_secret "$secret_name")

    if [[ -z "$password" ]]; then
        log "  WARNING: No password found for $user (secret: $secret_name)"
        log "  Skipping user creation - ensure secrets are mounted"
        continue
    fi

    log "  Creating user: $user (for database: $db)"

    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        -- Create user if not exists (idempotent using DO block)
        DO \$\$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$user') THEN
                CREATE USER $user WITH PASSWORD '$password';
                RAISE NOTICE 'Created user: $user';
            ELSE
                -- Update password in case it changed
                ALTER USER $user WITH PASSWORD '$password';
                RAISE NOTICE 'Updated password for user: $user';
            END IF;
        END
        \$\$;
EOSQL

    log "  User $user created/updated"
done

# ----------------------------------------------------------
# Step 3: Enable pgvector Extension
# ----------------------------------------------------------
log "Step 3: Enabling pgvector extension..."

for db in "${VECTOR_DATABASES[@]}"; do
    log "  Enabling pgvector in database: $db"

    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
        -- Enable pgvector extension (idempotent)
        CREATE EXTENSION IF NOT EXISTS vector;

        -- Verify installation
        DO \$\$
        DECLARE
            v_version text;
        BEGIN
            SELECT extversion INTO v_version
            FROM pg_extension
            WHERE extname = 'vector';

            IF v_version IS NULL THEN
                RAISE EXCEPTION 'pgvector extension failed to install in $db';
            ELSE
                RAISE NOTICE 'pgvector version % installed in $db', v_version;
            END IF;
        END
        \$\$;
EOSQL

    log "  pgvector enabled in $db"
done

# ----------------------------------------------------------
# Step 4: Grant Permissions
# ----------------------------------------------------------
log "Step 4: Granting permissions..."

for user in "${!USER_DB_MAP[@]}"; do
    db="${USER_DB_MAP[$user]}"

    log "  Granting permissions: $user -> $db"

    # Grant database-level permissions
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        GRANT ALL PRIVILEGES ON DATABASE $db TO $user;
EOSQL

    # Grant schema-level permissions (required for table creation)
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
        -- Grant schema permissions
        GRANT ALL ON SCHEMA public TO $user;

        -- Grant default privileges for future objects
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT ALL ON TABLES TO $user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT ALL ON SEQUENCES TO $user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT ALL ON FUNCTIONS TO $user;

        -- Grant usage on schema (required for extensions)
        GRANT USAGE ON SCHEMA public TO $user;
EOSQL

    log "  Permissions granted for $user"
done

# ----------------------------------------------------------
# Step 5: Verification
# ----------------------------------------------------------
log "Step 5: Running verification..."

# Verify databases exist
log "  Verifying databases..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "\l" | \
    grep -E "$(IFS='|'; echo "${DATABASES[*]}")" && \
    log "  All databases verified" || \
    log "  WARNING: Some databases may be missing"

# Verify users exist
log "  Verifying users..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "\du" | \
    grep -E "$(IFS='|'; echo "${!USER_DB_MAP[*]}")" && \
    log "  All users verified" || \
    log "  WARNING: Some users may be missing"

# Verify pgvector extension
for db in "${VECTOR_DATABASES[@]}"; do
    log "  Verifying pgvector in $db..."
    version=$(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" -t -c \
        "SELECT extversion FROM pg_extension WHERE extname = 'vector';" | tr -d '[:space:]')

    if [[ -n "$version" ]]; then
        log "  pgvector $version installed in $db"
    else
        log "  WARNING: pgvector not found in $db"
    fi
done

# ----------------------------------------------------------
# Complete
# ----------------------------------------------------------
log "========================================"
log "PostgreSQL Initialization Complete"
log "========================================"
log "Databases: ${DATABASES[*]}"
log "Users: ${!USER_DB_MAP[*]}"
log "Vector-enabled: ${VECTOR_DATABASES[*]}"
log "========================================"

exit 0
