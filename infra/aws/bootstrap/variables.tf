variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "beepbite-dev"
}

variable "github_owner" {
  type    = string
  default = "richard-work-dev"
}

variable "github_owner_id" {
  type    = string
  default = "168694091"
}

variable "github_repository" {
  type    = string
  default = "beepbite"
}

variable "github_repository_id" {
  type    = string
  default = "1383642392"
}

variable "development_hosted_zone_id" {
  type    = string
  default = "Z05141911C11MWQMPGATK"
}

variable "development_certificate_arn" {
  type    = string
  default = "arn:aws:acm:us-east-1:010438497251:certificate/8a3acfb4-6099-4c4d-95ef-920588a2e02d"
}
