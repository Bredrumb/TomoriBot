/**
 * ECS cluster, task definition, and service for TomoriBot.
 */

locals {
  postgres_host = coalesce(var.postgres_host_override, aws_db_instance.tomoribot.address)
  # Use family:revision to avoid drift when the service expects a specific revision.
  ecs_task_definition_ref            = "${var.ecs_task_family}:${aws_ecs_task_definition.tomoribot.revision}"
  cloudflare_tunnel_token_secret_arn = "${aws_secretsmanager_secret.tomoribot_production.arn}:${var.cloudflare_tunnel_token_secret_key}::"

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

  app_container_definition = merge(
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
    var.enable_cloudflare_tunnel_sidecar ? {
      dependsOn = [
        {
          containerName = var.cloudflare_tunnel_container_name
          condition     = "START"
        },
      ]
    } : {},
  )

  cloudflare_tunnel_container_definitions = var.enable_cloudflare_tunnel_sidecar ? [
    {
      name      = var.cloudflare_tunnel_container_name
      image     = var.cloudflare_tunnel_image
      essential = true
      command   = ["tunnel", "--no-autoupdate", "run"]
      secrets = [
        {
          name      = "TUNNEL_TOKEN"
          valueFrom = local.cloudflare_tunnel_token_secret_arn
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "cloudflared"
          "awslogs-create-group"  = "true"
        }
      }
    },
  ] : []

  container_definitions = concat(
    [local.app_container_definition],
    local.cloudflare_tunnel_container_definitions,
  )
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

  container_definitions = jsonencode(local.container_definitions)

  tags = {
    Name = "tomoribot-task-definition"
  }
}

resource "aws_ecs_service" "tomoribot" {
  name                          = var.ecs_service_name
  cluster                       = aws_ecs_cluster.tomoribot.id
  task_definition               = local.ecs_task_definition_ref
  desired_count                 = var.ecs_desired_count
  platform_version              = var.ecs_platform_version
  scheduling_strategy           = "REPLICA"
  availability_zone_rebalancing = "ENABLED"

  # Primary: Prefer FARGATE_SPOT (cheapest option)
  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    base              = 0
    weight            = 4 # 80% preference for Spot
  }

  # Fallback: Use FARGATE when SPOT unavailable
  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    base              = 1 # Ensures at least 1 task can always run
    weight            = 1 # 20% weight (backup only)
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
