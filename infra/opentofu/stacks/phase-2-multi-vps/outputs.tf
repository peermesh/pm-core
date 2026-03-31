# PEERMESH_OPENTOFU_PHASE2_SCAFFOLD_NON_PRODUCTION
output "phase_2_multi_vps_contract_summary" {
  description = "NON_PRODUCTION_SCAFFOLD: forwarded placeholder contract summary from phase-2-multi-vps-contract."
  value       = module.phase_2_multi_vps_contract.phase_2_multi_vps_contract_summary
}

output "phase_2_stack_scaffold_marker" {
  description = "NON_PRODUCTION_SCAFFOLD: stack-level marker string for integrity gates."
  value       = local.phase2_stack_marker
}
