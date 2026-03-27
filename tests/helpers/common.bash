#!/usr/bin/env bash
# Common test helpers for Core test suite

# Load bats libraries
load '../lib/bats-support/load'
load '../lib/bats-assert/load'

# Project paths
export DOCKER_LAB_ROOT="${BATS_TEST_DIRNAME}/../.."
export SCRIPTS_DIR="${DOCKER_LAB_ROOT}/scripts"
export MODULES_DIR="${DOCKER_LAB_ROOT}/modules"
export PROFILES_DIR="${DOCKER_LAB_ROOT}/profiles"
export EXAMPLES_DIR="${DOCKER_LAB_ROOT}/examples"

# Test-specific paths
export TEST_FIXTURES_DIR="${BATS_TEST_DIRNAME}/../fixtures"
export TEST_TMP_DIR="${BATS_TEST_TMPDIR:-/tmp}/core-tests"

# Ensure test temp directory exists
setup_test_tmp() {
  mkdir -p "$TEST_TMP_DIR"
}

# Clean up test temp directory
teardown_test_tmp() {
  if [[ -d "$TEST_TMP_DIR" ]]; then
    rm -rf "$TEST_TMP_DIR"
  fi
}

# Skip test if not running in CI environment
skip_if_not_ci() {
  if [[ -z "${CI:-}" ]]; then
    skip "This test requires CI environment"
  fi
}

# Skip test if docker is not available
skip_if_no_docker() {
  if ! command -v docker &>/dev/null; then
    skip "Docker is not installed"
  fi

  if ! docker info &>/dev/null; then
    skip "Docker daemon is not running"
  fi
}

# Skip test if running on VPS (we don't want to disrupt production)
skip_if_vps() {
  if [[ -f "/opt/peermesh-core/README.md" ]]; then
    skip "This test should not run on VPS"
  fi
}

# Wait for container to be healthy
wait_for_container_health() {
  local container_name="$1"
  local max_wait="${2:-60}"
  local elapsed=0

  while [[ $elapsed -lt $max_wait ]]; do
    local health_status
    health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "unknown")

    if [[ "$health_status" == "healthy" ]]; then
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

# Check if container is running
container_is_running() {
  local container_name="$1"
  docker ps --filter "name=${container_name}" --filter "status=running" --format '{{.Names}}' | grep -q "^${container_name}$"
}

# Check if volume exists
volume_exists() {
  local volume_name="$1"
  docker volume ls --format '{{.Name}}' | grep -q "^${volume_name}$"
}

# Get container logs
get_container_logs() {
  local container_name="$1"
  local lines="${2:-50}"
  docker logs --tail "$lines" "$container_name" 2>&1
}

# Assert script has help message
assert_script_has_help() {
  local script_path="$1"

  run "$script_path" --help
  assert_success
  assert_output --partial "Usage:"
}

# Assert script fails without required arguments
assert_script_requires_args() {
  local script_path="$1"

  run "$script_path"
  assert_failure
}

# Make HTTP request and check status
http_status() {
  local url="$1"
  local timeout="${2:-10}"
  curl -sS --max-time "$timeout" -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000"
}

# Make HTTP request and get body
http_body() {
  local url="$1"
  local timeout="${2:-10}"
  curl -sS --max-time "$timeout" "$url" 2>/dev/null || echo ""
}

# Assert HTTP endpoint returns expected status
assert_http_status() {
  local url="$1"
  local expected_status="$2"
  local actual_status

  actual_status=$(http_status "$url")
  assert_equal "$actual_status" "$expected_status"
}

# Assert HTTP response contains text
assert_http_contains() {
  local url="$1"
  local expected_text="$2"
  local body

  body=$(http_body "$url")
  assert_output --partial "$expected_text" <<< "$body"
}

# Clean up docker resources by prefix
cleanup_docker_resources() {
  local prefix="$1"

  # Stop and remove containers
  docker ps -a --filter "name=${prefix}" --format '{{.Names}}' | while read -r container; do
    docker rm -f "$container" &>/dev/null || true
  done

  # Remove volumes
  docker volume ls --filter "name=${prefix}" --format '{{.Name}}' | while read -r volume; do
    docker volume rm "$volume" &>/dev/null || true
  done

  # Remove networks (except default bridge networks)
  docker network ls --filter "name=${prefix}" --format '{{.Name}}' | while read -r network; do
    if [[ "$network" != "bridge" && "$network" != "host" && "$network" != "none" ]]; then
      docker network rm "$network" &>/dev/null || true
    fi
  done
}

# Export all functions
export -f setup_test_tmp
export -f teardown_test_tmp
export -f skip_if_not_ci
export -f skip_if_no_docker
export -f skip_if_vps
export -f wait_for_container_health
export -f container_is_running
export -f volume_exists
export -f get_container_logs
export -f assert_script_has_help
export -f assert_script_requires_args
export -f http_status
export -f http_body
export -f assert_http_status
export -f assert_http_contains
export -f cleanup_docker_resources
