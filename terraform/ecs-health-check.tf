/**
 * ECS cluster, task definition, and service for TomoriBot.
 */

locals {
	postgres_host = coalesce(var.postgres_host_override, aws_db_instance.tomoribot.address)
	# Use family:revision to avoid drift when the service expects a specific revision.
	ecs_task_definition_ref = "${var.ecs_task_family}:${aws_ecs_task_definition.tomoribot.revision}"

	container_environment = [
		{
			name  = "POSTGRES_USER"
			value = var.postgres_user
		},
		{
			name  = "POSTGRES_PORT"
			value = var.postgres_port
		},
		{
			name  = "NODE_ENV"
			value = var.node_env
		},
		{
			name  = "RUN_ENV"
			value = var.run_env
		},
		{
			name  = "POSTGRES_DB"
			value = var.postgres_db
		},
		{
			name  = "POSTGRES_HOST"
			value = local.postgres_host
		},
	]
}

resource "aws_ecs_cluster" "tomoribot" {
	name = var.ecs_cluster_name

	configuration {
		execute_command_configuration {
			logging = "DEFAULT"
		}
	}
}

resource "aws_ecs_cluster_capacity_providers" "tomoribot" {
	cluster_name       = aws_ecs_cluster.tomoribot.name
	capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}

resource "aws_ecs_task_definition" "tomoribot" {
	family                   = var.ecs_task_family
	network_mode             = "awsvpc"
	requires_compatibilities = ["FARGATE"]
	cpu                      = var.ecs_task_cpu
	memory                   = var.ecs_task_memory
	execution_role_arn       = aws_iam_role.tomoribot_execution.arn
	task_role_arn            = aws_iam_role.tomoribot_execution.arn

	container_definitions = jsonencode([
		{
			name      = var.container_name
			image     = var.container_image
			essential = true

			environment = local.container_environment
			secrets     = []

			logConfiguration = {
				logDriver = "awslogs"
				options = {
					"awslogs-group"         = var.log_group_name
					"awslogs-region"        = var.aws_region
					"awslogs-stream-prefix" = "ecs"
					"awslogs-create-group"  = "true"
				}
			}

			healthCheck = {
				command = [
					"CMD-SHELL",
					"curl -f http://127.0.0.1:3000/health || exit 1",
				]
				interval    = var.health_check_interval
				timeout     = var.health_check_timeout
				retries     = var.health_check_retries
				startPeriod = var.health_check_start_period
			}
		},
	])

	tags = {
		Name = "tomoribot-task-definition"
	}
}

resource "aws_ecs_service" "tomoribot" {
	name              = var.ecs_service_name
	cluster           = aws_ecs_cluster.tomoribot.id
	task_definition   = local.ecs_task_definition_ref
	desired_count     = var.ecs_desired_count
	platform_version  = var.ecs_platform_version
	scheduling_strategy = "REPLICA"
	availability_zone_rebalancing = "ENABLED"

	capacity_provider_strategy {
		capacity_provider = var.ecs_capacity_provider
		base              = var.ecs_capacity_provider_base
		weight            = var.ecs_capacity_provider_weight
	}

	deployment_circuit_breaker {
		enable   = true
		rollback = true
	}

	deployment_maximum_percent         = 200
	deployment_minimum_healthy_percent = 100

	enable_ecs_managed_tags = true
	propagate_tags          = "NONE"

	network_configuration {
		subnets          = [for subnet in aws_subnet.public : subnet.id]
		security_groups  = [aws_security_group.tomoribot_app.id]
		assign_public_ip = true
	}

	depends_on = [aws_ecs_cluster_capacity_providers.tomoribot]
}
