#!/usr/bin/env bats
# Unit tests: module dependency resolver

load '../helpers/common'

RESOLVER_SCRIPT=""
MODULE_FIXTURE_DIR=""

setup() {
  setup_test_tmp
  RESOLVER_SCRIPT="${DOCKER_LAB_ROOT}/foundation/lib/dependency-resolve.sh"
  MODULE_FIXTURE_DIR="${TEST_TMP_DIR}/modules"
  mkdir -p "$MODULE_FIXTURE_DIR"
}

teardown() {
  teardown_test_tmp
}

create_module_manifest() {
  local module_id="$1"
  local version="$2"
  local deps_json="$3"
  local module_dir="${MODULE_FIXTURE_DIR}/${module_id}"

  mkdir -p "$module_dir"
  cat > "${module_dir}/module.json" <<EOF
{
  "id": "${module_id}",
  "version": "${version}",
  "requires": {
    "modules": ${deps_json}
  }
}
EOF
}

@test "dependency resolver: no dependencies returns module itself" {
  create_module_manifest "solo" "1.0.0" "[]"

  run "$RESOLVER_SCRIPT" "solo" --modules-dir "$MODULE_FIXTURE_DIR" --order-only
  assert_success
  assert_line --index 0 "solo"
}

@test "dependency resolver: linear chain resolves in dependency-first order" {
  create_module_manifest "c" "1.0.0" "[]"
  create_module_manifest "b" "1.0.0" "[{\"id\":\"c\",\"optional\":false}]"
  create_module_manifest "a" "1.0.0" "[{\"id\":\"b\",\"optional\":false}]"

  run "$RESOLVER_SCRIPT" "a" --modules-dir "$MODULE_FIXTURE_DIR" --order-only
  assert_success
  assert_line --index 0 "c"
  assert_line --index 1 "b"
  assert_line --index 2 "a"
}

@test "dependency resolver: diamond dependency contains shared dependency once" {
  create_module_manifest "d" "1.0.0" "[]"
  create_module_manifest "b" "1.0.0" "[{\"id\":\"d\",\"optional\":false}]"
  create_module_manifest "c" "1.0.0" "[{\"id\":\"d\",\"optional\":false}]"
  create_module_manifest "a" "1.0.0" "[{\"id\":\"b\",\"optional\":false},{\"id\":\"c\",\"optional\":false}]"

  run "$RESOLVER_SCRIPT" "a" --modules-dir "$MODULE_FIXTURE_DIR" --order-only
  assert_success
  assert_output --partial "d"
  assert_output --partial "b"
  assert_output --partial "c"
  assert_line --index 0 "d"
  assert_line --index 3 "a"
}

@test "dependency resolver: required missing dependency fails closed" {
  create_module_manifest "a" "1.0.0" "[{\"id\":\"missing-module\",\"optional\":false}]"

  run "$RESOLVER_SCRIPT" "a" --modules-dir "$MODULE_FIXTURE_DIR" --order-only
  assert_failure
  assert_output --partial "required dependency missing: a -> missing-module"
}

@test "dependency resolver: circular dependency fails with cycle description" {
  create_module_manifest "a" "1.0.0" "[{\"id\":\"b\",\"optional\":false}]"
  create_module_manifest "b" "1.0.0" "[{\"id\":\"c\",\"optional\":false}]"
  create_module_manifest "c" "1.0.0" "[{\"id\":\"a\",\"optional\":false}]"

  run "$RESOLVER_SCRIPT" "a" --modules-dir "$MODULE_FIXTURE_DIR" --order-only
  assert_failure
  assert_output --partial "circular dependency detected:"
}

@test "dependency resolver: dry-run prints execution plan" {
  create_module_manifest "dep" "1.0.0" "[]"
  create_module_manifest "root" "1.0.0" "[{\"id\":\"dep\",\"optional\":false}]"

  run "$RESOLVER_SCRIPT" "root" --modules-dir "$MODULE_FIXTURE_DIR" --dry-run
  assert_success
  assert_output --partial "Dependency resolution plan for module: root"
  assert_output --partial "1. dep"
  assert_output --partial "2. root"
}

