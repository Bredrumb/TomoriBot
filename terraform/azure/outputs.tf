/**
 * Key outputs needed for CI/CD deployment and runtime secret updates.
 */

output "vm_public_ip" {
  description = "Static VM public IP retained only for low-cost outbound SNAT; no inbound NSG rule permits access."
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
  description = "Migration-only PostgreSQL administrator login. Never place it in the runtime application bundle."
  value       = azurerm_postgresql_flexible_server.main.administrator_login
}

output "postgres_private_ip" {
  description = "Private endpoint address used to verify VNet-only PostgreSQL resolution."
  value       = azurerm_private_endpoint.postgres.private_service_connection[0].private_ip_address
}

output "vm_name" {
  description = "VM name consumed by the Azure Run Command deployment path."
  value       = azurerm_linux_virtual_machine.tomoribot.name
}

output "vm_admin_username" {
  description = "Provisioning user passed to the explicit one-time host-lockdown command."
  value       = var.vm_admin_username
}

output "vm_network_security_group_name" {
  description = "Network security group checked after the explicit host-lockdown operation."
  value       = azurerm_network_security_group.vm.name
}
