#!/bin/bash
# Security Test: Auth Bypass Verification
# Tests that protected endpoints reject unauthenticated requests.
#
# Usage: ./test-auth-bypass.sh <base-url>
# Example: ./test-auth-bypass.sh http://localhost:8080

set -euo pipefail

BASE_URL="${1:?Usage: $0 <base-url>}"

# Define protected endpoints (customize for your module)
PROTECTED_ENDPOINTS=(
    "/api/data"
    "/api/config"
    "/admin"
)

PASS=0
FAIL=0

for endpoint in "${PROTECTED_ENDPOINTS[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${endpoint}" 2>/dev/null)
    if [[ "$status" == "401" || "$status" == "403" || "$status" == "302" ]]; then
        echo "PASS: ${endpoint} returns ${status} (access denied)"
        ((PASS++))
    else
        echo "FAIL: ${endpoint} returns ${status} (expected 401/403/302)"
        ((FAIL++))
    fi
done

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
