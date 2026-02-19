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
  description = "Compute provider slug for pilot host contract."

  validation {
    condition     = length(trimspace(var.compute_provider)) > 0
    error_message = "compute_provider cannot be empty."
  }
}

variable "dns_provider" {
  type        = string
  description = "DNS provider slug for pilot domain contract."

  validation {
    condition     = length(trimspace(var.dns_provider)) > 0
    error_message = "dns_provider cannot be empty."
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
  description = "Pilot region/zone label."

  validation {
    condition     = length(trimspace(var.pilot_region)) > 0
    error_message = "pilot_region cannot be empty."
  }
}

variable "pilot_instance_size" {
  type        = string
  description = "Pilot compute size slug."

  validation {
    condition     = length(trimspace(var.pilot_instance_size)) > 0
    error_message = "pilot_instance_size cannot be empty."
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

variable "pilot_enable_ipv6" {
  type        = bool
  description = "Enable IPv6 for pilot host."
  default     = false
}

variable "firewall_allow_ssh_cidrs" {
  type        = list(string)
  description = "Allowed SSH CIDR blocks for pilot host firewall."
  default     = []

  validation {
    condition     = length(var.firewall_allow_ssh_cidrs) > 0
    error_message = "firewall_allow_ssh_cidrs must include at least one CIDR."
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

variable "resource_tags" {
  type        = map(string)
  description = "Metadata tags for pilot contract."
  default     = {}
}
