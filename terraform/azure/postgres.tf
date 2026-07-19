/**
 * Azure Database for PostgreSQL Flexible Server.
 *
 * Public network access is deliberate for the low-cost VM architecture. Firewall
 * rules narrow access to the singleton VM public IP plus an optional admin IP.
 * pgvector still needs CREATE EXTENSION vector inside the database after the
 * Azure allowlist below is applied.
 */

resource "azurerm_postgresql_flexible_server" "main" {
  name                = var.postgres_server_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  version                       = var.postgres_version
  administrator_login           = var.postgres_admin_login
  administrator_password        = var.postgres_admin_password
  sku_name                      = var.postgres_sku_name
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = var.postgres_backup_retention_days
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = true

  tags = local.common_tags

  # Azure selects an availability zone when none is configured. Preserve that
  # provider-assigned zone on later applies; changing it requires a coordinated
  # standby-zone exchange that this single-server deployment does not use.
  lifecycle {
    ignore_changes = [zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "tomoribot" {
  name      = var.postgres_database_name
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "vm" {
  name             = "allow-tomoribot-vm"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = azurerm_public_ip.vm.ip_address
  end_ip_address   = azurerm_public_ip.vm.ip_address
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "admin" {
  for_each = var.admin_ip == null ? {} : { admin = var.admin_ip }

  name             = "allow-admin-ip"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = each.value
  end_ip_address   = each.value
}

# azure.extensions REPLACES the allowlist wholesale, so every extension the app
# needs must be listed together: VECTOR (embeddings), PGCRYPTO (required by
# schema.sql), PG_CRON (optional cooldown cleanup; app degrades gracefully without it).
resource "azurerm_postgresql_flexible_server_configuration" "extension_allowlist" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "VECTOR,PGCRYPTO,PG_CRON"
}

# pg_cron additionally must be preloaded at server start. This is a static server
# parameter: the first apply sets it, but a one-time manual restart
# (az postgres flexible-server restart) is required before CREATE EXTENSION pg_cron works.
resource "azurerm_postgresql_flexible_server_configuration" "shared_preload_libraries" {
  name      = "shared_preload_libraries"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "pg_cron"
}
