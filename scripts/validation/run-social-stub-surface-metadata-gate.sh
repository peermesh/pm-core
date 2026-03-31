#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

cd "$core_root"

python3 scripts/validation/validate_social_stub_surface_metadata.py "$@"
