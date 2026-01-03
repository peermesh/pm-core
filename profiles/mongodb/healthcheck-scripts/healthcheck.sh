#!/bin/bash
# ==============================================================
# MongoDB Health Check Script
# ==============================================================
# Secrets-aware health check for Docker container healthcheck
#
# This script reads the MongoDB password from Docker secrets
# (mounted at /run/secrets/) to authenticate the health check.
#
# Features:
# - Reads password from /run/secrets/ (production)
# - Falls back to environment variable (development)
# - Uses mongosh for modern MongoDB versions
# - Returns proper exit codes for Docker health check
#
# Per D4.1: Health Check Standardization
# Per D3.1: Secrets-aware pattern
#
# Mount this script in docker-compose.yml:
#   volumes:
#     - ./profiles/mongodb/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro
#   healthcheck:
#     test: ["CMD", "/healthcheck.sh"]
# ==============================================================

set -euo pipefail

# ==============================================================
# Read Password from Secrets
# ==============================================================
# Priority:
# 1. Docker secret file (production)
# 2. Environment variable (development/testing)

PASSWORD=""

# Try Docker secrets first (production pattern)
if [[ -f /run/secrets/mongodb_root_password ]]; then
    PASSWORD=$(cat /run/secrets/mongodb_root_password)
# Fall back to environment variable (development)
elif [[ -n "${MONGO_INITDB_ROOT_PASSWORD:-}" ]]; then
    PASSWORD="$MONGO_INITDB_ROOT_PASSWORD"
fi

# ==============================================================
# Determine Username
# ==============================================================
USERNAME="${MONGO_INITDB_ROOT_USERNAME:-mongo}"

# ==============================================================
# Execute Health Check
# ==============================================================
# Use mongosh (modern) with admin command ping
# This validates:
# - MongoDB process is running
# - Authentication works
# - Database is responding to commands

if [[ -n "$PASSWORD" ]]; then
    # Authenticated health check
    exec mongosh \
        --username "$USERNAME" \
        --password "$PASSWORD" \
        --authenticationDatabase admin \
        --quiet \
        --eval "db.adminCommand('ping')"
else
    # Unauthenticated health check (localhost exception or no auth)
    # This works when authentication is disabled or during initial setup
    exec mongosh \
        --quiet \
        --eval "db.adminCommand('ping')"
fi
