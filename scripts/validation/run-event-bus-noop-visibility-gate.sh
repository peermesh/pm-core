#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

cd "$core_root"

echo "[event-bus-noop-visibility-gate] running validate_event_bus_noop_visibility.py"
python3 scripts/validation/validate_event_bus_noop_visibility.py
echo "[event-bus-noop-visibility-gate] success"
