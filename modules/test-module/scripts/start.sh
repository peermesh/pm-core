#!/bin/bash
#
# test-module: Start script
#
# Exit codes:
#   0 - Success - module is running
#   1 - General failure
#   2 - Dependency not available

set -e

MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[test-module] Starting..."

# Check if docker is available
if command -v docker &> /dev/null; then
    cd "$MODULE_DIR"

    # Start the container
    docker compose up -d

    # Wait for container to be running
    sleep 2

    # Create health marker
    docker exec test-module-app sh -c "touch /tmp/healthy" 2>/dev/null || true

    echo "[test-module] Container started"
else
    echo "[test-module] Docker not available, running in mock mode"
fi

# Update state
STATE_FILE="$MODULE_DIR/data/config/state"
if [ -f "$STATE_FILE" ]; then
    echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$STATE_FILE"
fi

echo "[test-module] Started successfully"
exit 0
