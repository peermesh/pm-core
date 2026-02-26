#!/usr/bin/env bats
# Integration tests: Module lifecycle (install -> start -> health -> stop -> uninstall)

load '../helpers/common'

# Test module details
TEST_MODULE_DIR="${MODULES_DIR}/test-module"
TEST_MODULE_DATA_DIR="${TEST_MODULE_DIR}/data"
TEST_CONTAINER_NAME="test-module-app"
TEST_VOLUME_NAME="test-module-data"

setup() {
  setup_test_tmp
  skip_if_no_docker
  skip_if_vps

  # Clean up any leftover resources from previous test runs
  cleanup_module
}

teardown() {
  # Clean up module resources after each test
  cleanup_module
  teardown_test_tmp
}

cleanup_module() {
  # Uninstall the test module
  cd "$TEST_MODULE_DIR"
  REMOVE_DATA=true ./scripts/uninstall.sh &>/dev/null || true

  # Force cleanup Docker resources if still present
  cleanup_docker_resources "test-module"
}

@test "module lifecycle: install creates data directories" {
  cd "$TEST_MODULE_DIR"

  run ./scripts/install.sh
  assert_success
  assert_output --partial "Installation complete"

  # Verify data directories were created
  [[ -d "$TEST_MODULE_DATA_DIR/config" ]]
  [[ -d "$TEST_MODULE_DATA_DIR/logs" ]]

  # Verify state file was created
  [[ -f "$TEST_MODULE_DATA_DIR/config/state" ]]

  # Verify state file contains installation timestamp
  run cat "$TEST_MODULE_DATA_DIR/config/state"
  assert_output --partial "installed="
}

@test "module lifecycle: install validates module.json exists" {
  cd "$TEST_MODULE_DIR"

  # module.json should exist
  [[ -f "$TEST_MODULE_DIR/module.json" ]]

  run ./scripts/install.sh
  assert_success
}

@test "module lifecycle: start brings up container" {
  cd "$TEST_MODULE_DIR"

  # Install first
  ./scripts/install.sh

  # Start the module
  run ./scripts/start.sh
  assert_success
  assert_output --partial "Started successfully"

  # Verify container is running
  sleep 3
  run docker ps --filter "name=${TEST_CONTAINER_NAME}" --format '{{.Names}}'
  assert_success
  assert_output "$TEST_CONTAINER_NAME"

  # Verify state file was updated
  run cat "$TEST_MODULE_DATA_DIR/config/state"
  assert_output --partial "started="
}

@test "module lifecycle: health check passes after start" {
  cd "$TEST_MODULE_DIR"

  # Install and start
  ./scripts/install.sh
  ./scripts/start.sh

  # Wait for container to be fully healthy
  sleep 5

  # Run health check
  run ./scripts/health.sh

  # Health check should succeed (exit code 0 or 2 for degraded is acceptable)
  # We accept degraded because health check might run before container is fully healthy
  [[ $status -eq 0 || $status -eq 2 ]]

  # Output should be valid JSON
  echo "$output" | jq -e . >/dev/null

  # Should contain status field
  echo "$output" | jq -e '.status' >/dev/null

  # Should contain checks array
  echo "$output" | jq -e '.checks' >/dev/null
}

@test "module lifecycle: health check reports container status" {
  cd "$TEST_MODULE_DIR"

  # Install and start
  ./scripts/install.sh
  ./scripts/start.sh

  # Wait for container to be fully healthy
  sleep 5

  # Run health check and parse JSON
  run ./scripts/health.sh

  # Parse the health check output
  local health_json="$output"

  # Check that we have container check in the output
  local container_check
  container_check=$(echo "$health_json" | jq -r '.checks[] | select(.name == "container") | .status')

  # Container should be in pass or warn state (warn if still starting)
  [[ "$container_check" == "pass" || "$container_check" == "warn" ]]
}

@test "module lifecycle: stop gracefully shuts down container" {
  cd "$TEST_MODULE_DIR"

  # Install and start
  ./scripts/install.sh
  ./scripts/start.sh
  sleep 3

  # Verify container is running
  container_is_running "$TEST_CONTAINER_NAME"

  # Stop the module
  run ./scripts/stop.sh
  assert_success
  assert_output --partial "Stopped successfully"

  # Wait a moment for shutdown
  sleep 2

  # Verify container is stopped
  run docker ps --filter "name=${TEST_CONTAINER_NAME}" --filter "status=running" --format '{{.Names}}'
  assert_success
  refute_output "$TEST_CONTAINER_NAME"

  # Verify state file was updated
  run cat "$TEST_MODULE_DATA_DIR/config/state"
  assert_output --partial "stopped="
}

@test "module lifecycle: uninstall removes Docker resources" {
  cd "$TEST_MODULE_DIR"

  # Install and start
  ./scripts/install.sh
  ./scripts/start.sh
  sleep 3

  # Verify volume exists
  volume_exists "$TEST_VOLUME_NAME"

  # Uninstall the module
  run env REMOVE_DATA=true ./scripts/uninstall.sh
  assert_success
  assert_output --partial "Uninstall complete"

  # Verify container is removed
  run docker ps -a --filter "name=${TEST_CONTAINER_NAME}" --format '{{.Names}}'
  assert_success
  refute_output "$TEST_CONTAINER_NAME"

  # Verify volume is removed
  run docker volume ls --format '{{.Name}}'
  assert_success
  refute_output --partial "$TEST_VOLUME_NAME"
}

@test "module lifecycle: uninstall removes data when REMOVE_DATA=true" {
  cd "$TEST_MODULE_DIR"

  # Install
  ./scripts/install.sh

  # Verify data directory exists
  [[ -d "$TEST_MODULE_DATA_DIR" ]]

  # Uninstall with data removal
  run env REMOVE_DATA=true ./scripts/uninstall.sh
  assert_success

  # Verify data directory is removed
  [[ ! -d "$TEST_MODULE_DATA_DIR" ]]
}

@test "module lifecycle: uninstall preserves data when REMOVE_DATA is not set" {
  cd "$TEST_MODULE_DIR"

  # Install
  ./scripts/install.sh

  # Verify data directory exists
  [[ -d "$TEST_MODULE_DATA_DIR" ]]

  # Uninstall without REMOVE_DATA
  run ./scripts/uninstall.sh
  assert_success
  assert_output --partial "Data directory preserved"

  # Verify data directory still exists
  [[ -d "$TEST_MODULE_DATA_DIR" ]]

  # Clean up for this test
  rm -rf "$TEST_MODULE_DATA_DIR"
}

@test "module lifecycle: full cycle (install -> start -> health -> stop -> uninstall)" {
  cd "$TEST_MODULE_DIR"

  # Step 1: Install
  run ./scripts/install.sh
  assert_success
  [[ -d "$TEST_MODULE_DATA_DIR" ]]

  # Step 2: Start
  run ./scripts/start.sh
  assert_success
  sleep 3
  container_is_running "$TEST_CONTAINER_NAME"

  # Step 3: Health check
  run ./scripts/health.sh
  [[ $status -eq 0 || $status -eq 2 ]]
  echo "$output" | jq -e . >/dev/null

  # Step 4: Stop
  run ./scripts/stop.sh
  assert_success
  sleep 2
  run docker ps --filter "name=${TEST_CONTAINER_NAME}" --filter "status=running" --format '{{.Names}}'
  refute_output "$TEST_CONTAINER_NAME"

  # Step 5: Uninstall
  run env REMOVE_DATA=true ./scripts/uninstall.sh
  assert_success

  # Verify complete cleanup
  [[ ! -d "$TEST_MODULE_DATA_DIR" ]]
  run docker ps -a --filter "name=${TEST_CONTAINER_NAME}" --format '{{.Names}}'
  refute_output "$TEST_CONTAINER_NAME"
  run docker volume ls --format '{{.Name}}'
  refute_output --partial "$TEST_VOLUME_NAME"
}
