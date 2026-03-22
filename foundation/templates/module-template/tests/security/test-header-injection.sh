#!/bin/bash
# Security Test: Header Injection
# Tests that endpoints don't reflect injected headers in responses.
#
# Usage: ./test-header-injection.sh <base-url>

set -euo pipefail

BASE_URL="${1:?Usage: $0 <base-url>}"
PASS=0
FAIL=0

# Test CRLF injection in Host header
response=$(curl -s -D - -H "Host: evil.com%0d%0aInjected: true" "${BASE_URL}/" 2>/dev/null)
if echo "$response" | grep -qi "Injected: true"; then
    echo "FAIL: CRLF injection via Host header"
    ((FAIL++))
else
    echo "PASS: CRLF injection blocked"
    ((PASS++))
fi

# Test XSS in User-Agent reflection
response=$(curl -s -H "User-Agent: <script>alert(1)</script>" "${BASE_URL}/" 2>/dev/null)
if echo "$response" | grep -q "<script>alert(1)</script>"; then
    echo "FAIL: User-Agent reflected without sanitization"
    ((FAIL++))
else
    echo "PASS: User-Agent not reflected or sanitized"
    ((PASS++))
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
