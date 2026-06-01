/**
 * Cloudflare provider variables for Matrix edge configuration.
 */

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:DNS:Edit, Zone:WAF:Edit, and Account:Cloudflare Tunnel:Edit permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the managed domain"
  type        = string
}

variable "cloudflare_zone_name" {
  description = "Root domain managed by Cloudflare (e.g. tomoribot.app)"
  type        = string
  default     = "tomoribot.app"
}

variable "matrix_tunnel_id" {
  description = "ID of the existing Cloudflare tunnel used for the Matrix appservice callback"
  type        = string
}

variable "matrix_appservice_port" {
  description = "Local port the Matrix appservice listens on inside the tunnel connector"
  type        = number
  default     = 9993
}
