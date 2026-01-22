#!/bin/bash
#
# test-module: Uninstall script
#
# Exit codes:
#   0 - Success - cleanup complete
#   1 - General failure
#   2 - User cancelled
#   3 - Partial cleanup (some items remain)

MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$MODULE_DIR/data}"

echo "[test-module] Uninstalling..."

# Stop if running
"$MODULE_DIR/scripts/stop.sh" 2>/dev/null || true

# Remove Docker resources if available
if command -v docker &> /dev/null; then
    cd "$MODULE_DIR"
    docker compose down -v --remove-orphans 2>/dev/null || true
    echo "[test-module] Docker resources removed"
fi

# Optionally remove data (requires confirmation)
if [ "$REMOVE_DATA" = "true" ]; then
    echo "[test-module] Removing data directory: $DATA_DIR"
    rm -rf "$DATA_DIR"
else
    echo "[test-module] Data directory preserved: $DATA_DIR"
    echo "[test-module] Set REMOVE_DATA=true to delete"
fi

echo "[test-module] Uninstall complete"
exit 0
