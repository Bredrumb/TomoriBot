/**
 * RDS resources: subnet group, parameter group, and the PostgreSQL instance.
 */

resource "aws_db_subnet_group" "tomoribot" {
	name        = var.rds_subnet_group_name
	description = var.rds_subnet_group_description
	subnet_ids  = [for subnet in aws_subnet.private : subnet.id]
}

resource "aws_db_parameter_group" "tomoribot" {
	name        = var.rds_parameter_group_name
	family      = var.rds_parameter_group_family
	description = "Force SSL for TomoriBot"

	parameter {
		name         = "cron.database_name"
		value        = var.rds_parameter_cron_database_name
		apply_method = "pending-reboot"
	}

	parameter {
		name         = "rds.allowed_extensions"
		value        = var.rds_parameter_allowed_extensions
		apply_method = "immediate"
	}

	parameter {
		name         = "shared_preload_libraries"
		value        = var.rds_parameter_shared_preload_libraries
		apply_method = "pending-reboot"
	}
}

resource "aws_db_instance" "tomoribot" {
	identifier = var.rds_instance_identifier
	engine     = "postgres"
	engine_version = var.rds_engine_version
	instance_class = var.rds_instance_class

	allocated_storage = var.rds_allocated_storage
	storage_type      = var.rds_storage_type
	storage_encrypted = var.rds_storage_encrypted
	kms_key_id        = var.rds_kms_key_id

	db_name  = var.rds_db_name
	username = var.rds_master_username
	password = var.rds_master_password
	port     = var.rds_port

	db_subnet_group_name   = aws_db_subnet_group.tomoribot.name
	vpc_security_group_ids = [aws_security_group.tomoribot_db.id]
	parameter_group_name   = aws_db_parameter_group.tomoribot.name

	backup_retention_period = var.rds_backup_retention_period
	backup_window           = var.rds_preferred_backup_window
	maintenance_window      = var.rds_preferred_maintenance_window

	multi_az            = var.rds_multi_az
	publicly_accessible = var.rds_publicly_accessible

	auto_minor_version_upgrade = var.rds_auto_minor_version_upgrade
	copy_tags_to_snapshot      = var.rds_copy_tags_to_snapshot
	monitoring_interval        = 0

	performance_insights_enabled = var.rds_performance_insights_enabled
	# Only set these when Performance Insights is enabled to avoid unnecessary drift.
	performance_insights_retention_period = var.rds_performance_insights_enabled ? var.rds_performance_insights_retention_period : null
	performance_insights_kms_key_id        = var.rds_performance_insights_enabled ? var.rds_performance_insights_kms_key_id : null

	deletion_protection = var.rds_deletion_protection
	# Keep current deletion behavior; adjust deliberately in production.
	skip_final_snapshot = var.rds_skip_final_snapshot
	apply_immediately   = var.rds_apply_immediately

	lifecycle {
		prevent_destroy = true
		# Avoid drift from password rotations managed outside Terraform.
		ignore_changes = [password]
	}
}
