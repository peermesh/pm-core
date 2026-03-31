#!/usr/bin/env bash
# Delegates to parent-repo federation readiness validator when monorepo layout is present.
# Standalone core clones skip with exit 0 (backward compatible).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parent_root="$(cd "$script_dir/../../../.." && pwd)"
validator="${parent_root}/scripts/validation/validate-federation-live-test-readiness-contract.sh"

if [[ -f "$validator" ]]; then
  echo "[federation-live-test-readiness] running parent validator"
  bash "$validator" "$@"
else
  echo "[federation-live-test-readiness] SKIP: parent validator not found (standalone core checkout)"
  exit 0
fi
