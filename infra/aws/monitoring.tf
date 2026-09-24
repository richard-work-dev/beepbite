resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = local.lambda_artifacts

  alarm_name          = "${local.name}-${each.key}-errors"
  alarm_description   = "${each.key} Lambda reported one or more errors in five minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.function[each.key].function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each = local.lambda_artifacts

  alarm_name          = "${local.name}-${each.key}-throttles"
  alarm_description   = "${each.key} Lambda was throttled."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = aws_lambda_function.function[each.key].function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "jobs_dead_lettered" {
  alarm_name          = "${local.name}-jobs-dead-lettered"
  alarm_description   = "The development jobs dead-letter queue contains a failed message."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.jobs_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "http_api_5xx" {
  alarm_name          = "${local.name}-http-api-5xx"
  alarm_description   = "The development HTTP API returned a server error."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.http.id, Stage = aws_apigatewayv2_stage.http.name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_dashboard" "serverless" {
  dashboard_name = local.name
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6,
        properties = {
          title = "Lambda errors and throttles", region = var.aws_region, view = "timeSeries",
          metrics = concat([for key, function in aws_lambda_function.function : [
            ["AWS/Lambda", "Errors", "FunctionName", function.function_name, { label = "${key} errors" }],
            [".", "Throttles", ".", ".", { label = "${key} throttles" }]
          ]]...)
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6,
        properties = {
          title = "API and failed jobs", region = var.aws_region, view = "timeSeries",
          metrics = [
            ["AWS/ApiGateway", "5xx", "ApiId", aws_apigatewayv2_api.http.id, "Stage", aws_apigatewayv2_stage.http.name],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.jobs_dlq.name]
          ]
        }
      }
    ]
  })
}
