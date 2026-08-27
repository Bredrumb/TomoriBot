/**
 * Service accounts and Workload Identity Federation for TomoriBot GCP.
 *
 * Two service accounts:
 *   - github-deploy: assumed by GitHub Actions via WIF to push images and deploy Cloud Run
 *   - tomoribot-app: the identity Cloud Run tasks run as at runtime
 */

# --- Workload Identity Federation ---

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only tokens from the TomoriBot repo on an allowed ref are accepted
  attribute_condition = "attribute.repository == '${var.github_repo_owner}/${var.github_repo_name}' && attribute.ref in ['${join("', '", var.github_allowed_refs)}']"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# --- GitHub Actions deploy service account ---

resource "google_service_account" "github_deploy" {
  account_id   = "github-deploy"
  display_name = "GitHub Actions Deploy"
}

# Allow the WIF pool/provider to impersonate the deploy SA
resource "google_service_account_iam_binding" "github_wif" {
  service_account_id = google_service_account.github_deploy.name
  role               = "roles/iam.workloadIdentityUser"

  members = [
    "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo_owner}/${var.github_repo_name}"
  ]
}

# Permissions needed by GitHub Actions during deployment
resource "google_project_iam_member" "github_deploy_run_admin" {
  project = var.gcp_project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

resource "google_project_iam_member" "github_deploy_ar_writer" {
  project = var.gcp_project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

# Broad read/write access needed for Terraform to manage GCP resources
resource "google_project_iam_member" "github_deploy_editor" {
  project = var.gcp_project_id
  role    = "roles/editor"
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

# Required for Terraform to manage project-level IAM bindings
resource "google_project_iam_member" "github_deploy_iam_admin" {
  project = var.gcp_project_id
  role    = "roles/resourcemanager.projectIamAdmin"
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

# Required for Terraform to read/write the GCS state backend bucket
resource "google_storage_bucket_iam_member" "github_deploy_state_bucket" {
  bucket = var.terraform_state_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.github_deploy.email}"
}

# Required so GitHub Actions can deploy Cloud Run services that run as tomoribot-app
resource "google_service_account_iam_member" "github_deploy_act_as_app" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deploy.email}"
}

# --- Application runtime service account ---

resource "google_service_account" "app" {
  account_id   = "tomoribot-app"
  display_name = "TomoriBot Application"
}

resource "google_project_iam_member" "app_secret_accessor" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_cloudsql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# Grants ADC-based Vertex AI access — Cloud Run picks this up automatically via
# the metadata server, so no JSON key or GOOGLE_APPLICATION_CREDENTIALS is needed.
resource "google_project_iam_member" "app_vertex_ai_user" {
  project = var.gcp_project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}
