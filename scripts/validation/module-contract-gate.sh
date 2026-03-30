#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

cd "$core_root"

echo "[contract-gate] running module contract validation"
output="$(./launch_pm-core.sh module validate --contract-json)"
printf '%s\n' "$output"

json_payload="$(printf '%s\n' "$output" | awk '
  /^BEGIN_CONTRACT_REPORT_JSON$/ { in_block=1; next }
  /^END_CONTRACT_REPORT_JSON$/ { in_block=0; exit }
  in_block { print }
')"

if [[ -z "${json_payload//[[:space:]]/}" ]]; then
  echo "[contract-gate] error: missing contract report JSON block" >&2
  exit 1
fi

if ! printf '%s\n' "$json_payload" | jq -e 'type == "array"' >/dev/null; then
  echo "[contract-gate] error: invalid contract report JSON payload" >&2
  exit 1
fi

record_count="$(printf '%s\n' "$json_payload" | jq -r 'length')"
echo "[contract-gate] parsed $record_count contract record(s)"
echo "[contract-gate] success"
