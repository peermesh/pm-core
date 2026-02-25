variable "environment_key" {
  type = string
}

variable "compute_provider" {
  type = string
}

variable "dns_provider" {
  type = string
}

variable "fqdn" {
  type = string
}

variable "pilot_region" {
  type = string
}

variable "pilot_instance_size" {
  type = string
}

variable "pilot_enable_ipv6" {
  type = bool
}

variable "firewall_allow_ssh_cidrs" {
  type = list(string)
}

variable "firewall_allow_http" {
  type = bool
}

variable "firewall_allow_https" {
  type = bool
}

variable "resource_tags" {
  type = map(string)
}

variable "runtime_boundary_mode" {
  type = string
}
