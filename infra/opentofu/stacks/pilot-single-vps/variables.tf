variable "pilot_environment_key" {
  type        = string
  description = "Pilot environment key."
  default     = "pilot-single-vps"

  validation {
    condition     = var.pilot_environment_key == "pilot-single-vps"
    error_message = "pilot_environment_key must remain 'pilot-single-vps' for this stack."
  }
}

variable "runtime_boundary_mode" {
  type        = string
  description = "Runtime ownership boundary mode."
  default     = "compose-webhook-authoritative"

  validation {
    condition     = var.runtime_boundary_mode == "compose-webhook-authoritative"
    error_message = "runtime_boundary_mode must remain 'compose-webhook-authoritative'."
  }
}

variable "manage_runtime_services" {
  type        = bool
  description = "Must stay false in pilot; OpenTofu does not manage runtime services."
  default     = false

  validation {
    condition     = var.manage_runtime_services == false
    error_message = "manage_runtime_services must be false in pilot scope."
  }
}

variable "compute_provider" {
  type        = string
  description = "Compute provider slug for pilot host contract (Hetzner-first)."

  validation {
    condition = contains(
      ["hetzner", "hcloud", "hetzner-cloud"],
      lower(trimspace(var.compute_provider)),
    )
    error_message = "compute_provider must be one of: hetzner, hcloud, hetzner-cloud."
  }
}

variable "dns_provider" {
  type        = string
  description = "DNS provider slug for pilot domain contract."
  default     = "none"

  validation {
    condition = contains(
      ["none", "cloudflare", "cf"],
      lower(trimspace(var.dns_provider)),
    )
    error_message = "dns_provider must be one of: none, cloudflare, cf."
  }
}

variable "pilot_domain" {
  type        = string
  description = "Base domain for pilot endpoint."

  validation {
    condition     = length(trimspace(var.pilot_domain)) > 0
    error_message = "pilot_domain cannot be empty."
  }
}

variable "pilot_subdomain" {
  type        = string
  description = "Subdomain for pilot endpoint."

  validation {
    condition     = length(trimspace(var.pilot_subdomain)) > 0
    error_message = "pilot_subdomain cannot be empty."
  }
}

variable "pilot_region" {
  type        = string
  description = "Hetzner location slug (for example: fsn1, nbg1, hel1, ash, hil)."

  validation {
    condition     = length(trimspace(var.pilot_region)) > 0
    error_message = "pilot_region cannot be empty."
  }
}

variable "pilot_instance_size" {
  type        = string
  description = "Hetzner server type slug (for example: cpx11)."

  validation {
    condition     = length(trimspace(var.pilot_instance_size)) > 0
    error_message = "pilot_instance_size cannot be empty."
  }
}

variable "hcloud_server_image" {
  type        = string
  description = "Hetzner server image slug."
  default     = "ubuntu-24.04"

  validation {
    condition     = length(trimspace(var.hcloud_server_image)) > 0
    error_message = "hcloud_server_image cannot be empty."
  }
}

variable "operator_ssh_public_key" {
  type        = string
  description = "Operator SSH public key (runtime-injected in real pilot)."

  validation {
    condition     = length(trimspace(var.operator_ssh_public_key)) > 0
    error_message = "operator_ssh_public_key cannot be empty."
  }
}

variable "hcloud_ssh_key_name" {
  type        = string
  description = "Suffix used for managed Hetzner SSH key name."
  default     = "operator"

  validation {
    condition     = length(trimspace(var.hcloud_ssh_key_name)) > 0
    error_message = "hcloud_ssh_key_name cannot be empty."
  }
}

variable "pilot_enable_ipv6" {
  type        = bool
  description = "Enable IPv6 for pilot host."
  default     = false
}

variable "hcloud_network_cidr" {
  type        = string
  description = "Private network CIDR for pilot network."
  default     = "10.80.0.0/16"

  validation {
    condition     = can(cidrhost(var.hcloud_network_cidr, 0))
    error_message = "hcloud_network_cidr must be a valid CIDR block."
  }
}

variable "hcloud_subnet_cidr" {
  type        = string
  description = "Private subnet CIDR for pilot host attachment."
  default     = "10.80.1.0/24"

  validation {
    condition     = can(cidrhost(var.hcloud_subnet_cidr, 0))
    error_message = "hcloud_subnet_cidr must be a valid CIDR block."
  }
}

variable "hcloud_network_zone" {
  type        = string
  description = "Hetzner network zone slug (for example: eu-central)."
  default     = "eu-central"

  validation {
    condition     = length(trimspace(var.hcloud_network_zone)) > 0
    error_message = "hcloud_network_zone cannot be empty."
  }
}

variable "hcloud_private_ipv4" {
  type        = string
  description = "Static private IPv4 assignment for the pilot host within the subnet."
  default     = "10.80.1.10"

  validation {
    condition     = can(cidrhost("10.80.0.0/8", 1)) && can(regex("^\\d+\\.\\d+\\.\\d+\\.\\d+$", var.hcloud_private_ipv4))
    error_message = "hcloud_private_ipv4 must be a valid IPv4 address string."
  }
}

variable "firewall_allow_ssh_cidrs" {
  type        = list(string)
  description = "Allowed SSH CIDR blocks for pilot host firewall."
  default     = []

  validation {
    condition = length(var.firewall_allow_ssh_cidrs) > 0 && alltrue([
      for cidr in var.firewall_allow_ssh_cidrs : can(cidrhost(cidr, 0))
    ])
    error_message = "firewall_allow_ssh_cidrs must include at least one valid CIDR."
  }
}

variable "firewall_allow_http" {
  type        = bool
  description = "Allow HTTP ingress."
  default     = true
}

variable "firewall_allow_https" {
  type        = bool
  description = "Allow HTTPS ingress."
  default     = true
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare zone id used when dns_provider is cloudflare."
  default     = ""

  validation {
    condition = (
      !contains(["cloudflare", "cf"], lower(trimspace(var.dns_provider)))
      || length(trimspace(var.cloudflare_zone_id)) > 0
    )
    error_message = "cloudflare_zone_id is required when dns_provider is cloudflare/cf."
  }
}

variable "cloudflare_record_ttl" {
  type        = number
  description = "Cloudflare record TTL in seconds (use 1 for automatic TTL)."
  default     = 1

  validation {
    condition     = var.cloudflare_record_ttl == 1 || (var.cloudflare_record_ttl >= 60 && var.cloudflare_record_ttl <= 86400)
    error_message = "cloudflare_record_ttl must be 1 (auto) or between 60 and 86400."
  }
}

variable "cloudflare_proxied" {
  type        = bool
  description = "Enable Cloudflare proxy for pilot A record."
  default     = false
}

variable "resource_tags" {
  type        = map(string)
  description = "Metadata tags for pilot resources."
  default     = {}
}
