#!/usr/bin/env bash
# Test runner for Docker Lab test suite
# Runs bats tests with proper configuration and output formatting

set -euo pipefail

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BATS_BIN="${SCRIPT_DIR}/lib/bats-core/bin/bats"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Usage
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [TEST_SUITE]

Run Docker Lab test suite using bats-core.

TEST_SUITE:
  all             Run all tests (default)
  unit            Run unit tests only
  integration     Run integration tests only
  smoke           Run smoke tests only
  e2e             Run end-to-end tests only
  <file.bats>     Run specific test file

OPTIONS:
  -v, --verbose   Enable verbose output
  -f, --filter    Filter tests by name pattern
  -h, --help      Show this help message

ENVIRONMENT VARIABLES:
  BATS_VERBOSE    Set to 1 for verbose output
  CI              Set to 1 for CI mode (affects test skipping)
  GHOST_URL       URL for Ghost smoke tests
  WORDPRESS_URL   URL for WordPress smoke tests
  PYTHON_API_URL  URL for Python API smoke tests
  VPS_URL         URL for remote VPS smoke tests

EXAMPLES:
  $(basename "$0")                    # Run all tests
  $(basename "$0") unit               # Run unit tests only
  $(basename "$0") integration        # Run integration tests
  $(basename "$0") -v smoke           # Run smoke tests with verbose output
  $(basename "$0") tests/unit/test-scripts-help.bats  # Run specific test file

EXIT CODES:
  0 - All tests passed
  1 - One or more tests failed
  2 - Test setup error

For more information, see tests/README.md
EOF
}

# Check if bats is installed
check_bats() {
  if [[ ! -x "$BATS_BIN" ]]; then
    echo -e "${RED}ERROR: bats-core not found at ${BATS_BIN}${NC}" >&2
    echo "" >&2
    echo "Initialize git submodules to install bats-core:" >&2
    echo "  git submodule update --init --recursive" >&2
    echo "" >&2
    echo "Or install bats-core system-wide:" >&2
    echo "  brew install bats-core  # macOS" >&2
    echo "  apt-get install bats    # Ubuntu/Debian" >&2
    exit 2
  fi
}

# Parse arguments
VERBOSE="${BATS_VERBOSE:-0}"
FILTER_PATTERN=""
TEST_SUITE="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--verbose)
      VERBOSE=1
      shift
      ;;
    -f|--filter)
      FILTER_PATTERN="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    unit|integration|smoke|e2e|all)
      TEST_SUITE="$1"
      shift
      ;;
    *.bats)
      # Specific test file
      TEST_SUITE="$1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Check prerequisites
check_bats

# Build bats command
BATS_ARGS=()

if [[ "$VERBOSE" -eq 1 ]]; then
  BATS_ARGS+=(--verbose-run --show-output-of-passing-tests)
fi

if [[ -n "$FILTER_PATTERN" ]]; then
  BATS_ARGS+=(--filter "$FILTER_PATTERN")
fi

# Determine which tests to run
TEST_FILES=()

case "$TEST_SUITE" in
  all)
    TEST_FILES+=("$SCRIPT_DIR/unit")
    TEST_FILES+=("$SCRIPT_DIR/integration")
    TEST_FILES+=("$SCRIPT_DIR/smoke")
    TEST_FILES+=("$SCRIPT_DIR/e2e")
    ;;
  unit)
    TEST_FILES+=("$SCRIPT_DIR/unit")
    ;;
  integration)
    TEST_FILES+=("$SCRIPT_DIR/integration")
    ;;
  smoke)
    TEST_FILES+=("$SCRIPT_DIR/smoke")
    ;;
  e2e)
    TEST_FILES+=("$SCRIPT_DIR/e2e")
    ;;
  *.bats)
    # Specific test file
    if [[ -f "$TEST_SUITE" ]]; then
      TEST_FILES+=("$TEST_SUITE")
    elif [[ -f "$SCRIPT_DIR/$TEST_SUITE" ]]; then
      TEST_FILES+=("$SCRIPT_DIR/$TEST_SUITE")
    else
      echo -e "${RED}ERROR: Test file not found: $TEST_SUITE${NC}" >&2
      exit 2
    fi
    ;;
  *)
    echo -e "${RED}ERROR: Unknown test suite: $TEST_SUITE${NC}" >&2
    usage >&2
    exit 2
    ;;
esac

# Print test run info
echo -e "${BLUE}Docker Lab Test Suite${NC}"
echo -e "${BLUE}=====================${NC}"
echo "Suite: $TEST_SUITE"
echo "Verbose: $VERBOSE"
if [[ -n "$FILTER_PATTERN" ]]; then
  echo "Filter: $FILTER_PATTERN"
fi
echo ""

# Run tests
RC=0
"$BATS_BIN" "${BATS_ARGS[@]}" "${TEST_FILES[@]}" || RC=$?

# Print summary
echo ""
if [[ $RC -eq 0 ]]; then
  echo -e "${GREEN}✓ All tests passed${NC}"
else
  echo -e "${RED}✗ Some tests failed (exit code: $RC)${NC}"
fi

exit $RC
