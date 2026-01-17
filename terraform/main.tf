/**
 * Terraform configuration and AWS provider setup.
 * S3 backend uses lockfiles for state locking.
 */

terraform {
	required_version = ">= 1.0"

	required_providers {
		aws = {
			source  = "hashicorp/aws"
			version = "~> 5.0"
		}
	}

	backend "s3" {
		bucket       = "tomoribot-terraform-state"
		key          = "production/terraform.tfstate"
		region       = "us-east-1"
		# Locking via S3 lockfiles keeps setup minimal (no DynamoDB table).
		use_lockfile = true
		encrypt      = true
	}
}

provider "aws" {
	region  = var.aws_region
	profile = var.aws_profile

	default_tags {
		tags = {
			Project     = "TomoriBot"
			ManagedBy   = "Terraform"
			Environment = var.environment
		}
	}
}
