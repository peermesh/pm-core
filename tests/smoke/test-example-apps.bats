#!/usr/bin/env bats
# Smoke tests: Example application deployments

load '../helpers/common'

# These tests validate that example applications can be smoke-tested
# They use the existing smoke-example-app.sh script

@test "smoke test helper: smoke-http validates HTTP endpoints" {
  # Test against a known working endpoint
  run "$SCRIPTS_DIR/testing/smoke-http.sh" --url "https://httpbin.org/status/200" --expect-status 200
  assert_success
  assert_output --partial "Smoke check passed"
}

@test "smoke test helper: smoke-http detects wrong status code" {
  run "$SCRIPTS_DIR/testing/smoke-http.sh" --url "https://httpbin.org/status/404" --expect-status 200
  assert_failure
  assert_output --partial "expected status 200, got 404"
}

@test "smoke test helper: smoke-http validates content contains" {
  run "$SCRIPTS_DIR/testing/smoke-http.sh" \
    --url "https://httpbin.org/html" \
    --expect-status 200 \
    --contains "Herman Melville"
  assert_success
}

@test "smoke test helper: smoke-http detects missing content" {
  run "$SCRIPTS_DIR/testing/smoke-http.sh" \
    --url "https://httpbin.org/html" \
    --expect-status 200 \
    --contains "NONEXISTENT_STRING_12345"
  assert_failure
  assert_output --partial "does not contain expected text"
}

# Example app smoke tests
# These tests validate the smoke-example-app script works correctly
# They do NOT deploy the apps, they just test the smoke test script logic

@test "smoke example app: ghost smoke test structure is valid" {
  # Test that the ghost smoke test would work against a mock endpoint
  # We're not actually deploying Ghost, just validating the smoke test logic

  skip "Requires deployed Ghost instance or mock server"
}

@test "smoke example app: wordpress smoke test structure is valid" {
  # WordPress smoke test should check /wp-login.php for user_login

  skip "Requires deployed WordPress instance or mock server"
}

@test "smoke example app: python-api smoke test structure is valid" {
  # Python API smoke test should check /get endpoint
  # We can test this against httpbin which has the same endpoint

  run "$SCRIPTS_DIR/testing/smoke-example-app.sh" \
    --app python-api \
    --base-url "https://httpbin.org"

  assert_success
  assert_output --partial "Example app smoke passed"
}

@test "smoke example app: matrix smoke test expects versions endpoint" {
  # Matrix should expose /_matrix/client/versions endpoint
  # This test validates the smoke test logic without deploying Matrix

  skip "Requires deployed Matrix instance or mock server"
}

@test "smoke example app: invalid app name is rejected" {
  run "$SCRIPTS_DIR/testing/smoke-example-app.sh" \
    --app "nonexistent-app" \
    --base-url "https://example.com"

  assert_failure
  assert_output --partial "Unsupported app"
}

@test "smoke example app: missing base-url is rejected" {
  run "$SCRIPTS_DIR/testing/smoke-example-app.sh" --app ghost

  assert_failure
  assert_output --partial "--app and --base-url are required"
}

# Integration tests for deployed examples
# These would run against actual deployments (local or remote)

@test "deployed example: landing page serves content" {
  # This test would validate a deployed landing page
  # Skip if LANDING_URL is not set

  if [[ -z "${LANDING_URL:-}" ]]; then
    skip "LANDING_URL environment variable not set"
  fi

  run "$SCRIPTS_DIR/testing/smoke-http.sh" \
    --url "$LANDING_URL" \
    --expect-status 200

  assert_success
}

@test "deployed example: ghost instance is accessible" {
  # This test would validate a deployed Ghost instance
  # Skip if GHOST_URL is not set

  if [[ -z "${GHOST_URL:-}" ]]; then
    skip "GHOST_URL environment variable not set"
  fi

  run "$SCRIPTS_DIR/testing/smoke-example-app.sh" \
    --app ghost \
    --base-url "$GHOST_URL"

  assert_success
}

@test "deployed example: wordpress instance is accessible" {
  # This test would validate a deployed WordPress instance
  # Skip if WORDPRESS_URL is not set

  if [[ -z "${WORDPRESS_URL:-}" ]]; then
    skip "WORDPRESS_URL environment variable not set"
  fi

  run "$SCRIPTS_DIR/testing/smoke-example-app.sh" \
    --app wordpress \
    --base-url "$WORDPRESS_URL"

  assert_success
}

@test "deployed example: python-api instance is accessible" {
  # This test would validate a deployed Python API instance
  # Skip if PYTHON_API_URL is not set

  if [[ -z "${PYTHON_API_URL:-}" ]]; then
    skip "PYTHON_API_URL environment variable not set"
  fi

  run "$SCRIPTS_DIR/testing/smoke-example-app.sh" \
    --app python-api \
    --base-url "$PYTHON_API_URL"

  assert_success
}

# Remote deployment smoke tests
# These tests can run against VPS deployments

@test "remote smoke: foundation services are accessible (when VPS_URL is set)" {
  # Test foundation services on remote VPS
  # Skip if VPS_URL is not set

  if [[ -z "${VPS_URL:-}" ]]; then
    skip "VPS_URL environment variable not set (e.g., https://dockerlab.peermesh.org)"
  fi

  # Test Traefik dashboard (will return 401 if auth is enabled, which is expected)
  run "$SCRIPTS_DIR/testing/smoke-http.sh" \
    --url "${VPS_URL}/" \
    --expect-status 401

  # 401 is success for auth-protected endpoint
  assert_success
}
