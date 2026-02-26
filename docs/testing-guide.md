# Docker Lab Testing Guide

Complete guide to the Docker Lab test suite and testing practices.

## Overview

The Docker Lab uses a comprehensive test suite built on [bats-core](https://github.com/bats-core/bats-core) (Bash Automated Testing System). The test suite provides:

- **Unit tests** - Individual script and function validation
- **Integration tests** - Module lifecycle and component interaction tests
- **Smoke tests** - Quick validation of deployed applications
- **End-to-end tests** - Full workflow validation (backup/restore, etc.)

## Quick Start

### Prerequisites

1. **Git submodules** - Test framework dependencies are included as submodules:
   ```bash
   git submodule update --init --recursive
   ```

2. **Just command runner** - Used for test commands:
   ```bash
   # macOS
   brew install just

   # Ubuntu/Debian
   cargo install just
   ```

3. **Docker** (for integration and e2e tests):
   ```bash
   docker --version
   ```

### Running Tests

```bash
# Run all tests
just test

# Run specific test suites
just test-unit          # Unit tests only
just test-integration   # Integration tests only
just test-smoke         # Smoke tests only
just test-e2e          # End-to-end tests only

# Run with verbose output
BATS_VERBOSE=1 just test-unit

# Run specific test file
./tests/run-tests.sh tests/unit/test-scripts-help.bats
```

## Test Structure

```
tests/
├── unit/              # Unit tests for individual scripts
│   ├── test-scripts-help.bats
│   └── test-framework.bats
├── integration/       # Integration tests for module lifecycle
│   └── test-module-lifecycle.bats
├── smoke/            # Smoke tests for deployed applications
│   └── test-example-apps.bats
├── e2e/              # End-to-end workflow tests
│   └── test-backup-restore.bats
├── helpers/          # Shared test helpers
│   └── common.bash
├── fixtures/         # Test fixtures and sample data
├── lib/              # Test framework libraries (git submodules)
│   ├── bats-core/
│   ├── bats-support/
│   └── bats-assert/
├── run-tests.sh      # Main test runner
├── README.md         # Test suite documentation
└── CI.md            # CI integration guide
```

## Writing Tests

### Basic Test Structure

```bash
#!/usr/bin/env bats
# Description of what this test file covers

load '../helpers/common'

setup() {
  # Run before each test
  setup_test_tmp
}

teardown() {
  # Run after each test
  teardown_test_tmp
}

@test "descriptive test name" {
  run command_to_test arg1 arg2

  assert_success
  assert_output "expected output"
}
```

### Available Assertions

From `bats-assert`:

```bash
assert_success         # Exit code 0
assert_failure         # Exit code non-zero
assert_equal "a" "b"   # Exact match
assert_output "text"   # Exact output match
assert_output --partial "text"  # Partial match
assert_line "text"     # Line exists in output
refute_output          # No output produced
```

### Helper Functions

From `tests/helpers/common.bash`:

```bash
# Test setup/teardown
setup_test_tmp()              # Create test temp directory
teardown_test_tmp()           # Clean up test temp directory

# Test skipping
skip_if_not_ci()              # Skip unless in CI
skip_if_no_docker()           # Skip if Docker unavailable
skip_if_vps()                 # Skip on production VPS

# Docker helpers
wait_for_container_health()   # Wait for container healthy
container_is_running()        # Check if container running
volume_exists()               # Check if volume exists
get_container_logs()          # Get container logs
cleanup_docker_resources()    # Clean up by prefix

# Script testing
assert_script_has_help()      # Verify --help works
assert_script_requires_args() # Verify fails without args

# HTTP testing
http_status()                 # Get HTTP status code
http_body()                   # Get HTTP response body
assert_http_status()          # Assert status code
assert_http_contains()        # Assert response contains text
```

### Test Categories

#### Unit Tests

Test individual scripts and functions in isolation:

```bash
@test "script shows help message" {
  run "$SCRIPTS_DIR/my-script.sh" --help
  assert_success
  assert_output --partial "Usage:"
}

@test "script validates input" {
  run "$SCRIPTS_DIR/my-script.sh" invalid-input
  assert_failure
  assert_output --partial "ERROR"
}
```

#### Integration Tests

Test component interactions and module lifecycle:

```bash
@test "module lifecycle: install -> start -> stop -> uninstall" {
  skip_if_no_docker

  cd "$MODULES_DIR/test-module"

  # Install
  run ./scripts/install.sh
  assert_success

  # Start
  run ./scripts/start.sh
  assert_success
  container_is_running "test-module-app"

  # Stop
  run ./scripts/stop.sh
  assert_success

  # Uninstall
  run env REMOVE_DATA=true ./scripts/uninstall.sh
  assert_success
}
```

#### Smoke Tests

Quick validation of deployed applications:

```bash
@test "deployed app responds correctly" {
  if [[ -z "${APP_URL:-}" ]]; then
    skip "APP_URL not set"
  fi

  run "$SCRIPTS_DIR/testing/smoke-http.sh" \
    --url "$APP_URL/health" \
    --expect-status 200 \
    --contains "ok"

  assert_success
}
```

#### End-to-End Tests

Full workflow validation:

```bash
@test "backup/restore cycle preserves data" {
  skip_if_no_docker
  skip_if_vps

  # Create test data
  # ... create database with test records ...

  # Backup
  run "$SCRIPTS_DIR/backup.sh" postgres
  assert_success

  # Destroy
  # ... remove database ...

  # Restore
  run "$SCRIPTS_DIR/restore-postgres.sh" "$backup_file"
  assert_success

  # Verify data integrity
  # ... check test records exist ...
}
```

## Best Practices

### 1. Test Independence

Each test should be completely independent:

```bash
setup() {
  setup_test_tmp
  # Create fresh test environment
}

teardown() {
  cleanup_docker_resources "test-"
  teardown_test_tmp
}
```

### 2. Skip Appropriately

Use skip functions to handle different environments:

```bash
@test "requires docker" {
  skip_if_no_docker
  skip_if_vps  # Don't run destructive tests on VPS

  # Test code here
}
```

### 3. Clear Test Names

Use descriptive test names that explain what is being tested:

```bash
# Good
@test "backup creates timestamped file with checksum"

# Bad
@test "test backup"
```

### 4. Meaningful Assertions

Check for specific behaviors, not just exit codes:

```bash
# Good
run backup.sh
assert_success
assert_output --partial "Backup created"
[[ -f "$BACKUP_DIR/backup-$(date +%Y-%m-%d).tar.gz" ]]

# Less useful
run backup.sh
assert_success
```

### 5. Clean Up Resources

Always clean up Docker resources in teardown:

```bash
teardown() {
  docker rm -f test-container &>/dev/null || true
  docker volume rm test-volume &>/dev/null || true
  cleanup_docker_resources "test-"
}
```

## Debugging Tests

### Verbose Output

```bash
BATS_VERBOSE=1 just test-unit
```

### Run Single Test

```bash
./tests/run-tests.sh tests/unit/test-scripts-help.bats
```

### Filter by Pattern

```bash
./tests/run-tests.sh --filter "backup" e2e
```

### Check Test Output

```bash
# Print test output even on success
@test "debug test" {
  run command_to_test
  echo "Status: $status"
  echo "Output: $output"
  assert_success
}
```

### Interactive Debugging

```bash
# Add this in your test to pause and inspect
@test "debug pause" {
  run command_to_test

  # Print debug info
  echo "Status: $status" >&3
  echo "Output: $output" >&3

  # Assertion here
  assert_success
}
```

## CI Integration

See [CI.md](../tests/CI.md) for complete CI integration guide.

### Quick CI Setup

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: docker/setup-buildx-action@v3
      - run: just test
```

## Environment Variables

Configure tests with environment variables:

| Variable | Purpose | Example |
|----------|---------|---------|
| `CI` | Enable CI mode | `CI=1` |
| `BATS_VERBOSE` | Verbose output | `BATS_VERBOSE=1` |
| `GHOST_URL` | Ghost smoke test URL | `https://ghost.example.com` |
| `WORDPRESS_URL` | WordPress smoke test URL | `https://wp.example.com` |
| `PYTHON_API_URL` | Python API smoke test URL | `https://api.example.com` |
| `VPS_URL` | Remote VPS URL | `https://dockerlab.peermesh.org` |

## Test Coverage

### Current Coverage

- **Unit tests**: Core scripts (validation, deployment, testing helpers)
- **Integration tests**: Module lifecycle (install/start/health/stop/uninstall)
- **Smoke tests**: Example applications (Ghost, WordPress, Python API, etc.)
- **E2E tests**: Backup/restore cycle with data integrity verification

### Adding New Tests

When adding new functionality:

1. **Start with unit tests** - Test the smallest units
2. **Add integration tests** - Test component interactions
3. **Add smoke tests** - If user-facing, add smoke tests
4. **Consider e2e tests** - For critical workflows

## Troubleshooting

### Submodules Not Initialized

```bash
git submodule update --init --recursive
```

### Docker Permission Denied

```bash
# Add your user to docker group
sudo usermod -aG docker $USER
# Log out and back in
```

### Tests Hanging

```bash
# Set timeout
timeout 300 just test
```

### Cleanup After Failed Tests

```bash
# Manual cleanup
docker ps -a --filter "name=test-" --format '{{.Names}}' | xargs -r docker rm -f
docker volume ls --filter "name=test-" --format '{{.Name}}' | xargs -r docker volume rm
```

## Resources

- [bats-core documentation](https://bats-core.readthedocs.io/)
- [bats-assert library](https://github.com/bats-core/bats-assert)
- [bats-support library](https://github.com/bats-core/bats-support)
- [Test Suite README](../tests/README.md)
- [CI Integration Guide](../tests/CI.md)

## Contributing

When contributing tests:

1. Follow existing test structure
2. Use meaningful test names
3. Include setup/teardown
4. Clean up resources
5. Add documentation for complex tests
6. Run full test suite before submitting

```bash
# Before submitting PR
just test
```
