/**
 * Cloud Run v2 service for TomoriBot.
 *
 * Key design decisions:
 *   - min_instance_count = 1: Discord bots maintain a persistent WebSocket to the gateway;
 *     scaling to zero would drop the connection.
 *   - max_instance_count = 1: Only one bot instance should be connected at a time to avoid
 *     duplicate event handling.
 *   - cloud_sql_instance volume: mounts the Cloud SQL Auth Proxy socket so the app can
 *     reach the database without a VPC connector.
 *   - Secret is volume-mounted at /run/secrets/<secret_id> so secretsManager.ts can read
 *     it as a file rather than calling the AWS SDK.
 *   - ingress = INGRESS_TRAFFIC_INTERNAL_ONLY: the bot makes outbound calls only;
 *     no public HTTP endpoint is needed.
 */

resource "google_cloud_run_v2_service" "tomoribot" {
  name                = var.cloud_run_service_name
  location            = var.gcp_region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = false

  template {
    service_account = google_service_account.app.email

    scaling {
      min_instance_count = 1
      max_instance_count = var.cloud_run_max_instances
    }

    # Cloud SQL Auth Proxy socket — app connects via /cloudsql/<connection_name>
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    # Combined runtime secret mounted as a file
    volumes {
      name = "secrets"
      secret {
        secret = google_secret_manager_secret.tomoribot.secret_id
        items {
          version = "latest"
          path    = var.secret_name
        }
      }
    }

    containers {
      name  = var.container_name
      image = var.container_image

      resources {
        limits = {
          cpu    = var.cloud_run_cpu
          memory = var.cloud_run_memory
        }
        # Keep CPU allocated while the instance is running (needed for the persistent WS connection)
        cpu_idle = false
      }

      env {
        name  = "NODE_ENV"
        value = var.node_env
      }

      env {
        name  = "RUN_ENV"
        value = var.run_env
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.gcp_project_id
      }

      # Path to the mounted secret file — secretsManager.ts reads this instead of AWS SDK
      env {
        name  = "GCP_SECRET_FILE"
        value = "/run/secrets/${var.secret_name}"
      }

      # Cloud SQL connection name — used to construct the unix socket path
      env {
        name  = "CLOUD_SQL_CONNECTION_NAME"
        value = google_sql_database_instance.main.connection_name
      }

      # GCS bucket names injected so app code doesn't need to parse them from the secret
      env {
        name  = "AVATAR_GCS_BUCKET"
        value = google_storage_bucket.avatars.name
      }

      env {
        name  = "VOICE_SAMPLE_GCS_BUCKET"
        value = google_storage_bucket.voice_samples.name
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      volume_mounts {
        name       = "secrets"
        mount_path = "/run/secrets"
      }

    }
  }

  depends_on = [
    google_project_service.apis,
    google_sql_database_instance.main,
    google_secret_manager_secret.tomoribot,
  ]
}
