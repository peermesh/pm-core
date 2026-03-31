#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

cd "$core_root"

echo "[adapter-boundary-gate] ARCH-008 import hygiene (strict)"
python3 scripts/validation/validate_adapter_import_boundaries.py
echo "[adapter-boundary-gate] success"
