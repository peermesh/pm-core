#!/bin/bash
# ==============================================================
# PostgreSQL Health Check Script
# ==============================================================
# Purpose: Verify PostgreSQL is healthy and ready to accept connections
# Features:
#   - Works with _FILE secrets pattern (no environment password)
#   - Basic connectivity check via pg_isready
#   - Optional: Verify pgvector extension is available
#   - Optional: Verify application databases exist
#
# Usage:
#   Docker healthcheck: ["CMD", "/healthcheck.sh"]
#   Manual check: docker exec postgres /healthcheck.sh
#
# Profile: postgresql
# Documentation: profiles/postgresql/PROFILE-SPEC.md
# Decision Reference: D4.1-HEALTH-CHECKS.md
# ==============================================================

set -e

# ==============================================================
# Configuration
# ==============================================================

# PostgreSQL user (default superuser)
PG_USER="${POSTGRES_USER:-postgres}"

# Primary database to check
PG_DB="${POSTGRES_DB:-postgres}"

# Enable extended checks (set to "true" to verify extensions/databases)
EXTENDED_CHECKS="${EXTENDED_CHECKS:-false}"

# Databases that should exist (for extended checks)
REQUIRED_DATABASES="${REQUIRED_DATABASES:-}"

# Databases that should have pgvector (for extended checks)
VECTOR_DATABASES="${VECTOR_DATABASES:-librechat}"

# ==============================================================
# Basic Health Check (Always Run)
# ==============================================================

# pg_isready is the recommended way to check PostgreSQL readiness
# It does NOT require authentication, making it compatible with _FILE secrets
basic_check() {
    pg_isready -U "$PG_USER" -d "$PG_DB" -q
    return $?
}

# ==============================================================
# Extended Checks (Optional)
# ==============================================================

# Verify we can execute a simple query
# This requires the postgres user to connect without password
# (only works if pg_hba.conf allows local trust or peer auth)
query_check() {
    psql -U "$PG_USER" -d "$PG_DB" -c "SELECT 1" -t -q > /dev/null 2>&1
    return $?
}

# Verify required databases exist
database_check() {
    local db="$1"
    psql -U "$PG_USER" -d "$PG_DB" -t -q -c \
        "SELECT 1 FROM pg_database WHERE datname = '$db'" 2>/dev/null | grep -q 1
    return $?
}

# Verify pgvector extension is installed in a database
vector_check() {
    local db="$1"
    psql -U "$PG_USER" -d "$db" -t -q -c \
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'" 2>/dev/null | grep -q 1
    return $?
}

# ==============================================================
# Main Health Check
# ==============================================================

main() {
    # Basic check - must always pass
    if ! basic_check; then
        echo "UNHEALTHY: PostgreSQL not accepting connections"
        exit 1
    fi

    # If extended checks are disabled, we're done
    if [[ "$EXTENDED_CHECKS" != "true" ]]; then
        exit 0
    fi

    # Extended: Query check
    if ! query_check; then
        echo "UNHEALTHY: Cannot execute queries"
        exit 1
    fi

    # Extended: Required databases
    if [[ -n "$REQUIRED_DATABASES" ]]; then
        for db in $REQUIRED_DATABASES; do
            if ! database_check "$db"; then
                echo "UNHEALTHY: Database '$db' not found"
                exit 1
            fi
        done
    fi

    # Extended: pgvector extension
    if [[ -n "$VECTOR_DATABASES" ]]; then
        for db in $VECTOR_DATABASES; do
            if database_check "$db"; then
                if ! vector_check "$db"; then
                    echo "UNHEALTHY: pgvector not installed in '$db'"
                    exit 1
                fi
            fi
        done
    fi

    # All checks passed
    exit 0
}

# Run main
main
