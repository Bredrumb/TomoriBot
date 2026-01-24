/**
 * Useful outputs for verification and pipeline wiring.
 */

output "vpc_id" {
	description = "VPC ID"
	value       = aws_vpc.tomoribot.id
}

output "public_subnet_ids" {
	description = "Public subnet IDs"
	value       = [for subnet in aws_subnet.public : subnet.id]
}

output "private_subnet_ids" {
	description = "Private subnet IDs"
	value       = [for subnet in aws_subnet.private : subnet.id]
}

output "ecs_cluster_arn" {
	description = "ARN of the ECS cluster"
	value       = aws_ecs_cluster.tomoribot.arn
}

output "ecs_service_name" {
	description = "Name of the ECS service"
	value       = aws_ecs_service.tomoribot.name
}

output "task_definition_arn" {
	description = "ARN of the ECS task definition"
	value       = aws_ecs_task_definition.tomoribot.arn
}

output "ecr_repository_url" {
	description = "ECR repository URL"
	value       = aws_ecr_repository.tomoribot.repository_url
}

output "rds_endpoint" {
	description = "RDS endpoint"
	value       = aws_db_instance.tomoribot.endpoint
}

output "rds_address" {
	description = "RDS hostname"
	value       = aws_db_instance.tomoribot.address
}

output "rds_port" {
	description = "RDS port"
	value       = aws_db_instance.tomoribot.port
}

output "secrets_manager_secret_arn" {
	description = "Secrets Manager ARN for TomoriBot"
	value       = aws_secretsmanager_secret.tomoribot_production.arn
}

output "log_group_names" {
	description = "CloudWatch log groups"
	value = [
		aws_cloudwatch_log_group.tomoribot.name,
		aws_cloudwatch_log_group.tomoribot_task.name,
	]
}

output "github_actions_role_arn" {
	description = "IAM role ARN for GitHub Actions"
	value       = aws_iam_role.github_actions_deploy.arn
}

output "ecs_task_execution_role_arn" {
	description = "IAM role ARN for ECS task execution"
	value       = aws_iam_role.tomoribot_execution.arn
}

output "health_check_configuration" {
	description = "Summary of health check configuration"
	value = {
		interval     = "${var.health_check_interval}s"
		timeout      = "${var.health_check_timeout}s"
		retries      = var.health_check_retries
		start_period = "${var.health_check_start_period}s"
		endpoint     = "http://127.0.0.1:3000/health"
	}
}

output "avatars_bucket_name" {
	description = "S3 bucket name for persona avatars"
	value       = aws_s3_bucket.avatars.bucket
}

output "avatars_bucket_regional_domain" {
	description = "Regional S3 domain for the avatar bucket"
	value       = aws_s3_bucket.avatars.bucket_regional_domain_name
}

output "avatars_cloudfront_domain" {
	description = "CloudFront domain for avatar distribution (null if disabled)"
	value       = try(aws_cloudfront_distribution.avatars[0].domain_name, null)
}

output "avatars_public_base_url" {
	description = "Public base URL for avatar objects"
	value = var.enable_avatar_cloudfront ? "https://${aws_cloudfront_distribution.avatars[0].domain_name}" : "https://${aws_s3_bucket.avatars.bucket_regional_domain_name}"
}
