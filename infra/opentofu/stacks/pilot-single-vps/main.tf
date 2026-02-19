locals {
  pilot_fqdn = format("%s.%s", var.pilot_subdomain, var.pilot_domain)
}

module "pilot_contract" {
  source = "../../modules/pilot-contract"

  environment_key          = var.pilot_environment_key
  compute_provider         = var.compute_provider
  dns_provider             = var.dns_provider
  fqdn                     = local.pilot_fqdn
  pilot_region             = var.pilot_region
  pilot_instance_size      = var.pilot_instance_size
  pilot_enable_ipv6        = var.pilot_enable_ipv6
  firewall_allow_ssh_cidrs = var.firewall_allow_ssh_cidrs
  firewall_allow_http      = var.firewall_allow_http
  firewall_allow_https     = var.firewall_allow_https
  resource_tags            = var.resource_tags
  runtime_boundary_mode    = var.runtime_boundary_mode
}
