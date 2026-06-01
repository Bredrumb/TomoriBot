/**
 * CloudWatch log groups for ECS tasks.
 */

resource "aws_cloudwatch_log_group" "tomoribot" {
  name              = var.log_group_name
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "tomoribot_task" {
  name = var.extra_log_group_name
  # Null keeps AWS default/never expire for legacy groups.
  retention_in_days = var.extra_log_retention_days
}
