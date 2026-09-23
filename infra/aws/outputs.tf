output "instance_id" {
  description = "EC2 instance managed through AWS Systems Manager Session Manager."
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "Elastic IPv4 address to use for the application DNS record."
  value       = aws_eip.app.public_ip
}

output "api_repository_url" {
  description = "ECR repository URL for immutable API images."
  value       = aws_ecr_repository.api.repository_url
}

output "uploads_bucket" {
  description = "Private bucket used for direct image uploads."
  value       = aws_s3_bucket.uploads.id
}

output "uploads_public_base_url" {
  description = "CloudFront base URL for uploaded images."
  value       = "https://${aws_cloudfront_distribution.uploads.domain_name}"
}

output "backups_bucket" {
  description = "Private bucket used for PostgreSQL backups."
  value       = aws_s3_bucket.backups.id
}

output "runtime_secret_id" {
  description = "Secrets Manager entry to populate before deploying the application."
  value       = aws_secretsmanager_secret.runtime.name
}
