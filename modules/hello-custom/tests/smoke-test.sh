#!/bin/bash
# ==============================================================
# Hello Custom Module - Smoke Test
# ==============================================================
# Purpose: Verify the module is working correctly after deployment
# Usage:   ./tests/smoke-test.sh
#
# This test verifies:
#   1. Container is running
#   2. HTTP endpoint responds with 200
#   3. Response contains expected content
#   4. Health check hook returns valid output
#
# Prerequisites:
#   - Module must be running (docker compose up -d)
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed
# ==============================================================

# Avoid exiting on first failure; we aggregate pass/fail across tests
set -uo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="hello-custom"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

pass() {
    ((TESTS_PASSED++))
    echo -e "  ${GREEN}PASS${NC} $1"
}

fail() {
    ((TESTS_FAILED++))
    echo -e "  ${RED}FAIL${NC} $1"
    if [[ -n "${2:-}" ]]; then
        echo -e "       ${YELLOW}$2${NC}"
    fi
}

run_test() {
    ((TESTS_RUN++))
}

# ==============================================================
# Tests
# ==============================================================

test_container_running() {
    run_test
    if docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" \
        --format '{{.Names}}' 2>/dev/null | grep -q "${CONTAINER_NAME}"; then
        pass "Container is running"
    else
        fail "Container is not running" "Start with: cd ${MODULE_DIR} && docker compose up -d"
    fi
}

test_http_response() {
    run_test
    local status_code
    status_code=$(docker exec "${CONTAINER_NAME}" \
        wget --quiet --output-document=/dev/null --server-response \
        "http://127.0.0.1/" 2>&1 | grep "HTTP/" | awk '{print $2}' | tail -1) || true

    if [[ "$status_code" == "200" ]]; then
        pass "HTTP endpoint returns 200"
    else
        fail "HTTP endpoint returned ${status_code:-no response}" "Expected 200"
    fi
}

test_html_content() {
    run_test
    local content
    content=$(docker exec "${CONTAINER_NAME}" \
        wget --quiet -O- "http://127.0.0.1/" 2>/dev/null) || true

    if echo "$content" | grep -q "Hello from PeerMesh Custom"; then
        pass "Response contains 'Hello from PeerMesh Custom'"
    else
        fail "Response does not contain expected content"
    fi
}

test_html_has_module_info() {
    run_test
    local content
    content=$(docker exec "${CONTAINER_NAME}" \
        wget --quiet -O- "http://127.0.0.1/" 2>/dev/null) || true

    if echo "$content" | grep -q "hello-custom"; then
        pass "Response contains module identifier"
    else
        fail "Response does not contain module identifier"
    fi
}

test_custom_note_present() {
    run_test
    local expected_note
    expected_note=$(docker exec "${CONTAINER_NAME}" \
        printenv HELLO_CUSTOM_NOTE 2>/dev/null || echo "Custom variant engaged")
    expected_note="${expected_note%$'\n'}"

    local content
    content=$(docker exec "${CONTAINER_NAME}" \
        wget --quiet -O- "http://127.0.0.1/" 2>/dev/null) || true

    if echo "$content" | grep -Fq "$expected_note"; then
        pass "Response exposes the configured note"
    else
        fail "Response missing configured note" "Expected: ${expected_note:-<empty>}"
    fi
}

test_health_hook_text() {
    run_test
    local output
    output=$("${MODULE_DIR}/hooks/health.sh" text 2>&1) || true

    if echo "$output" | grep -qi "healthy\|status"; then
        pass "Health hook (text mode) produces output"
    else
        fail "Health hook (text mode) produced no recognizable output"
    fi
}

test_health_hook_json() {
    run_test
    local output
    output=$("${MODULE_DIR}/hooks/health.sh" json 2>&1) || true

    # Check that output looks like JSON with a status field
    if echo "$output" | grep -q '"status"'; then
        pass "Health hook (json mode) returns JSON with status field"
    else
        fail "Health hook (json mode) did not return expected JSON"
    fi
}

test_container_health_status() {
    run_test
    local health
    health=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "none")

    if [[ "$health" == "healthy" ]]; then
        pass "Docker health check reports healthy"
    elif [[ "$health" == "starting" ]]; then
        pass "Docker health check is starting (may need more time)"
    else
        fail "Docker health check reports: ${health}"
    fi
}

# ==============================================================
# Main
# ==============================================================

main() {
    echo "========================================"
    echo "Hello Custom Module - Smoke Test"
    echo "========================================"
    echo ""

    # Run all tests
    test_container_running
    test_http_response
    test_html_content
    test_html_has_module_info
    test_custom_note_present
    test_health_hook_text
    test_health_hook_json
    test_container_health_status

    echo ""
    echo "========================================"
    echo "Results: ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
    echo "========================================"

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi

    exit 0
}

main "$@"
