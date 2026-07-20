/**
 * Azure Database for PostgreSQL Flexible Server.
 *
 * Private Link and private DNS keep application traffic inside the production
 * VNet. Public access remains enabled solely for one Terraform-managed Grafana
 * operator address using a separate read-only database login.
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

resource "azurerm_postgresql_flexible_server_firewall_rule" "grafana" {
  name             = "allow-grafana-operator"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = var.grafana_egress_ip
  end_ip_address   = var.grafana_egress_ip
}

resource "azurerm_private_dns_zone" "postgres" {
  name                = "privatelink.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.common_tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "${var.name_prefix}-postgres-dns-link"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
  tags                  = local.common_tags
}

resource "azurerm_private_endpoint" "postgres" {
  name                = "${var.name_prefix}-postgres-pe"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.postgres_private_endpoint.id
  tags                = local.common_tags

  private_service_connection {
    name                           = "${var.name_prefix}-postgres-private-connection"
    private_connection_resource_id = azurerm_postgresql_flexible_server.main.id
    subresource_names              = ["postgresqlServer"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.postgres.id]
  }

  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
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
