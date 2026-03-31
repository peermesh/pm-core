#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

cd "$core_root"

echo "[arch009-provider-event-surface-gate] checking provides.events on baseline manifests"
python3 scripts/validation/validate_provider_event_surface.py
echo "[arch009-provider-event-surface-gate] success"
