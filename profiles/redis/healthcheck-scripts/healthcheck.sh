#!/bin/sh
# ==============================================================
# Redis Health Check Script (Secrets-Aware)
# ==============================================================
# Performs health check for Redis containers
#
# Features:
# - Reads password from Docker secrets mount
# - Falls back to no-auth mode if no secret exists
# - Returns exit code 0 (healthy) or 1 (unhealthy)
#
# Usage in docker-compose.yml:
#   healthcheck:
#     test: ["CMD", "/healthcheck.sh"]
#     interval: 10s
#     timeout: 3s
#     retries: 3
#     start_period: 5s
#
# The script must be mounted into the container:
#   volumes:
#     - ./profiles/redis/healthcheck-scripts/healthcheck.sh:/healthcheck.sh:ro
# ==============================================================

# Build authentication argument
REDIS_AUTH=""

# Check for password in Docker secrets mount
if [ -f /run/secrets/redis_password ]; then
    REDIS_PASSWORD=$(cat /run/secrets/redis_password)
    if [ -n "$REDIS_PASSWORD" ]; then
        REDIS_AUTH="-a $REDIS_PASSWORD"
    fi
fi

# Execute ping health check
# Note: Using --no-auth-warning to suppress password warning in logs
RESULT=$(redis-cli $REDIS_AUTH --no-auth-warning ping 2>/dev/null)

if echo "$RESULT" | grep -q "PONG"; then
    exit 0
else
    exit 1
fi
