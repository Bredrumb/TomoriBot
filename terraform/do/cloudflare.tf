/**
 * Cloudflare provider configuration for Matrix edge resources.
 * Manages DNS, tunnel routes, and WAF for the Matrix bridge subdomain.
 * Provider version and source are declared in main.tf required_providers.
 */

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
