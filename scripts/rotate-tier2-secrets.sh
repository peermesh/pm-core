#!/usr/bin/env bash
# ==============================================================
# Tier 2 Secret Rotation (30-day cycle)
# ==============================================================
# Rotates session-layer secrets: jwt_secret, session_secret,
# oidc_hmac_secret. Archives current values before replacement.
#
# WARNING: All active sessions will be invalidated after rotation.
#
# Usage:
#   ./scripts/rotate-tier2-secrets.sh
#   ./scripts/rotate-tier2-secrets.sh --dry-run
#   ./scripts/rotate-tier2-secrets.sh --help
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SECRETS_DIR="${SECRETS_DIR:-$PROJECT_ROOT/secrets}"

TIER2_SECRETS=("jwt_secret" "session_secret" "oidc_hmac_secret")
DRY_RUN=false
DATE_STAMP="$(date -u +"%Y%m%d")"

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Rotate Tier 2 secrets (30-day cycle): jwt_secret, session_secret, oidc_hmac_secret.

Options:
  --dry-run     Show what would happen without making changes
  --help, -h    Show this help

Examples:
  $0                 # Rotate all Tier 2 secrets
  $0 --dry-run       # Preview rotation without changes
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if ! command -v openssl >/dev/null 2>&1; then
    echo "[ERROR] openssl is required"
    exit 1
fi

if [[ ! -d "$SECRETS_DIR" ]]; then
    echo "[ERROR] Secrets directory not found: $SECRETS_DIR"
    exit 1
fi

echo ""
echo "=== Tier 2 Secret Rotation ==="
echo "Date: $DATE_STAMP"
echo ""

if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY RUN] No changes will be made."
    echo ""
fi

# --- Step 1: Archive current secrets ---

ARCHIVE_DIR="$PROJECT_ROOT/secrets.archive/$DATE_STAMP"

if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY RUN] Would create archive directory: $ARCHIVE_DIR"
else
    mkdir -p "$ARCHIVE_DIR"
fi

for secret_name in "${TIER2_SECRETS[@]}"; do
    secret_file="$SECRETS_DIR/$secret_name"
    if [[ -f "$secret_file" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            echo "[DRY RUN] Would archive: $secret_name -> $ARCHIVE_DIR/$secret_name"
        else
            cp "$secret_file" "$ARCHIVE_DIR/$secret_name"
            chmod 600 "$ARCHIVE_DIR/$secret_name"
            echo "[ARCHIVED] $secret_name -> $ARCHIVE_DIR/$secret_name"
        fi
    else
        echo "[WARN] Secret file not found, will create: $secret_name"
    fi
done

echo ""

# --- Step 2: Generate new secrets ---

for secret_name in "${TIER2_SECRETS[@]}"; do
    secret_file="$SECRETS_DIR/$secret_name"
    new_file="${secret_file}.new"

    if [[ "$DRY_RUN" == true ]]; then
        echo "[DRY RUN] Would generate new value for: $secret_name"
        echo "[DRY RUN] Would write to: ${secret_file}.new then mv to $secret_file"
        continue
    fi

    # Generate new secret value
    new_value="$(openssl rand -base64 64 | tr -d '\n')"

    # Step 3: Atomic replacement - write to .new then mv
    printf '%s' "$new_value" > "$new_file"
    chmod 600 "$new_file"
    mv "$new_file" "$secret_file"

    # Step 4: Enforce permissions
    chmod 600 "$secret_file"

    echo "[ROTATED] $secret_name"
done

echo ""

# --- Step 5: Print operator instructions ---

if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY RUN] Would instruct operator to restart services."
    echo ""
    echo "No changes were made."
else
    echo "Secrets rotated. Restart services to apply:"
    echo "  docker compose restart authelia"
    echo ""
    echo "NOTE: All active sessions will be invalidated."
fi
