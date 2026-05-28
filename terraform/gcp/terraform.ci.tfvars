# Values injected by CI via environment variables:
#   TF_VAR_gcp_project_id  = ${{ secrets.GCP_PROJECT_ID }}
#   TF_VAR_container_image = <resolved Artifact Registry URI>
#   TF_VAR_db_password     = ${{ secrets.CLOUD_SQL_INSTANCE_PASSWORD }}
#
# Non-sensitive CI overrides:
environment = "production"
