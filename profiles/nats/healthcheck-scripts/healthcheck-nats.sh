#!/bin/sh
# ==============================================================
# NATS + JetStream Health Check Script
# ==============================================================
# Purpose: Verify NATS is healthy and ready to accept connections
# Features:
#   - Basic connectivity check via monitoring endpoint
#   - Optional: Verify JetStream is enabled
#   - Works without authentication (monitoring endpoint is public)
#
# Usage:
#   Docker healthcheck: ["CMD", "/healthcheck.sh"]
#   Manual check: docker exec pmdl_nats /healthcheck.sh
#
# Profile: nats
# Documentation: profiles/nats/PROFILE-SPEC.md
# Decision Reference: D4.1-HEALTH-CHECKS.md
# ==============================================================

set -e

# ==============================================================
# Configuration
# ==============================================================

# NATS monitoring port (default 8222)
MONITORING_PORT="${NATS_MONITORING_PORT:-8222}"

# Enable extended checks (JetStream verification)
EXTENDED_CHECKS="${EXTENDED_CHECKS:-false}"

# ==============================================================
# Basic Health Check (Always Run)
# ==============================================================

# NATS exposes a /healthz endpoint on the monitoring port
# This is the recommended way to check NATS health
basic_check() {
    # Use wget (available in alpine image)
    wget --spider -q "http://localhost:${MONITORING_PORT}/healthz" 2>/dev/null
    return $?
}

# ==============================================================
# Extended Checks (Optional)
# ==============================================================

# Verify JetStream is enabled
# Checks the /jsz endpoint which returns JetStream stats
jetstream_check() {
    wget -q -O- "http://localhost:${MONITORING_PORT}/jsz" 2>/dev/null | grep -q '"config"'
    return $?
}

# Verify server is responding to varz (server info)
server_info_check() {
    wget -q -O- "http://localhost:${MONITORING_PORT}/varz" 2>/dev/null | grep -q '"server_id"'
    return $?
}

# ==============================================================
# Main Health Check
# ==============================================================

main() {
    # Basic check - must always pass
    if ! basic_check; then
        echo "UNHEALTHY: NATS monitoring endpoint not responding"
        exit 1
    fi

    # If extended checks are disabled, we're done
    if [ "$EXTENDED_CHECKS" != "true" ]; then
        exit 0
    fi

    # Extended: Server info check
    if ! server_info_check; then
        echo "UNHEALTHY: NATS server info endpoint not responding"
        exit 1
    fi

    # Extended: JetStream check
    if ! jetstream_check; then
        echo "WARNING: JetStream not enabled or not responding"
        # Don't fail on JetStream check - it might be intentionally disabled
        # exit 1
    fi

    # All checks passed
    exit 0
}

# Run main
main
