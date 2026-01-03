#!/bin/bash
# =============================================================
# MySQL Health Check Script (Secrets-Aware)
# =============================================================
# This script works with MYSQL_PASSWORD_FILE environment variable.
#
# CRITICAL: When using _FILE suffix for secrets, the actual
# MYSQL_PASSWORD environment variable is NOT set. Health checks
# that use ${MYSQL_PASSWORD} will FAIL.
#
# This script uses socket-based ping which doesn't require
# authentication, making it reliable regardless of how
# credentials are passed.
#
# Options:
#   1. Socket-based ping (default, recommended)
#   2. Query-based check reading from secrets file
#
# =============================================================

# -------------------------------------------------------------
# Option 1: Socket-based ping (Recommended)
# No password required for localhost socket connection
# -------------------------------------------------------------

# Simple ping check - fastest and most reliable
if mysqladmin ping -h localhost --silent 2>/dev/null; then
    exit 0
fi

# -------------------------------------------------------------
# Option 2: Fallback - Query-based check with secrets file
# Only used if socket ping fails (shouldn't happen normally)
# -------------------------------------------------------------

# Try to read password from secrets file
if [[ -f /run/secrets/mysql_root_password ]]; then
    PASSWORD=$(cat /run/secrets/mysql_root_password 2>/dev/null)
    if [[ -n "$PASSWORD" ]]; then
        if mysql -h localhost -u root -p"$PASSWORD" -e "SELECT 1" --silent 2>/dev/null; then
            exit 0
        fi
    fi
fi

# -------------------------------------------------------------
# Both methods failed
# -------------------------------------------------------------
exit 1
