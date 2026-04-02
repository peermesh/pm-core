#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

smoke_file="$core_root/modules/social/tests/smoke-test.sh"
guard_file="$core_root/modules/social/app/lib/stub-exposure-guard.js"
dsnp_route="$core_root/modules/social/app/routes/dsnp.js"
datasync_route="$core_root/modules/social/app/routes/datasync.js"
matrix_route="$core_root/modules/social/app/routes/matrix.js"
xmtp_route="$core_root/modules/social/app/routes/xmtp.js"
blockchain_route="$core_root/modules/social/app/routes/blockchain.js"
zot_route="$core_root/modules/social/app/routes/zot.js"

fail=0

check_file() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    printf '%s\n' "FAIL: missing file: $f" >&2
    fail=1
  else
    printf '%s\n' "PASS: file present: $f"
  fi
}

check_pattern() {
  local p="$1"
  local f="$2"
  local label="$3"
  if rg -q "$p" "$f"; then
    printf '%s\n' "PASS: ${label}"
  else
    printf '%s\n' "FAIL: ${label}" >&2
    fail=1
  fi
}

printf '%s\n' "validate-social-priority-route-graduation-contract (core_root=${core_root})"

check_file "$smoke_file"
check_file "$guard_file"
check_file "$dsnp_route"
check_file "$datasync_route"
check_file "$matrix_route"
check_file "$xmtp_route"
check_file "$blockchain_route"
check_file "$zot_route"

# priority-1 graduated/guarded route surface must remain explicitly tracked
check_pattern 'dsnp-profilealice-stub' "$smoke_file" "smoke contract includes dsnp priority route"
check_pattern 'hypercore-feedalice-stub' "$smoke_file" "smoke contract includes hypercore priority route"
check_pattern 'braid-version-stub' "$smoke_file" "smoke contract includes braid priority route"

# restricted-mode behavior must remain explicit in smoke expectations
check_pattern 'experimental_stub_disabled' "$smoke_file" "smoke includes restricted-mode denial code checks"

# route handlers must enforce experimental restriction guard
check_pattern 'denyExperimentalStubIfRestricted' "$dsnp_route" "dsnp route enforces experimental guard"
check_pattern 'denyExperimentalStubIfRestricted' "$datasync_route" "datasync route enforces experimental guard"

# guard implementation contract
check_pattern 'SOCIAL_LAB_RESTRICT_EXPERIMENTAL_STUBS' "$guard_file" "guard references canonical env toggle"
check_pattern 'experimental_stub_disabled' "$guard_file" "guard emits canonical denial code"

# priority-plus route coverage must remain visible in smoke contract
check_pattern '/api/matrix/identity/alice' "$smoke_file" "smoke covers matrix identity route"
check_pattern '/api/xmtp/identity/alice' "$smoke_file" "smoke covers xmtp identity route"
check_pattern '/api/lens/profile/alice' "$smoke_file" "smoke covers lens profile route"
check_pattern '/api/farcaster/identity/alice' "$smoke_file" "smoke covers farcaster identity route"
check_pattern '/api/zot/channel/alice' "$smoke_file" "smoke covers zot channel route"

printf '%s\n' "SOCIAL_PRIORITY_ROUTE_GRADUATION_CONTRACT_FAIL=${fail}"
exit "$fail"
