/**
 * Networking primitives: VPC, subnets, route tables, IGW, and S3 endpoint.
 */

locals {
  # Static keys keep for_each stable for import/state addressing.
  public_subnet_map  = { for idx, subnet in var.public_subnets : idx => subnet }
  private_subnet_map = { for idx, subnet in var.private_subnets : idx => subnet }
}

resource "aws_vpc" "tomoribot" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = var.vpc_name
  }
}

resource "aws_internet_gateway" "tomoribot" {
  vpc_id = aws_vpc.tomoribot.id

  tags = {
    Name = var.internet_gateway_name
  }
}

resource "aws_subnet" "public" {
  for_each = local.public_subnet_map

  vpc_id                  = aws_vpc.tomoribot.id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = false

  tags = {
    Name = each.value.name
  }
}

resource "aws_subnet" "private" {
  for_each = local.private_subnet_map

  vpc_id                  = aws_vpc.tomoribot.id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = false

  tags = {
    Name = each.value.name
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.tomoribot.id

  tags = {
    Name = var.public_route_table_name
  }
}

resource "aws_route" "public_internet_access" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.tomoribot.id
}

resource "aws_route_table_association" "public" {
  for_each = local.public_subnet_map

  subnet_id      = aws_subnet.public[each.key].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  for_each = local.private_subnet_map

  vpc_id = aws_vpc.tomoribot.id

  tags = {
    Name = format("%s%d-%s", var.private_route_table_name_prefix, tonumber(each.key) + 1, each.value.az)
  }
}

resource "aws_route_table_association" "private" {
  for_each = local.private_subnet_map

  subnet_id      = aws_subnet.private[each.key].id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.tomoribot.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for route_table in aws_route_table.private : route_table.id]

  # Matches the existing permissive policy; tighten after migration if desired.
  policy = jsonencode({
    Version = "2008-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = "*"
        Action    = "*"
        Resource  = "*"
      },
    ]
  })

  tags = {
    Name = var.s3_vpc_endpoint_name
  }
}
