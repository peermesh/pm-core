output "pilot_contract" {
  description = "Single-VPS pilot infrastructure contract summary with provider-backed resource fields."

  value = merge(
    module.pilot_contract.contract_summary,
    {
      provider_backed_resources = {
        hcloud_ssh_key_id   = length(hcloud_ssh_key.operator) > 0 ? hcloud_ssh_key.operator[0].id : null
        hcloud_network_id   = length(hcloud_network.pilot) > 0 ? hcloud_network.pilot[0].id : null
        hcloud_subnet_id    = length(hcloud_network_subnet.pilot) > 0 ? hcloud_network_subnet.pilot[0].id : null
        hcloud_firewall_id  = length(hcloud_firewall.pilot) > 0 ? hcloud_firewall.pilot[0].id : null
        hcloud_server_id    = length(hcloud_server.pilot) > 0 ? hcloud_server.pilot[0].id : null
        hcloud_server_ipv4  = length(hcloud_server.pilot) > 0 ? hcloud_server.pilot[0].ipv4_address : null
        hcloud_server_ipv6  = length(hcloud_server.pilot) > 0 ? hcloud_server.pilot[0].ipv6_address : null
        hcloud_private_ipv4 = length(hcloud_server_network.pilot) > 0 ? hcloud_server_network.pilot[0].ip : null

        dns_provider     = var.dns_provider
        dns_record_id    = length(cloudflare_record.pilot_a) > 0 ? cloudflare_record.pilot_a[0].id : null
        dns_record_name  = length(cloudflare_record.pilot_a) > 0 ? cloudflare_record.pilot_a[0].hostname : local.pilot_fqdn
        dns_record_value = length(cloudflare_record.pilot_a) > 0 ? cloudflare_record.pilot_a[0].content : null
      }
    },
  )
}

output "pilot_server_ipv4" {
  description = "Pilot host public IPv4 address."
  value       = length(hcloud_server.pilot) > 0 ? hcloud_server.pilot[0].ipv4_address : null
}

output "pilot_server_private_ipv4" {
  description = "Pilot host private IPv4 address attached to pilot network."
  value       = length(hcloud_server_network.pilot) > 0 ? hcloud_server_network.pilot[0].ip : null
}

output "pilot_dns_record_hostname" {
  description = "DNS hostname managed for the pilot endpoint."
  value       = length(cloudflare_record.pilot_a) > 0 ? cloudflare_record.pilot_a[0].hostname : local.pilot_fqdn
}
