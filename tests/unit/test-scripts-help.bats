#!/usr/bin/env bats
# Unit tests: Verify all scripts have proper help/usage messages

load '../helpers/common'

@test "validate-app-secrets shows usage when run without args" {
  run "$SCRIPTS_DIR/validate-app-secrets.sh"
  assert_failure
  assert_output --partial "Usage:"
}

@test "validate-app-secrets help works with valid app" {
  # This script requires an app name even with --help
  # Skip testing --help flag since it requires positional argument
  skip "Script requires app name before --help flag"
}

@test "validate-secret-parity shows help" {
  run "$SCRIPTS_DIR/validate-secret-parity.sh" --help
  assert_success
  assert_output --partial "Usage:"
}

@test "deploy script shows help" {
  run "$SCRIPTS_DIR/deploy.sh" --help
  assert_success
  assert_output --partial "Usage:"
}

@test "validate-supply-chain shows help" {
  run "$SCRIPTS_DIR/security/validate-supply-chain.sh" --help
  assert_success
  assert_output --partial "Usage:"
}

@test "smoke-http shows help" {
  assert_script_has_help "$SCRIPTS_DIR/testing/smoke-http.sh"
}

@test "smoke-example-app shows help" {
  assert_script_has_help "$SCRIPTS_DIR/testing/smoke-example-app.sh"
}

@test "view-deploy-log shows help" {
  assert_script_has_help "$SCRIPTS_DIR/view-deploy-log.sh"
}

@test "dependency resolver script shows help" {
  assert_script_has_help "${DOCKER_LAB_ROOT}/foundation/lib/dependency-resolve.sh"
}

@test "backup script exists and is executable" {
  [[ -x "$SCRIPTS_DIR/backup.sh" ]]
}

@test "restore-all script exists and is executable" {
  [[ -x "$SCRIPTS_DIR/restore-all.sh" ]]
}
