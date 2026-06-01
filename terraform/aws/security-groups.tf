/**
 * Security groups for ECS tasks, RDS, and the bastion host.
 * Rules are defined separately to avoid cyclic dependencies.
 */

resource "aws_security_group" "tomoribot_app" {
  name        = var.app_security_group_name
  description = "Outbound HTTPS only for TomoriBot"
  vpc_id      = aws_vpc.tomoribot.id
}

resource "aws_security_group" "tomoribot_db" {
  name        = var.db_security_group_name
  description = "For TomoriBot RDS PostgreSQL"
  vpc_id      = aws_vpc.tomoribot.id
}

resource "aws_security_group" "bastion" {
  name        = var.bastion_security_group_name
  description = "Allows SSH Access to DB"
  vpc_id      = aws_vpc.tomoribot.id
}

resource "aws_security_group_rule" "tomoribot_app_egress_db" {
  type                     = "egress"
  description              = "Connection to DB"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.tomoribot_app.id
  source_security_group_id = aws_security_group.tomoribot_db.id
}

resource "aws_security_group_rule" "tomoribot_app_egress_https" {
  type              = "egress"
  description       = "Outbound HTTPS for provider APIs and Cloudflare tunnel fallback"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.tomoribot_app.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "tomoribot_app_egress_cloudflare_udp" {
  count             = var.enable_cloudflare_tunnel_sidecar ? 1 : 0
  type              = "egress"
  description       = "Cloudflare Tunnel QUIC transport"
  from_port         = 7844
  to_port           = 7844
  protocol          = "udp"
  security_group_id = aws_security_group.tomoribot_app.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "tomoribot_app_egress_cloudflare_tcp" {
  count             = var.enable_cloudflare_tunnel_sidecar ? 1 : 0
  type              = "egress"
  description       = "Cloudflare Tunnel TCP transport fallback"
  from_port         = 7844
  to_port           = 7844
  protocol          = "tcp"
  security_group_id = aws_security_group.tomoribot_app.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "tomoribot_db_ingress_app" {
  type                     = "ingress"
  description              = "Only let traffic in if it comes from TomoriBot"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.tomoribot_db.id
  source_security_group_id = aws_security_group.tomoribot_app.id
}

resource "aws_security_group_rule" "tomoribot_db_ingress_bastion" {
  type                     = "ingress"
  description              = "Bastion Connection"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.tomoribot_db.id
  source_security_group_id = aws_security_group.bastion.id
}

resource "aws_security_group_rule" "tomoribot_db_egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.tomoribot_db.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "bastion_ingress_ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  security_group_id = aws_security_group.bastion.id
  # Update when your public IP changes.
  cidr_blocks = [var.bastion_ssh_cidr]
}

resource "aws_security_group_rule" "bastion_egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.bastion.id
  cidr_blocks       = ["0.0.0.0/0"]
}
