locals {
  pilot_fqdn = format("%s.%s", var.pilot_subdomain, var.pilot_domain)

  compute_provider_normalized = lower(trimspace(var.compute_provider))
  dns_provider_normalized     = lower(trimspace(var.dns_provider))

  use_hetzner    = contains(["hetzner", "hcloud", "hetzner-cloud"], local.compute_provider_normalized)
  use_cloudflare = contains(["cloudflare", "cf"], local.dns_provider_normalized)

  resource_name_prefix = replace(var.pilot_environment_key, "_", "-")

  resource_labels = merge(
    {
      environment = var.pilot_environment_key
      managed_by  = "opentofu"
      project     = "peer-mesh-docker-lab"
    },
    var.resource_tags,
  )

  firewall_rules = concat(
    [
      for cidr in var.firewall_allow_ssh_cidrs : {
        direction  = "in"
        protocol   = "tcp"
        port       = "22"
        source_ips = [cidr]
      }
    ],
    var.firewall_allow_http ? [{
      direction  = "in"
      protocol   = "tcp"
      port       = "80"
      source_ips = ["0.0.0.0/0", "::/0"]
    }] : [],
    var.firewall_allow_https ? [{
      direction  = "in"
      protocol   = "tcp"
      port       = "443"
      source_ips = ["0.0.0.0/0", "::/0"]
    }] : [],
  )
}

provider "hcloud" {}

provider "cloudflare" {
  # Keep Cloudflare provider satisfiable even when dns_provider=none.
  # Real Cloudflare auth is required only when use_cloudflare=true.
  api_token = local.use_cloudflare ? null : "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
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

resource "hcloud_ssh_key" "operator" {
  count = local.use_hetzner ? 1 : 0

  name       = format("%s-%s", local.resource_name_prefix, var.hcloud_ssh_key_name)
  public_key = var.operator_ssh_public_key
  labels     = local.resource_labels
}

resource "hcloud_network" "pilot" {
  count = local.use_hetzner ? 1 : 0

  name     = format("%s-network", local.resource_name_prefix)
  ip_range = var.hcloud_network_cidr
  labels   = local.resource_labels
}

resource "hcloud_network_subnet" "pilot" {
  count = local.use_hetzner ? 1 : 0

  network_id   = hcloud_network.pilot[0].id
  type         = "cloud"
  network_zone = var.hcloud_network_zone
  ip_range     = var.hcloud_subnet_cidr
}

resource "hcloud_firewall" "pilot" {
  count = local.use_hetzner ? 1 : 0

  name   = format("%s-firewall", local.resource_name_prefix)
  labels = local.resource_labels

  dynamic "rule" {
    for_each = local.firewall_rules

    content {
      direction  = rule.value.direction
      protocol   = rule.value.protocol
      port       = rule.value.port
      source_ips = rule.value.source_ips
    }
  }
}

resource "hcloud_server" "pilot" {
  count = local.use_hetzner ? 1 : 0

  name        = format("%s-host", local.resource_name_prefix)
  server_type = var.pilot_instance_size
  image       = var.hcloud_server_image
  location    = var.pilot_region
  ssh_keys    = [hcloud_ssh_key.operator[0].id]
  labels      = local.resource_labels

  firewall_ids = [hcloud_firewall.pilot[0].id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = var.pilot_enable_ipv6
  }
}

resource "hcloud_server_network" "pilot" {
  count = local.use_hetzner ? 1 : 0

  server_id  = hcloud_server.pilot[0].id
  network_id = hcloud_network.pilot[0].id
  ip         = var.hcloud_private_ipv4
}

resource "cloudflare_record" "pilot_a" {
  count = (
    local.use_hetzner
    && local.use_cloudflare
    && length(trimspace(var.cloudflare_zone_id)) > 0
  ) ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = var.pilot_subdomain
  content = hcloud_server.pilot[0].ipv4_address
  type    = "A"
  ttl     = var.cloudflare_record_ttl
  proxied = var.cloudflare_proxied
}
