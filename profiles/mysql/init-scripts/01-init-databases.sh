#!/bin/bash
# =============================================================
# MySQL Database Initialization Script
# =============================================================
# Phase 1: Bootstrap - Additional configuration beyond MYSQL_DATABASE
#
# This script runs ONLY on first container start with empty data volume.
# The primary database (ghost) and user are created automatically via
# environment variables: MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD_FILE
#
# This script handles:
# - Additional grants or permissions
# - Creating supplementary databases if needed
# - Security hardening
#
# =============================================================

set -e

echo "=== MySQL Initialization Script ==="
echo "Date: $(date)"
echo ""

# =============================================================
# Read Root Password from Secrets
# =============================================================
# CRITICAL: When using MYSQL_ROOT_PASSWORD_FILE, the MYSQL_ROOT_PASSWORD
# environment variable is NOT set. We must read from the secrets file.

MYSQL_PASS=""

# Try Docker secrets first (production pattern)
if [[ -f /run/secrets/mysql_root_password ]]; then
    MYSQL_PASS=$(cat /run/secrets/mysql_root_password)
    echo "[OK] Read root password from /run/secrets/mysql_root_password"
# Fallback to environment variable (development/testing)
elif [[ -n "${MYSQL_ROOT_PASSWORD:-}" ]]; then
    MYSQL_PASS="${MYSQL_ROOT_PASSWORD}"
    echo "[OK] Using MYSQL_ROOT_PASSWORD from environment"
else
    echo "[ERROR] No root password available"
    echo "        Ensure MYSQL_ROOT_PASSWORD_FILE is set or MYSQL_ROOT_PASSWORD is provided"
    exit 1
fi

# =============================================================
# Verify Core Setup
# =============================================================
# The ghost database and user should already exist from environment variables

echo "Verifying core database setup..."

mysql -u root -p"${MYSQL_PASS}" <<-EOSQL
    -- Verify ghost database exists
    SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = 'ghost';

    -- Verify ghost user exists
    SELECT User, Host FROM mysql.user WHERE User = 'ghost';
EOSQL

echo "Core setup verified."

# =============================================================
# Additional Grants
# =============================================================
# Ghost may need PROCESS privilege for certain operations

echo "Applying additional grants..."

mysql -u root -p"${MYSQL_PASS}" <<-EOSQL
    -- Grant PROCESS privilege for Ghost (needed for some status queries)
    -- This is a limited privilege, not SUPER
    GRANT PROCESS ON *.* TO 'ghost'@'%';

    -- Ensure ghost has all privileges on its database
    GRANT ALL PRIVILEGES ON ghost.* TO 'ghost'@'%';

    -- Apply changes
    FLUSH PRIVILEGES;
EOSQL

echo "Additional grants applied."

# =============================================================
# Security Hardening
# =============================================================
# Remove anonymous users and restrict root access

echo "Applying security hardening..."

mysql -u root -p"${MYSQL_PASS}" <<-EOSQL
    -- Remove anonymous users (if any)
    DELETE FROM mysql.user WHERE User='';

    -- Remove remote root access (root only via localhost)
    DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');

    -- Apply changes
    FLUSH PRIVILEGES;
EOSQL

echo "Security hardening complete."

# =============================================================
# Verification
# =============================================================

echo ""
echo "=== Initialization Complete ==="
echo ""
echo "Databases:"
mysql -u root -p"${MYSQL_PASS}" -e "SHOW DATABASES;"

echo ""
echo "Users:"
mysql -u root -p"${MYSQL_PASS}" -e "SELECT User, Host FROM mysql.user;"

echo ""
echo "Ghost user grants:"
mysql -u root -p"${MYSQL_PASS}" -e "SHOW GRANTS FOR 'ghost'@'%';"

echo ""
echo "MySQL initialization script completed successfully."
