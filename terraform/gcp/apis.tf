/**
 * Enable required GCP APIs.
 * cloudresourcemanager.googleapis.com must be enabled manually before first apply —
 * it is the prerequisite for Terraform to enable anything else.
 */

locals {
  required_apis = [
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",    # Workload Identity Federation token exchange
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "cloudkms.googleapis.com",
    "aiplatform.googleapis.com",        # Vertex AI
    "bigquery.googleapis.com",          # BigQuery (used by Grafana monitoring datasource)
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.required_apis)

  project            = var.gcp_project_id
  service            = each.value
  disable_on_destroy = false
}
