/**
 * Artifact Registry repository for TomoriBot Docker images.
 * Replaces AWS ECR. Images are tagged with commit SHA and semantic version.
 */

resource "google_artifact_registry_repository" "tomoribot" {
  location      = var.artifact_registry_location
  repository_id = var.artifact_registry_repository_id
  description   = "TomoriBot Docker images"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}
