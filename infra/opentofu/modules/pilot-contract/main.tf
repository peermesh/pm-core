locals {
  contract_summary = {
    environment_key         = var.environment_key
    fqdn                    = var.fqdn
    compute_provider        = var.compute_provider
    dns_provider            = var.dns_provider
    pilot_region            = var.pilot_region
    pilot_instance_size     = var.pilot_instance_size
    pilot_enable_ipv6       = var.pilot_enable_ipv6
    firewall_allow_ssh_cidrs = var.firewall_allow_ssh_cidrs
    firewall_allow_http     = var.firewall_allow_http
    firewall_allow_https    = var.firewall_allow_https
    runtime_boundary_mode   = var.runtime_boundary_mode
    resource_tags           = var.resource_tags
  }
}
