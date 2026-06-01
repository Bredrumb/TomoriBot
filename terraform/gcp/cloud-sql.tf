/**
 * Cloud SQL PostgreSQL instance for TomoriBot.
 *
 * Uses public IP with Cloud SQL Auth Proxy (handled by Cloud Run's cloud_sql_connections).
 * pg_tle is intentionally omitted — it is AWS-specific and not supported on Cloud SQL.
 * Supported extensions: pg_cron, pgcrypto, vector (pgvector).
 *
 * App connects via unix socket: /cloudsql/<connection_name>
 * Update POSTGRES_HOST in secretsManager to use the socket path after migration.
 */

resource "google_sql_database_instance" "main" {
  name             = var.db_instance_name
  database_version = var.db_version
  region           = var.gcp_region

  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = var.db_disk_size_gb
    disk_type         = "PD_SSD"

    backup_configuration {
      enabled    = var.db_backup_enabled
      start_time = "04:30"
    }

    database_flags {
      # Enable pg_cron scheduling
      name  = "cloudsql.enable_pg_cron"
      value = "on"
    }

    database_flags {
      name  = "max_connections"
      value = "25"
    }

    ip_configuration {
      # Public IP is required for Cloud SQL Auth Proxy access from Cloud Run
      ipv4_enabled = true
    }

    insights_config {
      query_insights_enabled = false
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "tomoribot" {
  name     = var.db_name
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = var.db_user
  instance = google_sql_database_instance.main.name
  password = var.db_password
}

# Password is auto-generated and stored in Terraform state.
# Retrieve it after apply with: terraform output -raw grafana_db_password
#
# Grant read-only access in the DB after first apply:
#   GRANT CONNECT ON DATABASE tomoribot TO grafana;
#   GRANT USAGE ON SCHEMA public TO grafana;
#   GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana;
#   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana;
resource "random_password" "grafana_db" {
  length  = 32
  special = false
}

resource "google_sql_user" "grafana" {
  name     = "grafana"
  instance = google_sql_database_instance.main.name
  password = random_password.grafana_db.result
}
