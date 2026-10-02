locals {
  name = "${var.project_name}-${var.environment}"
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.name}/runtime"
  description             = "BeepBite runtime configuration; populate outside Terraform"
  recovery_window_in_days = 7
}
