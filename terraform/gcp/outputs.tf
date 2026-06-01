/**
 * Key outputs needed for CI/CD secrets and application configuration.
 */

output "workload_identity_provider" {
  description = "WIF provider resource name — set as GCP_WORKLOAD_IDENTITY_PROVIDER in GitHub secrets"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deploy_service_account" {
  description = "GitHub Actions deploy SA email — set as GCP_SERVICE_ACCOUNT in GitHub secrets"
  value       = google_service_account.github_deploy.email
}

output "artifact_registry_url" {
  description = "Artifact Registry base URL — set as ARTIFACT_REGISTRY_REPO in GitHub secrets (append image name)"
  value       = "${var.artifact_registry_location}-docker.pkg.dev/${var.gcp_project_id}/${var.artifact_registry_repository_id}"
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name — used for the unix socket path /cloudsql/<this>"
  value       = google_sql_database_instance.main.connection_name
}

output "cloud_sql_public_ip" {
  description = "Cloud SQL public IP (informational; app uses the proxy socket, not this)"
  value       = google_sql_database_instance.main.public_ip_address
}

output "avatars_bucket_name" {
  description = "GCS bucket name for avatars — set as AVATAR_GCS_BUCKET in runtime secrets"
  value       = google_storage_bucket.avatars.name
}

output "avatars_public_base_url" {
  description = "Public base URL for avatar assets"
  value       = "https://storage.googleapis.com/${google_storage_bucket.avatars.name}"
}

output "voice_samples_bucket_name" {
  description = "GCS bucket name for voice samples — set as VOICE_SAMPLE_GCS_BUCKET in runtime secrets"
  value       = google_storage_bucket.voice_samples.name
}

output "voice_samples_public_base_url" {
  description = "Public base URL for voice sample assets"
  value       = "https://storage.googleapis.com/${google_storage_bucket.voice_samples.name}"
}

output "secret_name" {
  description = "Secret Manager secret ID — populate this secret with the runtime JSON blob before deploying"
  value       = google_secret_manager_secret.tomoribot.secret_id
}

output "grafana_db_password" {
  description = "Auto-generated password for the Grafana Cloud SQL user — use in your local Grafana PostgreSQL datasource"
  value       = random_password.grafana_db.result
  sensitive   = true
}
