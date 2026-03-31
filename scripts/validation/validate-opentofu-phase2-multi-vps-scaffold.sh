#!/usr/bin/env bash
# wo-pmdl-227: OpenTofu Phase-2 multi-VPS non-production scaffold integrity gate.
# usage:
#   ./scripts/validation/validate-opentofu-phase2-multi-vps-scaffold.sh
# exit: 0 pass; 1 check failed; 2 bad args
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"
marker='PEERMESH_OPENTOFU_PHASE2_SCAFFOLD_NON_PRODUCTION=1'
stack_rel="infra/opentofu/stacks/phase-2-multi-vps"
mod_rel="infra/opentofu/modules/phase-2-multi-vps-contract"
stack_root="${core_root}/${stack_rel}"
mod_root="${core_root}/${mod_rel}"

while (($# > 0)); do
  case "$1" in
    -h|--help)
      printf 'usage: %s\n' "$0" >&2
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

fail=0
printf '%s\n' "validate-opentofu-phase2-multi-vps-scaffold (core_root=${core_root})"

require_file() {
  local p="$1"
  local rel="$2"
  if [[ ! -f "$p" ]]; then
    printf '%s\n' "FAIL: missing required file: ${rel}" >&2
    return 1
  fi
  printf '%s\n' "PASS: present ${rel}"
  return 0
}

file_contains() {
  local path="$1"
  local needle="$2"
  local label="$3"
  if ! grep -Fq "$needle" "$path"; then
    printf '%s\n' "FAIL: ${label} (missing substring in ${path})" >&2
    return 1
  fi
  printf '%s\n' "PASS: ${label}"
  return 0
}

no_resource_blocks() {
  local path="$1"
  local rel="$2"
  if grep -Eq '^\s*resource\s+"' "$path"; then
    printf '%s\n' "FAIL: scaffold must not declare resource blocks yet: ${rel}" >&2
    return 1
  fi
  printf '%s\n' "PASS: no resource blocks in ${rel}"
  return 0
}

# required paths
for rel in \
  "${stack_rel}/README.md" \
  "${stack_rel}/versions.tf" \
  "${stack_rel}/main.tf" \
  "${stack_rel}/variables.tf" \
  "${stack_rel}/outputs.tf" \
  "${mod_rel}/README.md" \
  "${mod_rel}/main.tf" \
  "${mod_rel}/variables.tf" \
  "${mod_rel}/outputs.tf"; do
  require_file "${core_root}/${rel}" "$rel" || fail=1
done

# machine + human markers (README)
for readme in "${stack_root}/README.md" "${mod_root}/README.md"; do
  file_contains "$readme" "$marker" "machine marker in README" || fail=1
  file_contains "$readme" "non-production" "human non-production marker in README" || fail=1
done

# syntax shape expectations
file_contains "${stack_root}/versions.tf" "required_version" "stack versions.tf declares required_version" || fail=1
file_contains "${stack_root}/main.tf" 'module "phase_2_multi_vps_contract"' "stack main.tf declares phase_2 module" || fail=1
file_contains "${stack_root}/main.tf" '../../modules/phase-2-multi-vps-contract' "stack module source path" || fail=1
file_contains "${stack_root}/variables.tf" 'variable "phase2_environment_key"' "stack phase2_environment_key variable" || fail=1
file_contains "${stack_root}/outputs.tf" 'output "phase_2_multi_vps_contract_summary"' "stack contract output" || fail=1
file_contains "${mod_root}/main.tf" "contract_summary" "module contract_summary local" || fail=1
file_contains "${mod_root}/variables.tf" 'variable "environment_key"' "module environment_key variable" || fail=1
file_contains "${mod_root}/outputs.tf" 'output "phase_2_multi_vps_contract_summary"' "module contract output" || fail=1

# scaffold must remain resource-free (no live infra)
no_resource_blocks "${stack_root}/main.tf" "${stack_rel}/main.tf" || fail=1
no_resource_blocks "${mod_root}/main.tf" "${mod_rel}/main.tf" || fail=1

# optional: tofu/terraform fmt + validate when CLI available (no backend, no providers)
if command -v tofu >/dev/null 2>&1; then
  printf '%s\n' "INFO: running tofu fmt -check + init -backend=false + validate in ${stack_rel}"
  (
    cd "$stack_root"
    tofu fmt -check -recursive
    tofu init -backend=false -input=false
    tofu validate
  ) || fail=1
elif command -v terraform >/dev/null 2>&1; then
  printf '%s\n' "INFO: running terraform fmt -check + init -backend=false + validate in ${stack_rel}"
  (
    cd "$stack_root"
    terraform fmt -check -recursive
    terraform init -backend=false -input=false
    terraform validate
  ) || fail=1
else
  printf '%s\n' "SKIP: neither tofu nor terraform in PATH; structural checks only"
fi

if [[ "$fail" -ne 0 ]]; then
  printf '%s\n' "validate-opentofu-phase2-multi-vps-scaffold: FAILED" >&2
  exit 1
fi

printf '%s\n' "validate-opentofu-phase2-multi-vps-scaffold: OK"
exit 0
