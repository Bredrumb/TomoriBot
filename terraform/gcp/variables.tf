/**
 * Variables for TomoriBot GCP infrastructure.
 * Defaults match a minimal production setup targeting the $300 free-credit budget.
 */

variable "gcp_project_id" {
  description = "GCP project ID"
  type        = string
}

variable "terraform_state_bucket" {
  description = "GCS bucket name holding Terraform state (must match the backend config in main.tf — backends cannot use variables)"
  type        = string
  default     = "tomoribot-terraform-state-gcp"
}

variable "gcp_region" {
  description = "GCP region for all regional resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name (production, staging, development)"
  type        = string
  default     = "production"
}

variable "name_prefix" {
  description = "Prefix used for naming GCP resources"
  type        = string
  default     = "tomoribot"
}

# --- GitHub / Workload Identity ---

variable "github_repo_owner" {
  description = "GitHub org/user that owns the repo"
  type        = string
  default     = "Bredrumb"
}

variable "github_repo_name" {
  description = "GitHub repository name"
  type        = string
  default     = "TomoriBot"
}

variable "github_allowed_refs" {
  description = "Git refs allowed to impersonate the deploy service account via WIF"
  type        = list(string)
  default     = ["refs/heads/release"]
}

# --- Artifact Registry ---

variable "artifact_registry_location" {
  description = "Location for Artifact Registry repository (should match gcp_region)"
  type        = string
  default     = "us-central1"
}

variable "artifact_registry_repository_id" {
  description = "Artifact Registry repository name"
  type        = string
  default     = "tomoribot"
}

# --- Cloud Storage ---

variable "avatars_bucket_name" {
  description = "GCS bucket name for persona avatars (null uses auto-naming)"
  type        = string
  default     = null
}

variable "avatar_bucket_location" {
  description = "GCS bucket location for avatars (multi-region or region)"
  type        = string
  default     = "US"
}

variable "voice_samples_bucket_name" {
  description = "GCS bucket name for voice samples (null uses auto-naming)"
  type        = string
  default     = null
}

variable "voice_samples_bucket_location" {
  description = "GCS bucket location for voice samples"
  type        = string
  default     = "US"
}

# --- Cloud SQL ---

variable "db_instance_name" {
  description = "Cloud SQL instance name"
  type        = string
  default     = "tomoribot-db"
}

variable "db_version" {
  description = "Cloud SQL Postgres version"
  type        = string
  default     = "POSTGRES_16"
}

variable "db_tier" {
  description = "Cloud SQL machine tier (db-f1-micro is the cheapest shared-core option)"
  type        = string
  default     = "db-f1-micro"
}

variable "db_disk_size_gb" {
  description = "Cloud SQL disk size in GiB"
  type        = number
  default     = 10
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "tomoribot"
}

variable "db_user" {
  description = "Database user"
  type        = string
  default     = "postgres"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "db_backup_enabled" {
  description = "Enable automated Cloud SQL backups"
  type        = bool
  default     = true
}

variable "db_deletion_protection" {
  description = "Enable deletion protection on the Cloud SQL instance"
  type        = bool
  default     = false
}


# --- Secret Manager ---

variable "secret_name" {
  description = "Secret Manager secret ID for combined TomoriBot runtime secrets"
  type        = string
  default     = "tomoribot-production"
}

# --- Cloud Run ---

variable "container_image" {
  description = "Full Artifact Registry image URI for TomoriBot (e.g. us-central1-docker.pkg.dev/PROJECT/tomoribot/tomoribot:v1.0.0)"
  type        = string
}

variable "container_name" {
  description = "Container name in the Cloud Run service"
  type        = string
  default     = "tomoribot"
}

variable "cloud_run_service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "tomoribot"
}

variable "cloud_run_cpu" {
  description = "vCPU allocation for the Cloud Run container (e.g. '1', '2')"
  type        = string
  default     = "1"
}

variable "cloud_run_memory" {
  description = "Memory allocation for the Cloud Run container (e.g. '512Mi', '1Gi')"
  type        = string
  default     = "1Gi"
}

variable "cloud_run_max_instances" {
  description = "Maximum Cloud Run instance count (1 for a singleton Discord bot)"
  type        = number
  default     = 1
}

variable "node_env" {
  description = "NODE_ENV for the container"
  type        = string
  default     = "production"
}

variable "run_env" {
  description = "RUN_ENV for the container"
  type        = string
  default     = "production"
}

