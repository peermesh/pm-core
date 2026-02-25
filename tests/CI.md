# CI Integration Guide

This document describes how to integrate the Docker Lab test suite into CI/CD pipelines.

## Quick Start

The test suite is designed to work out-of-the-box in most CI environments:

```bash
# Initialize test dependencies
git submodule update --init --recursive

# Run all tests
just test

# Or run specific test suites
just test-unit
just test-integration
just test-smoke
just test-e2e
```

## CI Environment Detection

Tests automatically detect CI environments via the `CI` environment variable:

```bash
export CI=1
just test
```

When `CI=1`, tests that require special conditions will be skipped appropriately.

## GitHub Actions

Example `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Run unit tests
        run: just test-unit

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Set up Docker
        uses: docker/setup-buildx-action@v3

      - name: Run integration tests
        run: just test-integration

  smoke-tests:
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Run smoke tests
        env:
          VPS_URL: ${{ secrets.VPS_URL }}
        run: just test-smoke

  e2e-tests:
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Set up Docker
        uses: docker/setup-buildx-action@v3

      - name: Run E2E tests
        run: just test-e2e
```

## GitLab CI

Example `.gitlab-ci.yml`:

```yaml
stages:
  - test

variables:
  GIT_SUBMODULE_STRATEGY: recursive

unit-tests:
  stage: test
  image: ubuntu:latest
  before_script:
    - apt-get update && apt-get install -y just git
  script:
    - just test-unit

integration-tests:
  stage: test
  image: docker:latest
  services:
    - docker:dind
  before_script:
    - apk add --no-cache just git bash
  script:
    - just test-integration

smoke-tests:
  stage: test
  image: ubuntu:latest
  before_script:
    - apt-get update && apt-get install -y just git curl
  script:
    - just test-smoke
  only:
    - main
```

## Test Skipping in CI

The test suite uses smart skipping to handle different CI environments:

### Docker Availability

```bash
@test "requires docker" {
  skip_if_no_docker  # Skips if docker not available
  # Test code here
}
```

### VPS Protection

```bash
@test "local only test" {
  skip_if_vps  # Skips on production VPS
  # Test code here
}
```

### Environment-Specific Tests

```bash
@test "requires deployed app" {
  if [[ -z "${GHOST_URL:-}" ]]; then
    skip "GHOST_URL not set"
  fi
  # Test against deployed Ghost
}
```

## Test Output Formats

The test suite uses bats-core which produces TAP (Test Anything Protocol) output:

```
1..5
ok 1 test framework: bats-core is available
ok 2 test framework: assert_success works
ok 3 test framework: assert_failure works
ok 4 test framework: assert_output works
ok 5 test framework: setup_test_tmp creates directory
```

### JUnit XML Output

For CI systems that require JUnit XML:

```bash
# Install bats-junit formatter
git submodule add https://github.com/bats-core/bats-junit.git tests/lib/bats-junit

# Run tests with JUnit output
./tests/lib/bats-core/bin/bats \
  --formatter junit \
  --output /tmp/junit \
  tests/unit
```

## Performance Optimization

### Parallel Test Execution

Run test suites in parallel to speed up CI:

```bash
# Run unit and smoke tests in parallel (different jobs)
just test-unit &
just test-smoke &
wait
```

### Selective Test Execution

Run only affected tests based on changed files:

```bash
# Example: Run integration tests only if modules/ changed
if git diff --name-only HEAD~1 | grep -q '^modules/'; then
  just test-integration
fi
```

### Test Caching

Cache test dependencies to speed up subsequent runs:

```yaml
# GitHub Actions example
- uses: actions/cache@v3
  with:
    path: tests/lib
    key: test-deps-${{ hashFiles('.gitmodules') }}
```

## Environment Variables

Configure test behavior with environment variables:

| Variable | Purpose | Example |
|----------|---------|---------|
| `CI` | Enable CI mode | `CI=1` |
| `BATS_VERBOSE` | Verbose output | `BATS_VERBOSE=1` |
| `GHOST_URL` | Ghost smoke test URL | `https://ghost.example.com` |
| `WORDPRESS_URL` | WordPress smoke test URL | `https://wp.example.com` |
| `PYTHON_API_URL` | Python API smoke test URL | `https://api.example.com` |
| `VPS_URL` | Remote VPS URL | `https://dockerlab.peermesh.org` |
| `BACKUP_DIR` | Backup test directory | `/tmp/test-backups` |

## Troubleshooting

### Submodule Initialization Failed

```bash
# Reinitialize submodules
git submodule deinit -f tests/lib
git submodule update --init --recursive
```

### Docker Permission Denied

```bash
# Add CI user to docker group
sudo usermod -aG docker $USER

# Or use docker socket proxy in CI
```

### Tests Hang in CI

```bash
# Set timeout for tests
timeout 300 just test  # 5 minute timeout
```

## Exit Codes

The test suite returns standard exit codes:

- `0` - All tests passed
- `1` - One or more tests failed
- `2` - Test setup/infrastructure error

## Best Practices

1. **Run unit tests first** - They're fastest and catch most issues
2. **Run integration tests on Docker-enabled runners** - They need Docker
3. **Run smoke tests against staging** - Don't test against production
4. **Run E2E tests on dedicated runners** - They're resource-intensive
5. **Use matrix builds** - Test on multiple platforms/versions
6. **Cache dependencies** - Speed up subsequent runs
7. **Set timeouts** - Prevent hanging jobs
8. **Collect artifacts** - Save test logs and reports

## Example Complete CI Pipeline

```yaml
name: Complete Test Suite

on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - run: just test-unit

  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: unit
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: docker/setup-buildx-action@v3
      - run: just test-integration

  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: unit
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - run: just test-smoke
        env:
          VPS_URL: ${{ secrets.STAGING_URL }}

  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    needs: [unit, integration]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: docker/setup-buildx-action@v3
      - run: just test-e2e

  report:
    runs-on: ubuntu-latest
    needs: [unit, integration, smoke, e2e]
    if: always()
    steps:
      - name: Report Results
        run: echo "Test suite completed"
```
