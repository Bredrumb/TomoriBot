# CI overrides for Terraform (safe to commit; no secrets here).

aws_region  = "us-east-1"
environment = "production"

ecr_scan_on_push = false
ecs_task_cpu     = "512"
ecs_task_memory  = "1024"

# Keep in sync with the current AWS OIDC thumbprint.
github_actions_oidc_thumbprints = ["2b18947a6a9fc7764fd8b5fb18a863b0c6dac24f"]

# Leave the legacy log group retention unchanged (null == AWS default).
extra_log_retention_days = null

# Match the existing IAM inline policy scope.
secret_access_wildcard = true

# Match production deletion behavior.
rds_skip_final_snapshot = true

# Keep the deletion recovery window consistent with current metadata.
secrets_manager_recovery_window_days = 30
