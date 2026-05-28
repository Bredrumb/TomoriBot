/**
 * Monitoring service account and IAM roles for Grafana.
 *
 * This SA is used by Grafana (self-hosted, local PC) to query:
 *   - BigQuery (logs exported via Log Router)
 *   - Cloud Logging / Cloud Monitoring
 *   - Cloud SQL via Auth Proxy
 *
 * To connect from your PC:
 *   1. Authenticate: gcloud auth application-default login
 *   2. Start proxy: cloud-sql-proxy <project>:us-central1:tomoribot-db --port=5432
 *   3. Get the generated DB password: terraform output -raw grafana_db_password
 *   4. Point Grafana PostgreSQL datasource at localhost:5432, user=grafana
 */

# SA already exists in GCP — imported into Terraform state on first apply, skipped thereafter.
import {
  id = "projects/${var.gcp_project_id}/serviceAccounts/grafana-monitor@${var.gcp_project_id}.iam.gserviceaccount.com"
  to = google_service_account.grafana_monitor
}

resource "google_service_account" "grafana_monitor" {
  account_id   = "grafana-monitor"
  display_name = "Grafana Monitoring"

  lifecycle {
    # SA is already in production — prevent accidental destruction via terraform destroy
    prevent_destroy = true
  }
}

# --- BigQuery (existing bindings brought under Terraform management) ---

resource "google_project_iam_member" "grafana_bq_data_viewer" {
  project = var.gcp_project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.grafana_monitor.email}"
}

resource "google_project_iam_member" "grafana_bq_job_user" {
  project = var.gcp_project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.grafana_monitor.email}"
}

# --- Cloud Logging / Monitoring (existing bindings) ---

resource "google_project_iam_member" "grafana_log_view_accessor" {
  project = var.gcp_project_id
  role    = "roles/logging.viewAccessor"
  member  = "serviceAccount:${google_service_account.grafana_monitor.email}"
}

resource "google_project_iam_member" "grafana_log_viewer" {
  project = var.gcp_project_id
  role    = "roles/logging.viewer"
  member  = "serviceAccount:${google_service_account.grafana_monitor.email}"
}

resource "google_project_iam_member" "grafana_monitoring_viewer" {
  project = var.gcp_project_id
  role    = "roles/monitoring.viewer"
  member  = "serviceAccount:${google_service_account.grafana_monitor.email}"
}

# --- Cloud SQL (new — enables Auth Proxy tunnel for local Grafana) ---

resource "google_project_iam_member" "grafana_cloudsql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.grafana_monitor.email}"
}
