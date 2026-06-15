# Values injected by CI via environment variables:
#   TF_VAR_gcp_project_id  = ${{ secrets.GCP_PROJECT_ID }}
#   TF_VAR_container_image = <resolved Artifact Registry URI>
#   TF_VAR_db_password     = ${{ secrets.CLOUD_SQL_INSTANCE_PASSWORD }}
#
# Non-sensitive CI overrides:
environment = "production"

# Keep the Discord bot singleton always-on, but give Bun enough RSS headroom.
cloud_run_memory = "2Gi"

# Disable the always-on SearXNG sidecar in production to reduce Cloud Run cost.
enable_searxng_sidecar = false
