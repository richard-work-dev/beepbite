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

variable "upload_cors_origins" {
  description = "Exact web origins allowed to upload directly to S3. Leave empty until the application hostname is known."
  type        = list(string)
  default     = []
}

variable "archive_retention_days" {
  description = "Days to retain exported archive objects."
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Lambda functions."
  type        = number
  default     = 14
}

variable "domain_name" {
  description = "Public DNS zone delegated to Route 53."
  type        = string
  default     = "rikopollo.dpdns.org"
}

variable "enable_custom_domains" {
  description = "Activates CloudFront and API Gateway aliases after the Route 53 delegation has propagated."
  type        = bool
  default     = false
}

variable "single_store_enabled" {
  description = "Restricts registration to one configured store and invited users."
  type        = bool
  default     = false
}

variable "single_store_owner_email" {
  description = "Email allowed to bootstrap the single store owner account."
  type        = string
  default     = ""
}

variable "single_store_name" {
  description = "Commercial name of the single store."
  type        = string
  default     = ""
}

variable "single_store_country" {
  description = "Country stored on the organization and primary location."
  type        = string
  default     = ""
}

variable "single_store_city" {
  description = "City stored on the primary location."
  type        = string
  default     = ""
}

variable "single_store_address" {
  description = "Street address stored on the primary location."
  type        = string
  default     = ""
}

variable "single_store_time_zone" {
  description = "IANA time zone used for trading days and local timestamps."
  type        = string
  default     = "UTC"
}

variable "single_store_currency" {
  description = "ISO 4217 currency code used by the store."
  type        = string
  default     = "USD"

  validation {
    condition     = can(regex("^[A-Z]{3}$", var.single_store_currency))
    error_message = "single_store_currency must be a three-letter uppercase ISO 4217 code."
  }
}

variable "single_store_tax_rate" {
  description = "Default store tax percentage."
  type        = number
  default     = 0

  validation {
    condition     = var.single_store_tax_rate >= 0 && var.single_store_tax_rate <= 100
    error_message = "single_store_tax_rate must be between 0 and 100."
  }
}

variable "single_store_tax_inclusive" {
  description = "Whether catalog prices already include tax."
  type        = bool
  default     = false
}
