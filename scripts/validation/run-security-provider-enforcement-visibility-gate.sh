#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

cd "$core_root"

echo "[security-provider-enforcement-visibility] running validate_security_provider_enforcement_visibility.py"
python3 scripts/validation/validate_security_provider_enforcement_visibility.py
echo "[security-provider-enforcement-visibility] success"
