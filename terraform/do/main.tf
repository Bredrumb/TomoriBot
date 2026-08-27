/**
 * DigitalOcean stack for Matrix homeserver infrastructure.
 * Keep this state isolated from the AWS Terraform state.
 */

terraform {
  required_version = ">= 1.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }

    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # Remote state in the same S3 bucket used by the AWS stack.
  # Key is intentionally different to keep stacks fully isolated.
  backend "s3" {
    bucket       = "tomoribot-terraform-state"
    key          = "matrix-do/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "digitalocean" {
  token = var.digitalocean_token
}
