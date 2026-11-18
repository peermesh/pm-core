#!/usr/bin/env bats
# Unit tests: module install gate in launch_core.sh (module enable/install)
#
# WO-PMSYS-20261102-290, gap ledger L5. Each test copies launch_core.sh and the
# pieces it needs into a temporary project, adds fixture modules, and runs
# `module enable`. Docker is used only for `docker compose config` (render);
# fixture hooks replace compose up, so no container is ever started.
#
# Fixture hooks write "$GATE_MARKER_DIR/<module>.<hook>" when they run. A
# refusal is "before any hook" only if no marker exists afterwards.

load '../helpers/common'

GATE_FIXTURES="${TEST_FIXTURES_DIR}/module-install-gate/modules"
PROJ=""
GATE_HELPER=""

skip_if_no_compose() {
  if ! command -v docker &>/dev/null || ! docker compose version &>/dev/null; then
    skip "docker compose CLI is not available"
  fi
}

setup() {
  setup_test_tmp
  skip_if_no_compose
  PROJ="${TEST_TMP_DIR}/proj"
  mkdir -p "$PROJ/foundation" "$PROJ/scripts/validation" "$PROJ/modules"
  cp "${DOCKER_LAB_ROOT}/launch_core.sh" "$PROJ/"
  cp -R "${DOCKER_LAB_ROOT}/foundation/schemas" "${DOCKER_LAB_ROOT}/foundation/lib" "$PROJ/foundation/"
  cp "${DOCKER_LAB_ROOT}/foundation/docker-compose.base.yml" "$PROJ/foundation/"
  cp "${DOCKER_LAB_ROOT}/scripts/validation/module_install_gate.py" "$PROJ/scripts/validation/"
  cp -R "${GATE_FIXTURES}/." "$PROJ/modules/"
  mkdir -p "$PROJ/modules/test-module"
  cp "${MODULES_DIR}/test-module/module.json" "${MODULES_DIR}/test-module/docker-compose.yml" "$PROJ/modules/test-module/"
  GATE_HELPER="$PROJ/scripts/validation/module_install_gate.py"
  export GATE_MARKER_DIR="${TEST_TMP_DIR}/markers"
  mkdir -p "$GATE_MARKER_DIR"
}

teardown() {
  teardown_test_tmp
}

assert_no_hook_ran() {
  local module="$1"
  [[ ! -e "$GATE_MARKER_DIR/$module.install" ]] || fail "install hook of $module ran"
  [[ ! -e "$GATE_MARKER_DIR/$module.start" ]] || fail "start hook of $module ran"
}

assert_hooks_ran() {
  local module="$1"
  [[ -e "$GATE_MARKER_DIR/$module.install" ]] || fail "install hook of $module did not run"
  [[ -e "$GATE_MARKER_DIR/$module.start" ]] || fail "start hook of $module did not run"
}

# --- valid modules ----------------------------------------------------------

@test "install gate: first-party test-module passes validation and dry run" {
  run "$PROJ/launch_core.sh" module enable test-module --dry-run
  assert_success
  assert_output --partial "[test-module] module.json valid against module.schema.json"
  assert_output --partial "service test-module-app"
  assert_output --partial "image: alpine@sha256:"
  assert_output --partial "named volumes: test-module-data -> /data"
  assert_output --partial "docker socket mount: no"
  assert_output --partial "No hook ran; nothing started."
}

@test "install gate: dry run reports every field and runs no hook" {
  run "$PROJ/launch_core.sh" module enable gate-clean --dry-run
  assert_success
  for field in "image:" "modules/gate-clean/config -> /config (read-only)" \
      "named volumes:" "privileged: false" "cap_add: none" "devices: none" \
      "network_mode: default" "pid: default" "ipc: default" "security_opt: none" \
      "docker socket mount: no"; do
    assert_output --partial "$field"
  done
  assert_no_hook_ran gate-clean
}

@test "install gate: dry run writes no module .env" {
  printf 'DOMAIN=gate.test\n' > "$PROJ/.env"
  printf 'DOMAIN=example.com\n' > "$PROJ/modules/gate-clean/.env.example"
  run "$PROJ/launch_core.sh" module enable gate-clean --dry-run
  assert_success
  [[ ! -e "$PROJ/modules/gate-clean/.env" ]] || fail "dry run created a module .env"
}

@test "install gate: a clean module enables and its hooks run" {
  run "$PROJ/launch_core.sh" module enable gate-clean
  assert_success
  assert_output --partial "compose check passed"
  assert_hooks_ran gate-clean
}

# --- manifest failures --------------------------------------------------------

@test "install gate: manifest missing a required field is refused before any hook" {
  run "$PROJ/launch_core.sh" module enable gate-missing-field
  assert_failure
  assert_output --partial "field foundation: missing required field"
  assert_no_hook_ran gate-missing-field
}

@test "install gate: malformed module.json is refused before any hook" {
  run "$PROJ/launch_core.sh" module enable gate-malformed
  assert_failure
  assert_output --partial "module.json is malformed JSON"
  assert_no_hook_ran gate-malformed
}

@test "install gate: missing module.json is refused before any hook" {
  run "$PROJ/launch_core.sh" module enable gate-no-manifest
  assert_failure
  assert_output --partial "No module.json found for gate-no-manifest"
  assert_no_hook_ran gate-no-manifest
}

@test "install gate: dry run also refuses an invalid manifest" {
  run "$PROJ/launch_core.sh" module enable gate-missing-field --dry-run
  assert_failure
  assert_output --partial "field foundation: missing required field"
}

# --- dangerous compose requests -------------------------------------------------

refused_case() {
  local module="$1" expected="$2"
  run "$PROJ/launch_core.sh" module enable "$module"
  assert_failure
  assert_output --partial "REFUSED"
  assert_output --partial "$expected"
  assert_output --partial "--allow-dangerous=$module"
  assert_no_hook_ran "$module"
}

@test "install gate: Docker socket mount is refused before any hook" {
  refused_case gate-socket "Docker socket mount (/var/run/docker.sock)"
}

@test "install gate: privileged is refused before any hook" {
  refused_case gate-privileged "privileged: true"
}

@test "install gate: host network is refused before any hook" {
  refused_case gate-hostnet "network_mode: host"
}

@test "install gate: pid host is refused before any hook" {
  refused_case gate-pidhost "pid: host"
}

@test "install gate: ipc host is refused before any hook" {
  refused_case gate-ipchost "ipc: host"
}

@test "install gate: cap_add is refused before any hook" {
  refused_case gate-capadd "cap_add ['NET_ADMIN']"
}

@test "install gate: devices are refused before any hook" {
  refused_case gate-devices "devices ['/dev/null:/dev/fixture-null']"
}

@test "install gate: bind mount of / is refused before any hook" {
  refused_case gate-rootbind "bind mount of the host root /"
}

@test "install gate: bind mount of /etc is refused before any hook" {
  refused_case gate-etcbind "bind mount of /etc"
}

@test "install gate: bind mount of the operator home is refused before any hook" {
  refused_case gate-homebind "bind mount of the operator's home"
}

@test "install gate: dangerous request in docker-compose.override.yml is refused" {
  refused_case gate-override-file "privileged: true"
}

@test "install gate: dry run reports a dangerous request and exits non-zero" {
  run "$PROJ/launch_core.sh" module enable gate-socket --dry-run
  assert_failure
  assert_output --partial "docker socket mount: YES"
  assert_output --partial "enable would be refused"
  assert_no_hook_ran gate-socket
}

# --- operator override ----------------------------------------------------------------

@test "install gate: --allow-dangerous lets exactly the named module through and logs it" {
  run "$PROJ/launch_core.sh" module enable gate-privileged --allow-dangerous=gate-privileged
  assert_success
  assert_output --partial "ALLOWED by operator override --allow-dangerous=gate-privileged"
  assert_hooks_ran gate-privileged

  local log="$PROJ/logs/module-security-overrides.log"
  [[ -f "$log" ]] || fail "override log not written"
  run python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; assert len(e)==1, e; e=e[0]; assert e["module"]=="gate-privileged" and e["event"]=="module-install-dangerous-override" and any("privileged" in f for f in e["findings"]), e; print("ok")' "$log"
  assert_success
}

@test "install gate: --allow-dangerous for another module does not let this one through" {
  run "$PROJ/launch_core.sh" module enable gate-socket --allow-dangerous=gate-privileged
  assert_failure
  assert_output --partial "REFUSED"
  assert_output --partial "has no effect"
  assert_no_hook_ran gate-socket
  [[ ! -e "$PROJ/logs/module-security-overrides.log" ]] || fail "override logged without effect"
}

@test "install gate: --allow-dangerous does not bypass a manifest failure" {
  run "$PROJ/launch_core.sh" module enable gate-missing-field --allow-dangerous=gate-missing-field
  assert_failure
  assert_no_hook_ran gate-missing-field
}

@test "install gate: --allow-dangerous needs a module name" {
  run "$PROJ/launch_core.sh" module enable gate-clean --allow-dangerous=
  assert_failure
  assert_output --partial "--allow-dangerous needs a module name"
}

# --- dependency-module path --------------------------------------------------------------

@test "install gate: dependency path refuses a dangerous dependency before any hook" {
  run "$PROJ/launch_core.sh" module enable gate-dep-parent
  assert_failure
  assert_output --partial "Resolved enable order: gate-privileged gate-dep-parent"
  assert_output --partial "[gate-privileged]   - service app: privileged: true"
  assert_no_hook_ran gate-privileged
  assert_no_hook_ran gate-dep-parent
}

@test "install gate: dependency path override names the dependency, not the parent" {
  run "$PROJ/launch_core.sh" module enable gate-dep-parent --allow-dangerous=gate-dep-parent
  assert_failure
  assert_no_hook_ran gate-privileged
  assert_no_hook_ran gate-dep-parent

  run "$PROJ/launch_core.sh" module enable gate-dep-parent --allow-dangerous gate-privileged
  assert_success
  assert_hooks_ran gate-privileged
  assert_hooks_ran gate-dep-parent
}

@test "install gate: dependency with an invalid manifest stops the parent before any hook" {
  python3 - "$PROJ/modules/gate-dep-parent/module.json" <<'EOF'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["requires"]["modules"] = [{"id": "gate-missing-field"}]
json.dump(d, open(p, "w"))
EOF
  # The resolver needs the dependency id; keep it resolvable but schema-invalid.
  run "$PROJ/launch_core.sh" module enable gate-dep-parent
  assert_failure
  assert_output --partial "[gate-missing-field]   field foundation: missing required field"
  assert_no_hook_ran gate-missing-field
  assert_no_hook_ran gate-dep-parent
}

# --- schema engines ------------------------------------------------------------------------

@test "install gate: built-in schema engine matches jsonschema on every manifest" {
  if ! python3 -c 'import jsonschema' 2>/dev/null; then
    skip "jsonschema package not installed; built-in engine only"
  fi
  local manifest module rc_js rc_bi
  for manifest in "${MODULES_DIR}"/*/module.json "${GATE_FIXTURES}"/*/module.json; do
    module="$(basename "$(dirname "$manifest")")"
    rc_js=0; rc_bi=0
    PEERMESH_SCHEMA_ENGINE=jsonschema python3 "$GATE_HELPER" manifest --module "$module" \
      --manifest "$manifest" --schema-dir "$PROJ/foundation/schemas" >/dev/null 2>&1 || rc_js=$?
    PEERMESH_SCHEMA_ENGINE=builtin python3 "$GATE_HELPER" manifest --module "$module" \
      --manifest "$manifest" --schema-dir "$PROJ/foundation/schemas" >/dev/null 2>&1 || rc_bi=$?
    [[ "$rc_js" == "$rc_bi" ]] || fail "$manifest: jsonschema exit $rc_js, builtin exit $rc_bi"
  done
}

@test "install gate: built-in schema engine fails closed on an unknown keyword" {
  local schemas="${TEST_TMP_DIR}/schemas"
  cp -R "$PROJ/foundation/schemas" "$schemas"
  python3 - "$schemas/module.schema.json" <<'EOF'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["properties"]["id"]["dependentRequired"] = {}
json.dump(d, open(p, "w"))
EOF
  run env PEERMESH_SCHEMA_ENGINE=builtin python3 "$GATE_HELPER" manifest --module test-module \
    --manifest "$PROJ/modules/test-module/module.json" --schema-dir "$schemas"
  assert_failure
  assert_output --partial "not supported by the built-in validator"
}

@test "install gate: built-in engine refuses the missing-field fixture" {
  run env PEERMESH_SCHEMA_ENGINE=builtin python3 "$GATE_HELPER" manifest --module gate-missing-field \
    --manifest "$PROJ/modules/gate-missing-field/module.json" --schema-dir "$PROJ/foundation/schemas"
  assert_failure
  assert_output --partial "field foundation: missing required field"
  assert_output --partial "engine: builtin"
}
