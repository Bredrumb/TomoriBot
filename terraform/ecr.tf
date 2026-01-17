/**
 * ECR repository for TomoriBot container images.
 */

resource "aws_ecr_repository" "tomoribot" {
	name                 = var.ecr_repository_name
	image_tag_mutability = var.ecr_tag_mutability

	image_scanning_configuration {
		scan_on_push = var.ecr_scan_on_push
	}

	encryption_configuration {
		encryption_type = "AES256"
	}
}
