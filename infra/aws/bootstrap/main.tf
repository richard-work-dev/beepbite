data "aws_caller_identity" "current" {}

locals {
  repository_subject = "repo:${var.github_owner}@${var.github_owner_id}/${var.github_repository}@${var.github_repository_id}:environment:development"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # The provider is account-wide and may be shared with other repositories.
  # Keep its existing ownership tags when importing it into this state.
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

resource "aws_iam_role" "github_development" {
  name                 = "beepbite-github-development"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = local.repository_subject
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_iam" {
  name = "beepbite-development-terraform-iam"
  role = aws_iam_role.github_development.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ManageDevelopmentRuntimeRole"
        Effect = "Allow"
        Action = [
          "iam:AttachRolePolicy",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:DeleteRolePolicy",
          "iam:DetachRolePolicy",
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListRolePolicies",
          "iam:ListRoleTags",
          "iam:PutRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy"
        ]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/beepbite-dev-*"
      },
      {
        Sid      = "PassDevelopmentRuntimeRoleToLambda"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/beepbite-dev-*"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "lambda.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "github_application" {
  name = "beepbite-development-terraform-application"
  role = aws_iam_role.github_development.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TerraformStateBucket"
        Effect = "Allow"
        Action = [
          "s3:GetBucketVersioning",
          "s3:GetBucketLocation",
          "s3:ListBucket"
        ]
        Resource = "arn:aws:s3:::beepbite-terraform-state-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
      },
      {
        Sid    = "TerraformStateObjects"
        Effect = "Allow"
        Action = [
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "arn:aws:s3:::beepbite-terraform-state-${data.aws_caller_identity.current.account_id}-${var.aws_region}/beepbite/dev/terraform.tfstate*"
      },
      {
        Sid    = "ApplicationBuckets"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:aws:s3:::beepbite-dev-*",
          "arn:aws:s3:::beepbite-dev-*/*"
        ]
      },
      {
        Sid      = "ApplicationFunctions"
        Effect   = "Allow"
        Action   = "lambda:*"
        Resource = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:beepbite-dev-*"
      },
      {
        Sid    = "LambdaEventSources"
        Effect = "Allow"
        Action = [
          "lambda:CreateEventSourceMapping",
          "lambda:DeleteEventSourceMapping",
          "lambda:GetEventSourceMapping",
          "lambda:ListEventSourceMappings",
          "lambda:UpdateEventSourceMapping"
        ]
        Resource = "*"
      },
      {
        Sid      = "ApplicationTables"
        Effect   = "Allow"
        Action   = "dynamodb:*"
        Resource = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/beepbite-dev-*"
      },
      {
        Sid      = "ApplicationQueues"
        Effect   = "Allow"
        Action   = "sqs:*"
        Resource = "arn:aws:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:beepbite-dev-*"
      },
      {
        Sid      = "ApplicationLogs"
        Effect   = "Allow"
        Action   = "logs:*"
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/beepbite-dev-*"
      },
      {
        Sid      = "DiscoverApplicationLogGroups"
        Effect   = "Allow"
        Action   = "logs:DescribeLogGroups"
        Resource = "*"
      },
      {
        Sid      = "ApplicationRepositories"
        Effect   = "Allow"
        Action   = "ecr:*"
        Resource = "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/beepbite-dev-*"
      },
      {
        Sid      = "ECRAuthorization"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid      = "ApplicationSecrets"
        Effect   = "Allow"
        Action   = "secretsmanager:*"
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:beepbite-dev/*"
      },
      {
        Sid      = "APIGatewayDevelopment"
        Effect   = "Allow"
        Action   = "apigateway:*"
        Resource = "arn:aws:apigateway:${var.aws_region}::/*"
      },
      {
        Sid      = "CloudFrontDevelopment"
        Effect   = "Allow"
        Action   = "cloudfront:*"
        Resource = "*"
      },
      {
        Sid    = "Route53Development"
        Effect = "Allow"
        Action = [
          "route53:ChangeResourceRecordSets",
          "route53:GetHostedZone",
          "route53:ListResourceRecordSets",
          "route53:ListTagsForResource"
        ]
        Resource = "arn:aws:route53:::hostedzone/${var.development_hosted_zone_id}"
      },
      {
        Sid      = "Route53ChangeStatus"
        Effect   = "Allow"
        Action   = "route53:GetChange"
        Resource = "arn:aws:route53:::change/*"
      },
      {
        Sid    = "CertificateManagerDevelopment"
        Effect = "Allow"
        Action = [
          "acm:AddTagsToCertificate",
          "acm:DescribeCertificate",
          "acm:ListTagsForCertificate",
          "acm:RemoveTagsFromCertificate"
        ]
        Resource = var.development_certificate_arn
      },
      {
        Sid    = "ReadAccountMetadata"
        Effect = "Allow"
        Action = [
          "sts:GetCallerIdentity",
          "tag:GetResources"
        ]
        Resource = "*"
      },
      {
        Sid    = "ReadLambdaLoggingPolicy"
        Effect = "Allow"
        Action = [
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListPolicyVersions"
        ]
        Resource = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
      }
    ]
  })
}

output "development_role_arn" {
  value = aws_iam_role.github_development.arn
}

output "github_oidc_subject" {
  value = local.repository_subject
}
