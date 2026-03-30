#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

cd "$core_root"

echo "[composition-gate] running ARCH-009 composition audit in strict mode"
python3 scripts/validation/audit-module-data-composition.py --strict
echo "[composition-gate] success"
