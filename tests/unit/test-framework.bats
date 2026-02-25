#!/usr/bin/env bats
# Unit tests: Validate the test framework itself

load '../helpers/common'

@test "test framework: bats-core is available" {
  # Verify bats is installed
  [[ -x "${BATS_TEST_DIRNAME}/../lib/bats-core/bin/bats" ]]
}

@test "test framework: bats-support library is loaded" {
  # bats-support should be loaded by common.bash
  command -v assert_success &>/dev/null
}

@test "test framework: bats-assert library is loaded" {
  # bats-assert should be loaded by common.bash
  command -v assert_output &>/dev/null
}

@test "test framework: project paths are set correctly" {
  # Verify environment variables from common.bash
  [[ -n "$DOCKER_LAB_ROOT" ]]
  [[ -d "$DOCKER_LAB_ROOT" ]]
  [[ -d "$SCRIPTS_DIR" ]]
  [[ -d "$MODULES_DIR" ]]
}

@test "test framework: test helpers are available" {
  # Verify helper functions are exported
  command -v setup_test_tmp &>/dev/null
  command -v cleanup_docker_resources &>/dev/null
  command -v assert_script_has_help &>/dev/null
}

@test "test framework: assert_success works" {
  run true
  assert_success
}

@test "test framework: assert_failure works" {
  run false
  assert_failure
}

@test "test framework: assert_output works" {
  run echo "test output"
  assert_output "test output"
}

@test "test framework: assert_output --partial works" {
  run echo "this is a test"
  assert_output --partial "test"
}

@test "test framework: setup_test_tmp creates directory" {
  setup_test_tmp
  [[ -d "$TEST_TMP_DIR" ]]
}

@test "test framework: teardown_test_tmp removes directory" {
  setup_test_tmp
  local tmp_dir="$TEST_TMP_DIR"
  teardown_test_tmp
  [[ ! -d "$tmp_dir" ]]
}

@test "test framework: skip_if_no_docker detects docker" {
  if command -v docker &>/dev/null && docker info &>/dev/null; then
    # Docker is available, function should not skip
    run skip_if_no_docker
    # Function should return normally (no skip)
    [[ $status -eq 0 ]]
  else
    # Docker not available, can't test the skip function
    skip "Docker not available"
  fi
}

@test "test framework: container_is_running helper works" {
  skip_if_no_docker

  # Start a test container
  docker run -d --name test-framework-container --rm alpine:latest sleep 30 || skip "Cannot start test container"

  # Test the helper
  run container_is_running "test-framework-container"
  assert_success

  # Clean up
  docker rm -f test-framework-container &>/dev/null || true
}

@test "test framework: http_status helper works" {
  # Test against a known working endpoint
  local status
  status=$(http_status "https://httpbin.org/status/200")

  [[ "$status" == "200" ]]
}

@test "test framework: http_body helper works" {
  # Test against a known endpoint
  local body
  body=$(http_body "https://httpbin.org/html")

  [[ -n "$body" ]]
  [[ "$body" =~ "Herman Melville" ]]
}
