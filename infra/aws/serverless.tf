resource "aws_dynamodb_table" "core" {
  name         = "${local.name}-core"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  attribute {
    name = "GSI2PK"
    type = "S"
  }

  attribute {
    name = "GSI2SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    projection_type = "ALL"

    key_schema {
      attribute_name = "GSI1PK"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "GSI1SK"
      key_type       = "RANGE"
    }
  }

  global_secondary_index {
    name            = "GSI2"
    projection_type = "ALL"

    key_schema {
      attribute_name = "GSI2PK"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "GSI2SK"
      key_type       = "RANGE"
    }
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

resource "aws_dynamodb_table" "connections" {
  name         = "${local.name}-connections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connection_id"

  attribute {
    name = "connection_id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "connected_at"
    type = "S"
  }

  global_secondary_index {
    name            = "ByUser"
    projection_type = "ALL"

    key_schema {
      attribute_name = "user_id"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "connected_at"
      key_type       = "RANGE"
    }
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${local.name}-jobs-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${local.name}-jobs"
  visibility_timeout_seconds = 180
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "jobs_dlq" {
  queue_url = aws_sqs_queue.jobs_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.jobs.arn]
  })
}

locals {
  lambda_artifacts = {
    api      = "${path.module}/artifacts/api.zip"
    realtime = "${path.module}/artifacts/realtime.zip"
    stream   = "${path.module}/artifacts/stream.zip"
    worker   = "${path.module}/artifacts/worker.zip"
  }

  lambda_environment = {
    CORE_TABLE        = aws_dynamodb_table.core.name
    CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
    JOBS_QUEUE_URL    = aws_sqs_queue.jobs.id
    RUNTIME_SECRET_ID = aws_secretsmanager_secret.runtime.name
    UPLOADS_BUCKET    = aws_s3_bucket.uploads.id
    UPLOADS_BASE_URL  = "https://${aws_cloudfront_distribution.uploads.domain_name}"
  }

  application_origins = distinct(concat(
    ["https://${aws_cloudfront_distribution.frontend.domain_name}"],
    var.enable_custom_domains ? ["https://${local.frontend_domain}"] : [],
    var.upload_cors_origins
  ))
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.lambda_artifacts

  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "function" {
  for_each = local.lambda_artifacts

  function_name    = "${local.name}-${each.key}"
  role             = aws_iam_role.lambda.arn
  architectures    = ["arm64"]
  runtime          = "provided.al2023"
  handler          = "bootstrap"
  filename         = each.value
  source_code_hash = filebase64sha256(each.value)
  memory_size      = each.key == "api" ? 512 : 256
  timeout          = each.key == "worker" ? 120 : 30

  environment {
    variables = local.lambda_environment
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda,
    aws_iam_role_policy_attachment.lambda_logs
  ]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name}-http"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = [
      "authorization",
      "content-type",
      "idempotency-key",
      "x-actor-token",
      "x-location-id",
      "x-organization-id"
    ]
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_origins = local.application_origins
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "http" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.function["api"].invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "http" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.http.id}"
}

resource "aws_apigatewayv2_stage" "http" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "http" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function["api"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_apigatewayv2_api" "realtime" {
  name                       = "${local.name}-realtime"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_integration" "realtime" {
  api_id             = aws_apigatewayv2_api.realtime.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.function["realtime"].invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "realtime" {
  for_each = toset(["$connect", "$disconnect", "$default"])

  api_id    = aws_apigatewayv2_api.realtime.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.realtime.id}"
}

resource "aws_apigatewayv2_stage" "realtime" {
  api_id      = aws_apigatewayv2_api.realtime.id
  name        = var.environment
  auto_deploy = true
}

resource "aws_lambda_permission" "realtime" {
  statement_id  = "AllowWebSocketApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function["realtime"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.realtime.execution_arn}/*"
}

resource "aws_lambda_event_source_mapping" "core_stream" {
  event_source_arn               = aws_dynamodb_table.core.stream_arn
  function_name                  = aws_lambda_function.function["stream"].arn
  starting_position              = "LATEST"
  batch_size                     = 100
  bisect_batch_on_function_error = true
  function_response_types        = ["ReportBatchItemFailures"]

  depends_on = [aws_iam_role_policy.lambda]
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn                   = aws_sqs_queue.jobs.arn
  function_name                      = aws_lambda_function.function["worker"].arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 5
  }

  depends_on = [aws_iam_role_policy.lambda]
}
