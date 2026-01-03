#!/bin/bash
# ==============================================================
# [TECHNOLOGY] Initialization Script Template
# ==============================================================
#
# This script runs during first container startup.
# It MUST read secrets from mounted files, NEVER hardcode passwords.
#
# ==============================================================

set -euo pipefail

echo "=== [TECHNOLOGY] Initialization Starting ==="

# ==============================================================
# CRITICAL: Read Secrets from Files
# ==============================================================
# Secrets are mounted at /run/secrets/ by Docker Compose.
# NEVER use environment variables for passwords.
# NEVER hardcode passwords like "CHANGEME_password123".

# Example: Read application database password
if [[ -f /run/secrets/app_db_password ]]; then
    APP_DB_PASSWORD=$(cat /run/secrets/app_db_password)
else
    echo "ERROR: Secret file /run/secrets/app_db_password not found!"
    echo "Ensure secrets are properly mounted in docker-compose.yml"
    exit 1
fi

# Example: Read additional secrets as needed
# ANOTHER_SECRET=$(cat /run/secrets/another_secret)

# ==============================================================
# Create Application User
# ==============================================================
# Replace with technology-specific commands

echo "Creating application user..."

# PostgreSQL example:
# psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
#     CREATE USER app_user WITH PASSWORD '$APP_DB_PASSWORD';
#     CREATE DATABASE app_db OWNER app_user;
#     GRANT ALL PRIVILEGES ON DATABASE app_db TO app_user;
# EOSQL

# MySQL example:
# mysql -u root -p"$MYSQL_ROOT_PASSWORD" <<-EOSQL
#     CREATE USER IF NOT EXISTS 'app_user'@'%' IDENTIFIED BY '$APP_DB_PASSWORD';
#     CREATE DATABASE IF NOT EXISTS app_db;
#     GRANT ALL PRIVILEGES ON app_db.* TO 'app_user'@'%';
#     FLUSH PRIVILEGES;
# EOSQL

# MongoDB example:
# mongosh admin --eval "
#     db.createUser({
#         user: 'app_user',
#         pwd: '$APP_DB_PASSWORD',
#         roles: [{ role: 'readWrite', db: 'app_db' }]
#     });
# "

echo "Application user created successfully."

# ==============================================================
# Create Additional Databases (if needed)
# ==============================================================

echo "Creating additional databases..."

# Add your database creation commands here

echo "Additional databases created successfully."

# ==============================================================
# Set Up Permissions
# ==============================================================

echo "Setting up permissions..."

# Add permission grants here

echo "Permissions configured successfully."

# ==============================================================
# Completion
# ==============================================================

echo "=== [TECHNOLOGY] Initialization Complete ==="
echo ""
echo "Created resources:"
echo "  - User: app_user"
echo "  - Database: app_db"
echo ""
echo "Connection string (for applications):"
echo "  [protocol]://app_user:***@[host]:[port]/app_db"
