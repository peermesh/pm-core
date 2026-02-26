# Docker Lab Test Suite

This directory contains the comprehensive test suite for the PeerMesh Docker Lab.

## Test Framework

We use [bats-core](https://github.com/bats-core/bats-core) - Bash Automated Testing System - for all shell-based tests.

### Installation

bats-core is included as a git submodule. To initialize:

```bash
git submodule update --init --recursive
```

Or install bats-core system-wide:

```bash
# macOS
brew install bats-core

# Ubuntu/Debian
sudo apt-get install bats

# From source
git clone https://github.com/bats-core/bats-core.git
cd bats-core
./install.sh /usr/local
```

## Test Structure

```
tests/
├── unit/              # Unit tests for individual scripts and functions
├── integration/       # Integration tests for module lifecycle
├── smoke/            # Smoke tests for deployed applications
├── e2e/              # End-to-end tests (backup/restore, full workflows)
├── helpers/          # Shared test helpers and utilities
└── fixtures/         # Test fixtures and sample data
```

## Running Tests

### All Tests
```bash
just test
```

### Specific Test Suites
```bash
just test-unit          # Unit tests only
just test-integration   # Integration tests only
just test-smoke         # Smoke tests only
just test-e2e          # End-to-end tests only
```

### Individual Test Files
```bash
./tests/lib/bats-core/bin/bats tests/unit/test-example.bats
```

### With Verbose Output
```bash
BATS_VERBOSE=1 just test-unit
```

## Writing Tests

### Test File Naming
- All test files must end with `.bats`
- Use descriptive names: `test-module-lifecycle.bats`, `test-backup-restore.bats`

### Test Structure Example
```bash
#!/usr/bin/env bats

# Load test helpers
load '../helpers/common'

setup() {
  # Run before each test
  export TEST_VAR="value"
}

teardown() {
  # Run after each test
  unset TEST_VAR
}

@test "description of what is being tested" {
  run command_to_test arg1 arg2

  assert_success
  assert_output "expected output"
}
```

### Available Assertions
- `assert_success` - exit code 0
- `assert_failure` - exit code non-zero
- `assert_output "text"` - exact output match
- `assert_output --partial "text"` - partial output match
- `assert_line "text"` - specific line in output
- `refute_output` - no output

## Test Categories

### Unit Tests
Test individual scripts, functions, and utilities in isolation.
- Script help/usage messages
- Input validation
- Error handling
- Output formatting

### Integration Tests
Test interactions between components.
- Module lifecycle (install → start → health → stop → uninstall)
- Service dependencies
- Network connectivity
- Volume persistence

### Smoke Tests
Quick validation of deployed applications.
- Container health checks
- HTTP endpoint responses
- Expected content delivery
- Service availability

### End-to-End Tests
Full workflow validation.
- Backup → destroy → restore → verify cycles
- Multi-module deployments
- Configuration changes
- Upgrade paths

## CI Integration

Tests produce TAP (Test Anything Protocol) output suitable for CI systems.

Exit codes:
- `0` - all tests passed
- `1` - one or more tests failed

## Best Practices

1. **Keep tests isolated** - Each test should be independent
2. **Use setup/teardown** - Clean up after tests
3. **Test one thing** - Each test should verify a single behavior
4. **Meaningful names** - Test names should describe what is being tested
5. **Fast tests** - Optimize for quick feedback
6. **Skip when needed** - Use `skip "reason"` for tests requiring special conditions
