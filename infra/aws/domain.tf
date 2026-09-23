locals {
  frontend_domain  = "dev.${var.domain_name}"
  api_domain       = "api-dev.${var.domain_name}"
  websocket_domain = "ws-dev.${var.domain_name}"
}

resource "aws_route53_zone" "application" {
  name = var.domain_name
}

resource "aws_acm_certificate" "application" {
  domain_name       = "*.${var.domain_name}"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.application.domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  }

  allow_overwrite = true
  zone_id         = aws_route53_zone.application.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
}

resource "aws_acm_certificate_validation" "application" {
  count = var.enable_custom_domains ? 1 : 0

  certificate_arn         = aws_acm_certificate.application.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

resource "aws_apigatewayv2_domain_name" "http" {
  count       = var.enable_custom_domains ? 1 : 0
  domain_name = local.api_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.application[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "http" {
  count = var.enable_custom_domains ? 1 : 0

  api_id      = aws_apigatewayv2_api.http.id
  domain_name = aws_apigatewayv2_domain_name.http[0].id
  stage       = aws_apigatewayv2_stage.http.id
}

resource "aws_route53_record" "http" {
  count = var.enable_custom_domains ? 1 : 0

  zone_id = aws_route53_zone.application.zone_id
  name    = local.api_domain
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.http[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.http[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_apigatewayv2_domain_name" "realtime" {
  count       = var.enable_custom_domains ? 1 : 0
  domain_name = local.websocket_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.application[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "realtime" {
  count = var.enable_custom_domains ? 1 : 0

  api_id      = aws_apigatewayv2_api.realtime.id
  domain_name = aws_apigatewayv2_domain_name.realtime[0].id
  stage       = aws_apigatewayv2_stage.realtime.id
}

resource "aws_route53_record" "realtime" {
  count = var.enable_custom_domains ? 1 : 0

  zone_id = aws_route53_zone.application.zone_id
  name    = local.websocket_domain
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.realtime[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.realtime[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "frontend" {
  count = var.enable_custom_domains ? 1 : 0

  zone_id = aws_route53_zone.application.zone_id
  name    = local.frontend_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
