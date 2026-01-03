#!/bin/bash
# ==============================================================
# MinIO Bucket Initialization Script
# ==============================================================
# Purpose: Create default buckets and configure policies
# Execution: Run after MinIO container starts
#
# CRITICAL: This script reads passwords from Docker secrets
#           (/run/secrets/). NEVER hardcode credentials.
#
# Profile: minio
# Documentation: profiles/minio/PROFILE-SPEC.md
# ==============================================================

set -euo pipefail

# ==============================================================
# Configuration
# ==============================================================

# MinIO endpoint
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"

# Buckets to create with their configuration
# Format: bucket_name:versioning:quota_gb
BUCKETS=(
    "backups:enabled:0"       # Database backups, versioning enabled
    "uploads:disabled:50"     # User uploads, 50GB quota
    "assets:disabled:0"       # Static assets, no quota
    "temp:disabled:10"        # Temporary files, 10GB quota
)

# Bucket lifecycle policies (days until expiration)
declare -A LIFECYCLE_POLICIES=(
    ["temp"]=7               # Temp files expire in 7 days
    ["backups"]=90           # Old backup versions expire in 90 days
)

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

# Read secret from file
read_secret() {
    local secret_name="$1"
    local secret_file="/run/secrets/${secret_name}"

    if [[ -f "$secret_file" ]]; then
        cat "$secret_file"
    else
        log "WARNING: Secret file not found: $secret_file"
        echo ""
    fi
}

# Wait for MinIO to be ready
wait_for_minio() {
    local max_attempts=30
    local attempt=1

    log "Waiting for MinIO to be ready..."

    while [[ $attempt -le $max_attempts ]]; do
        if curl -sf "${MINIO_ENDPOINT}/minio/health/ready" > /dev/null 2>&1; then
            log "MinIO is ready"
            return 0
        fi

        log "  Attempt $attempt/$max_attempts - waiting..."
        sleep 2
        ((attempt++))
    done

    error_exit "MinIO did not become ready in time"
}

# Configure mc alias
setup_mc_alias() {
    local root_user
    local root_password

    root_user=$(read_secret "minio_root_user")
    root_password=$(read_secret "minio_root_password")

    if [[ -z "$root_user" ]] || [[ -z "$root_password" ]]; then
        error_exit "MinIO credentials not found in secrets"
    fi

    # Configure alias (suppresses output)
    mc alias set local "$MINIO_ENDPOINT" "$root_user" "$root_password" --quiet

    log "MinIO client configured"
}

# ==============================================================
# Bucket Creation Functions
# ==============================================================

create_bucket() {
    local bucket_name="$1"
    local versioning="$2"
    local quota_gb="$3"

    log "Creating bucket: $bucket_name"

    # Create bucket (ignore if exists)
    if mc mb "local/${bucket_name}" --ignore-existing --quiet; then
        log "  Bucket $bucket_name created/verified"
    else
        log "  WARNING: Failed to create bucket $bucket_name"
        return 1
    fi

    # Configure versioning
    if [[ "$versioning" == "enabled" ]]; then
        mc version enable "local/${bucket_name}" --quiet
        log "  Versioning enabled for $bucket_name"
    else
        mc version suspend "local/${bucket_name}" --quiet 2>/dev/null || true
        log "  Versioning disabled for $bucket_name"
    fi

    # Configure quota (if specified and > 0)
    if [[ "$quota_gb" -gt 0 ]]; then
        mc quota set "local/${bucket_name}" --size "${quota_gb}GB" --quiet
        log "  Quota set to ${quota_gb}GB for $bucket_name"
    fi

    return 0
}

configure_lifecycle() {
    local bucket_name="$1"
    local expire_days="$2"

    log "Configuring lifecycle for $bucket_name (expire: ${expire_days} days)"

    # Add expiration rule
    mc ilm rule add \
        --expire-days "$expire_days" \
        "local/${bucket_name}" \
        --quiet || {
            log "  WARNING: Failed to set lifecycle for $bucket_name"
            return 1
        }

    log "  Lifecycle configured for $bucket_name"
}

# ==============================================================
# Main Initialization
# ==============================================================

main() {
    log "========================================"
    log "MinIO Bucket Initialization Starting"
    log "========================================"

    # Wait for MinIO
    wait_for_minio

    # Setup mc client
    setup_mc_alias

    # ----------------------------------------------------------
    # Step 1: Create Buckets
    # ----------------------------------------------------------
    log "Step 1: Creating buckets..."

    for bucket_config in "${BUCKETS[@]}"; do
        IFS=':' read -r name versioning quota <<< "$bucket_config"
        create_bucket "$name" "$versioning" "$quota"
    done

    # ----------------------------------------------------------
    # Step 2: Configure Lifecycle Policies
    # ----------------------------------------------------------
    log "Step 2: Configuring lifecycle policies..."

    for bucket in "${!LIFECYCLE_POLICIES[@]}"; do
        days="${LIFECYCLE_POLICIES[$bucket]}"
        configure_lifecycle "$bucket" "$days"
    done

    # ----------------------------------------------------------
    # Step 3: Verification
    # ----------------------------------------------------------
    log "Step 3: Verifying buckets..."

    mc ls local/ --quiet | while read -r line; do
        log "  Found: $line"
    done

    # ----------------------------------------------------------
    # Complete
    # ----------------------------------------------------------
    log "========================================"
    log "MinIO Bucket Initialization Complete"
    log "========================================"
    log "Buckets created: ${#BUCKETS[@]}"
    log "Lifecycle policies: ${#LIFECYCLE_POLICIES[@]}"
    log "========================================"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
