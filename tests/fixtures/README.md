# Test Fixtures

This directory contains test fixtures and sample data for the test suite.

## Purpose

Test fixtures provide consistent, reusable test data that can be used across multiple tests.

## Usage

Test fixtures can be accessed from test files using the `TEST_FIXTURES_DIR` variable:

```bash
load '../helpers/common'

@test "example using fixture" {
  local fixture_file="${TEST_FIXTURES_DIR}/sample-config.json"

  # Use the fixture in your test
  run validate_config "$fixture_file"
  assert_success
}
```

## Creating Fixtures

When creating new fixtures:

1. Use descriptive filenames (e.g., `valid-module.json`, `invalid-compose.yml`)
2. Keep fixtures minimal - include only what's needed for the test
3. Document the purpose of complex fixtures
4. Use realistic data when possible

## Examples

- `sample-module.json` - A valid module.json for testing module validation
- `sample-compose.yml` - A minimal docker-compose.yml for testing compose validation
- `test-secrets/` - Sample secret files for backup/restore testing
