/**
 * Key outputs needed for CI/CD deployment and runtime secret updates.
 */

output "vm_public_ip" {
  description = "Static VM public IP - consumed by the Azure deploy workflow for ssh/scp."
  value       = azurerm_public_ip.vm.ip_address
}

output "postgres_fqdn" {
  description = "PostgreSQL Flexible Server FQDN - set as POSTGRES_HOST in TOMORI_SECRETS_JSON."
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

output "resource_group_name" {
  description = "Azure resource group containing TomoriBot runtime resources."
  value       = azurerm_resource_group.main.name
}

output "postgres_database_name" {
  description = "Application database name created on the Flexible Server."
  value       = azurerm_postgresql_flexible_server_database.tomoribot.name
}

output "postgres_admin_login" {
  description = "PostgreSQL administrator login to use as POSTGRES_USER unless a separate app role is created later."
  value       = azurerm_postgresql_flexible_server.main.administrator_login
}
