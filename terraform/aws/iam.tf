/**
 * IAM roles and policies for ECS tasks and GitHub Actions deployments.
 */

locals {
  # Use wildcard to match the pre-existing inline policy during import.
  secret_access_arns = var.secret_access_wildcard ? ["*"] : concat(
    [aws_secretsmanager_secret.tomoribot_production.arn],
    var.extra_secrets_manager_arns,
  )
}

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "tomoribot_execution" {
  name               = var.ecs_task_execution_role_name
  description        = var.ecs_task_execution_role_description
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "tomoribot_execution" {
  role       = aws_iam_role.tomoribot_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "tomoribot_secret_access" {
  statement {
    sid       = "VisualEditor0"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.secret_access_arns
  }
}

resource "aws_iam_role_policy" "tomoribot_secret_access" {
  name   = "TomoriSecretAccess"
  role   = aws_iam_role.tomoribot_execution.id
  policy = data.aws_iam_policy_document.tomoribot_secret_access.json
}

data "aws_iam_policy_document" "tomoribot_avatar_bucket_access" {
  statement {
    sid    = "AvatarBucketObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.avatars.arn}/*"]
  }

  statement {
    sid       = "AvatarBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.avatars.arn]
  }
}

resource "aws_iam_role_policy" "tomoribot_avatar_bucket_access" {
  name   = "TomoriAvatarBucketAccess"
  role   = aws_iam_role.tomoribot_execution.id
  policy = data.aws_iam_policy_document.tomoribot_avatar_bucket_access.json
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # Keep thumbprints aligned with AWS to avoid drift.
  thumbprint_list = var.github_actions_oidc_thumbprints
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        for ref in var.github_actions_allowed_refs :
        "repo:${var.github_actions_repo_owner}/${var.github_actions_repo_name}:ref:${ref}"
      ]
    }
  }
}

resource "aws_iam_role" "github_actions_deploy" {
  name               = var.github_actions_role_name
  description        = "Role for GitHub Actions OIDC deployment"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role.json
}

resource "aws_iam_role_policy_attachment" "github_actions_managed" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser",
    "arn:aws:iam::aws:policy/AmazonECS_FullAccess",
  ])

  role       = aws_iam_role.github_actions_deploy.name
  policy_arn = each.value
}
