data "aws_ami" "amazon_linux_2023_arm64" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*-kernel-6.1-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_ecr_repository" "api" {
  name                 = "${local.name}-api"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the ten newest images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.name}/runtime"
  description             = "BeepBite runtime configuration; populate outside Terraform"
  recovery_window_in_days = 7
}

resource "aws_instance" "app" {
  ami                         = data.aws_ami.amazon_linux_2023_arm64.id
  instance_type               = var.instance_type
  availability_zone           = local.az
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  associate_public_ip_address = false
  monitoring                  = false

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/templates/bootstrap.sh.tftpl", {
    aws_region       = var.aws_region
    ecr_repository   = aws_ecr_repository.api.repository_url
    uploads_bucket   = aws_s3_bucket.uploads.id
    backups_bucket   = aws_s3_bucket.backups.id
    runtime_secret   = aws_secretsmanager_secret.runtime.name
    uploads_base_url = "https://${aws_cloudfront_distribution.uploads.domain_name}"
  })

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = var.root_volume_size_gb
  }

  lifecycle {
    ignore_changes = [ami]
  }

  tags = { Name = local.name }
}

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id

  depends_on = [aws_internet_gateway.main]
  tags       = { Name = local.name }
}
