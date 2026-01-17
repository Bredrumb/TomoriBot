/**
 * Secrets Manager secret metadata for TomoriBot.
 * The secret value is managed outside Terraform.
 */

resource "aws_secretsmanager_secret" "tomoribot_production" {
	name                          = var.secrets_manager_secret_name
	description                   = var.secrets_manager_description
	recovery_window_in_days       = var.secrets_manager_recovery_window_days
	# Preserve current setting; avoids forcing replica overwrite.
	force_overwrite_replica_secret = false
}
