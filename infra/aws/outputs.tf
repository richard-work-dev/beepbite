output "api_url" {
  description = "Public HTTP API endpoint."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "websocket_url" {
  description = "Authenticated realtime WebSocket endpoint."
  value       = "${aws_apigatewayv2_api.realtime.api_endpoint}/${aws_apigatewayv2_stage.realtime.name}"
}

output "frontend_url" {
  description = "CloudFront URL for the web application."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "core_table" {
  description = "Single-table DynamoDB data store."
  value       = aws_dynamodb_table.core.name
}

output "connections_table" {
  description = "Active realtime connections table."
  value       = aws_dynamodb_table.connections.name
}

output "jobs_queue_url" {
  description = "Asynchronous application jobs queue."
  value       = aws_sqs_queue.jobs.id
}

output "api_repository_url" {
  description = "ECR repository retained during the application migration."
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

output "archives_bucket" {
  description = "Private bucket used for exports and transition archives."
  value       = aws_s3_bucket.backups.id
}

output "runtime_secret_id" {
  description = "Secrets Manager entry containing runtime secrets."
  value       = aws_secretsmanager_secret.runtime.name
}
