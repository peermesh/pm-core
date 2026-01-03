#!/bin/bash
# ==============================================================
# Volume Initialization Script
# ==============================================================
# Prepares Docker volumes with correct ownership for non-root containers.
# Must be run after compose file parsing but before container start.
#
# Usage:
#   ./scripts/init-volumes.sh           # Initialize all volumes
#   ./scripts/init-volumes.sh --check   # Check ownership only
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
CHECK_ONLY=false
if [ "${1:-}" = "--check" ] || [ "${1:-}" = "-c" ]; then
    CHECK_ONLY=true
fi

echo "=== Initializing Docker Volumes ==="
echo ""

# Volume ownership requirements
# Format: volume_name uid:gid description
# Note: Only volumes for non-root containers need initialization
declare -A VOLUME_OWNERS=(
    ["pmdl_synapse_data"]="991:991"
    ["pmdl_peertube_data"]="1000:1000"
    ["pmdl_peertube_config"]="1000:1000"
    ["pmdl_redis_data"]="999:999"
)

declare -A VOLUME_DESCRIPTIONS=(
    ["pmdl_synapse_data"]="Synapse Matrix server (runs as uid 991)"
    ["pmdl_peertube_data"]="PeerTube video data (runs as uid 1000)"
    ["pmdl_peertube_config"]="PeerTube config (runs as uid 1000)"
    ["pmdl_redis_data"]="Redis cache (runs as uid 999)"
)

init_volume() {
    local volume=$1
    local owner=$2
    local description="${VOLUME_DESCRIPTIONS[$volume]:-}"

    # Check if volume exists
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
        log_warn "[SKIP] $volume - not created yet"
        echo "        Hint: Run 'docker compose up -d' first to create volumes"
        return 0
    fi

    local volume_path
    volume_path=$(docker volume inspect "$volume" --format '{{ .Mountpoint }}')

    if [ ! -d "$volume_path" ]; then
        log_warn "[SKIP] $volume - path not found: $volume_path"
        return 0
    fi

    # Get current owner
    local current_owner
    current_owner=$(stat -c '%u:%g' "$volume_path" 2>/dev/null || stat -f '%u:%g' "$volume_path" 2>/dev/null)

    if [ "$current_owner" = "$owner" ]; then
        log_ok "[OK] $volume ($owner)"
        return 0
    fi

    if [ "$CHECK_ONLY" = true ]; then
        log_warn "[NEEDS FIX] $volume: current=$current_owner, expected=$owner"
        echo "        $description"
        return 1
    fi

    # Fix ownership
    log_info "[INIT] $volume -> $owner"
    echo "        $description"

    if sudo chown -R "$owner" "$volume_path" 2>/dev/null; then
        log_ok "[FIXED] $volume"
    else
        log_error "[FAILED] $volume - could not change ownership"
        echo "        Try running: sudo chown -R $owner $volume_path"
        return 1
    fi
}

needs_fix=0
for volume in "${!VOLUME_OWNERS[@]}"; do
    if ! init_volume "$volume" "${VOLUME_OWNERS[$volume]}"; then
        ((needs_fix++))
    fi
done

echo ""

if [ "$CHECK_ONLY" = true ]; then
    if [ $needs_fix -gt 0 ]; then
        echo "=== Volume Check: $needs_fix volumes need fixing ==="
        echo "Run without --check to fix ownership"
        exit 1
    else
        echo "=== Volume Check: All volumes OK ==="
    fi
else
    echo "=== Volume Initialization Complete ==="
fi
