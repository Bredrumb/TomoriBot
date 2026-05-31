/**
 * Secret Manager secret for TomoriBot runtime configuration.
 *
 * This secret holds a JSON blob with the same keys as the AWS Secrets Manager
 * secret (tomoribot/production), minus AWS/Matrix/Cloudflare-specific keys.
 * It is mounted as a volume in Cloud Run at /run/secrets/tomoribot-production.
 *
 * Update secretsManager.ts to read from the mounted file instead of AWS SDK.
 * New GCS-specific keys replace the S3 equivalents:
 *   AVATAR_GCS_BUCKET, AVATAR_PUBLIC_BASE_URL
 *   VOICE_SAMPLE_GCS_BUCKET, VOICE_SAMPLE_PUBLIC_BASE_URL, VOICE_SAMPLE_GCS_PREFIX
 */

resource "google_secret_manager_secret" "tomoribot" {
  secret_id = var.secret_name

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

data "google_project" "project" {}

# Runtime access for the app service account
resource "google_secret_manager_secret_iam_member" "app_access" {
  secret_id = google_secret_manager_secret.tomoribot.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# Cloud Run service agent needs access to validate secrets during deployment
resource "google_secret_manager_secret_iam_member" "cloudrun_agent_access" {
  secret_id = google_secret_manager_secret.tomoribot.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-${data.google_project.project.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

# -------------------------------------------------------------------
# SearXNG sidecar secret (Phase 2).
# Holds the SEARXNG_SECRET value required by the searxng container's
# `settings.yml`. Not consumed by TomoriBot directly.
# -------------------------------------------------------------------

resource "google_secret_manager_secret" "searxng_secret" {
  secret_id = "${var.name_prefix}-searxng-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "searxng_app_access" {
  secret_id = google_secret_manager_secret.searxng_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "searxng_cloudrun_agent_access" {
  secret_id = google_secret_manager_secret.searxng_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-${data.google_project.project.number}@serverless-robot-prod.iam.gserviceaccount.com"
}
