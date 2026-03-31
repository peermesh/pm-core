# PEERMESH_OPENTOFU_PHASE2_SCAFFOLD_NON_PRODUCTION — stack wires placeholder contract only; no cloud resources.
locals {
  phase2_stack_marker = "non-production-phase-2-multi-vps-scaffold"
}

module "phase_2_multi_vps_contract" {
  source = "../../modules/phase-2-multi-vps-contract"

  environment_key = var.phase2_environment_key
}
