#!/usr/bin/env bash
# Delegates to parent-repo validator when this checkout is the monorepo layout
# (sub-repos/core/...). Standalone core clones skip with exit 0.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# From sub-repos/core/scripts/validation -> monorepo root is four levels up
parent_root="$(cd "$script_dir/../../../.." && pwd)"
validator="${parent_root}/scripts/validation/validate-strict-security-overlay-contract.sh"

if [[ -f "$validator" ]]; then
  echo "[strict-security-overlay-contract] running parent validator"
  bash "$validator"
else
  echo "[strict-security-overlay-contract] SKIP: parent validator not found (standalone core checkout)"
  exit 0
fi
