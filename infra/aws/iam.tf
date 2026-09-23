resource "aws_iam_role" "lambda" {
  name = "${local.name}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.name}-serverless-runtime"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CoreData"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:ConditionCheckItem",
          "dynamodb:DeleteItem", "dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem",
          "dynamodb:Query", "dynamodb:Scan", "dynamodb:TransactGetItems",
          "dynamodb:TransactWriteItems", "dynamodb:UpdateItem"
        ]
        Resource = [
          aws_dynamodb_table.core.arn,
          "${aws_dynamodb_table.core.arn}/index/*",
          aws_dynamodb_table.connections.arn,
          "${aws_dynamodb_table.connections.arn}/index/*"
        ]
      },
      {
        Sid    = "CoreDataStream"
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeStream", "dynamodb:GetRecords",
          "dynamodb:GetShardIterator", "dynamodb:ListStreams"
        ]
        Resource = "${aws_dynamodb_table.core.arn}/stream/*"
      },
      {
        Sid    = "Jobs"
        Effect = "Allow"
        Action = [
          "sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes",
          "sqs:ReceiveMessage", "sqs:SendMessage"
        ]
        Resource = aws_sqs_queue.jobs.arn
      },
      {
        Sid    = "Uploads"
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload", "s3:DeleteObject", "s3:GetObject",
          "s3:ListBucket", "s3:PutObject"
        ]
        Resource = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"]
      },
      {
        Sid      = "RuntimeSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.runtime.arn
      },
      {
        Sid      = "WebSocketConnections"
        Effect   = "Allow"
        Action   = ["execute-api:ManageConnections"]
        Resource = "${aws_apigatewayv2_api.realtime.execution_arn}/*"
      }
    ]
  })
}
