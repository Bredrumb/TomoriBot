/**
 * Cloudflare outputs for cross-stack reference and verification.
 * Use these values when configuring AWS Secrets Manager keys for Matrix.
 */

output "matrix_homeserver_url" {
  description = "Public HTTPS URL of the Matrix homeserver"
  value       = "https://matrix.${var.cloudflare_zone_name}"
}

output "matrix_appservice_public_url" {
  description = "Public HTTPS URL of the Matrix appservice callback (via Cloudflare tunnel)"
  value       = "https://matrix-appservice.${var.cloudflare_zone_name}"
}
