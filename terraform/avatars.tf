/**
 * Avatar storage: S3 bucket with optional CloudFront distribution.
 * This supports stable, long-lived avatar URLs for persona webhooks.
 */

data "aws_caller_identity" "current" {}

locals {
	avatars_bucket_name = coalesce(
		var.avatars_bucket_name,
		"${var.name_prefix}-avatars-${var.environment}-${data.aws_caller_identity.current.account_id}",
	)
	avatar_bucket_public_read = var.enable_avatar_cloudfront ? false : var.avatar_bucket_public_read
	avatar_cloudfront_origin_id = "tomoribot-avatars-s3"
	avatar_cloudfront_arn = var.enable_avatar_cloudfront ? aws_cloudfront_distribution.avatars[0].arn : null
}

resource "aws_s3_bucket" "avatars" {
	bucket        = local.avatars_bucket_name
	force_destroy = var.avatar_bucket_force_destroy
}

resource "aws_s3_bucket_ownership_controls" "avatars" {
	bucket = aws_s3_bucket.avatars.id

	rule {
		object_ownership = "BucketOwnerPreferred"
	}
}

resource "aws_s3_bucket_versioning" "avatars" {
	bucket = aws_s3_bucket.avatars.id

	versioning_configuration {
		status = var.avatar_bucket_versioning ? "Enabled" : "Suspended"
	}
}

resource "aws_s3_bucket_server_side_encryption_configuration" "avatars" {
	bucket = aws_s3_bucket.avatars.id

	rule {
		apply_server_side_encryption_by_default {
			sse_algorithm = "AES256"
		}
	}
}

resource "aws_s3_bucket_lifecycle_configuration" "avatars" {
	bucket = aws_s3_bucket.avatars.id

	rule {
		id     = "AbortIncompleteMultipartUploads"
		status = "Enabled"
		filter {
			prefix = ""
		}

		abort_incomplete_multipart_upload {
			days_after_initiation = 7
		}
	}
}

resource "aws_s3_bucket_public_access_block" "avatars" {
	bucket = aws_s3_bucket.avatars.id

	block_public_acls       = local.avatar_bucket_public_read ? false : true
	block_public_policy     = local.avatar_bucket_public_read ? false : true
	ignore_public_acls      = local.avatar_bucket_public_read ? false : true
	restrict_public_buckets = local.avatar_bucket_public_read ? false : true
}

resource "aws_cloudfront_origin_access_control" "avatars" {
	count = var.enable_avatar_cloudfront ? 1 : 0

	name                              = "${var.name_prefix}-avatars-oac"
	description                       = "OAC for TomoriBot avatar bucket"
	origin_access_control_origin_type = "s3"
	signing_behavior                  = "always"
	signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
	count = var.enable_avatar_cloudfront ? 1 : 0
	name  = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "avatars" {
	count   = var.enable_avatar_cloudfront ? 1 : 0
	enabled = true
	comment = "TomoriBot avatar CDN"

	origin {
		domain_name              = aws_s3_bucket.avatars.bucket_regional_domain_name
		origin_id                = local.avatar_cloudfront_origin_id
		origin_access_control_id = aws_cloudfront_origin_access_control.avatars[0].id
	}

	default_cache_behavior {
		target_origin_id       = local.avatar_cloudfront_origin_id
		viewer_protocol_policy = "redirect-to-https"
		allowed_methods        = ["GET", "HEAD", "OPTIONS"]
		cached_methods         = ["GET", "HEAD", "OPTIONS"]
		compress               = true
		cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized[0].id
	}

	restrictions {
		geo_restriction {
			restriction_type = "none"
		}
	}

	viewer_certificate {
		cloudfront_default_certificate = true
	}

	price_class = var.avatar_cloudfront_price_class
}

data "aws_iam_policy_document" "avatars_bucket_policy" {
	dynamic "statement" {
		for_each = local.avatar_bucket_public_read ? [1] : []
		content {
			sid    = "PublicReadGetObject"
			effect = "Allow"
			actions = ["s3:GetObject"]
			resources = ["${aws_s3_bucket.avatars.arn}/*"]

			principals {
				type        = "*"
				identifiers = ["*"]
			}
		}
	}

	dynamic "statement" {
		for_each = var.enable_avatar_cloudfront ? [1] : []
		content {
			sid    = "AllowCloudFrontReadOnly"
			effect = "Allow"
			actions = ["s3:GetObject"]
			resources = ["${aws_s3_bucket.avatars.arn}/*"]

			principals {
				type        = "Service"
				identifiers = ["cloudfront.amazonaws.com"]
			}

			condition {
				test     = "StringEquals"
				variable = "AWS:SourceArn"
				values   = [local.avatar_cloudfront_arn]
			}
		}
	}
}

resource "aws_s3_bucket_policy" "avatars" {
	bucket = aws_s3_bucket.avatars.id
	policy = data.aws_iam_policy_document.avatars_bucket_policy.json
}
