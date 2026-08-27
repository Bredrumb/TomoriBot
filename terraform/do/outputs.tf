/**
 * Outputs for Matrix homeserver provisioning.
 */

output "matrix_droplet_id" {
  description = "DigitalOcean droplet ID for the Matrix homeserver"
  value       = digitalocean_droplet.matrix_homeserver.id
}

output "matrix_droplet_ipv4" {
  description = "Public IPv4 address of the Matrix homeserver"
  value       = digitalocean_droplet.matrix_homeserver.ipv4_address
}

output "matrix_data_volume_id" {
  description = "DigitalOcean volume ID used for Matrix data"
  value       = digitalocean_volume.matrix_data.id
}

output "matrix_homeserver_fqdn" {
  description = "Matrix homeserver FQDN (null when domain_name is unset)"
  value       = local.matrix_fqdn
}

output "matrix_base_url" {
  description = "Suggested homeserver base URL"
  value       = local.matrix_fqdn == null ? null : "https://${local.matrix_fqdn}"
}
