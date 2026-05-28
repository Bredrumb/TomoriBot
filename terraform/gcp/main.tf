/**
 * Terraform configuration and Google Cloud provider setup.
 * GCS backend stores state in a bucket you must create manually before first init:
 *   gcloud storage buckets create gs://tomoribot-terraform-state-gcp --location=us-central1
 */

terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Backend config cannot use variables — this bucket name must also match var.terraform_state_bucket.
  # To override for a different environment: terraform init -backend-config="bucket=<name>"
  backend "gcs" {
    bucket = "tomoribot-terraform-state-gcp"
    prefix = "production"
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}
