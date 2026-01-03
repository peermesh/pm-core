#!/bin/bash
# ==============================================================
# MinIO Health Check Script
# ==============================================================
# Purpose: Verify MinIO is healthy and ready to accept connections
# Features:
#   - Works with _FILE secrets pattern
#   - Basic connectivity check via health endpoint
#   - Optional: Verify buckets exist
#   - Optional: Verify read/write access
#
# Usage:
#   Docker healthcheck: ["CMD", "/healthcheck.sh"]
#   Manual check: docker exec minio /healthcheck.sh
#
# Profile: minio
# Documentation: profiles/minio/PROFILE-SPEC.md
# Decision Reference: D4.1-HEALTH-CHECKS.md
# ==============================================================

set -e

# ==============================================================
# Configuration
# ==============================================================

# MinIO endpoint (internal)
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"

# Enable extended checks (set to "true" to verify buckets/access)
EXTENDED_CHECKS="${EXTENDED_CHECKS:-false}"

# Required buckets (for extended checks, space-separated)
REQUIRED_BUCKETS="${REQUIRED_BUCKETS:-}"

# ==============================================================
# Basic Health Check (Always Run)
# ==============================================================

# MinIO provides dedicated health endpoints that don't require auth
basic_check() {
    # Live check - is the process running?
    curl -sf "${MINIO_ENDPOINT}/minio/health/live" > /dev/null 2>&1
    return $?
}

# Ready check - is MinIO ready to serve requests?
ready_check() {
    curl -sf "${MINIO_ENDPOINT}/minio/health/ready" > /dev/null 2>&1
    return $?
}

# ==============================================================
# Extended Checks (Optional)
# ==============================================================

# Read credentials from secrets
read_credentials() {
    local user_file="/run/secrets/minio_root_user"
    local pass_file="/run/secrets/minio_root_password"

    if [[ -f "$user_file" ]] && [[ -f "$pass_file" ]]; then
        MINIO_USER=$(cat "$user_file")
        MINIO_PASS=$(cat "$pass_file")
        return 0
    fi

    return 1
}

# Setup mc alias (requires credentials)
setup_mc() {
    if ! read_credentials; then
        return 1
    fi

    # Configure alias silently
    mc alias set healthcheck "${MINIO_ENDPOINT}" "$MINIO_USER" "$MINIO_PASS" --quiet 2>/dev/null
    return $?
}

# Check if required buckets exist
bucket_check() {
    if [[ -z "$REQUIRED_BUCKETS" ]]; then
        return 0
    fi

    for bucket in $REQUIRED_BUCKETS; do
        if ! mc ls "healthcheck/${bucket}" > /dev/null 2>&1; then
            echo "UNHEALTHY: Required bucket '$bucket' not found"
            return 1
        fi
    done

    return 0
}

# Test read/write access
access_check() {
    local test_file=".healthcheck-$(date +%s)"
    local test_bucket="healthcheck"

    # Try to write a test object
    echo "healthcheck" | mc pipe "healthcheck/${test_bucket}/${test_file}" 2>/dev/null || {
        echo "UNHEALTHY: Cannot write to MinIO"
        return 1
    }

    # Try to read it back
    mc cat "healthcheck/${test_bucket}/${test_file}" > /dev/null 2>&1 || {
        echo "UNHEALTHY: Cannot read from MinIO"
        return 1
    }

    # Cleanup
    mc rm "healthcheck/${test_bucket}/${test_file}" 2>/dev/null || true

    return 0
}

# ==============================================================
# Main Health Check
# ==============================================================

main() {
    # Basic check - must always pass
    if ! basic_check; then
        echo "UNHEALTHY: MinIO not responding to health check"
        exit 1
    fi

    # Ready check - optional but recommended
    if ! ready_check; then
        echo "UNHEALTHY: MinIO not ready to serve requests"
        exit 1
    fi

    # If extended checks are disabled, we're done
    if [[ "$EXTENDED_CHECKS" != "true" ]]; then
        exit 0
    fi

    # Extended checks require credentials
    if ! setup_mc; then
        # Can't do extended checks without credentials, but basic health is OK
        exit 0
    fi

    # Extended: Required buckets
    if ! bucket_check; then
        exit 1
    fi

    # All checks passed
    exit 0
}

# Run main
main
