# PEERMESH_OPENTOFU_PHASE2_SCAFFOLD_NON_PRODUCTION — contract locals only; no provider resources.
locals {
  phase2_scaffold_marker = "PEERMESH_OPENTOFU_PHASE2_SCAFFOLD_NON_PRODUCTION"

  contract_summary = {
    environment_key    = var.environment_key
    scaffold_phase     = "phase_2_multi_vps_non_production"
    execution_status   = "placeholder_no_live_resources"
    runtime_boundary   = "compose-webhook-authoritative_future_multi_vps_tbd"
    scaffold_marker    = local.phase2_scaffold_marker
  }
}
