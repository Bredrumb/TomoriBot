/**
 * GCS buckets for TomoriBot public assets.
 * Both buckets use uniform bucket-level access with allUsers objectViewer for public reads.
 */

locals {
  avatars_bucket_name       = var.avatars_bucket_name != null ? var.avatars_bucket_name : "${var.name_prefix}-avatars-${var.gcp_project_id}"
  voice_samples_bucket_name = var.voice_samples_bucket_name != null ? var.voice_samples_bucket_name : "${var.name_prefix}-voice-samples-${var.gcp_project_id}"
}

# --- Avatars bucket ---

resource "google_storage_bucket" "avatars" {
  name                        = local.avatars_bucket_name
  location                    = var.avatar_bucket_location
  uniform_bucket_level_access = true
  force_destroy               = false

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "avatars_public_read" {
  bucket = google_storage_bucket.avatars.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Allow the app SA to write avatars
resource "google_storage_bucket_iam_member" "avatars_app_write" {
  bucket = google_storage_bucket.avatars.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.app.email}"
}

# --- Voice samples bucket ---

resource "google_storage_bucket" "voice_samples" {
  name                        = local.voice_samples_bucket_name
  location                    = var.voice_samples_bucket_location
  uniform_bucket_level_access = true
  force_destroy               = false

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "voice_samples_public_read" {
  bucket = google_storage_bucket.voice_samples.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_storage_bucket_iam_member" "voice_samples_app_write" {
  bucket = google_storage_bucket.voice_samples.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.app.email}"
}
