variable "aws_region" {
  description = "AWS region for BeepBite resources."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile used by Terraform."
  type        = string
  default     = "beepbite-dev"
}

variable "project_name" {
  description = "Prefix used for resource names."
  type        = string
  default     = "beepbite"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.project_name))
    error_message = "project_name must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "availability_zone" {
  description = "Optional availability zone. The first available AZ is used when empty."
  type        = string
  default     = ""
}

variable "instance_type" {
  description = "ARM64 EC2 type for the API and local PostgreSQL."
  type        = string
  default     = "t4g.small"
}

variable "root_volume_size_gb" {
  description = "Encrypted gp3 root volume size."
  type        = number
  default     = 30

  validation {
    condition     = var.root_volume_size_gb >= 20
    error_message = "root_volume_size_gb must be at least 20."
  }
}

variable "upload_cors_origins" {
  description = "Exact web origins allowed to upload directly to S3. Leave empty until the application hostname is known."
  type        = list(string)
  default     = []
}

variable "backup_retention_days" {
  description = "Days to retain PostgreSQL backup objects."
  type        = number
  default     = 30
}
