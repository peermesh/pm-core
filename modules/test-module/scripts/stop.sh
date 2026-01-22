#!/bin/bash
#
# test-module: Stop script
#
# Exit codes:
#   0 - Success - clean shutdown
#   1 - General failure
#   2 - Timeout waiting for shutdown

MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMEOUT=30

echo "[test-module] Stopping..."

# Check if docker is available
if command -v docker &> /dev/null; then
    cd "$MODULE_DIR"

    # Stop containers gracefully
    docker compose stop --timeout $TIMEOUT 2>/dev/null || true

    echo "[test-module] Container stopped"
else
    echo "[test-module] Docker not available, mock stop"
fi

# Update state
STATE_FILE="$MODULE_DIR/data/config/state"
if [ -f "$STATE_FILE" ]; then
    echo "stopped=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$STATE_FILE"
fi

echo "[test-module] Stopped successfully"
exit 0
