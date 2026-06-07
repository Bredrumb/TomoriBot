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

      # Ingress container: Cloud Run requires exactly one container to expose a
      # port, injects PORT with this value, and targets its startup probe here.
      # The bot's health server reads process.env.PORT (see src/index.ts) and
      # binds it. Deliberately 8081 — not 8080 — because Cloud Run containers
      # share a localhost network namespace and must each bind a unique port;
      # the SearXNG sidecar keeps 8080.
      ports {
        container_port = 8081
      }

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

      # SearXNG sidecar reachable on the loopback interface of the same pod.
      env {
        name  = "SEARXNG_BASE_URL"
        value = "http://localhost:8080/"
      }

      depends_on = ["searxng"]

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      volume_mounts {
        name       = "secrets"
        mount_path = "/run/secrets"
      }

    }

    # ------------------------------------------------------------
    # SearXNG metasearch sidecar (Phase 2).
    # Cloud Run v2 multi-container — containers share localhost.
    # ------------------------------------------------------------
    containers {
      name  = "searxng"
      image = var.searxng_image

      # Sidecar: no `ports` block — only the ingress container (tomoribot) may
      # expose a port. SearXNG still listens on its default 8080 internally and
      # is reachable by the bot at http://localhost:8080/ via the shared
      # network namespace (see SEARXNG_BASE_URL below and the startup_probe).

      env {
        name = "SEARXNG_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.searxng_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "SEARXNG_BASE_URL"
        value = "http://localhost:8080/"
      }

      resources {
        limits = {
          cpu    = var.searxng_cpu
          memory = var.searxng_memory
        }
        cpu_idle = false
      }

      startup_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 6
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_sql_database_instance.main,
    google_secret_manager_secret.tomoribot,
    google_secret_manager_secret.searxng_secret,
  ]
}
