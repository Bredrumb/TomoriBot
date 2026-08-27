/**
 * Variables for Matrix homeserver deployment on DigitalOcean.
 */

variable "digitalocean_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "project_name" {
  description = "DigitalOcean project name"
  type        = string
  default     = "tomoribot-matrix"
}

variable "region" {
  description = "DigitalOcean region slug"
  type        = string
  default     = "nyc3"
}

variable "droplet_name" {
  description = "Matrix homeserver droplet name"
  type        = string
  default     = "tomoribot-matrix-hs"
}

variable "droplet_size" {
  description = "Droplet size slug"
  type        = string
  default     = "s-1vcpu-512mb-10gb"
}

variable "droplet_image" {
  description = "Droplet image slug"
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "enable_droplet_backups" {
  description = "Enable managed droplet backups"
  type        = bool
  default     = false
}

variable "ssh_key_fingerprints" {
  description = "SSH key fingerprints or IDs to install on the droplet"
  type        = list(string)
  default     = []
}

variable "ssh_ingress_cidrs" {
  description = "Allowed CIDR blocks for SSH access"
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.ssh_ingress_cidrs) > 0
    error_message = "Set at least one trusted CIDR in ssh_ingress_cidrs (for example, your public IP /32)."
  }

  validation {
    condition = alltrue([
      for cidr in var.ssh_ingress_cidrs : cidr != "0.0.0.0/0" && cidr != "::/0"
    ])
    error_message = "Do not allow world-open SSH CIDRs (0.0.0.0/0 or ::/0). Use specific trusted IP ranges."
  }
}

variable "volume_name" {
  description = "Block volume name for Matrix data"
  type        = string
  default     = "tomoribot-matrix-data"
}

variable "volume_size_gib" {
  description = "Block volume size in GiB"
  type        = number
  default     = 5
}

variable "tags" {
  description = "Tags applied to Matrix resources"
  type        = list(string)
  default     = ["tomoribot", "matrix", "tuwunel"]
}

variable "domain_name" {
  description = "Domain managed by DigitalOcean DNS (null to skip DNS record)"
  type        = string
  default     = null
}

variable "matrix_record_name" {
  description = "DNS record label for Matrix homeserver"
  type        = string
  default     = "matrix"
}
