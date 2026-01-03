#!/bin/sh
# ==============================================================
# Redis Initialization Script (Secrets-Aware)
# ==============================================================
# This script is used as the container entrypoint to:
# 1. Read secrets from file-based secrets mount
# 2. Configure Redis with appropriate settings
# 3. Start Redis server with security and performance options
#
# Usage: entrypoint: ["/bin/sh", "/init-scripts/01-init-redis.sh"]
# ==============================================================

set -e

# ==============================================================
# Configuration Variables
# ==============================================================
# These can be overridden via environment variables

# Memory settings
REDIS_MAXMEMORY="${REDIS_MAXMEMORY:-400mb}"
REDIS_MAXMEMORY_POLICY="${REDIS_MAXMEMORY_POLICY:-allkeys-lru}"

# Connection settings
REDIS_MAXCLIENTS="${REDIS_MAXCLIENTS:-1000}"
REDIS_TIMEOUT="${REDIS_TIMEOUT:-300}"
REDIS_TCP_KEEPALIVE="${REDIS_TCP_KEEPALIVE:-60}"

# Persistence settings (set to empty to disable)
REDIS_SAVE_RULES="${REDIS_SAVE_RULES:-900 1 300 10 60 10000}"
REDIS_APPENDONLY="${REDIS_APPENDONLY:-no}"

# Logging
REDIS_LOGLEVEL="${REDIS_LOGLEVEL:-notice}"

# ==============================================================
# Secret Loading
# ==============================================================
# Read password from Docker secrets mount point

REDIS_PASSWORD=""
if [ -f /run/secrets/redis_password ]; then
    REDIS_PASSWORD=$(cat /run/secrets/redis_password)
    echo "Redis: Loaded password from secrets mount"
elif [ -n "$REDIS_PASSWORD_ENV" ]; then
    # Fallback for development (NOT recommended for production)
    REDIS_PASSWORD="$REDIS_PASSWORD_ENV"
    echo "Redis: WARNING - Using password from environment variable (not recommended)"
fi

# ==============================================================
# Build Command Arguments
# ==============================================================

# Start with base arguments
REDIS_ARGS=""

# Memory configuration
REDIS_ARGS="$REDIS_ARGS --maxmemory $REDIS_MAXMEMORY"
REDIS_ARGS="$REDIS_ARGS --maxmemory-policy $REDIS_MAXMEMORY_POLICY"

# Connection configuration
REDIS_ARGS="$REDIS_ARGS --maxclients $REDIS_MAXCLIENTS"
REDIS_ARGS="$REDIS_ARGS --timeout $REDIS_TIMEOUT"
REDIS_ARGS="$REDIS_ARGS --tcp-keepalive $REDIS_TCP_KEEPALIVE"

# Logging
REDIS_ARGS="$REDIS_ARGS --loglevel $REDIS_LOGLEVEL"

# Authentication
if [ -n "$REDIS_PASSWORD" ]; then
    REDIS_ARGS="$REDIS_ARGS --requirepass $REDIS_PASSWORD"
    echo "Redis: Authentication enabled"
else
    # No password - enable protected mode to prevent external access
    REDIS_ARGS="$REDIS_ARGS --protected-mode no"
    echo "Redis: WARNING - No authentication configured, running in protected mode"
fi

# Persistence configuration
if [ -n "$REDIS_SAVE_RULES" ] && [ "$REDIS_SAVE_RULES" != "disabled" ]; then
    # Parse save rules: "900 1 300 10 60 10000" -> --save 900 1 --save 300 10 --save 60 10000
    # Split by space pairs
    echo "Redis: Persistence enabled with RDB snapshots"

    # Use temporary file to build save args
    SAVE_ARGS=""
    set -- $REDIS_SAVE_RULES
    while [ $# -ge 2 ]; do
        SAVE_ARGS="$SAVE_ARGS --save $1 $2"
        shift 2
    done
    REDIS_ARGS="$REDIS_ARGS $SAVE_ARGS"
else
    # Disable persistence
    REDIS_ARGS="$REDIS_ARGS --save \"\""
    echo "Redis: Persistence disabled"
fi

# AOF configuration
if [ "$REDIS_APPENDONLY" = "yes" ]; then
    REDIS_ARGS="$REDIS_ARGS --appendonly yes"
    echo "Redis: AOF persistence enabled"
else
    REDIS_ARGS="$REDIS_ARGS --appendonly no"
fi

# ==============================================================
# Production Security Hardening (Optional)
# ==============================================================
# Uncomment to disable dangerous commands in production

if [ "$REDIS_PRODUCTION_MODE" = "true" ]; then
    echo "Redis: Production mode - disabling dangerous commands"
    REDIS_ARGS="$REDIS_ARGS --rename-command FLUSHDB \"\""
    REDIS_ARGS="$REDIS_ARGS --rename-command FLUSHALL \"\""
    REDIS_ARGS="$REDIS_ARGS --rename-command CONFIG \"\""
    REDIS_ARGS="$REDIS_ARGS --rename-command DEBUG \"\""
    REDIS_ARGS="$REDIS_ARGS --rename-command SHUTDOWN \"\""
fi

# ==============================================================
# Start Redis Server
# ==============================================================

echo "Redis: Starting server..."
echo "Redis: Memory limit: $REDIS_MAXMEMORY"
echo "Redis: Eviction policy: $REDIS_MAXMEMORY_POLICY"

# Execute redis-server with all arguments
# Using eval to properly handle quoted empty strings
eval "exec redis-server $REDIS_ARGS"
