#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS_COUNT=0
FAIL_COUNT=0

run_case() {
  local name="$1"
  local expected_exit="$2"
  local expected_pattern="$3"
  shift 3

  local output
  local rc=0

  set +e
  output="$($@ 2>&1)"
  rc=$?
  set -e

  if [[ "$rc" -ne "$expected_exit" ]]; then
    echo "[FAIL] $name: expected exit $expected_exit, got $rc"
    echo "$output"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  if [[ -n "$expected_pattern" ]] && ! grep -Fq "$expected_pattern" <<<"$output"; then
    echo "[FAIL] $name: expected output to contain '$expected_pattern'"
    echo "$output"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  echo "[PASS] $name"
  PASS_COUNT=$((PASS_COUNT + 1))
}

run_case "validate-app-secrets usage" 1 "Usage:" \
  "$PROJECT_DIR/scripts/validate-app-secrets.sh"

run_case "validate-secret-parity help" 0 "Usage:" \
  "$PROJECT_DIR/scripts/validate-secret-parity.sh" --help

run_case "deploy help" 0 "Usage:" \
  "$PROJECT_DIR/scripts/deploy.sh" --help

run_case "validate-supply-chain help" 0 "Usage:" \
  "$PROJECT_DIR/scripts/security/validate-supply-chain.sh" --help

run_case "pilot-apply-readiness help" 0 "Usage:" \
  "$PROJECT_DIR/infra/opentofu/scripts/pilot-apply-readiness.sh" --help

run_case "pilot-credentials help" 0 "Usage:" \
  "$PROJECT_DIR/infra/opentofu/scripts/pilot-credentials.sh" --help

run_case "smoke-http help" 0 "Usage:" \
  "$PROJECT_DIR/scripts/testing/smoke-http.sh" --help

run_case "smoke-example-app help" 0 "Usage:" \
  "$PROJECT_DIR/scripts/testing/smoke-example-app.sh" --help

run_case "view-deploy-log help" 0 "Usage:" \
  "$PROJECT_DIR/scripts/view-deploy-log.sh" --help

echo ""
echo "Script test summary: pass=$PASS_COUNT fail=$FAIL_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
