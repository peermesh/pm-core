#!/bin/bash
# ==============================================================
# [TECHNOLOGY] Healthcheck Script Template
# ==============================================================
#
# CRITICAL: This script MUST read secrets from mounted files.
#
# Problem:
#   When using MYSQL_PASSWORD_FILE (or similar _FILE suffix),
#   the environment variable MYSQL_PASSWORD does NOT exist.
#   Standard healthchecks that use $MYSQL_PASSWORD will fail.
#
# Solution:
#   This script reads the password from /run/secrets/ directly.
#
# Usage:
#   In docker-compose.yml:
#     healthcheck:
#       test: ["CMD", "/healthcheck.sh"]
#
# ==============================================================

set -e

# ==============================================================
# Read Secret from File
# ==============================================================
# Secrets are mounted at /run/secrets/ by Docker Compose.
# The filename matches the secret name in docker-compose.yml.

SECRET_NAME="[tech]_password"  # Change to match your secret name
SECRET_FILE="/run/secrets/$SECRET_NAME"

if [[ -f "$SECRET_FILE" ]]; then
    # Read from mounted secret file (production mode with _FILE suffix)
    PASSWORD=$(cat "$SECRET_FILE")
elif [[ -n "${[ENV_PASSWORD_VAR]:-}" ]]; then
    # Fallback: Use environment variable (development mode without _FILE)
    PASSWORD="${[ENV_PASSWORD_VAR]}"
else
    # No password available - might be intentional for some setups
    # Check if service allows passwordless local connections
    PASSWORD=""
fi

# ==============================================================
# Technology-Specific Health Check
# ==============================================================

# REPLACE THIS SECTION with your technology's health check command

# --------------------------------------------------------------
# PostgreSQL Example:
# --------------------------------------------------------------
# pg_isready works without password for local socket connections
# pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"

# --------------------------------------------------------------
# MySQL Example:
# --------------------------------------------------------------
# mysqladmin ping can give false positives, query is more reliable
# mysql -h localhost -u root -p"$PASSWORD" -e "SELECT 1" >/dev/null 2>&1

# Alternative using mysqladmin (simpler but less reliable):
# mysqladmin ping -h localhost -u root -p"$PASSWORD" --silent

# --------------------------------------------------------------
# MariaDB 10.4+ Example:
# --------------------------------------------------------------
# Uses built-in healthcheck script
# healthcheck.sh --connect --innodb_initialized

# --------------------------------------------------------------
# MongoDB Example:
# --------------------------------------------------------------
# mongosh --quiet --eval "db.adminCommand('ping')"

# With authentication:
# mongosh --quiet \
#     --username root \
#     --password "$PASSWORD" \
#     --authenticationDatabase admin \
#     --eval "db.adminCommand('ping')"

# --------------------------------------------------------------
# Redis Example:
# --------------------------------------------------------------
# Without auth:
# redis-cli ping | grep -q PONG

# With auth:
# redis-cli -a "$PASSWORD" ping | grep -q PONG

# --------------------------------------------------------------
# Placeholder - REPLACE WITH ACTUAL COMMAND:
# --------------------------------------------------------------
echo "PLACEHOLDER: Replace with actual health check command"
echo "This should exit 0 if healthy, non-zero if unhealthy"

# Example of what a real check looks like:
# [health_command] || exit 1

exit 0
