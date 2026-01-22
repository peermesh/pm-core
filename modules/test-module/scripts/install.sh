#!/bin/bash
#
# test-module: Installation script
#
# Exit codes:
#   0 - Success
#   1 - General failure
#   2 - Missing dependencies
#   3 - Configuration error

set -e

MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$MODULE_DIR/data}"

echo "[test-module] Installing..."
echo "[test-module] Module directory: $MODULE_DIR"
echo "[test-module] Data directory: $DATA_DIR"

# Create data directories
mkdir -p "$DATA_DIR"/{config,logs}

# Validate the module.json exists
if [ ! -f "$MODULE_DIR/module.json" ]; then
    echo "[test-module] ERROR: module.json not found"
    exit 3
fi

# Check for docker compose
if ! command -v docker &> /dev/null; then
    echo "[test-module] WARNING: Docker not available (will skip container tests)"
fi

# Write installation marker
echo "installed=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DATA_DIR/config/state"

echo "[test-module] Installation complete"
exit 0
